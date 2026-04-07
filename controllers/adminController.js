const fs = require('fs');
const path = require('path');

const { ADS_UPLOADS_PUBLIC_PATH, isValidAdUpload } = require('../config/adStorage');
const { all, get, run } = require('../config/database');
const {
  getCueCinemaMovies,
  saveCueCinemaMovies,
  scrapeComingSoon,
  scrapeMovieDetails,
  scrapeNowShowing,
} = require('../services/movieSyncService');
const {
  getPlayerSettings,
  SCREEN_PLAYER_SETTING_DEFAULTS,
  getScreenPlayerSettings,
  upsertPlayerSettings,
  upsertScreenPlayerSettings,
  setGlobalRefreshToken,
  normalizeScreenName,
} = require('../repositories/playerSettingsRepository');
const {
  createAd,
  deleteAd,
  getAdById,
  getAdByFilePath,
  listAds,
  toggleAdStatus,
  updateSortOrder,
  updateAdCompressionState,
} = require('../repositories/adRepository');
const {
  getMovieById,
  setMoviePlaylistVisibility,
} = require('../repositories/movieSyncRepository');
const {
  ADS_OPTIMIZED_UPLOADS_PUBLIC_PATH,
} = require('../config/adStorage');
const {
  compressVideoForSignage,
  ensureFfmpegAvailable,
} = require('../services/adCompressionService');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';
const ADS_SCAN_ALLOWED_EXTENSIONS = new Set(['.mp4', '.jpg', '.jpeg', '.png', '.webp']);

const PORTRAIT_APPEARANCE_KEYS = [
  'portrait_strip_height_vh',
  'portrait_title_font_size_vh',
  'portrait_status_font_size_vh',
  'portrait_gap_vh',
  'portrait_showtime_height_vh',
  'portrait_badge_width_percent',
  'portrait_info_padding_vh',
];

const CINEMA_WALL_APPEARANCE_KEYS = [
  'cinema_wall_gap_px',
  'cinema_wall_padding_px',
  'cinema_wall_title_font_rem',
  'cinema_wall_showtime_font_rem',
  'cinema_wall_status_font_rem',
  'cinema_wall_card_padding_px',
  'cinema_wall_poster_width_percent',
  'cinema_wall_radius_px',
  'cinema_wall_header_gap_px',
  'cinema_wall_content_scale',
];

function buildDashboardData(message = '', error = '') {
  return Promise.all([
    get(
      `SELECT COUNT(*) AS total
       FROM movies
       WHERE source_name = ?`,
      ['CUE Cinemas']
    ),
    get(
      `SELECT COUNT(*) AS total
       FROM movies
       WHERE source_name = ?
         AND status = ?`,
      ['CUE Cinemas', 'Now Showing']
    ),
    get(
      `SELECT COUNT(*) AS total
       FROM movies
       WHERE source_name = ?
         AND status = ?`,
      ['CUE Cinemas', 'Coming Soon']
    ),
    get(
      `SELECT COUNT(*) AS total
       FROM ads
       WHERE status = ?`,
      ['active']
    ),
    get(
      `SELECT COUNT(*) AS total
       FROM ads
       WHERE status = ?`,
      ['inactive']
    ),
    get(
      `SELECT MAX(last_synced_at) AS last_synced_at
       FROM movies
       WHERE source_name = ?`,
      ['CUE Cinemas']
    ),
  ]).then(([
    totalMoviesRow,
    nowShowingRow,
    comingSoonRow,
    activeAdsRow,
    inactiveAdsRow,
    lastSyncRow,
  ]) => ({
    totalMovies: totalMoviesRow?.total || 0,
    nowShowingCount: nowShowingRow?.total || 0,
    comingSoonCount: comingSoonRow?.total || 0,
    activeAdsCount: activeAdsRow?.total || 0,
    inactiveAdsCount: inactiveAdsRow?.total || 0,
    lastSyncedAt: lastSyncRow?.last_synced_at || '',
    message,
    error,
  }));
}

