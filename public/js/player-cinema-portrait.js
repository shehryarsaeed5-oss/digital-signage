console.log("PORTRAIT PLAYER VERSION 2 LOADED");

const ROTATION_INTERVAL_MS = 8000;
const REFRESH_INTERVAL_MS = 15000;
const GLOBAL_REFRESH_CHECK_INTERVAL_MS = 5000;
const MAX_VISIBLE_SHOWTIMES = 3;

const state = {
  items: [],
  moviePlaylistItems: [],
  adItems: [],
  combinedPlaylist: [],
  playerSettings: {
    now_showing_duration_seconds: 8,
    coming_soon_duration_seconds: 5,
    enable_ads: true,
    ad_frequency_movies: 2,
    ad_break_interval_seconds: 240,
    ads_per_break: 2,
    max_video_ad_seconds: 15,
    default_image_ad_seconds: 10,
    house_ad_fallback_enabled: true,
  },
  failedAdKeys: new Set(),
  activeIndex: 0,
  visibleSlot: 0,
  playbackToken: 0,
  lastPlaybackActivityAt: Date.now(),
  playbackWatchdogTimer: null,
  playerMode: 'waiting',
  rotationTimer: null,
  refreshTimer: null,
  refreshSignalTimer: null,
  initialized: false,
  adBreakActive: false,
  adBreakResumeIndex: 0,
  contentElapsedSeconds: 0,
  adRotationCursor: 0,
  lastRefreshToken: null,
  lastScreenRefreshToken: null,
  lastGroupRefreshToken: null,
  lastSiteRefreshToken: null,
};

const slideNodes = [
  {
    root: document.getElementById('portrait-slide-primary'),
    poster: document.getElementById('portrait-poster-primary'),
    footer: document.querySelector('#portrait-slide-primary .portrait-info-strip'),
    status: document.getElementById('portrait-status-primary'),
    title: document.getElementById('portrait-title-primary'),
    showtimes: document.getElementById('portrait-showtimes-primary'),
  },
  {
    root: document.getElementById('portrait-slide-secondary'),
    poster: document.getElementById('portrait-poster-secondary'),
    footer: document.querySelector('#portrait-slide-secondary .portrait-info-strip'),
    status: document.getElementById('portrait-status-secondary'),
    title: document.getElementById('portrait-title-secondary'),
    showtimes: document.getElementById('portrait-showtimes-secondary'),
  },
];

const emptyNode = document.getElementById('portrait-empty');
const emptyCopyNode = emptyNode ? emptyNode.querySelector('.portrait-empty-copy') : null;
const emptyCopyDefaultText = emptyCopyNode ? emptyCopyNode.textContent : '';
const playerStatusBadgeNode = createPlayerStatusBadge();
const REPORT_ENDPOINT_BASE = '/api/reports';
const REPORT_HEARTBEAT_INTERVAL_MS = 45000;
const PLAYER_HEARTBEAT_INTERVAL_MS = 30000;

const reportState = {
  heartbeatTimer: null,
  currentItem: null,
  currentStartedAt: null,
  currentToken: null,
  currentSessionId: null,
};

const PLAYER_CACHE_KEY = 'signage_cache_cinema_portrait';
const showtimeUtils = window.ShowtimeUtils || {};
const formatTodayString = showtimeUtils.formatTodayString;
const buildLocalDateTime = showtimeUtils.buildLocalDateTime;

function readPlayerCache() {
  try {
    const cachedValue = window.localStorage?.getItem(PLAYER_CACHE_KEY);
    return cachedValue ? JSON.parse(cachedValue) : null;
  } catch (error) {
    return null;
  }
}

