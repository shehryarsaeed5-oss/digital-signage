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
  playerSettings: {
    now_showing_duration_seconds: 8,
    coming_soon_duration_seconds: 5,
    enable_ads: true,
    ad_frequency_movies: 2,
  },
  lastRefreshToken: null,
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

function formatTodayString() {
  const now = new Date();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleDateString('en-US', { month: 'long' });
  const year = now.getFullYear();
  return `${weekday}, ${day} ${month} ${year}`;
}

function parseDateLabel(dateLabel) {
  const match = String(dateLabel || '').trim().match(/^[A-Za-z]+,\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const monthLabel = match[2].toLowerCase();
  const year = Number(match[3]);
  const monthIndex = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  }[monthLabel];

  if (!Number.isInteger(day) || monthIndex === undefined || !Number.isInteger(year)) {
    return null;
  }

  return new Date(year, monthIndex, day);
}

function parseTimeLabel(timeLabel) {
  const match = String(timeLabel || '').trim().match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (meridiem === 'PM' && hours !== 12) {
    hours += 12;
  }

  if (meridiem === 'AM' && hours === 12) {
    hours = 0;
  }

  return { hours, minutes };
}

function buildLocalDateTime(dateLabel, timeLabel) {
  const showDate = parseDateLabel(dateLabel);
  const showTime = parseTimeLabel(timeLabel);

  if (!showDate || !showTime) {
    return null;
  }

  return new Date(
    showDate.getFullYear(),
    showDate.getMonth(),
    showDate.getDate(),
    showTime.hours,
    showTime.minutes,
    0,
    0
  );
}

function filterTodayShowtimes(showtimesByDate, now = new Date()) {
  const todayLabel = formatTodayString();
  const todayEntry = (Array.isArray(showtimesByDate) ? showtimesByDate : []).find((entry) => entry?.date === todayLabel);
  if (!todayEntry) {
    return [];
  }

  const times = (Array.isArray(todayEntry?.times) ? todayEntry.times : [])
    .filter(Boolean)
    .filter((time) => {
      const showDateTime = buildLocalDateTime(todayEntry.date, time);
      return showDateTime ? showDateTime.getTime() > now.getTime() : false;
    });

  if (times.length === 0) {
    return [];
  }

  return [{
    ...todayEntry,
    times,
  }];
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
    ad_frequency_movies: Number.isFinite(Number(settings?.ad_frequency_movies))
      ? Math.min(10, Math.max(1, Number(settings.ad_frequency_movies)))
      : 2,
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
      duration: Number.isFinite(Number(ad.duration)) ? Number(ad.duration) : null,
      screenTargets: Array.isArray(ad.screenTargets)
        ? ad.screenTargets
        : (Array.isArray(ad.screen_targets) ? ad.screen_targets : []),
      playlistType: 'ad',
    }));
}

function isAdsEnabledForScreen(settings) {
  return settings?.cinema_3x2_ads_enabled !== false;
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
  const ads = Array.isArray(adItems) ? adItems : [];
  const enableAds = playerSettings?.enable_ads !== false;
  const frequency = Number.isFinite(Number(playerSettings?.ad_frequency_movies))
    ? Math.min(10, Math.max(1, Number(playerSettings.ad_frequency_movies)))
    : 2;

  if (!enableAds || ads.length === 0 || movies.length === 0) {
    return [...movies];
  }

  const combined = [];
  let adIndex = 0;

  for (let movieIndex = 0; movieIndex < movies.length; movieIndex += 1) {
    combined.push(movies[movieIndex]);

    if ((movieIndex + 1) % frequency === 0) {
      combined.push({
        ...ads[adIndex % ads.length],
        playlistIndex: combined.length,
      });
      adIndex += 1;
    }
  }

  return combined;
}

function rebuildCombinedPlaylist() {
  const previousItem = state.combinedPlaylist[state.playbackIndex];
  const previousIndex = state.playbackIndex;
  state.combinedPlaylist = buildCombinedPlaylist(
    state.moviePlaylistItems,
    getPlayableAds(state.adItems),
    state.playerSettings
  );

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
}

function setAdMode(isAd) {
  if (statusNode) {
    statusNode.hidden = isAd;
  }
}