async function buildLivePlaylistPageData() {
  const [movies, ads] = await Promise.all([
    all(
      `SELECT id, title, poster_url, local_poster_path, status, runtime, genre, release_date, last_synced_at, excluded_from_playlist
       FROM movies
       WHERE source_name = ?
       ORDER BY
         CASE status
           WHEN 'Now Showing' THEN 1
           WHEN 'Coming Soon' THEN 2
           ELSE 3
         END,
         title ASC`,
      ['CUE Cinemas']
    ),
    listAds({
      createdAtOrder: 'DESC',
    }),
  ]);

  const movieRows = movies.map((movie, index) => ({
    id: movie.id,
    entityKind: 'movie',
    itemType: movie.status === 'Coming Soon' ? 'coming-soon' : 'now-showing',
    itemTypeLabel: movie.status || 'Movie',
    thumbnailPath: movie.local_poster_path || movie.poster_url || '',
    title: movie.title,
    sourceLabel: 'Synced Movie',
    durationLabel: movie.runtime || 'N/A',
    isActive: movie.excluded_from_playlist !== 1,
    statusLabel: movie.excluded_from_playlist === 1 ? 'Hidden' : 'Active',
    updatedAt: movie.last_synced_at || '',
    notes: [movie.genre, movie.release_date].filter(Boolean).join(' · ') || 'Sync-driven movie',
    sourceOrder: index,
  }));

  const adRows = ads.map((ad, index) => ({
    id: ad.id,
    entityKind: 'ad',
    itemType: ad.type === 'video' ? 'ad-video' : 'ad-image',
    itemTypeLabel: ad.type === 'video' ? 'Ad Video' : 'Ad Image',
    thumbnailPath: ad.type === 'image' ? ad.file_path : '',
    title: ad.title,
    sourceLabel: 'Ads Manager',
    durationLabel: ad.type === 'image'
      ? `${ad.duration_seconds || 10}s`
      : (ad.duration_seconds ? `${ad.duration_seconds}s` : 'Video asset'),
    isActive: ad.status === 'active',
    statusLabel: ad.status === 'active' ? 'Active' : 'Inactive',
    updatedAt: ad.updated_at || ad.created_at || '',
    notes: `Sort order ${ad.sort_order}${ad.type === 'video' ? ' · Video creative' : ' · Image creative'}`,
    sourceOrder: index,
  }));

  const rows = [...movieRows, ...adRows]
    .sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }

      const typeOrder = {
        'now-showing': 0,
        'coming-soon': 1,
        'ad-video': 2,
        'ad-image': 3,
      };

      const typeDelta = (typeOrder[left.itemType] ?? 99) - (typeOrder[right.itemType] ?? 99);
      if (typeDelta !== 0) {
        return typeDelta;
      }

      return (left.sourceOrder ?? 0) - (right.sourceOrder ?? 0);
    });

  return {
    rows,
    activeCount: rows.filter((row) => row.isActive).length,
    inactiveAdsCount: adRows.filter((row) => !row.isActive).length,
    hiddenMoviesCount: movieRows.filter((row) => !row.isActive).length,
  };
}

