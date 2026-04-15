const REFRESH_INTERVAL_MS = 15000;
const GLOBAL_REFRESH_CHECK_INTERVAL_MS = 5000;

const state = {
  refreshTimer: null,
  refreshSignalTimer: null,
  hasRenderedData: false,
  moviePlaylistItems: [],
  adItems: [],
  failedAdKeys: new Set(),
  loggedAdSkipKeys: new Set(),
  combinedPlaylist: [],
  playbackIndex: 0,
  playbackTimer: null,
  playbackToken: 0,
  nowShowingMovies: [],
  nowShowingPage: 0,
  nowShowingTimer: null,
  playbackWatchdogTimer: null,
  lastPlaybackActivityAt: Date.now(),
  playerMode: 'waiting',
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
  adBreakActive: false,
  adBreakResumeIndex: 0,
  contentElapsedSeconds: 0,
  adRotationCursor: 0,
  lastRefreshToken: null,
  lastScreenRefreshToken: null,
  lastGroupRefreshToken: null,
  lastSiteRefreshToken: null,
};

const SLOT_CONFIG = [
  { id: 'now-slot-3x2-1' },
  { id: 'now-slot-3x2-2' },
  { id: 'now-slot-3x2-3' },
  { id: 'now-slot-3x2-4' },
  { id: 'now-slot-3x2-5' },
  { id: 'now-slot-3x2-6' },
];

const NOW_SHOWING_PAGE_SIZE = 6;

const playerNode = document.getElementById('cinema-player-3x2');
const statusNode = document.getElementById('cinema-status-3x2');
const clockNode = document.getElementById('cinema-clock-3x2');
const nowShowingSlotNodes = SLOT_CONFIG.map((slot) => document.getElementById(slot.id));
const adOverlayNode = createAdOverlay();
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

const PLAYER_CACHE_KEY = 'signage_cache_cinema_3x2';
const showtimeUtils = window.ShowtimeUtils || {};
const formatTodayString = showtimeUtils.formatTodayString;
const parseDateLabel = showtimeUtils.parseDateLabel;
const parseTimeLabel = showtimeUtils.parseTimeLabel;
const buildLocalDateTime = showtimeUtils.buildLocalDateTime;
const filterTodayShowtimes = showtimeUtils.filterTodayShowtimes;

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

