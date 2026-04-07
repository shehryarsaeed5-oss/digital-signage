console.log("PORTRAIT PLAYER VERSION 2 LOADED");

const ROTATION_INTERVAL_MS = 8000;
const REFRESH_INTERVAL_MS = 60000;
const MAX_VISIBLE_SHOWTIMES = 4;

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
  },
  failedAdKeys: new Set(),
  activeIndex: 0,
  visibleSlot: 0,
  rotationTimer: null,
  refreshTimer: null,
  initialized: false,
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseDateLabel(dateLabel) {
  if (dateLabel instanceof Date && !Number.isNaN(dateLabel.getTime())) {
    return new Date(dateLabel.getFullYear(), dateLabel.getMonth(), dateLabel.getDate());
  }

  const text = String(dateLabel || '').trim();
  if (!text) {
    return null;
  }

  const directParse = new Date(text);
  if (!Number.isNaN(directParse.getTime())) {
    return new Date(directParse.getFullYear(), directParse.getMonth(), directParse.getDate());
  }

  const monthMap = {
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
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  const longMonthMatch = text.match(/^(?:[A-Za-z]+,\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (longMonthMatch) {
    const day = Number(longMonthMatch[1]);
    const monthIndex = monthMap[String(longMonthMatch[2]).toLowerCase()];
    const year = Number(longMonthMatch[3]);

    if (Number.isInteger(day) && Number.isInteger(year) && monthIndex !== undefined) {
      return new Date(year, monthIndex, day);
    }
  }

  const numericMatch = text.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
  if (numericMatch) {
    const first = Number(numericMatch[1]);
    const second = Number(numericMatch[2]);
    const third = Number(numericMatch[3]);

    if (String(numericMatch[1]).length === 4) {
      return new Date(first, second - 1, third);
    }

    if (String(numericMatch[3]).length === 4) {
      return new Date(third, second - 1, first);
    }
  }

  return null;
}

function parseTimeLabel(timeLabel) {
  const text = String(timeLabel || '').trim();
  if (!text) {
    return null;
  }

  const twelveHourMatch = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]);
    const minutes = Number(twelveHourMatch[2]);
    const meridiem = twelveHourMatch[3].toUpperCase();

    if (meridiem === 'PM' && hours !== 12) {
      hours += 12;
    }

    if (meridiem === 'AM' && hours === 12) {
      hours = 0;
    }

    return { hours, minutes };
  }

  const twentyFourHourMatch = text.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    return {
      hours: Number(twentyFourHourMatch[1]),
      minutes: Number(twentyFourHourMatch[2]),
    };
  }

  return null;
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