async function buildMovieSyncPageData() {
  const [movies, showtimes] = await Promise.all([
    all(
      `SELECT *
       FROM movies
       WHERE source_name = ?
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
  ]);

  const showtimesByMovieId = new Map();

  for (const showtime of showtimes) {
    if (!showtimesByMovieId.has(showtime.movie_id)) {
      showtimesByMovieId.set(showtime.movie_id, new Map());
    }

    const datesMap = showtimesByMovieId.get(showtime.movie_id);
    if (!datesMap.has(showtime.show_date)) {
      datesMap.set(showtime.show_date, []);
    }

    datesMap.get(showtime.show_date).push(showtime.show_time);
  }

  return movies.map((movie) => ({
    ...movie,
    showtimesByDate: [...(showtimesByMovieId.get(movie.id)?.entries() || [])].map(([date, times]) => ({
      date,
      times,
    })),
  }));
}

function consumeFlash(req) {
  const flash = {
    success: req.session.flashMessage || '',
    error: req.session.flashError || '',
  };

  req.session.flashMessage = '';
  req.session.flashError = '';

  return flash;
}

function consumeAdFormData(req) {
  const form = req.session.flashAdForm || {
    title: '',
    duration_seconds: 10,
    sort_order: 0,
    status: 'inactive',
    screen_targets: [],
  };

  req.session.flashAdForm = null;
  return form;
}

function buildAdsAssetAbsolutePath(filePath) {
  if (!filePath || !filePath.startsWith('/uploads_test/ads/')) {
    return null;
  }

  return path.join(__dirname, '..', 'public', filePath.replace(/^\//, ''));
}

function buildAdsOptimizedAbsolutePath(filePath) {
  if (!filePath || !filePath.startsWith(`${ADS_OPTIMIZED_UPLOADS_PUBLIC_PATH}/`)) {
    return null;
  }

  return path.join(__dirname, '..', 'public', filePath.replace(/^\//, ''));
}

function formatBytes(bytes) {
  const numericBytes = Number(bytes);
  if (!Number.isFinite(numericBytes) || numericBytes < 0) {
    return '';
  }

  if (numericBytes < 1024) {
    return `${numericBytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = numericBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function detectAdTypeFromExtension(fileName) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (extension === '.mp4') {
    return 'video';
  }

  if (ADS_SCAN_ALLOWED_EXTENSIONS.has(extension)) {
    return 'image';
  }

  return null;
}

function isSafeAdsFolderPublicPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.startsWith('/uploads_test/ads/')) {
    return false;
  }

  const adsFolderRoot = path.resolve(path.join(__dirname, '..', 'public', 'uploads_test', 'ads'));
  const absolutePath = path.resolve(path.join(__dirname, '..', 'public', filePath.replace(/^\//, '')));
  return absolutePath.startsWith(`${adsFolderRoot}${path.sep}`) || absolutePath === adsFolderRoot;
}

function readAdsFolderFiles() {
  const adsFolderRoot = path.join(__dirname, '..', 'public', 'uploads_test', 'ads');

  return new Promise((resolve, reject) => {
    fs.readdir(adsFolderRoot, { withFileTypes: true }, async (error, entries) => {
      if (error) {
        reject(error);
        return;
      }

      try {
        const files = await Promise.all(
          (Array.isArray(entries) ? entries : [])
            .filter((entry) => entry?.isFile?.())
            .filter((entry) => ADS_SCAN_ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            .map(async (entry) => {
              const absolutePath = path.join(adsFolderRoot, entry.name);
              const stats = await fs.promises.stat(absolutePath);

              return {
                filename: entry.name,
                file_path: `/uploads_test/ads/${entry.name}`,
                size_bytes: stats.size,
                size_label: formatBytes(stats.size),
                type: detectAdTypeFromExtension(entry.name),
              };
            })
        );

        resolve(files.sort((left, right) => left.filename.localeCompare(right.filename)));
      } catch (statError) {
        reject(statError);
      }
    });
  });
}

async function buildAdsPageViewModel(req, scannedFiles = null) {
  const [ads, flash] = await Promise.all([
    listAds(),
    Promise.resolve(consumeFlash(req)),
  ]);

  const adsWithCompression = ads.map((ad) => {
    const originalAbsolutePath = buildAdsAssetAbsolutePath(ad.file_path);
    const optimizedAbsolutePath = buildAdsOptimizedAbsolutePath(ad.optimized_file_path);
    const originalFileExists = !!originalAbsolutePath && fs.existsSync(originalAbsolutePath);
    const optimizedFileExists = !!optimizedAbsolutePath && fs.existsSync(optimizedAbsolutePath);
    const originalSizeBytes = originalFileExists ? fs.statSync(originalAbsolutePath).size : null;
    const optimizedSizeBytes = optimizedFileExists ? fs.statSync(optimizedAbsolutePath).size : null;

    return {
      ...ad,
      original_file_exists: originalFileExists,
      optimized_file_exists: optimizedFileExists,
      original_size_bytes: originalSizeBytes,
      optimized_size_bytes: optimizedSizeBytes,
      original_size_label: formatBytes(originalSizeBytes),
      optimized_size_label: formatBytes(optimizedSizeBytes),
    };
  });

  const existingPaths = new Set(adsWithCompression.map((ad) => ad.file_path));
  return {
    ads: adsWithCompression,
    scannedFiles: Array.isArray(scannedFiles)
      ? scannedFiles.map((file) => ({
          ...file,
          already_imported: existingPaths.has(file.file_path),
        }))
      : [],
    success: flash.success,
    error: flash.error,
  };
}

exports.showLogin = (req, res) => {
  if (req.session.isAuthenticated) {
    res.redirect('/admin');
    return;
  }

  res.render('admin/login', {
    error: '',
    defaultUsername: ADMIN_USERNAME,
  });
};

exports.login = (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAuthenticated = true;
    res.redirect('/admin');
    return;
  }

  res.status(401).render('admin/login', {
    error: 'Invalid username or password.',
    defaultUsername: ADMIN_USERNAME,
  });
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
};

exports.dashboard = async (req, res, next) => {
  try {
    const flash = consumeFlash(req);
    const data = await buildDashboardData(flash.success, flash.error);

    res.render('admin/dashboard', data);
  } catch (error) {
    next(error);
  }
};

exports.movieSyncPage = async (req, res, next) => {
  try {
    const movies = await buildMovieSyncPageData();
    res.render('admin/movie-sync', {
      movies,
    });
  } catch (error) {
    next(error);
  }
};

exports.playlistPage = async (req, res, next) => {
  try {
    const data = await buildLivePlaylistPageData();
    const flash = consumeFlash(req);
    res.render('admin/playlist', {
      ...data,
      success: flash.success,
      error: flash.error,
    });
  } catch (error) {
    next(error);
  }
};

exports.togglePlaylistAd = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    const ad = await toggleAdStatus(adId);

    if (!ad) {
      req.session.flashError = 'Ad not found.';
      req.session.flashMessage = '';
      res.redirect('/admin/playlist');
      return;
    }

    req.session.flashMessage = `Ad ${ad.status === 'active' ? 'activated' : 'deactivated'} from the live playlist.`;
    req.session.flashError = '';
    res.redirect('/admin/playlist');
  } catch (error) {
    next(error);
  }
};

exports.toggleMoviePlaylistVisibility = async (req, res, next) => {
  try {
    const movieId = Number.parseInt(req.params.id, 10);
    const movie = await getMovieById(movieId);

    if (!movie) {
      req.session.flashError = 'Movie not found.';
      req.session.flashMessage = '';
      res.redirect('/admin/playlist');
      return;
    }

    const updatedMovie = await setMoviePlaylistVisibility(movieId, movie.excluded_from_playlist !== 1);
    const isHidden = updatedMovie?.excluded_from_playlist === 1;

    req.session.flashMessage = `Movie ${isHidden ? 'hidden from' : 'restored to'} the live playlist.`;
    req.session.flashError = '';
    res.redirect('/admin/playlist');
  } catch (error) {
    next(error);
  }
};

exports.playerSettingsPage = async (req, res, next) => {
  try {
    const screenOrder = ['cinema', 'cinema-3x2', 'cinema-portrait'];
    const screenSettings = Object.fromEntries(await Promise.all(
      screenOrder.map(async (screen) => {
        const settings = await getScreenPlayerSettings(screen);
        return [
          screen,
          settings || {
            screen,
            ...SCREEN_PLAYER_SETTING_DEFAULTS,
          },
        ];
      })
    ));
    const flash = consumeFlash(req);

    res.render('admin/player-settings', {
      screenSettings,
      success: flash.success,
      error: flash.error,
    });
  } catch (error) {
    next(error);
  }
};

exports.refreshAllScreens = async (req, res, next) => {
  try {
    await setGlobalRefreshToken(new Date().toISOString());

    req.session.flashMessage = 'Refresh signal sent to all screens.';
    req.session.flashError = '';
    res.redirect('/admin/player-settings');
  } catch (error) {
    next(error);
  }
};

exports.savePlayerSettings = async (req, res, next) => {
  try {
    const wantsJson = String(req.get('accept') || '').includes('application/json');
    const hasScreenField = Object.prototype.hasOwnProperty.call(req.body, 'screen');
    const selectedScreen = normalizeScreenName(req.body.screen);

    if (hasScreenField && !selectedScreen) {
      const errorMessage = 'Invalid screen selected.';
      if (wantsJson) {
        res.status(400).json({ error: errorMessage });
        return;
      }
      req.session.flashError = errorMessage;
      req.session.flashMessage = '';
      res.redirect('/admin/player-settings');
      return;
    }

    if (!selectedScreen) {
      const errorMessage = 'Invalid screen selected.';
      if (wantsJson) {
        res.status(400).json({ error: errorMessage });
        return;
      }
      req.session.flashError = errorMessage;
      req.session.flashMessage = '';
      res.redirect('/admin/player-settings');
      return;
    }

    const nowShowingDuration = Number.parseInt(req.body.now_showing_duration_seconds, 10);
    const comingSoonDuration = Number.parseInt(req.body.coming_soon_duration_seconds, 10);
    const adFrequencyMovies = Number.parseInt(req.body.ad_frequency_movies, 10);
    const hasPosterWidthField = Object.prototype.hasOwnProperty.call(req.body, 'poster_width_percent');
    const posterWidthPercent = hasPosterWidthField
      ? Number.parseInt(req.body.poster_width_percent, 10)
      : SCREEN_PLAYER_SETTING_DEFAULTS.poster_width_percent;
    const hasRowHeightField = Object.prototype.hasOwnProperty.call(req.body, 'row_height_percent');
    const rowHeightPercent = hasRowHeightField
      ? Number.parseInt(req.body.row_height_percent, 10)
      : SCREEN_PLAYER_SETTING_DEFAULTS.row_height_percent;
    const isEnabled = req.body.enable_ads === 'on' || req.body.enable_ads === 'true' || req.body.enable_ads === '1';
    const isValidDuration = (value) => Number.isFinite(value) && value >= 1 && value <= 60;
    const isValidAdFrequency = Number.isFinite(adFrequencyMovies) && adFrequencyMovies >= 1 && adFrequencyMovies <= 10;
    const isValidPosterWidth = Number.isFinite(posterWidthPercent) && posterWidthPercent >= 20 && posterWidthPercent <= 70;
    const isValidRowHeight = Number.isFinite(rowHeightPercent) && rowHeightPercent >= 70 && rowHeightPercent <= 130;

    if (!isValidDuration(nowShowingDuration) || !isValidDuration(comingSoonDuration)) {
      const errorMessage = 'Durations must be whole seconds between 1 and 60.';
      if (wantsJson) {
        res.status(400).json({ error: errorMessage });
        return;
      }
      req.session.flashError = errorMessage;
      req.session.flashMessage = '';
      res.redirect('/admin/player-settings');
      return;
    }

    if (!isValidAdFrequency) {
      const errorMessage = 'Ad frequency must be a whole number between 1 and 10.';
      if (wantsJson) {
        res.status(400).json({ error: errorMessage });
        return;
      }
      req.session.flashError = errorMessage;
      req.session.flashMessage = '';
      res.redirect('/admin/player-settings');
      return;
    }

    if (hasPosterWidthField && !isValidPosterWidth) {
      const errorMessage = 'Poster width must be a whole number between 20 and 70.';
      if (wantsJson) {
        res.status(400).json({ error: errorMessage });
        return;
      }
      req.session.flashError = errorMessage;
      req.session.flashMessage = '';
      res.redirect('/admin/player-settings');
      return;
    }

    if (hasRowHeightField && !isValidRowHeight) {
      const errorMessage = 'Grid height must be a whole number between 70 and 130.';
      if (wantsJson) {
        res.status(400).json({ error: errorMessage });
        return;
      }
      req.session.flashError = errorMessage;
      req.session.flashMessage = '';
      res.redirect('/admin/player-settings');
      return;
    }

    const updatedSettings = await upsertScreenPlayerSettings(selectedScreen, {
      now_showing_duration_seconds: nowShowingDuration,
      coming_soon_duration_seconds: comingSoonDuration,
      enable_ads: isEnabled,
      ad_frequency_movies: adFrequencyMovies,
      poster_width_percent: posterWidthPercent,
      row_height_percent: rowHeightPercent,
    });

    if (wantsJson) {
      res.json({ data: updatedSettings });
      return;
    }

    req.session.flashMessage = 'Screen settings saved.';
    req.session.flashError = '';
    res.redirect('/admin/player-settings');
  } catch (error) {
    next(error);
  }
};

exports.resetPortraitSettings = async (req, res, next) => {
  try {
    // Deleting the specific settings from DB will make it fallback to defaults
    for (const key of PORTRAIT_APPEARANCE_KEYS) {
      await run('DELETE FROM player_settings WHERE setting_key = ?', [key]);
    }

    req.session.flashMessage = 'Portrait appearance settings reset to default.';
    req.session.flashError = '';
    res.redirect('/admin/player-settings');
  } catch (error) {
    next(error);
  }
};

exports.resetCinemaWallSettings = async (req, res, next) => {
  try {
    for (const key of CINEMA_WALL_APPEARANCE_KEYS) {
      await run('DELETE FROM player_settings WHERE setting_key = ?', [key]);
    }

    req.session.flashMessage = 'Cinema wall appearance settings reset to default.';
    req.session.flashError = '';
    res.redirect('/admin/player-settings');
  } catch (error) {
    next(error);
  }
};

exports.uploadMedia = async (req, res, next) => {
  try {
    if (!req.file) {
      req.session.flashError = 'Please upload a JPG, PNG, or MP4 file.';
      res.redirect('/admin');
      return;
    }

    const detectedType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    const rawDuration = Number.parseInt(req.body.duration, 10);
    const duration = detectedType === 'image' && rawDuration > 0 ? rawDuration : null;
    const name = req.body.name?.trim() || path.parse(req.file.originalname).name;
    const filePath = `/uploads_test/${req.file.filename}`;

    await run(
      'INSERT INTO media (name, file_path, type, duration) VALUES (?, ?, ?, ?)',
      [name, filePath, detectedType, duration]
    );

    req.session.flashMessage = 'Media uploaded successfully.';
    res.redirect('/admin');
  } catch (error) {
    next(error);
  }
};

exports.uploadAd = async (req, res, next) => {
  try {
    if (!req.file) {
      req.session.flashError = 'Please upload a JPG, JPEG, PNG, WEBP, or MP4 file.';
      req.session.flashMessage = '';
      req.session.flashAdForm = {
        title: req.body.title?.trim() || '',
        duration_seconds: req.body.duration_seconds || 10,
        sort_order: req.body.sort_order || 0,
        status: req.body.status === 'active' ? 'active' : 'inactive',
      };
      res.redirect('/admin/ads/new');
      return;
    }

    if (!isValidAdUpload(req.file)) {
      req.session.flashError = 'Invalid file type for ads.';
      req.session.flashMessage = '';
      req.session.flashAdForm = {
        title: req.body.title?.trim() || '',
        duration_seconds: req.body.duration_seconds || 10,
        sort_order: req.body.sort_order || 0,
        status: req.body.status === 'active' ? 'active' : 'inactive',
      };
      res.redirect('/admin/ads/new');
      return;
    }

    const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    const rawDuration = req.body.duration_seconds ?? req.body.duration;
    const parsedDuration = Number.parseInt(rawDuration, 10);
    const durationSeconds = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null;

    if (type === 'image' && !durationSeconds) {
      req.session.flashError = 'Image ads require a duration in seconds.';
      req.session.flashMessage = '';
      req.session.flashAdForm = {
        title: req.body.title?.trim() || '',
        duration_seconds: rawDuration || 10,
        sort_order: req.body.sort_order || 0,
        status: req.body.status === 'active' ? 'active' : 'inactive',
      };
      res.redirect('/admin/ads/new');
      return;
    }

    const sortOrderValue = Number.parseInt(req.body.sort_order, 10);
    const sortOrder = Number.isFinite(sortOrderValue) ? sortOrderValue : 0;
    const status = req.body.status === 'active' ? 'active' : 'inactive';
    const title = req.body.title?.trim() || path.parse(req.file.originalname).name;
    const filePath = `${ADS_UPLOADS_PUBLIC_PATH}/${req.file.filename}`;

    const rawScreenTargets = req.body.screen_targets;
    const screenTargets = Array.isArray(rawScreenTargets) 
      ? rawScreenTargets.join(',') 
      : (rawScreenTargets || null);

    await createAd({
      title,
      file_path: filePath,
      type,
      duration_seconds: durationSeconds,
      status,
      sort_order: sortOrder,
      screen_targets: screenTargets,
    });

    req.session.flashMessage = 'Ad uploaded successfully.';
    req.session.flashError = '';
    req.session.flashAdForm = null;
    res.redirect('/admin/ads');
  } catch (error) {
    next(error);
  }
};

exports.importAdFromFolder = async (req, res, next) => {
  try {
    const filePath = String(req.body.file_path || '').trim();

    if (!isSafeAdsFolderPublicPath(filePath)) {
      req.session.flashError = 'Invalid ads folder path.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads/scan');
      return;
    }

    const absolutePath = buildAdsAssetAbsolutePath(filePath);
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      req.session.flashError = 'Selected file was not found in the ads folder.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads/scan');
      return;
    }

    const type = detectAdTypeFromExtension(filePath);
    if (!type) {
      req.session.flashError = 'Unsupported file type in ads folder.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads/scan');
      return;
    }

    const existingAd = await getAdByFilePath(filePath);
    if (existingAd) {
      req.session.flashMessage = 'File already imported as an ad.';
      req.session.flashError = '';
      res.redirect('/admin/ads/scan');
      return;
    }

    await createAd({
      title: path.basename(filePath),
      file_path: filePath,
      type,
      duration_seconds: type === 'video' ? null : 10,
      status: 'inactive',
      sort_order: 0,
      screen_targets: null,
    });

    req.session.flashMessage = 'Ad imported from ads folder.';
    req.session.flashError = '';
    res.redirect('/admin/ads');
  } catch (error) {
    next(error);
  }
};

