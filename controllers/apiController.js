const { all } = require('../config/database');
const { listAds, createAd, updateAd, deleteAd, getAdById } = require('../repositories/adRepository');
const {
  getPlayerSettings,
  SCREEN_PLAYER_SETTING_DEFAULTS,
  getGlobalRefreshToken,
  getScreenPlayerSettings,
  listScreenPlayerSettings,
  normalizeScreenName,
} = require('../repositories/playerSettingsRepository');

function normalizeScreenLabel(label) {
  const text = String(label || '').toLowerCase().trim();
  if (text.includes('3x2')) return 'cinema-3x2';
  if (text.includes('portrait')) return 'cinema-portrait';
  if (text.includes('cinema')) return 'cinema';
  return '';
}

function mapApiToDb(data) {
  const mapped = {};
  if (data.title !== undefined) mapped.title = data.title;
  if (data.duration !== undefined) mapped.duration_seconds = data.duration;
  if (data.sort !== undefined) mapped.sort_order = data.sort;
  if (data.status !== undefined) mapped.status = String(data.status).toLowerCase();
  if (data.file !== undefined) mapped.file_path = data.file;
  
  if (Array.isArray(data.screens)) {
    const screenTargets = data.screens.map(normalizeScreenLabel).filter(Boolean);
    mapped.screen_targets = screenTargets.length > 0 ? screenTargets.join(',') : null;
  } else if (data.screens !== undefined) {
    const screenTarget = normalizeScreenLabel(data.screens);
    mapped.screen_targets = screenTarget || null;
  }

  // Default type if missing for new ads
  if (data.type) {
    mapped.type = data.type;
  } else if (data.file) {
    mapped.type = String(data.file).toLowerCase().endsWith('.mp4') ? 'video' : 'image';
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
    res.json({
      refreshToken: refreshToken || '',
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
        `SELECT movie_id, show_date, show_time
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

      byDate.get(showtime.show_date).push(showtime.show_time);
    }

    const normalizedMovies = movies.map((movie) => ({
      id: movie.id,
      title: movie.title,
      posterPath: movie.local_poster_path || movie.poster_url || '',
      status: movie.status,
      releaseDate: movie.release_date || '',
      runtime: movie.runtime || '',
      showtimesByDate: [...(groupedShowtimes.get(movie.id)?.entries() || [])].map(([date, times]) => ({
        date,
        times,
      })),
    }));

    res.json({
      data: {
        nowShowing: normalizedMovies.filter((movie) => movie.status === 'Now Showing'),
        comingSoon: normalizedMovies.filter((movie) => movie.status === 'Coming Soon'),
        playerSettings,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.ads = async (req, res, next) => {
  try {
    console.log('API received screen:', req.query.screen);
    const { screen } = req.query;
    const ads = await listAds({
      status: req.query.status || 'active',
      screen: req.query.screen,
      createdAtOrder: 'ASC',
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

    const newAd = await createAd(adData);
    res.status(201).json(newAd);
  } catch (error) {
    next(error);
  }
};

exports.updateAdApi = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    const changes = mapApiToDb(req.body);
    
    const updatedAd = await updateAd(adId, changes);
    if (!updatedAd) {
      return res.status(404).json({ error: 'Ad not found.' });
    }
    
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
