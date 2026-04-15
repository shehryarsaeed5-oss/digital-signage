const path = require('path');
const { all } = require('../config/database');
const { listAds, createAd, updateAd, deleteAd, getAdById } = require('../repositories/adRepository');
const {
  logPlaybackStart,
  logPlaybackEnd,
  logPlaybackFailure,
  upsertScreenHeartbeat,
  normalizePlayerMode,
  normalizeScreenName: normalizeHeartbeatScreenName,
} = require('../repositories/reportRepository');
const {
  getPlayerSettings,
  SCREEN_PLAYER_SETTING_DEFAULTS,
  getGroupRefreshToken,
  getGlobalRefreshToken,
  getScreenRefreshToken,
  getSiteRefreshToken,
  getScreenPlayerSettings,
  listScreenPlayerSettings,
  normalizeScreenName,
} = require('../repositories/playerSettingsRepository');
const {
  getVideoDurationSeconds,
} = require('../services/adCompressionService');
const {
  listMovieScheduleRowsByDate,
} = require('../repositories/movieSyncRepository');

function normalizeScreenLabel(label) {
  const text = String(label || '').toLowerCase().trim();
  if (text.includes('3x2')) return 'cinema-3x2';
  if (text.includes('portrait')) return 'cinema-portrait';
  if (text.includes('cinema')) return 'cinema';
  return '';
}

function inferAdTypeFromFile(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (extension === '.mp4') {
    return 'video';
  }

  if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    return 'image';
  }

  return '';
}

function mapApiToDb(data, typeHint = '') {
  const mapped = {};
  if (data.title !== undefined) mapped.title = data.title;
  if (data.sort !== undefined) mapped.sort_order = data.sort;
  if (data.status !== undefined) mapped.status = String(data.status).toLowerCase();
  if (data.file !== undefined) mapped.file_path = data.file;
  if (data.start_at !== undefined) mapped.start_at = data.start_at;
  if (data.end_at !== undefined) mapped.end_at = data.end_at;
  
  if (Array.isArray(data.screens)) {
    const screenTargets = data.screens.map(normalizeScreenLabel).filter(Boolean);
    mapped.screen_targets = screenTargets.length > 0 ? screenTargets.join(',') : null;
  } else if (data.screens !== undefined) {
    const screenTarget = normalizeScreenLabel(data.screens);
    mapped.screen_targets = screenTarget || null;
  }

  // Default type if missing for new ads
  const resolvedType = data.type || inferAdTypeFromFile(data.file) || typeHint;
  if (resolvedType) {
    mapped.type = resolvedType;
  }

  const durationValue = data.duration !== undefined ? data.duration : data.duration_seconds;
  if (resolvedType === 'image' || (!resolvedType && typeHint === 'image')) {
    if (durationValue !== undefined && durationValue !== '') {
      mapped.duration_seconds = durationValue;
    }
  } else if (durationValue !== undefined && durationValue !== '') {
    mapped.duration_seconds = durationValue;
  }

  return mapped;
}

function resolveScreenFromRequest(req) {
  const queryScreen = normalizeScreenName(req.query.screen);
  if (queryScreen) {
    return queryScreen;
  }

  const referer = req.get('referer') || req.get('referrer') || '';
  if (referer) {
    try {
      const refererPath = new URL(referer).pathname;
      const refererScreen = normalizeScreenName(refererPath);
      if (refererScreen) {
        return refererScreen;
      }
    } catch (error) {
      // Ignore malformed referer values and fall through to the default.
    }
  }

  return 'cinema';
}

function normalizeReportScreen(value) {
  return normalizeScreenName(value);
}

function normalizeReportItemType(value) {
  const text = String(value || '').toLowerCase().trim();
  if (text === 'movie' || text === 'ad') {
    return text;
  }

  return '';
}