exports.adsPage = async (req, res, next) => {
  try {
    res.render('admin/ads', await buildAdsPageViewModel(req));
  } catch (error) {
    next(error);
  }
};

exports.scanAdsFolder = async (req, res, next) => {
  try {
    const scannedFiles = await readAdsFolderFiles();
    res.render('admin/ads', await buildAdsPageViewModel(req, scannedFiles));
  } catch (error) {
    next(error);
  }
};

exports.newAdPage = (req, res) => {
  const flash = consumeFlash(req);

  res.render('admin/ads-new', {
    success: flash.success,
    error: flash.error,
    formData: consumeAdFormData(req),
  });
};

exports.editAdPage = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(adId)) {
      res.status(400).render('admin/ads-edit', {
        ad: null,
        error: 'Invalid ad identifier.',
      });
      return;
    }

    const ad = await getAdById(adId);
    if (!ad) {
      res.status(404).render('admin/ads-edit', {
        ad: null,
        error: 'Ad not found.',
      });
      return;
    }

    res.render('admin/ads-edit', {
      ad,
      error: '',
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteAd = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    const ad = await getAdById(adId);

    if (!ad) {
      req.session.flashError = 'Ad not found.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    await deleteAd(adId);

    const absoluteAssetPath = buildAdsAssetAbsolutePath(ad.file_path);
    if (absoluteAssetPath && fs.existsSync(absoluteAssetPath)) {
      fs.unlinkSync(absoluteAssetPath);
    }

    req.session.flashMessage = 'Ad deleted.';
    req.session.flashError = '';
    res.redirect('/admin/ads');
  } catch (error) {
    next(error);
  }
};

exports.toggleAd = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    const ad = await toggleAdStatus(adId);

    if (!ad) {
      req.session.flashError = 'Ad not found.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    req.session.flashMessage = `Ad ${ad.status === 'active' ? 'activated' : 'deactivated'}.`;
    req.session.flashError = '';
    res.redirect('/admin/ads');
  } catch (error) {
    next(error);
  }
};