function showImageAd(adItem, playbackToken) {
  if (!adOverlayNode) {
    advanceCombinedPlayback(playbackToken);
    return;
  }

  const imageNode = adOverlayNode.querySelector('img');
  const videoNode = adOverlayNode.querySelector('video');
  if (!imageNode) {
    advanceCombinedPlayback(playbackToken);
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
    handleAdvance();
  };

  imageNode.onerror = () => {
    imageNode.onload = null;
    imageNode.onerror = null;
    hideAdOverlay();
    markAdFailed(adItem, 'image failed to load');
    advanceCombinedPlayback(playbackToken);
  };

  imageNode.src = adItem.file;
}

function advanceCombinedPlayback(expectedToken) {
  if (expectedToken !== undefined && expectedToken !== state.playbackToken) {
    return;
  }

  if (!Array.isArray(state.combinedPlaylist) || state.combinedPlaylist.length === 0) {
    hideAdOverlay();
    return;
  }

  state.playbackIndex = (state.playbackIndex + 1) % state.combinedPlaylist.length;
  runCombinedPlaybackLoop();
}

function showVideoAd(adItem, playbackToken) {
  if (!adOverlayNode) {
    advanceCombinedPlayback(playbackToken);
    return;
  }

  const imageNode = adOverlayNode.querySelector('img');
  const videoNode = adOverlayNode.querySelector('video');
  if (!videoNode) {
    advanceCombinedPlayback(playbackToken);
    return;
  }

  if (imageNode) {
    imageNode.style.display = 'none';
    imageNode.removeAttribute('src');
  }

  const handleAdvance = () => {
    advanceCombinedPlayback(playbackToken);
  };

  videoNode.onended = handleAdvance;
  videoNode.onerror = () => {
    hideAdOverlay();
    markAdFailed(adItem, 'video playback failed');
    handleAdvance();
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
  };

  videoNode.src = adItem.file;
  videoNode.load();

  const playPromise = videoNode.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      hideAdOverlay();
      markAdFailed(adItem, 'video autoplay failed');
      handleAdvance();
    });
  }
}

function getPlaylistItemDurationSeconds(item) {
  if (item?.playlistType === 'ad') {
    return Math.max(1, Number(item.duration) || 10);
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
    hideAdOverlay();
    return;
  }

  const currentIndex = ((state.playbackIndex % state.combinedPlaylist.length) + state.combinedPlaylist.length) % state.combinedPlaylist.length;
  const currentItem = state.combinedPlaylist[currentIndex];
  state.playbackToken += 1;
  const playbackToken = state.playbackToken;

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
    const response = await fetch('/api/player-settings/refresh-token', { cache: 'no-store' });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    const refreshToken = String(payload?.refreshToken || '');

    if (state.lastRefreshToken === null) {
      state.lastRefreshToken = refreshToken;
      return;
    }

    if (refreshToken !== state.lastRefreshToken) {
      window.location.reload();
      return;
    }
  } catch (error) {
    console.warn('Failed to check refresh token', error);
  }
}

async function fetchCinemaMovies() {
  try {
    const screen = detectPlayerScreen();
    const moviesResponse = await fetch(`/api/cinema-movies?screen=${screen}`, { cache: 'no-store' });

    const result = await moviesResponse.json();
    const data = result.data || {};
    const now = new Date();
    const nowShowing = filterNowShowingMovies(data.nowShowing || [], now);
    applyPlayerSettings(data.playerSettings);
    let ads = [];
    if (isAdsEnabledForScreen(data.playerSettings)) {
      console.log('Player screen:', screen);
      const adsResponse = await fetch(`/api/ads?screen=${screen}`, { cache: 'no-store' });
      ads = adsResponse.ok ? normalizeAds(await adsResponse.json()) : [];
    }

    state.moviePlaylistItems = normalizeMoviePlaylistItems(nowShowing);
    state.adItems = ads;
    rebuildCombinedPlaylist();
    logCombinedPlaylist(state.combinedPlaylist, 'Cinema 3x2');

    applyCinemaBoards(nowShowing);
    runCombinedPlaybackLoop();
    state.hasRenderedData = true;

    if (statusNode) {
      statusNode.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  } catch (error) {
    console.error('Failed to load cinema 3x2 movies', error);
    if (!state.hasRenderedData) {
      applyCinemaBoards([]);
      if (statusNode) {
        statusNode.textContent = 'Unavailable';
      }
    }
  }
}

updateClock();
window.setInterval(updateClock, 30000);
fetchCinemaMovies();
state.refreshTimer = window.setInterval(fetchCinemaMovies, REFRESH_INTERVAL_MS);
void pollGlobalRefreshToken();
state.refreshSignalTimer = window.setInterval(pollGlobalRefreshToken, GLOBAL_REFRESH_CHECK_INTERVAL_MS);