function normalizeTextOrNull(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function toLocalDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function normalizeShareDate(value) {
  const text = String(value || '').trim();
  if (!text) {
    return toLocalDateString(new Date());
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return '';
  }

  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return text;
}

function formatStoredShowDate(dateValue) {
  const text = normalizeShareDate(dateValue);
  if (!text) {
    return '';
  }

  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}

function parseTimeToMinutes(timeLabel) {
  const text = String(timeLabel || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) {
    return Number.MAX_SAFE_INTEGER;
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

  return hours * 60 + minutes;
}

function buildMovieScheduleResponse(rows, date, dateLabel) {
  const moviesById = new Map();
  const flatRows = [];

  for (const row of rows) {
    const posterPath = row.local_poster_path || row.poster_url || '';

    if (!moviesById.has(row.movie_id)) {
      moviesById.set(row.movie_id, {
        movie: row.title,
        poster: posterPath,
        runtime: row.runtime || '',
        rating: null,
        showtimes: [],
      });
    }

    const movie = moviesById.get(row.movie_id);
    if (!movie.poster && posterPath) {
      movie.poster = posterPath;
    }

    if (row.show_time) {
      movie.showtimes.push({
        date: row.show_date,
        time: row.show_time,
        screen: row.screen || null,
      });

      flatRows.push({
        movie: row.title,
        poster: posterPath,
        runtime: row.runtime || '',
        rating: null,
        screen: row.screen || null,
        time: row.show_time,
        date: row.show_date,
      });
    }
  }

  const movies = [...moviesById.values()].map((movie) => {
    const screenMap = new Map();

    for (const showtime of movie.showtimes) {
      const screen = String(showtime.screen || '').trim();
      if (!screen) {
        continue;
      }

      if (!screenMap.has(screen)) {
        screenMap.set(screen, []);
      }

      screenMap.get(screen).push(showtime.time);
    }

        const screenTimes = [...screenMap.entries()].map(([screen, times]) => ({
          screen,
          times: [...new Set(times)].sort((left, right) => parseTimeToMinutes(left) - parseTimeToMinutes(right)),
        }));

    return {
      ...movie,
      screens: screenTimes.map((entry) => entry.screen),
      times: [...new Set(movie.showtimes.map((showtime) => showtime.time))].sort((left, right) => parseTimeToMinutes(left) - parseTimeToMinutes(right)),
      screenTimes,
      showtimes: movie.showtimes.sort((left, right) => parseTimeToMinutes(left.time) - parseTimeToMinutes(right.time)),
    };
  });

  return {
    date,
    dateLabel,
    source: 'local-sqlite',
    screenAvailable: rows.some((row) => String(row.screen || '').trim().length > 0),
    movies,
    rows: flatRows.sort((left, right) => {
      const titleCompare = String(left.movie || '').localeCompare(String(right.movie || ''), 'en', {
        sensitivity: 'base',
      });

      if (titleCompare !== 0) {
        return titleCompare;
      }

      return parseTimeToMinutes(left.time) - parseTimeToMinutes(right.time);
    }),
  };
}

function normalizePlaybackStatus(value, fallback = 'played') {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'played' || status === 'failed' || status === 'skipped' || status === 'interrupted') {
    return status;
  }

  return fallback;
}

function normalizeMetadata(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return { value: String(value) };
  }
}

function normalizeReportTimestamp(value) {
  const text = String(value || '').trim();
  if (!text || Number.isNaN(Date.parse(text))) {
    return '';
  }

  return new Date(text).toISOString();
}