exports.updateAdSortOrder = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    const sortOrder = Number.parseInt(req.body.sort_order, 10);

    if (!Number.isFinite(sortOrder)) {
      req.session.flashError = 'Sort order must be a whole number.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    const ad = await updateSortOrder(adId, sortOrder);
    if (!ad) {
      req.session.flashError = 'Ad not found.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    req.session.flashMessage = 'Ad sort order updated.';
    req.session.flashError = '';
    res.redirect('/admin/ads');
  } catch (error) {
    next(error);
  }
};

exports.compressAdForSignage = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    const ad = await getAdById(adId);

    if (!ad) {
      req.session.flashError = 'Ad not found.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    if (ad.type !== 'video' || path.extname(ad.file_path || '').toLowerCase() !== '.mp4') {
      req.session.flashError = 'Only MP4 video ads can be compressed for player playback.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    const absoluteAssetPath = buildAdsAssetAbsolutePath(ad.file_path);
    if (!absoluteAssetPath || !fs.existsSync(absoluteAssetPath)) {
      req.session.flashError = 'Source video file is missing.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    try {
      await ensureFfmpegAvailable();
    } catch (error) {
      req.session.flashError = error.message;
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    await updateAdCompressionState(adId, {
      optimized_status: 'queued',
      optimized_error: null,
      optimized_started_at: null,
      optimized_completed_at: null,
    });

    setImmediate(async () => {
      try {
        await updateAdCompressionState(adId, {
          optimized_status: 'processing',
          optimized_error: null,
          optimized_started_at: new Date().toISOString(),
        });

        const result = await compressVideoForSignage(ad.file_path);

        await updateAdCompressionState(adId, {
          optimized_file_path: result.optimizedPublicPath,
          optimized_status: 'completed',
          optimized_error: null,
          optimized_started_at: new Date().toISOString(),
          optimized_completed_at: new Date().toISOString(),
          optimized_source_size_bytes: result.sourceSizeBytes,
          optimized_output_size_bytes: result.optimizedSizeBytes,
        });
      } catch (error) {
        await updateAdCompressionState(adId, {
          optimized_status: 'failed',
          optimized_error: error.message.slice(0, 500),
          optimized_completed_at: new Date().toISOString(),
        });
      }
    });

    req.session.flashMessage = 'Compression queued. Refresh the Ads Manager to see progress.';
    req.session.flashError = '';
    res.redirect('/admin/ads');
  } catch (error) {
    next(error);
  }
};