function writePlayerCache(payload) {
  try {
    window.localStorage?.setItem(PLAYER_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Ignore cache write failures.
  }
}

function getReportItemType(item) {
  return item?.playlistType === 'ad' ? 'ad' : 'movie';
}

function getReportItemId(item) {
  return item?.id === undefined || item?.id === null ? '' : String(item.id);
}

function getReportMetadata(item) {
  const metadata = {};

  if (item?.type) {
    metadata.asset_type = item.type;
  }

  if (item?.file) {
    metadata.file = item.file;
  }

  if (item?.posterPath) {
    metadata.poster_path = item.posterPath;
  }

  if (item?.posterUrl) {
    metadata.poster_path = item.posterUrl;
  }

  if (item?.status) {
    metadata.status = item.status;
  }

  if (item?.screenTargets && item.screenTargets.length > 0) {
    metadata.screen_targets = item.screenTargets;
  }

  if (item?.isComingSoon !== undefined) {
    metadata.is_coming_soon = !!item.isComingSoon;
  }

  return metadata;
}

function buildPlaybackSessionId(item, startedAt) {
  const screen = detectPlayerScreen();
  const itemType = getReportItemType(item);
  const itemId = getReportItemId(item);

  return [screen, itemType, itemId, startedAt]
    .map((part) => encodeURIComponent(String(part ?? '')))
    .join('|');
}

function buildReportPayload(item, extra = {}) {
  const startedAt = extra.started_at || reportState.currentStartedAt || new Date().toISOString();
  const payload = {
    screen: detectPlayerScreen(),
    item_type: getReportItemType(item),
    item_id: getReportItemId(item),
    item_title: item?.title || '',
    started_at: startedAt,
    status: extra.status,
    playback_session_id: extra.playback_session_id || reportState.currentSessionId || '',
    player_path: window.location?.pathname || '',
  };

  if (extra.ended_at) {
    payload.ended_at = extra.ended_at;
  }

  if (extra.duration_seconds !== undefined) {
    payload.duration_seconds = extra.duration_seconds;
  }

  const metadata = extra.metadata || getReportMetadata(item);
  if (metadata && Object.keys(metadata).length > 0) {
    payload.metadata = metadata;
  }

  return payload;
}

function postReport(path, payload) {
  if (!path) {
    return;
  }

  fetch(`${REPORT_ENDPOINT_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

function beginPlaybackReport(item, playbackToken) {
  reportState.currentItem = item || null;
  reportState.currentStartedAt = new Date().toISOString();
  reportState.currentToken = playbackToken;
  reportState.currentSessionId = buildPlaybackSessionId(item, reportState.currentStartedAt);
  postReport('/playback/start', buildReportPayload(item, {
    started_at: reportState.currentStartedAt,
    playback_session_id: reportState.currentSessionId,
  }));
  sendHeartbeatReport();
}

function finishPlaybackReport(playbackToken, status = 'played', extra = {}) {
  if (!reportState.currentItem) {
    return;
  }

  if (playbackToken !== undefined && reportState.currentToken !== playbackToken) {
    return;
  }

  const item = reportState.currentItem;
  const startedAt = reportState.currentStartedAt || new Date().toISOString();
  const endedAt = extra.ended_at || new Date().toISOString();
  const startedTime = Date.parse(startedAt);
  const endedTime = Date.parse(endedAt);
  const durationSeconds = extra.duration_seconds !== undefined
    ? extra.duration_seconds
    : (Number.isFinite(startedTime) && Number.isFinite(endedTime) && endedTime > startedTime
        ? Math.max(1, Math.round((endedTime - startedTime) / 1000))
        : undefined);

  const payload = buildReportPayload(item, {
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    status,
    playback_session_id: reportState.currentSessionId,
    metadata: extra.metadata,
  });

  if (status === 'failed') {
    postReport('/playback/failure', payload);
  } else {
    postReport('/playback/end', payload);
  }

  reportState.currentItem = null;
  reportState.currentStartedAt = null;
  reportState.currentToken = null;
  reportState.currentSessionId = null;
}

function sendHeartbeatReport() {
  const item = reportState.currentItem;
  const payload = {
    screen: detectPlayerScreen(),
    current_item_type: item ? getReportItemType(item) : '',
    current_item_id: item ? getReportItemId(item) : '',
    current_item_title: item?.title || '',
    player_path: window.location?.pathname || '',
    status: 'online',
  };

  postReport('/heartbeat', payload);
}

function startHeartbeatReportLoop() {
  clearInterval(reportState.heartbeatTimer);
  reportState.heartbeatTimer = window.setInterval(sendHeartbeatReport, REPORT_HEARTBEAT_INTERVAL_MS);
  sendHeartbeatReport();
}

function touchPlaybackActivity() {
  state.lastPlaybackActivityAt = Date.now();
}

function startPlaybackWatchdog() {
  clearInterval(state.playbackWatchdogTimer);
  state.playbackWatchdogTimer = window.setInterval(() => {
    if (Date.now() - state.lastPlaybackActivityAt <= 90000) {
      return;
    }

    clearInterval(state.playbackWatchdogTimer);
    state.playbackWatchdogTimer = null;
    console.warn('Playback watchdog triggered; reloading portrait player.');
    location.reload();
  }, 15000);
}

function sendPlayerHeartbeat() {
  fetch('/api/player/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      screen: detectPlayerScreen(),
      page_path: window.location?.pathname || '',
      screen_name: getPlayerScreenName(),
      player_mode: state.playerMode,
      timestamp: new Date().toISOString(),
    }),
    keepalive: true,
  }).catch(() => {});
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSameLocalCalendarDate(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getUpcomingShowtimes(showtimesByDate, now = new Date()) {
  const upcoming = [];

  const todayLabel = formatTodayString();
  const todayEntry = (Array.isArray(showtimesByDate) ? showtimesByDate : []).find((entry) => entry?.date === todayLabel);
  if (!todayEntry) {
    return [];
  }

  const screenGroups = Array.isArray(todayEntry?.screenTimes) && todayEntry.screenTimes.length > 0
    ? todayEntry.screenTimes
    : [{
        screen: todayEntry?.screen || '',
        times: Array.isArray(todayEntry?.times) ? todayEntry.times : [],
      }];

  screenGroups.forEach((group) => {
    const screen = String(group?.screen || todayEntry?.screen || '').trim();
    const times = Array.isArray(group?.times) ? group.times : [];

    times.forEach((time) => {
      const dateTime = buildLocalDateTime(todayEntry.date, time);
      if (!dateTime || dateTime.getTime() <= now.getTime()) {
        return;
      }

      upcoming.push({
        label: String(time).trim().replace(/\s*(AM|PM)\b/i, ' $1').replace(/\s+/g, ' ').trim(),
        screen,
        dateTime,
      });
    });
  });

  return upcoming.sort((left, right) => left.dateTime.getTime() - right.dateTime.getTime());
}

function formatReleaseDate(dateStr) {
  if (!dateStr) return '';

  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    return '';
  }

  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: '2-digit',
    year: 'numeric',
  });
}

function normalizeMovies(data) {
  const now = data.serverNow ? new Date(data.serverNow) : new Date();

  const nowShowing = (Array.isArray(data?.nowShowing) ? data.nowShowing : [])
    .map((movie) => {
      const isComingSoon = String(movie?.status || '').trim().toLowerCase() === 'coming_soon' || movie?.isComingSoon === true;
      const upcomingShowtimes = getUpcomingShowtimes(movie?.showtimesByDate, now);

      return {
        id: `now-${movie?.id ?? movie?.title ?? Math.random()}`,
        title: movie?.title || 'Untitled Movie',
        posterUrl: movie?.posterPath || '',
        runtime: movie?.runtime || '',
        genre: movie?.genre || '',
        status: movie?.status || (isComingSoon ? 'coming_soon' : 'now_showing'),
        releaseDate: movie?.releaseDate || movie?.release_date || '',
        showtimes: upcomingShowtimes.slice(0, MAX_VISIBLE_SHOWTIMES),
        isComingSoon,
      };
    })
    .filter((movie) => movie.showtimes.length > 0);

  const comingSoon = (Array.isArray(data?.comingSoon) ? data.comingSoon : []).map((movie) => ({
    id: `coming-${movie?.id ?? movie?.title ?? Math.random()}`,
    title: movie?.title || 'Untitled Movie',
    posterUrl: movie?.posterPath || '',
    runtime: movie?.runtime || '',
    genre: movie?.genre || '',
    status: movie?.status || 'coming_soon',
    releaseDate: movie?.releaseDate || movie?.release_date || '',
    showtimes: [],
    isComingSoon: true,
  }));

  return [...nowShowing, ...comingSoon];
}

function formatRuntimeBadge(runtime) {
  const text = String(runtime || '').trim().toLowerCase();
  if (!text) {
    return '';
  }

  const hoursMatch = text.match(/(\d+)\s*h(?:ours?)?/);
  const minutesMatch = text.match(/(\d+)\s*m(?:in(?:utes?)?)?/);

  if (hoursMatch || minutesMatch) {
    const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
    const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
    const totalMinutes = (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
    if (totalMinutes > 0) {
      return `${totalMinutes}M`;
    }
  }

  const directMinutesMatch = text.match(/\b(\d{2,3})\b/);
  if (directMinutesMatch) {
    return `${directMinutesMatch[1]}M`;
  }

  return '';
}

function getBadgeLabel(item) {
  if (!item || item?.playlistType === 'ad') {
    return '';
  }

  const ratingCandidates = [
    item.rating,
    item.ageRating,
    item.classification,
    item.certificate,
  ];

  for (const candidate of ratingCandidates) {
    const text = String(candidate || '').trim().toUpperCase();
    if (text) {
      return text;
    }
  }

  if (item.isComingSoon) {
    return 'SOON';
  }

  const runtimeLabel = formatRuntimeBadge(item.runtime);
  if (runtimeLabel) {
    return runtimeLabel;
  }

  const genreLabel = String(item.genre || '').trim().toUpperCase();
  if (genreLabel) {
    const primaryGenre = genreLabel.split(/[\s,/|-]+/).filter(Boolean)[0] || '';
    if (primaryGenre) {
      return primaryGenre.slice(0, 4);
    }
  }

  return '--';
}

function normalizeAds(data) {
  return (Array.isArray(data) ? data : [])
    .filter((ad) => ad && ad.file && (ad.type === 'image' || ad.type === 'video'))
    .map((ad) => ({
      id: ad.id,
      title: ad.title || 'Untitled Ad',
      file: ad.file,
      type: ad.type,
      duration: Number.isFinite(Number(ad.duration_seconds))
        ? Number(ad.duration_seconds)
        : (Number.isFinite(Number(ad.duration)) ? Number(ad.duration) : null),
      screenTargets: Array.isArray(ad.screenTargets)
        ? ad.screenTargets
        : (Array.isArray(ad.screen_targets) ? ad.screen_targets : []),
      playlistType: 'ad',
    }));
}

function isAdsEnabledForScreen(settings) {
  return settings?.ads_enabled !== false && settings?.enable_ads !== false;
}

function getAdBreakConfig() {
  const settings = state.playerSettings || {};

  return {
    adsEnabled: settings?.ads_enabled !== false && settings?.enable_ads !== false,
    intervalSeconds: Number.isFinite(Number(settings.ad_break_interval_seconds))
      ? Math.max(15, Math.min(3600, Number(settings.ad_break_interval_seconds)))
      : 240,
    adsPerBreak: Number.isFinite(Number(settings.ads_per_break))
      ? Math.max(1, Math.min(10, Number(settings.ads_per_break)))
      : 2,
    maxVideoAdSeconds: Number.isFinite(Number(settings.max_video_ad_seconds))
      ? Math.max(1, Math.min(120, Number(settings.max_video_ad_seconds)))
      : 15,
    defaultImageAdSeconds: Number.isFinite(Number(settings.default_image_ad_seconds))
      ? Math.max(1, Math.min(120, Number(settings.default_image_ad_seconds)))
      : 10,
    houseAdFallbackEnabled: settings?.house_ad_fallback_enabled !== false,
  };
}

function getAdPlaybackDurationSeconds(adItem) {
  const config = getAdBreakConfig();
  const rawDuration = Number(adItem?.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;

  if (adItem?.type === 'video') {
    const videoDuration = duration || config.maxVideoAdSeconds;
    return Math.max(1, Math.min(videoDuration, config.maxVideoAdSeconds));
  }

  return Math.max(1, duration || config.defaultImageAdSeconds);
}

function getNextAdBreakItems() {
  const config = getAdBreakConfig();
  if (!config.adsEnabled) {
    return [];
  }

  const playableAds = getPlayableAds(state.adItems);
  if (playableAds.length === 0) {
    return [];
  }

  const selectionCount = Math.min(config.adsPerBreak, playableAds.length);
  const startIndex = ((state.adRotationCursor % playableAds.length) + playableAds.length) % playableAds.length;
  const selected = [];

  for (let offset = 0; offset < selectionCount; offset += 1) {
    const index = (startIndex + offset) % playableAds.length;
    selected.push(playableAds[index]);
  }

  state.adRotationCursor = (startIndex + selected.length) % playableAds.length;
  return selected;
}

function enterAdBreak(resumeIndex) {
  const config = getAdBreakConfig();
  const nextAdItems = getNextAdBreakItems();

  if (nextAdItems.length === 0) {
    state.contentElapsedSeconds = Math.max(0, state.contentElapsedSeconds - config.intervalSeconds);
    resumeContentPlayback(resumeIndex);
    return;
  }

  state.adBreakActive = true;
  state.adBreakResumeIndex = resumeIndex;
  state.combinedPlaylist = nextAdItems;
  state.items = nextAdItems;
  state.activeIndex = 0;
  showItem(0, true);
  startRotation();
}

function resumeContentPlayback(resumeIndex = state.adBreakResumeIndex) {
  const contentItems = Array.isArray(state.moviePlaylistItems) ? state.moviePlaylistItems : [];
  if (contentItems.length === 0) {
    state.adBreakActive = false;
    state.adBreakResumeIndex = 0;
    state.items = [];
    state.combinedPlaylist = [];
    showEmptyState();
    return;
  }

  const normalizedResumeIndex = ((resumeIndex % contentItems.length) + contentItems.length) % contentItems.length;
  state.adBreakActive = false;
  state.adBreakResumeIndex = 0;
  state.combinedPlaylist = contentItems;
  state.items = contentItems;
  state.activeIndex = normalizedResumeIndex;
  showItem(normalizedResumeIndex, true);
  startRotation();
}

function normalizeScreenLabel(label) {
  const text = String(label || '').toLowerCase().trim();
  if (!text) return '';
  if (text.includes('3x2')) return 'cinema-3x2';
  if (text.includes('portrait')) return 'cinema-portrait';
  if (text.includes('cinema')) return 'cinema';
  return text;
}

function detectPlayerScreen() {
  let path = String(window.location?.pathname || '').toLowerCase();
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  if (path === '/player/cinema-portrait') return 'cinema-portrait';
  if (path === '/player/cinema-3x2') return 'cinema-3x2';
  if (path === '/player/cinema') return 'cinema';
  return 'cinema-portrait';
}

function getPlayerScreenName() {
  try {
    return new URLSearchParams(window.location?.search || '').get('screen_name')?.trim() || '';
  } catch (error) {
    return '';
  }
}

function getAdKey(adItem) {
  return `${adItem?.id || 'unknown'}:${adItem?.file || ''}:${adItem?.type || ''}`;
}

function getPlayableAds(adItems) {
  return (Array.isArray(adItems) ? adItems : []).filter((adItem) => !state.failedAdKeys.has(getAdKey(adItem)));
}

function buildCombinedPlaylist(movieItems, adItems, playerSettings) {
  const movies = Array.isArray(movieItems) ? movieItems : [];
  void adItems;
  void playerSettings;
  return [...movies];
}

function getPlaylistItemDurationSeconds(item) {
  if (item?.playlistType === 'ad') {
    return getAdPlaybackDurationSeconds(item);
  }

  return item?.isComingSoon
    ? Math.max(1, state.playerSettings.coming_soon_duration_seconds)
    : Math.max(1, state.playerSettings.now_showing_duration_seconds);
}

function rebuildCombinedPlaylist() {
  const previousItem = state.combinedPlaylist[state.activeIndex];
  const previousIndex = state.activeIndex;
  const nextPlaylist = buildCombinedPlaylist(
    state.moviePlaylistItems,
    state.adItems,
    state.playerSettings
  );

  if (state.adBreakActive) {
    state.moviePlaylistItems = nextPlaylist;
    return;
  }

  state.combinedPlaylist = nextPlaylist;
  state.items = nextPlaylist;

  if (!previousItem) {
    state.activeIndex = 0;
    return;
  }

  const matchedIndex = state.combinedPlaylist.findIndex((item) =>
    item.playlistType === previousItem?.playlistType &&
    item.id === previousItem?.id &&
    item.title === previousItem?.title
  );

  state.activeIndex = matchedIndex >= 0
    ? matchedIndex
    : Math.max(-1, Math.min(previousIndex - 1, state.combinedPlaylist.length - 1));
}

function showEmptyState(message = emptyCopyDefaultText) {
  if (emptyCopyNode) {
    emptyCopyNode.textContent = message || emptyCopyDefaultText;
  }
  emptyNode.classList.remove('hidden');
  slideNodes.forEach((slot) => {
    slot.root.classList.remove('is-visible');
    slot.root.setAttribute('aria-hidden', 'true');
  });
}

function showWaitingForServerMessage() {
  setPlayerStatusBadge('Waiting for server');
  showEmptyState('Waiting for server...');
}

function createPlayerStatusBadge() {
  if (!document?.body) {
    return null;
  }

  const badge = document.createElement('div');
  badge.setAttribute('aria-hidden', 'true');
  badge.style.position = 'fixed';
  badge.style.top = '12px';
  badge.style.right = '12px';
  badge.style.zIndex = '1000';
  badge.style.padding = '5px 10px';
  badge.style.borderRadius = '999px';
  badge.style.border = '1px solid rgba(255, 255, 255, 0.16)';
  badge.style.background = 'rgba(2, 6, 23, 0.56)';
  badge.style.color = '#e5e7eb';
  badge.style.fontSize = '10px';
  badge.style.fontWeight = '700';
  badge.style.letterSpacing = '0.14em';
  badge.style.textTransform = 'uppercase';
  badge.style.lineHeight = '1';
  badge.style.pointerEvents = 'none';
  badge.style.backdropFilter = 'blur(6px)';
  badge.style.webkitBackdropFilter = 'blur(6px)';
  badge.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.18)';
  badge.style.display = 'none';
  badge.textContent = 'Waiting for server';
  document.body.appendChild(badge);
  return badge;
}

function setPlayerStatusBadge(label) {
  if (!playerStatusBadgeNode) {
    return;
  }

  const text = String(label || '').trim() || 'Waiting for server';
  state.playerMode = text === 'Live' ? 'live' : text === 'Cached' ? 'cached' : 'waiting';
  playerStatusBadgeNode.textContent = text;
  playerStatusBadgeNode.style.display = 'block';
  playerStatusBadgeNode.style.borderColor =
    text === 'Live'
      ? 'rgba(34, 197, 94, 0.35)'
      : text === 'Cached'
        ? 'rgba(251, 191, 36, 0.38)'
        : 'rgba(255, 255, 255, 0.16)';
  playerStatusBadgeNode.style.color =
    text === 'Live'
      ? '#bbf7d0'
      : text === 'Cached'
        ? '#fde68a'
        : '#e5e7eb';
}

function hideEmptyState() {
  emptyNode.classList.add('hidden');
}

function renderPoster(node, item) {
  if (item?.playlistType === 'ad' && item?.type === 'video') {
    node.innerHTML = `
      <video
        class="portrait-poster-video"
        src="${escapeHtml(item.file)}"
        autoplay
        muted
        playsinline
        loop
      ></video>
    `;
    return;
  }

  const posterUrl = item?.playlistType === 'ad' ? item?.file : item?.posterUrl;
  if (!posterUrl) {
    node.innerHTML = '<div class="portrait-poster-fallback">Poster unavailable</div>';
    return;
  }

  const altText = item?.playlistType === 'ad'
    ? `${escapeHtml(item.title)} ad`
    : `${escapeHtml(item.title)} poster`;
  node.innerHTML = `<img class="portrait-poster-image" src="${escapeHtml(posterUrl)}" alt="${altText}">`;
}

function renderStatus(node, item) {
  if (item?.playlistType === 'ad') {
    node.innerHTML = '';
    return;
  }

  const label = getBadgeLabel(item) || '--';
  node.innerHTML = `<span class="portrait-rating-value">${escapeHtml(label)}</span>`;
}

function renderShowtimes(node, item) {
  if (item?.playlistType === 'ad') {
    node.innerHTML = '';
    node.classList.add('hidden');
    return;
  }

  const isComingSoon = item?.isComingSoon || String(item?.status || '').trim().toLowerCase() === 'coming_soon';

  if (isComingSoon) {
    const releaseDate = formatReleaseDate(item?.releaseDate || item?.release_date || '');
    node.innerHTML = `
      <div class="portrait-coming-soon">
        <div class="portrait-coming-label">COMING SOON</div>
        <div class="portrait-coming-date">${escapeHtml(releaseDate || '')}</div>
      </div>
    `;
    node.classList.remove('hidden');
    return;
  }

  const showtimes = Array.isArray(item.showtimes) ? item.showtimes.slice(0, MAX_VISIBLE_SHOWTIMES) : [];

  if (showtimes.length === 0) {
    node.innerHTML = '';
    node.classList.add('hidden');
    return;
  }

  const paddedShowtimes = [...showtimes];
  while (paddedShowtimes.length < MAX_VISIBLE_SHOWTIMES) {
    paddedShowtimes.push({ isEmpty: true });
  }

  node.innerHTML = paddedShowtimes
    .map((showtime, index) => {
      if (showtime?.isEmpty) {
        return `
          <span class="portrait-showtime portrait-showtime-secondary is-secondary is-empty" aria-hidden="true"></span>
        `;
      }

      if (index === 0) {
        return `
          <span class="portrait-showtime is-next">
            <span class="portrait-showtime-label">NEXT SHOW</span>
            <span class="portrait-showtime-text">${escapeHtml(showtime.label)}</span>
            <span class="portrait-showtime-screen">${escapeHtml(showtime.screen || '-')}</span>
          </span>
        `;
      }

      return `
        <span class="portrait-showtime portrait-showtime-secondary is-secondary">
          <span class="portrait-showtime-text">${escapeHtml(showtime.label)}</span>
          <span class="portrait-showtime-screen">${escapeHtml(showtime.screen || '-')}</span>
      </span>
    `;
    })
    .join('');

  node.classList.remove('hidden');
}

function renderSlide(slot, item) {
  const isAd = item?.playlistType === 'ad';
  if (slot.root) {
    slot.root.classList.toggle('is-ad-mode', isAd);
  }
  if (slot.footer) {
    slot.footer.classList.toggle('is-ad-mode', isAd);
    slot.footer.hidden = isAd;
    slot.footer.style.display = isAd ? 'none' : '';
  }
  if (slot.title) {
    slot.title.hidden = isAd;
  }
  if (slot.status) {
    slot.status.hidden = isAd;
  }
  if (slot.showtimes) {
    slot.showtimes.hidden = isAd;
  }

  renderPoster(slot.poster, item);

  if (isAd) {
    if (slot.status) {
      slot.status.innerHTML = '';
    }
    if (slot.title) {
      slot.title.textContent = '';
    }
    if (slot.showtimes) {
      slot.showtimes.innerHTML = '';
    }
    return;
  }

  renderStatus(slot.status, item);
  slot.title.textContent = item.title;
  renderShowtimes(slot.showtimes, item);
}

function showItem(index, immediate = false) {
  if (state.items.length === 0) {
    showEmptyState();
    return;
  }

  hideEmptyState();
  touchPlaybackActivity();
  state.activeIndex = ((index % state.items.length) + state.items.length) % state.items.length;
  state.playbackToken += 1;
  const playbackToken = state.playbackToken;
  beginPlaybackReport(state.items[state.activeIndex], playbackToken);

  const nextSlotIndex = immediate ? state.visibleSlot : (state.visibleSlot === 0 ? 1 : 0);
  const previousSlotIndex = immediate ? (nextSlotIndex === 0 ? 1 : 0) : state.visibleSlot;
  const nextSlot = slideNodes[nextSlotIndex];
  const previousSlot = slideNodes[previousSlotIndex];

  renderSlide(nextSlot, state.items[state.activeIndex]);
  
  // Use a small delay to ensure the browser has processed the DOM replacement
  // so the CSS animation restarts reliably from 0%
  requestAnimationFrame(() => {
    nextSlot.root.classList.add('is-visible');
    nextSlot.root.setAttribute('aria-hidden', 'false');
    touchPlaybackActivity();

    if (!immediate) {
      previousSlot.root.classList.remove('is-visible');
      previousSlot.root.setAttribute('aria-hidden', 'true');
      touchPlaybackActivity();
    }
  });

  state.visibleSlot = nextSlotIndex;
}

function startRotation() {
  clearTimeout(state.rotationTimer);
  state.rotationTimer = null;

  const playbackToken = state.playbackToken;
  const currentItem = state.items[state.activeIndex];
  const currentDurationSeconds = Math.max(1, getPlaylistItemDurationSeconds(currentItem));
  state.rotationTimer = window.setTimeout(() => {
    finishPlaybackReport(playbackToken, 'played');
    if (currentItem?.playlistType === 'ad' && state.adBreakActive) {
      const nextAdIndex = state.activeIndex + 1;
      if (nextAdIndex < state.items.length) {
        showItem(nextAdIndex);
        startRotation();
        return;
      }

      resumeContentPlayback();
      return;
    }

    if (currentItem?.playlistType !== 'ad') {
      state.contentElapsedSeconds += currentDurationSeconds;
      const config = getAdBreakConfig();
      if (config.adsEnabled && state.contentElapsedSeconds >= config.intervalSeconds) {
        state.contentElapsedSeconds = Math.max(0, state.contentElapsedSeconds - config.intervalSeconds);
        enterAdBreak(state.activeIndex + 1);
        return;
      }
    }

    showItem(state.activeIndex + 1);
    startRotation();
  }, currentDurationSeconds * 1000);
}

function applyItems(items) {
  const previousItem = state.items[state.activeIndex];
  state.items = Array.isArray(items) ? items : [];

  if (state.items.length === 0) {
    showEmptyState();
    clearTimeout(state.rotationTimer);
    state.rotationTimer = null;
    finishPlaybackReport(state.playbackToken, 'interrupted', {
      metadata: {
        reason: 'no items available',
      },
    });
    return;
  }

  if (!state.initialized) {
    state.initialized = true;
    showItem(0, true);
    startRotation();
    return;
  }

  const replacementIndex = previousItem
    ? Math.max(0, state.items.findIndex((item) => item.id === previousItem.id))
    : 0;

  finishPlaybackReport(state.playbackToken, 'interrupted', {
    metadata: {
      reason: 'playlist refreshed',
    },
  });
  showItem(replacementIndex, true);
  startRotation();
}

function applyPlayerSettings(settings) {
  state.playerSettings = {
    now_showing_duration_seconds: Number.isFinite(Number(settings?.now_showing_duration_seconds))
      ? Number(settings.now_showing_duration_seconds)
      : 8,
    coming_soon_duration_seconds: Number.isFinite(Number(settings?.coming_soon_duration_seconds))
      ? Number(settings.coming_soon_duration_seconds)
      : 5,
    enable_ads: settings?.enable_ads !== false,
    ads_enabled: settings?.ads_enabled !== false,
    ad_frequency_movies: Number.isFinite(Number(settings?.ad_frequency_movies))
      ? Math.min(10, Math.max(1, Number(settings.ad_frequency_movies)))
      : 2,
    ad_break_interval_seconds: Number.isFinite(Number(settings?.ad_break_interval_seconds))
      ? Number(settings.ad_break_interval_seconds)
      : 240,
    ads_per_break: Number.isFinite(Number(settings?.ads_per_break))
      ? Number(settings.ads_per_break)
      : 2,
    max_video_ad_seconds: Number.isFinite(Number(settings?.max_video_ad_seconds))
      ? Number(settings.max_video_ad_seconds)
      : 15,
    default_image_ad_seconds: Number.isFinite(Number(settings?.default_image_ad_seconds))
      ? Number(settings.default_image_ad_seconds)
      : 10,
    house_ad_fallback_enabled: settings?.house_ad_fallback_enabled !== false,
  };
}

async function pollGlobalRefreshToken() {
  try {
    const query = new URLSearchParams({
      screen: detectPlayerScreen(),
      page_path: window.location?.pathname || '',
    });
    const screenName = getPlayerScreenName();
    if (screenName) {
      query.set('screen_name', screenName);
    }

    const response = await fetch(`/api/player-settings/refresh-token?${query.toString()}`, { cache: 'no-store' });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    const refreshToken = String(payload?.refreshToken || '');
    const screenRefreshToken = String(payload?.screenRefreshToken || '');
    const groupRefreshToken = String(payload?.groupRefreshToken || '');
    const siteRefreshToken = String(payload?.siteRefreshToken || '');
    let shouldReload = false;

    if (state.lastRefreshToken === null) {
      state.lastRefreshToken = refreshToken;
    } else if (refreshToken !== state.lastRefreshToken) {
      shouldReload = true;
    }

    if (state.lastScreenRefreshToken === null) {
      state.lastScreenRefreshToken = screenRefreshToken;
    } else if (screenRefreshToken !== state.lastScreenRefreshToken) {
      shouldReload = true;
    }

    if (state.lastGroupRefreshToken === null) {
      state.lastGroupRefreshToken = groupRefreshToken;
    } else if (groupRefreshToken !== state.lastGroupRefreshToken) {
      shouldReload = true;
    }

    if (state.lastSiteRefreshToken === null) {
      state.lastSiteRefreshToken = siteRefreshToken;
    } else if (siteRefreshToken !== state.lastSiteRefreshToken) {
      shouldReload = true;
    }

    if (shouldReload) {
      window.location.reload();
    }
  } catch (error) {
    console.warn('Failed to check refresh token', error);
  }
}

function applyAppearanceSettings(settings) {
  if (!settings) return;

  const root = document.documentElement;
  const mapping = {
    portrait_strip_height_vh: '--portrait-strip-height',
    portrait_title_font_size_vh: '--portrait-title-size',
    portrait_status_font_size_vh: '--portrait-status-size',
    portrait_gap_vh: '--portrait-gap',
    portrait_showtime_height_vh: '--portrait-showtime-height',
    portrait_badge_width_percent: '--portrait-badge-width',
    portrait_info_padding_vh: '--portrait-info-padding',
  };

  for (const [key, variable] of Object.entries(mapping)) {
    if (settings[key] !== undefined) {
      const unit = key.includes('percent') ? '%' : 'vh';
      root.style.setProperty(variable, `${settings[key]}${unit}`);
    }
  }
}

async function fetchMovies() {
  try {
    const screen = detectPlayerScreen();
    const response = await fetch(`/api/cinema-movies?screen=${screen}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const data = payload.data || {};
    
    applyAppearanceSettings(data.playerSettings);

    const nowShowing = Array.isArray(data.nowShowing) ? data.nowShowing : [];
    const comingSoon = Array.isArray(data.comingSoon) ? data.comingSoon : [];
    state.moviePlaylistItems = normalizeMovies({ nowShowing, comingSoon });
    applyPlayerSettings(data.playerSettings);

    let ads = [];
    if (isAdsEnabledForScreen(data.playerSettings)) {
      const adsResponse = await fetch(`/api/ads?screen=${screen}`, { cache: 'no-store' });
      ads = adsResponse.ok ? normalizeAds(await adsResponse.json()) : [];
    }

    writePlayerCache({ data, ads });
    console.log('fresh data loaded', { player: 'cinema_portrait' });
    setPlayerStatusBadge('Live');

    state.adItems = ads;
    rebuildCombinedPlaylist();
    if (!state.adBreakActive) {
      applyItems(state.combinedPlaylist);
    }
    startHeartbeatReportLoop();
  } catch (error) {
    console.error('Failed to load movies', error);
    const cachedPayload = readPlayerCache();
    if (cachedPayload && cachedPayload.data !== undefined) {
      console.log('cached data used', { player: 'cinema_portrait' });
      setPlayerStatusBadge('Cached');
      const data = cachedPayload.data || {};
      applyAppearanceSettings(data.playerSettings);

      const nowShowing = Array.isArray(data.nowShowing) ? data.nowShowing : [];
      const comingSoon = Array.isArray(data.comingSoon) ? data.comingSoon : [];
      state.moviePlaylistItems = normalizeMovies({ nowShowing, comingSoon });
      applyPlayerSettings(data.playerSettings);
      state.adItems = Array.isArray(cachedPayload.ads) ? cachedPayload.ads : [];
      rebuildCombinedPlaylist();
      if (!state.adBreakActive) {
        applyItems(state.combinedPlaylist);
      }
      startHeartbeatReportLoop();
      return;
    }

    console.log('no cache available', { player: 'cinema_portrait' });
    if (!state.initialized || state.items.length === 0) {
      showWaitingForServerMessage();
    }
  }
}

fetchMovies();
state.refreshTimer = window.setInterval(fetchMovies, REFRESH_INTERVAL_MS);
void pollGlobalRefreshToken();
state.refreshSignalTimer = window.setInterval(pollGlobalRefreshToken, GLOBAL_REFRESH_CHECK_INTERVAL_MS);
startPlaybackWatchdog();
sendPlayerHeartbeat();
window.setInterval(sendPlayerHeartbeat, PLAYER_HEARTBEAT_INTERVAL_MS);