function resolveAdAbsolutePath(filePath) {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  if (!normalizedPath.startsWith('/')) {
    return null;
  }

  return path.join(__dirname, '..', 'public', normalizedPath.replace(/^\//, ''));
}

async function applyVideoDurationIfAvailable(adData, fallbackFilePath = '') {
  if (!adData || adData.type !== 'video') {
    return adData;
  }

  const absolutePath = resolveAdAbsolutePath(adData.file_path || fallbackFilePath);
  if (!absolutePath) {
    return adData;
  }

  const durationSeconds = await getVideoDurationSeconds(absolutePath);
  if (durationSeconds) {
    adData.duration_seconds = durationSeconds;
  }

  return adData;
}

function buildPlaybackPayload(body) {
  return {
    screen: normalizeReportScreen(body.screen),
    item_type: normalizeReportItemType(body.item_type),
    item_id: normalizeTextOrNull(body.item_id),
    item_title: normalizeTextOrNull(body.item_title),
    started_at: normalizeReportTimestamp(body.started_at),
    ended_at: normalizeReportTimestamp(body.ended_at),
    duration_seconds: body.duration_seconds,
    status: normalizePlaybackStatus(body.status),
    playback_session_id: normalizeTextOrNull(body.playback_session_id),
    metadata: normalizeMetadata(body.metadata),
  };
}

async function getScreenPlayerSettingsWithFallback(screen) {
  const normalizedScreen = normalizeScreenName(screen) || 'cinema';
  const primarySettings = await getScreenPlayerSettings(normalizedScreen);
  if (primarySettings) {
    return primarySettings;
  }

  if (normalizedScreen !== 'cinema') {
    const cinemaSettings = await getScreenPlayerSettings('cinema');
    if (cinemaSettings) {
      return cinemaSettings;
    }
  }

  return {
    screen: 'cinema',
    ...SCREEN_PLAYER_SETTING_DEFAULTS,
  };
}

exports.playlist = async (req, res, next) => {
  try {
    const items = await all(
      `SELECT media.id, media.name, media.file_path, media.type, media.duration, playlist_items."order" AS item_order
       FROM playlist_items
       INNER JOIN media ON media.id = playlist_items.media_id
       ORDER BY playlist_items."order" ASC, playlist_items.id ASC`
    );

    res.json({
      data: items,
    });
  } catch (error) {
    next(error);
  }
};

exports.playerSettings = async (req, res, next) => {
  try {
    if (req.query.screen) {
      const setting = await getScreenPlayerSettings(req.query.screen);
      res.json({
        data: {
          defaults: SCREEN_PLAYER_SETTING_DEFAULTS,
          setting,
        },
      });
      return;
    }

    const settings = await listScreenPlayerSettings();
    res.json({
      data: {
        defaults: SCREEN_PLAYER_SETTING_DEFAULTS,
        settings,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.playerSettingsRefreshToken = async (req, res, next) => {
  try {
    const refreshToken = await getGlobalRefreshToken();
    const screenRefreshToken = await getScreenRefreshToken({
      screen_name: req.query.screen_name,
      screen: req.query.screen,
      page_path: req.query.page_path,
    });
    const groupRefreshToken = await getGroupRefreshToken(req.query.screen);
    const siteRefreshToken = await getSiteRefreshToken({
      screen_name: req.query.screen_name,
      site_name: req.query.site_name,
      screen: req.query.screen,
    });
    res.json({
      refreshToken: refreshToken || '',
      screenRefreshToken: screenRefreshToken || '',
      groupRefreshToken: groupRefreshToken || '',
      siteRefreshToken: siteRefreshToken || '',
    });
  } catch (error) {
    next(error);
  }
};

exports.cinemaMovies = async (req, res, next) => {
  try {
    const screen = resolveScreenFromRequest(req);

    const [movies, showtimes, sharedSettings, screenSettings] = await Promise.all([
      all(
        `SELECT id, title, poster_url, local_poster_path, status, synopsis, release_date, runtime, genre
         FROM movies
         WHERE source_name = ?
           AND excluded_from_playlist = 0
         ORDER BY
           CASE status
             WHEN 'Now Showing' THEN 1
             WHEN 'Coming Soon' THEN 2
             ELSE 3
           END,
           title ASC`,
        ['CUE Cinemas']
      ),
      all(
        `SELECT movie_id, show_date, show_time, screen
         FROM movie_showtimes
         ORDER BY show_date ASC, show_time ASC`
      ),
      getPlayerSettings(),
      getScreenPlayerSettingsWithFallback(screen),
    ]);

    console.log('[api/cinema-movies] screen=%s', screen);
    const playerSettings = {
      ...sharedSettings,
      ...screenSettings,
      screen: screenSettings.screen || screen,
    };

    const groupedShowtimes = new Map();

    for (const showtime of showtimes) {
      if (!groupedShowtimes.has(showtime.movie_id)) {
        groupedShowtimes.set(showtime.movie_id, new Map());
      }

      const byDate = groupedShowtimes.get(showtime.movie_id);
      if (!byDate.has(showtime.show_date)) {
        byDate.set(showtime.show_date, []);
      }

      byDate.get(showtime.show_date).push({
        time: showtime.show_time,
        screen: showtime.screen || null,
      });
    }

    const normalizedMovies = movies.map((movie) => ({
      id: movie.id,
      title: movie.title,
      posterPath: movie.local_poster_path || movie.poster_url || '',
      status: movie.status,
      releaseDate: movie.release_date || '',
      runtime: movie.runtime || '',
      showtimesByDate: [...(groupedShowtimes.get(movie.id)?.entries() || [])].map(([date, entries]) => {
        const screenMap = new Map();

        for (const entry of entries) {
          const screen = String(entry.screen || '').trim();
          if (screen) {
            if (!screenMap.has(screen)) {
              screenMap.set(screen, []);
            }
            screenMap.get(screen).push(entry.time);
          }
        }

        const screenTimes = [...screenMap.entries()].map(([screen, times]) => ({
          screen,
          times: [...new Set(times)].sort((left, right) => parseTimeToMinutes(left) - parseTimeToMinutes(right)),
        }));

        return {
          date,
          times: [...new Set(entries.map((entry) => entry.time))],
          screens: screenTimes.map((entry) => entry.screen),
          screenTimes,
        };
      }),
    }));
    const serverNow = new Date().toISOString();

    res.json({
      data: {
        nowShowing: normalizedMovies.filter((movie) => movie.status === 'Now Showing'),
        comingSoon: normalizedMovies.filter((movie) => movie.status === 'Coming Soon'),
        playerSettings,
        serverNow,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.movieScheduleShare = async (req, res, next) => {
  try {
    const shareToken = String(process.env.MOVIE_SHARE_TOKEN || '').trim();
    if (shareToken) {
      const providedToken = String(req.query.token || '').trim();
      if (providedToken !== shareToken) {
        res.status(403).json({
          error: 'Invalid share token.',
        });
        return;
      }
    }

    const requestedDate = normalizeShareDate(req.query.date);
    if (!requestedDate) {
      res.status(400).json({
        error: 'Invalid date. Use YYYY-MM-DD.',
      });
      return;
    }

    const requestedDateLabel = formatStoredShowDate(requestedDate);
    const rows = await listMovieScheduleRowsByDate('CUE Cinemas', requestedDateLabel);
    res.json(buildMovieScheduleResponse(rows, requestedDate, requestedDateLabel));
  } catch (error) {
    next(error);
  }
};

exports.ads = async (req, res, next) => {
  try {
    console.log('API received screen:', req.query.screen);
    const eligibleParam = String(req.query.eligible ?? '').toLowerCase().trim();
    const eligibleNow = !(eligibleParam === '0' || eligibleParam === 'false');
    const ads = await listAds({
      status: req.query.status || 'active',
      screen: req.query.screen,
      createdAtOrder: 'ASC',
      eligibleNow,
    });

    console.log('Ads returned:', ads.map((ad) => ({
      id: ad.id,
      title: ad.title,
      screen_targets: ad.screen_targets,
      status: ad.status,
    })));

    res.json(
      ads.map((ad) => ({
        id: ad.id,
        title: ad.title,
        file: ad.file_path,
        type: ad.type,
        duration: ad.duration_seconds,
        sort: ad.sort_order,
        status: ad.status,
        start_at: ad.start_at,
        end_at: ad.end_at,
        screenTargets: ad.screen_targets ? ad.screen_targets.split(',') : [],
      }))
    );
  } catch (error) {
    next(error);
  }
};

exports.createAdApi = async (req, res, next) => {
  try {
    const adData = mapApiToDb(req.body);
    
    if (!adData.title || !adData.file_path) {
      return res.status(400).json({ error: 'Title and file path are required.' });
    }
    if (!adData.type) adData.type = 'image';
    if (adData.type === 'image' && (adData.duration_seconds === undefined || adData.duration_seconds === null || adData.duration_seconds === '')) {
      return res.status(400).json({ error: 'Image ads require duration_seconds.' });
    }

    await applyVideoDurationIfAvailable(adData);

    const newAd = await createAd(adData);
    res.status(201).json(newAd);
  } catch (error) {
    next(error);
  }
};

exports.updateAdApi = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    const existingAd = await getAdById(adId);
    if (!existingAd) {
      return res.status(404).json({ error: 'Ad not found.' });
    }

    const changes = mapApiToDb(req.body, existingAd.type);
    if (changes.type === 'video' || existingAd.type === 'video') {
      await applyVideoDurationIfAvailable(changes, existingAd.file_path);
    }
    
    const updatedAd = await updateAd(adId, changes);
    
    res.json(updatedAd);
  } catch (error) {
    next(error);
  }
};

exports.deleteAdApi = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    const ad = await getAdById(adId);
    
    if (!ad) {
      return res.status(404).json({ error: 'Ad not found.' });
    }
    
    await deleteAd(adId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

exports.logPlaybackStart = async (req, res, next) => {
  try {
    const payload = buildPlaybackPayload(req.body);

    if (!payload.screen || !payload.item_type || !payload.item_title || !payload.started_at) {
      res.status(400).json({ error: 'screen, item_type, item_title, and started_at are required.' });
      return;
    }

    await logPlaybackStart(payload);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

exports.logPlaybackEnd = async (req, res, next) => {
  try {
    const payload = buildPlaybackPayload(req.body);

    if (!payload.screen || !payload.item_type || !payload.item_title || !payload.started_at) {
      res.status(400).json({ error: 'screen, item_type, item_title, and started_at are required.' });
      return;
    }

    await logPlaybackEnd(payload);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

exports.logPlaybackFailure = async (req, res, next) => {
  try {
    const payload = buildPlaybackPayload(req.body);

    if (!payload.screen || !payload.item_type || !payload.item_title || !payload.started_at) {
      res.status(400).json({ error: 'screen, item_type, item_title, and started_at are required.' });
      return;
    }

    payload.status = normalizePlaybackStatus(req.body.status, 'failed');
    await logPlaybackFailure(payload);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

exports.logHeartbeat = async (req, res, next) => {
  try {
    const screen = normalizeReportScreen(req.body.screen);
    const pagePath = normalizeTextOrNull(req.body.player_path || req.body.page_path || req.body.current_page_path);
    const lastSeenAt = normalizeReportTimestamp(
      req.body.last_seen_at || req.body.timestamp || req.body.client_timestamp
    ) || new Date().toISOString();

    if (!screen) {
      res.status(400).json({ error: 'screen is required.' });
      return;
    }

    await upsertScreenHeartbeat({
      screen,
      current_item_type: normalizeReportItemType(req.body.current_item_type),
      current_item_id: normalizeTextOrNull(req.body.current_item_id),
      current_item_title: normalizeTextOrNull(req.body.current_item_title),
      player_path: pagePath,
      screen_name: normalizeHeartbeatScreenName(req.body.screen_name),
      player_mode: normalizePlayerMode(req.body.player_mode),
      last_seen_at: lastSeenAt,
      status: normalizeTextOrNull(req.body.status) || 'online',
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};