exports.importOptimizedAd = async (req, res, next) => {
  try {
    const adId = Number.parseInt(req.params.id, 10);
    const ad = await getAdById(adId);

    if (!ad) {
      req.session.flashError = 'Ad not found.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    if (ad.optimized_status !== 'completed' || !ad.optimized_file_path) {
      req.session.flashError = 'No completed optimized file is available for this ad.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    const optimizedAbsolutePath = buildAdsOptimizedAbsolutePath(ad.optimized_file_path);
    if (!optimizedAbsolutePath || !fs.existsSync(optimizedAbsolutePath)) {
      req.session.flashError = 'Optimized file is missing from disk.';
      req.session.flashMessage = '';
      res.redirect('/admin/ads');
      return;
    }

    const existingAd = await getAdByFilePath(ad.optimized_file_path);
    if (existingAd) {
      req.session.flashMessage = 'Optimized file is already imported as an ad.';
      req.session.flashError = '';
      res.redirect('/admin/ads');
      return;
    }

    await createAd({
      title: `${ad.title} (Optimized)`,
      file_path: ad.optimized_file_path,
      type: 'video',
      duration_seconds: null,
      status: ad.status,
      sort_order: ad.sort_order,
    });

    req.session.flashMessage = 'Optimized file imported as a new ad.';
    req.session.flashError = '';
    res.redirect('/admin/ads');
  } catch (error) {
    next(error);
  }
};

exports.savePlaylist = async (req, res, next) => {
  try {
    const selected = req.body.selected_media || [];
    const selectedIds = Array.isArray(selected) ? selected : [selected];
    const uniqueIds = [...new Set(selectedIds.map((value) => Number.parseInt(value, 10)).filter(Boolean))];

    await run('BEGIN TRANSACTION');

    try {
      await run('DELETE FROM playlist_items');

      for (const mediaId of uniqueIds) {
        const orderValue = Number.parseInt(req.body[`order_${mediaId}`], 10);
        const itemOrder = Number.isFinite(orderValue) ? orderValue : 9999;
        await run(
          'INSERT INTO playlist_items (media_id, "order") VALUES (?, ?)',
          [mediaId, itemOrder]
        );
      }

      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK');
      throw error;
    }

    req.session.flashMessage = 'Playlist updated.';
    res.redirect('/admin');
  } catch (error) {
    next(error);
  }
};

exports.previewNowShowing = async (req, res, next) => {
  try {
    const movies = await scrapeNowShowing();
    res.json({
      data: movies,
    });
  } catch (error) {
    next(error);
  }
};

exports.previewComingSoon = async (req, res, next) => {
  try {
    const movies = await scrapeComingSoon();
    res.json({
      data: movies,
    });
  } catch (error) {
    next(error);
  }
};

exports.previewMovieDetails = async (req, res, next) => {
  try {
    const detailsPageUrl = req.query.url?.trim();

    if (!detailsPageUrl) {
      res.status(400).json({
        error: 'Missing required query param: url',
      });
      return;
    }

    const details = await scrapeMovieDetails(detailsPageUrl);
    res.json({
      data: details,
    });
  } catch (error) {
    next(error);
  }
};

exports.previewAllCueCinemaMovies = async (req, res, next) => {
  try {
    const movies = await getCueCinemaMovies();
    res.json({
      data: movies,
    });
  } catch (error) {
    next(error);
  }
};

exports.runCueCinemaSync = async (req, res, next) => {
  try {
    const summary = await saveCueCinemaMovies({
      forcePosterRefresh: req.body?.forcePosterRefresh === true,
    });
    res.json({
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};