function isSameLocalCalendarDate(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getTodaysUpcomingShowtimes(showtimesByDate, now = new Date()) {
  const upcoming = [];

  (Array.isArray(showtimesByDate) ? showtimesByDate : []).forEach((entry) => {
    const times = Array.isArray(entry?.times) ? entry.times : [];

    times.forEach((time) => {
      const dateTime = buildLocalDateTime(entry?.date, time);
      if (!dateTime) {
        return;
      }

      if (!isSameLocalCalendarDate(dateTime, now)) {
        return;
      }

      if (dateTime.getTime() <= now.getTime()) {
        return;
      }

      upcoming.push({
        label: String(time).trim(),
        dateTime,
      });
    });
  });

  return upcoming.sort((left, right) => left.dateTime.getTime() - right.dateTime.getTime());
}

function normalizeMovies(data) {
  const now = new Date();

  const nowShowing = (Array.isArray(data?.nowShowing) ? data.nowShowing : [])
    .map((movie) => {
      const upcomingShowtimes = getTodaysUpcomingShowtimes(movie?.showtimesByDate, now);

      return {
        id: `now-${movie?.id ?? movie?.title ?? Math.random()}`,
        title: movie?.title || 'Untitled Movie',
        posterUrl: movie?.posterPath || '',
        showtimes: upcomingShowtimes.slice(0, MAX_VISIBLE_SHOWTIMES),
        isComingSoon: false,
      };
    })
    .filter((movie) => movie.showtimes.length > 0);

  const comingSoon = (Array.isArray(data?.comingSoon) ? data.comingSoon : []).map((movie) => ({
    id: `coming-${movie?.id ?? movie?.title ?? Math.random()}`,
    title: movie?.title || 'Untitled Movie',
    posterUrl: movie?.posterPath || '',
    showtimes: [],
    isComingSoon: true,
  }));

  return [...nowShowing, ...comingSoon];
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
  return settings?.enable_ads !== false;
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

function getAdPlaylistItemDurationSeconds(adItem) {
  return Math.max(1, Number(adItem?.duration) || 10);
}

function getPlaylistItemDurationSeconds(item) {
  if (item?.playlistType === 'ad') {
    return getAdPlaylistItemDurationSeconds(item);
  }

  return item?.isComingSoon
    ? Math.max(1, state.playerSettings.coming_soon_duration_seconds)
    : Math.max(1, state.playerSettings.now_showing_duration_seconds);
}

function rebuildCombinedPlaylist() {
  const previousItem = state.combinedPlaylist[state.activeIndex];
  const previousIndex = state.activeIndex;
  state.combinedPlaylist = buildCombinedPlaylist(
    state.moviePlaylistItems,
    getPlayableAds(state.adItems),
    state.playerSettings
  );

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

function showEmptyState() {
  emptyNode.classList.remove('hidden');
  slideNodes.forEach((slot) => {
    slot.root.classList.remove('is-visible');
    slot.root.setAttribute('aria-hidden', 'true');
  });
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
    node.innerHTML = `
      <div class="portrait-status-content">
        <span class="portrait-status-line">AD</span>
        <span class="portrait-status-line">PLAYBACK</span>
      </div>
    `;
    return;
  }

  const line1 = item.isComingSoon ? 'COMING' : 'NOW';
  const line2 = item.isComingSoon ? 'SOON' : 'SHOWING';

  node.innerHTML = `
    <div class="portrait-status-content">
      <span class="portrait-status-line">${line1}</span>
      <span class="portrait-status-line">${line2}</span>
    </div>
  `;
}

function renderShowtimes(node, item) {
  if (item?.playlistType === 'ad') {
    node.innerHTML = '';
    node.classList.add('hidden');
    return;
  }

  const showtimes = Array.isArray(item.showtimes) ? item.showtimes.slice(0, MAX_VISIBLE_SHOWTIMES) : [];

  if (item.isComingSoon || showtimes.length === 0) {
    node.innerHTML = '';
    node.classList.add('hidden');
    return;
  }

  node.innerHTML = showtimes
    .map((showtime, index) => {
      const className = index === 0 ? 'portrait-showtime is-next' : 'portrait-showtime';
      const nextBadge = index === 0 ? '<span class="portrait-showtime-badge">NEXT</span>' : '';

      return `<span class="${className}">${nextBadge}<span class="portrait-showtime-text">${escapeHtml(showtime.label)}</span></span>`;
    })
    .join('');

  node.classList.remove('hidden');
}

function renderSlide(slot, item) {
  const isAd = item?.playlistType === 'ad';
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
  state.activeIndex = ((index % state.items.length) + state.items.length) % state.items.length;

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

    if (!immediate) {
      previousSlot.root.classList.remove('is-visible');
      previousSlot.root.setAttribute('aria-hidden', 'true');
    }
  });

  state.visibleSlot = nextSlotIndex;
}

function startRotation() {
  clearTimeout(state.rotationTimer);
  state.rotationTimer = null;

  if (state.items.length <= 1) {
    return;
  }

  state.rotationTimer = window.setTimeout(() => {
    showItem(state.activeIndex + 1);
    startRotation();
  }, Math.max(1, getPlaylistItemDurationSeconds(state.items[state.activeIndex])) * 1000);
}

function applyItems(items) {
  const previousItem = state.items[state.activeIndex];
  state.items = Array.isArray(items) ? items : [];

  if (state.items.length === 0) {
    showEmptyState();
    clearTimeout(state.rotationTimer);
    state.rotationTimer = null;
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
    ad_frequency_movies: Number.isFinite(Number(settings?.ad_frequency_movies))
      ? Math.min(10, Math.max(1, Number(settings.ad_frequency_movies)))
      : 2,
  };
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

    state.adItems = ads;
    rebuildCombinedPlaylist();
    applyItems(state.combinedPlaylist);
  } catch (error) {
    console.error('Failed to load movies', error);
    if (!state.initialized || state.items.length === 0) {
      showEmptyState();
    }
  }
}

fetchMovies();
state.refreshTimer = window.setInterval(fetchMovies, REFRESH_INTERVAL_MS);