function showWaitingForServerMessage() {
  setPlayerStatusBadge('Waiting for server');
  if (statusNode) {
    statusNode.textContent = 'Waiting for server...';
  }
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

  if (item?.status) {
    metadata.status = item.status;
  }

  if (item?.screenTargets && item.screenTargets.length > 0) {
    metadata.screen_targets = item.screenTargets;
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
  touchPlaybackActivity();
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
    console.warn('Playback watchdog triggered; reloading cinema 3x2 player.');
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

function createAdOverlay() {
  if (!playerNode) {
    return null;
  }

  const overlay = document.createElement('section');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '999';
  overlay.style.display = 'none';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '32px';
  overlay.style.background = 'linear-gradient(180deg, #050816 0%, #101827 100%)';

  const image = document.createElement('img');
  image.alt = 'Cinema ad';
  image.style.maxWidth = '100%';
  image.style.maxHeight = '100%';
  image.style.width = '100%';
  image.style.height = '100%';
  image.style.objectFit = 'contain';
  image.style.borderRadius = '22px';
  image.style.boxShadow = '0 24px 80px rgba(0, 0, 0, 0.45)';
  image.style.display = 'none';

  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('autoplay', '');
  video.setAttribute('playsinline', '');
  video.style.maxWidth = '100%';
  video.style.maxHeight = '100%';
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'contain';
  video.style.borderRadius = '22px';
  video.style.boxShadow = '0 24px 80px rgba(0, 0, 0, 0.45)';
  video.style.display = 'none';

  overlay.appendChild(image);
  overlay.appendChild(video);
  playerNode.appendChild(overlay);
  return overlay;
}

function filterNowShowingMovies(movies, now = new Date()) {
  return (Array.isArray(movies) ? movies : [])
    .map((movie) => {
      if (movie?.status !== 'Now Showing') {
        return movie;
      }

      return {
        ...movie,
        showtimesByDate: filterTodayShowtimes(movie.showtimesByDate, now),
      };
    })
    .filter((movie) => movie?.status !== 'Now Showing' || movie.showtimesByDate.length > 0);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function flattenUpcomingShowtimes(showtimesByDate) {
  return (Array.isArray(showtimesByDate) ? showtimesByDate : []).flatMap((entry) =>
    (Array.isArray(entry?.times) ? entry.times : [])
      .filter(Boolean)
      .map((time) => ({
        date: entry.date,
        time,
        dateTime: buildLocalDateTime(entry.date, time),
      }))
      .filter((entryWithDate) => entryWithDate.dateTime)
  );
}

function formatScheduleLabel(dateLabel) {
  if (dateLabel === formatTodayString()) {
    return 'Today';
  }

  return dateLabel;
}

function getDisplayShowtimes(movie, maxTimes = 4) {
  const upcoming = flattenUpcomingShowtimes(movie.showtimesByDate);
  if (upcoming.length === 0) {
    return {
      scheduleLabel: '',
      times: [],
    };
  }

  const firstDate = upcoming[0].date;
  const sameDateTimes = upcoming.filter((entry) => entry.date === firstDate).slice(0, maxTimes);
  const times = sameDateTimes.length >= 2 ? sameDateTimes : upcoming.slice(0, Math.max(2, maxTimes));

  return {
    scheduleLabel: formatScheduleLabel(firstDate),
    times: times.slice(0, maxTimes),
  };
}

function renderPoster(movie, extraClass = '') {
  const className = extraClass ? `cinema-poster-shell ${extraClass}` : 'cinema-poster-shell';
  return movie.posterPath
    ? `<div class="${className}"><img class="cinema-poster" src="${escapeHtml(movie.posterPath)}" alt="${escapeHtml(movie.title)} poster"></div>`
    : `<div class="${className}"><div class="cinema-poster cinema-poster-fallback">Poster Unavailable</div></div>`;
}

function renderStandardNowShowingCard(movie) {
  const card = document.createElement('article');
  card.className = 'cinema-card';

  const showtimeDisplay = getDisplayShowtimes(movie, 4);
  const timePills = showtimeDisplay.times.length > 0
    ? showtimeDisplay.times
        .map(
          (entry, index) =>
            `<span class="cinema-time-pill ${index === 0 ? 'current' : ''}">${escapeHtml(entry.time)}</span>`
        )
        .join('')
    : '<div class="cinema-note">Session times at counter.</div>';

  card.innerHTML = `
    ${renderPoster(movie, 'cinema-poster-shell-main')}
    <div class="cinema-card-info">
      <div class="cinema-card-top">
        <h3 class="cinema-card-title">${escapeHtml(movie.title)}</h3>
        <span class="cinema-card-status">${escapeHtml(movie.status || 'Now Showing')}</span>
        ${movie.runtime ? `<span class="cinema-card-runtime">${escapeHtml(movie.runtime)}</span>` : ''}
      </div>
      <div class="cinema-card-bottom">
        <div class="cinema-showtimes-grid">
          ${timePills}
        </div>
      </div>
    </div>
  `;

  return card;
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

  const root = document.documentElement;
  const posterWidthValue = Number(settings?.poster_width_percent ?? settings?.cinema_wall_poster_width_percent);
  root.style.setProperty(
    '--cinema-3x2-poster-width',
    `${Number.isFinite(posterWidthValue) ? posterWidthValue : 40}%`
  );

  const rowHeightValue = Number(settings?.row_height_percent);
  root.style.setProperty(
    '--cinema-3x2-row-scale',
    `${Number.isFinite(rowHeightValue) ? rowHeightValue / 100 : 1}`
  );
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
  return settings?.ads_enabled !== false
    && settings?.enable_ads !== false
    && settings?.cinema_3x2_ads_enabled !== false;
}

function getAdBreakConfig() {
  const settings = state.playerSettings || {};

  return {
    adsEnabled: settings?.ads_enabled !== false
      && settings?.enable_ads !== false
      && settings?.cinema_3x2_ads_enabled !== false,
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

function startAdBreakPlayback(resumeIndex) {
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
  state.playbackIndex = 0;
  runCombinedPlaybackLoop();
}

function resumeContentPlayback(resumeIndex = state.adBreakResumeIndex) {
  const contentItems = Array.isArray(state.moviePlaylistItems) ? state.moviePlaylistItems : [];
  if (contentItems.length === 0) {
    state.adBreakActive = false;
    state.adBreakResumeIndex = 0;
    state.combinedPlaylist = [];
    hideAdOverlay();
    return;
  }

  const normalizedResumeIndex = ((resumeIndex % contentItems.length) + contentItems.length) % contentItems.length;
  state.adBreakActive = false;
  state.adBreakResumeIndex = 0;
  state.combinedPlaylist = contentItems;
  state.playbackIndex = normalizedResumeIndex;
  hideAdOverlay();
  runCombinedPlaybackLoop();
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
  return 'cinema-3x2';
}

function getPlayerScreenName() {
  try {
    return new URLSearchParams(window.location?.search || '').get('screen_name')?.trim() || '';
  } catch (error) {
    return '';
  }
}

function isAdTargetedToScreen(ad, screen) {
  const normalizedScreen = normalizeScreenLabel(screen);
  const targets = Array.isArray(ad?.screenTargets)
    ? ad.screenTargets.map(normalizeScreenLabel).filter(Boolean)
    : [];

  console.log('Ad targets:', targets);
  if (targets.length === 0) return true;
  return targets.includes(normalizedScreen);
}

function normalizeMoviePlaylistItems(nowShowingMovies) {
  return (Array.isArray(nowShowingMovies) ? nowShowingMovies : []).map((movie) => ({
    ...movie,
    playlistType: 'movie',
  }));
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

function rebuildCombinedPlaylist() {
  const previousItem = state.combinedPlaylist[state.playbackIndex];
  const previousIndex = state.playbackIndex;
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

  if (!previousItem) {
    state.playbackIndex = 0;
    return;
  }

  const matchedIndex = state.combinedPlaylist.findIndex((item) =>
    item.playlistType === previousItem?.playlistType &&
    item.id === previousItem?.id &&
    item.title === previousItem?.title
  );

  state.playbackIndex = matchedIndex >= 0
    ? matchedIndex
    : Math.max(-1, Math.min(previousIndex - 1, state.combinedPlaylist.length - 1));
}

function logCombinedPlaylist(playlist, contextLabel) {
  const summary = (Array.isArray(playlist) ? playlist : []).map((entry) => ({
    type: entry?.playlistType || 'movie',
    title: entry?.title || '',
    status: entry?.status || '',
    file: entry?.file || entry?.posterPath || '',
  }));

  console.info(`[${contextLabel}] Combined playlist`, summary);
}

function markAdFailed(adItem, reason) {
  const adKey = getAdKey(adItem);
  if (state.failedAdKeys.has(adKey)) {
    return;
  }

  state.failedAdKeys.add(adKey);
  if (!state.loggedAdSkipKeys.has(adKey)) {
    const playableAdsRemaining = getPlayableAds(state.adItems).length;
    console.warn(`Skipping ad "${adItem?.title || adItem?.file || 'unknown'}": ${reason}${playableAdsRemaining === 0 ? ' (ads disabled for this session)' : ''}`);
    state.loggedAdSkipKeys.add(adKey);
  }

  rebuildCombinedPlaylist();
}

function hideAdOverlay() {
  if (!adOverlayNode) {
    return;
  }

  setAdMode(false);
  adOverlayNode.style.display = 'none';
  adOverlayNode.setAttribute('aria-hidden', 'true');
  const imageNode = adOverlayNode.querySelector('img');
  const videoNode = adOverlayNode.querySelector('video');
  if (imageNode) {
    imageNode.onload = null;
    imageNode.onerror = null;
    imageNode.style.display = 'none';
    imageNode.removeAttribute('src');
  }
  if (videoNode) {
    videoNode.onended = null;
    videoNode.onerror = null;
    videoNode.onloadeddata = null;
    videoNode.pause();
    videoNode.currentTime = 0;
    videoNode.style.display = 'none';
    videoNode.removeAttribute('src');
    videoNode.load();
  }
  touchPlaybackActivity();
}

function setAdMode(isAd) {
  if (statusNode) {
    statusNode.hidden = isAd;
  }
}

function showImageAd(adItem, playbackToken) {
  if (!adOverlayNode) {
    finishPlaybackReport(playbackToken, 'failed', {
      metadata: {
        reason: 'ad overlay unavailable',
      },
    });
    advanceCombinedPlayback(playbackToken, { skipFinish: true });
    return;
  }

  const imageNode = adOverlayNode.querySelector('img');
  const videoNode = adOverlayNode.querySelector('video');
  if (!imageNode) {
    finishPlaybackReport(playbackToken, 'failed', {
      metadata: {
        reason: 'ad image node unavailable',
      },
    });
    advanceCombinedPlayback(playbackToken, { skipFinish: true });
    return;
  }

  if (videoNode) {
    videoNode.pause();
    videoNode.currentTime = 0;
    videoNode.style.display = 'none';
    videoNode.removeAttribute('src');
  }

  const handleAdvance = () => {
    if (playbackToken !== state.playbackToken) {
      return;
    }

    state.playbackTimer = window.setTimeout(() => {
      finishPlaybackReport(playbackToken, 'played');
      advanceCombinedPlayback(playbackToken);
    }, getPlaylistItemDurationSeconds(adItem) * 1000);
  };

  imageNode.onload = () => {
    if (playbackToken !== state.playbackToken) {
      return;
    }

    imageNode.onload = null;
    imageNode.onerror = null;
    imageNode.alt = adItem.title ? `${adItem.title} ad` : 'Cinema ad';
    imageNode.style.display = 'block';
    adOverlayNode.style.display = 'flex';
    adOverlayNode.setAttribute('aria-hidden', 'false');
    setAdMode(true);
    touchPlaybackActivity();
    handleAdvance();
  };

  imageNode.onerror = () => {
    imageNode.onload = null;
    imageNode.onerror = null;
    hideAdOverlay();
    finishPlaybackReport(playbackToken, 'failed', {
      metadata: {
        reason: 'image failed to load',
      },
    });
    markAdFailed(adItem, 'image failed to load');
    advanceCombinedPlayback(playbackToken, { skipFinish: true });
  };

  imageNode.src = adItem.file;
}

function advanceCombinedPlayback(expectedToken, options = {}) {
  if (expectedToken !== undefined && expectedToken !== state.playbackToken) {
    return;
  }

  const currentIndex = Array.isArray(state.combinedPlaylist) && state.combinedPlaylist.length > 0
    ? ((state.playbackIndex % state.combinedPlaylist.length) + state.combinedPlaylist.length) % state.combinedPlaylist.length
    : 0;
  const currentItem = state.combinedPlaylist[currentIndex];

  if (!options.skipFinish) {
    finishPlaybackReport(expectedToken, 'played');
  }

  if (!Array.isArray(state.combinedPlaylist) || state.combinedPlaylist.length === 0) {
    hideAdOverlay();
    return;
  }

  if (currentItem?.playlistType === 'ad' && state.adBreakActive) {
    const nextAdIndex = currentIndex + 1;
    if (nextAdIndex < state.combinedPlaylist.length) {
      state.playbackIndex = nextAdIndex;
      runCombinedPlaybackLoop();
      return;
    }

    resumeContentPlayback();
    return;
  }

  if (currentItem?.playlistType !== 'ad') {
    state.contentElapsedSeconds += Math.max(1, getPlaylistItemDurationSeconds(currentItem));
    const config = getAdBreakConfig();
    if (config.adsEnabled && state.contentElapsedSeconds >= config.intervalSeconds) {
      state.contentElapsedSeconds = Math.max(0, state.contentElapsedSeconds - config.intervalSeconds);
      startAdBreakPlayback(currentIndex + 1);
      return;
    }
  }

  state.playbackIndex = (currentIndex + 1) % state.combinedPlaylist.length;
  runCombinedPlaybackLoop();
}

function showVideoAd(adItem, playbackToken) {
  if (!adOverlayNode) {
    finishPlaybackReport(playbackToken, 'failed', {
      metadata: {
        reason: 'ad overlay unavailable',
      },
    });
    advanceCombinedPlayback(playbackToken, { skipFinish: true });
    return;
  }

  const imageNode = adOverlayNode.querySelector('img');
  const videoNode = adOverlayNode.querySelector('video');
  if (!videoNode) {
    finishPlaybackReport(playbackToken, 'failed', {
      metadata: {
        reason: 'ad video node unavailable',
      },
    });
    advanceCombinedPlayback(playbackToken, { skipFinish: true });
    return;
  }

  if (imageNode) {
    imageNode.style.display = 'none';
    imageNode.removeAttribute('src');
  }

  let advanced = false;
  const advanceOnce = () => {
    if (advanced || playbackToken !== state.playbackToken) {
      return;
    }

    advanced = true;
    clearPlaybackTimer();
    videoNode.onended = null;
    videoNode.onerror = null;
    finishPlaybackReport(playbackToken, 'played');
    advanceCombinedPlayback(playbackToken);
  };

  videoNode.onended = advanceOnce;
  videoNode.onerror = () => {
    hideAdOverlay();
    finishPlaybackReport(playbackToken, 'failed', {
      metadata: {
        reason: 'video playback failed',
      },
    });
    markAdFailed(adItem, 'video playback failed');
    advanceCombinedPlayback(playbackToken, { skipFinish: true });
  };
  videoNode.onloadeddata = () => {
    if (playbackToken !== state.playbackToken) {
      return;
    }

    videoNode.onloadeddata = null;
    videoNode.style.display = 'block';
    adOverlayNode.style.display = 'flex';
    adOverlayNode.setAttribute('aria-hidden', 'false');
    setAdMode(true);
    touchPlaybackActivity();
    state.playbackTimer = window.setTimeout(() => {
      if (advanced || playbackToken !== state.playbackToken) {
        return;
      }

      try {
        videoNode.pause();
      } catch (error) {
        // Ignore pause failures.
      }
      advanceOnce();
    }, getPlaylistItemDurationSeconds(adItem) * 1000);
  };
  videoNode.onplaying = () => {
    touchPlaybackActivity();
  };
  videoNode.ontimeupdate = () => {
    touchPlaybackActivity();
  };

  videoNode.src = adItem.file;
  videoNode.load();

  const playPromise = videoNode.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      hideAdOverlay();
      finishPlaybackReport(playbackToken, 'failed', {
        metadata: {
          reason: 'video autoplay failed',
        },
      });
      markAdFailed(adItem, 'video autoplay failed');
      advanceCombinedPlayback(playbackToken, { skipFinish: true });
    });
  }
}

function getPlaylistItemDurationSeconds(item) {
  if (item?.playlistType === 'ad') {
    return getAdPlaybackDurationSeconds(item);
  }

  return Math.max(1, state.playerSettings.now_showing_duration_seconds);
}

function clearPlaybackTimer() {
  clearTimeout(state.playbackTimer);
  state.playbackTimer = null;
}

function runCombinedPlaybackLoop() {
  clearPlaybackTimer();

  if (!Array.isArray(state.combinedPlaylist) || state.combinedPlaylist.length === 0) {
    if (reportState.currentItem) {
      finishPlaybackReport(state.playbackToken, 'interrupted', {
        metadata: {
          reason: 'playlist cleared',
        },
      });
    }
    hideAdOverlay();
    return;
  }

  const currentIndex = ((state.playbackIndex % state.combinedPlaylist.length) + state.combinedPlaylist.length) % state.combinedPlaylist.length;
  const currentItem = state.combinedPlaylist[currentIndex];
  if (reportState.currentItem) {
    finishPlaybackReport(state.playbackToken, 'interrupted', {
      metadata: {
        reason: 'playlist refreshed',
      },
    });
  }
  state.playbackToken += 1;
  const playbackToken = state.playbackToken;
  beginPlaybackReport(currentItem, playbackToken);

  if (currentItem?.playlistType === 'ad' && currentItem.type === 'image') {
    showImageAd(currentItem, playbackToken);
    return;
  }

  if (currentItem?.playlistType === 'ad' && currentItem.type === 'video') {
    showVideoAd(currentItem, playbackToken);
    return;
  }

  hideAdOverlay();
  state.playbackTimer = window.setTimeout(() => {
    finishPlaybackReport(playbackToken, 'played');
    advanceCombinedPlayback(playbackToken);
  }, getPlaylistItemDurationSeconds(currentItem) * 1000);
}

function clearRotationTimer(timerKey) {
  clearTimeout(state[timerKey]);
  state[timerKey] = null;
}

function fillTiles(items, neededCount) {
  const sourceItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (sourceItems.length === 0 || neededCount <= 0) {
    return [];
  }

  const filled = [];
  for (let index = 0; index < neededCount; index += 1) {
    filled.push(sourceItems[index % sourceItems.length]);
  }

  return filled;
}

function getPagedTileAssignments(items, neededCount, pageIndex) {
  const sourceItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (sourceItems.length === 0 || neededCount <= 0) {
    return [];
  }

  if (sourceItems.length <= neededCount) {
    return fillTiles(sourceItems, neededCount);
  }

  const startIndex = (((pageIndex || 0) * neededCount) % sourceItems.length + sourceItems.length) % sourceItems.length;
  const rotated = sourceItems.slice(startIndex).concat(sourceItems.slice(0, startIndex));
  return fillTiles(rotated, neededCount);
}

function renderSingleCell(container, movie, renderCard) {
  if (!container || !movie) {
    return;
  }

  container.innerHTML = '';
  container.appendChild(renderCard(movie));
}

function createGlobalEmptyState() {
  const emptyState = document.createElement('section');
  emptyState.className = 'cinema-wall-empty-state';
  emptyState.innerHTML = `
    <div class="cinema-wall-empty-copy">
      <div class="cinema-wall-empty-kicker">Cinema Wall 3x2</div>
      <h1 class="cinema-wall-empty-title">Now Showing Unavailable</h1>
      <p class="cinema-wall-empty-text">No now showing movies are available right now. Please check the cinema schedule feed and try again.</p>
    </div>
  `;
  return emptyState;
}

function renderGlobalEmptyState() {
  if (!playerNode) {
    return;
  }

  let emptyStateNode = playerNode.querySelector('.cinema-wall-empty-state');
  if (!emptyStateNode) {
    emptyStateNode = createGlobalEmptyState();
    playerNode.appendChild(emptyStateNode);
  }
}

function hideGlobalEmptyState() {
  if (!playerNode) {
    return;
  }

  const emptyStateNode = playerNode.querySelector('.cinema-wall-empty-state');
  if (emptyStateNode) {
    emptyStateNode.remove();
  }
}

function clearWallTileSet(slotNodes) {
  slotNodes.forEach((container) => {
    if (container) {
      container.innerHTML = '';
    }
  });
}

function buildCinemaWallAssignments() {
  const nowPool = Array.isArray(state.nowShowingMovies) ? state.nowShowingMovies : [];
  return {
    effectiveNowPool: nowPool,
    nowShowingTiles: getPagedTileAssignments(nowPool, NOW_SHOWING_PAGE_SIZE, state.nowShowingPage),
  };
}

function renderCinemaWall() {
  const hasNowShowing = state.nowShowingMovies.length > 0;

  if (!hasNowShowing) {
    clearWallTileSet(nowShowingSlotNodes);
    renderGlobalEmptyState();
    return;
  }

  hideGlobalEmptyState();

  const { nowShowingTiles } = buildCinemaWallAssignments();
  nowShowingSlotNodes.forEach((container, index) => renderSingleCell(container, nowShowingTiles[index], renderStandardNowShowingCard));
}

function scheduleSectionRotation() {
  const { effectiveNowPool } = buildCinemaWallAssignments();
  clearRotationTimer('nowShowingTimer');

  if (effectiveNowPool.length <= NOW_SHOWING_PAGE_SIZE) {
    return;
  }

  state.nowShowingTimer = window.setTimeout(() => {
    state.nowShowingPage += 1;
    renderCinemaWall();
    scheduleSectionRotation();
  }, Math.max(1, state.playerSettings.now_showing_duration_seconds) * 1000);
}

function applyCinemaBoards(nowShowingMovies) {
  state.nowShowingMovies = Array.isArray(nowShowingMovies) ? nowShowingMovies : [];
  const effectiveNowPool = state.nowShowingMovies;
  const nowShowingPageCount = Math.max(1, Math.ceil(effectiveNowPool.length / NOW_SHOWING_PAGE_SIZE));

  state.nowShowingPage = state.nowShowingPage % nowShowingPageCount;

  console.info('[Cinema Wall 3x2] 6-tile now showing mapping', {
    nowShowingPool: state.nowShowingMovies.length,
  });

  renderCinemaWall();
  scheduleSectionRotation();
}

function updateClock() {
  if (!clockNode) {
    return;
  }

  const now = new Date();
  clockNode.textContent = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
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

async function fetchCinemaMovies() {
  try {
    const screen = detectPlayerScreen();
    const moviesResponse = await fetch(`/api/cinema-movies?screen=${screen}`, { cache: 'no-store' });
    if (!moviesResponse.ok) {
      throw new Error(`HTTP ${moviesResponse.status}`);
    }

    const result = await moviesResponse.json();
    const data = result.data || {};
    const now = data.serverNow ? new Date(data.serverNow) : new Date();
    const nowShowing = filterNowShowingMovies(data.nowShowing || [], now);
    applyPlayerSettings(data.playerSettings);
    let ads = [];
    if (isAdsEnabledForScreen(data.playerSettings)) {
      console.log('Player screen:', screen);
      const adsResponse = await fetch(`/api/ads?screen=${screen}`, { cache: 'no-store' });
      ads = adsResponse.ok ? normalizeAds(await adsResponse.json()) : [];
    }

    const cachedPayload = { data, ads };
    writePlayerCache(cachedPayload);
    console.log('fresh data loaded', { player: 'cinema_3x2' });
    setPlayerStatusBadge('Live');

    state.moviePlaylistItems = normalizeMoviePlaylistItems(nowShowing);
    state.adItems = ads;
    rebuildCombinedPlaylist();
    logCombinedPlaylist(state.combinedPlaylist, 'Cinema 3x2');

    applyCinemaBoards(nowShowing);
    if (!state.adBreakActive) {
      runCombinedPlaybackLoop();
    }
    state.hasRenderedData = true;
    startHeartbeatReportLoop();

    if (statusNode) {
      statusNode.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  } catch (error) {
    console.error('Failed to load cinema 3x2 movies', error);
    const cachedPayload = readPlayerCache();
    if (cachedPayload && cachedPayload.data !== undefined) {
      console.log('cached data used', { player: 'cinema_3x2' });
      setPlayerStatusBadge('Cached');
      const data = cachedPayload.data || {};
      const now = data.serverNow ? new Date(data.serverNow) : new Date();
      const nowShowing = filterNowShowingMovies(data.nowShowing || [], now);
      applyPlayerSettings(data.playerSettings);
      state.moviePlaylistItems = normalizeMoviePlaylistItems(nowShowing);
      state.adItems = Array.isArray(cachedPayload.ads) ? cachedPayload.ads : [];
      rebuildCombinedPlaylist();
      logCombinedPlaylist(state.combinedPlaylist, 'Cinema 3x2');

      applyCinemaBoards(nowShowing);
      if (!state.adBreakActive) {
        runCombinedPlaybackLoop();
      }
      state.hasRenderedData = true;
      startHeartbeatReportLoop();

      if (statusNode) {
        statusNode.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return;
    }

    console.log('no cache available', { player: 'cinema_3x2' });
    if (!state.hasRenderedData) {
      applyCinemaBoards([]);
      showWaitingForServerMessage();
    }
  }
}

updateClock();
window.setInterval(updateClock, 30000);
fetchCinemaMovies();
state.refreshTimer = window.setInterval(fetchCinemaMovies, REFRESH_INTERVAL_MS);
void pollGlobalRefreshToken();
state.refreshSignalTimer = window.setInterval(pollGlobalRefreshToken, GLOBAL_REFRESH_CHECK_INTERVAL_MS);
startPlaybackWatchdog();
sendPlayerHeartbeat();
window.setInterval(sendPlayerHeartbeat, PLAYER_HEARTBEAT_INTERVAL_MS);
