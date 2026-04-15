const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const {
  ADS_UPLOADS_DIR,
  AD_ALLOWED_MIME_TYPES,
  ensureAdsUploadsDir,
} = require('../config/adStorage');

const adminController = require('../controllers/adminController');
const vistaReportRoutes = require('./vistaReport');
const reportRoutes = require('./report');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads_test');
ensureAdsUploadsDir();
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, callback) => {
    const safeBaseName = path
      .parse(file.originalname)
      .name.replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 60);
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${safeBaseName}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 250 * 1024 * 1024,
  },
  fileFilter: (req, file, callback) => {
    const isValid = ['image/jpeg', 'image/png', 'video/mp4'].includes(file.mimetype);
    callback(isValid ? null : new Error('Invalid file type.'), isValid);
  },
});

const adStorage = multer.diskStorage({
  destination: ADS_UPLOADS_DIR,
  filename: (req, file, callback) => {
    const safeBaseName = path
      .parse(file.originalname)
      .name.replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 60);
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${safeBaseName}${extension}`);
  },
});

const adUpload = multer({
  storage: adStorage,
  limits: {
    fileSize: 250 * 1024 * 1024,
  },
  fileFilter: (req, file, callback) => {
    const isValid = AD_ALLOWED_MIME_TYPES.includes(file.mimetype);
    callback(isValid ? null : new Error('Invalid file type for ads.'), isValid);
  },
});

router.get('/login', adminController.showLogin);
router.post('/login', adminController.login);
router.post('/logout', requireAuth, adminController.logout);
router.get('/', requireAuth, adminController.dashboard);
router.get('/ads', requireAuth, adminController.adsPage);
router.get('/ads/scan', requireAuth, adminController.scanAdsFolder);
router.get('/ads/new', requireAuth, adminController.newAdPage);
router.get('/ads/edit/:id', requireAuth, adminController.editAdPage);
router.get('/movie-sync', requireAuth, adminController.movieSyncPage);
router.get('/playlist', requireAuth, adminController.playlistPage);
router.get('/player-settings', requireAuth, adminController.playerSettingsPage);
router.get('/movie-schedule-api', requireAuth, adminController.movieScheduleApiPage);
router.get('/screens', requireAuth, adminController.screensPage);
router.post('/screens/refresh', requireAuth, adminController.refreshScreen);
router.use('/vista-report', requireAuth, vistaReportRoutes);
router.use('/reports', requireAuth, reportRoutes);
router.get('/movie-sync/preview-now', requireAuth, adminController.previewNowShowing);
router.get('/movie-sync/preview-coming', requireAuth, adminController.previewComingSoon);
router.get('/movie-sync/preview-details', requireAuth, adminController.previewMovieDetails);
router.get('/movie-sync/preview-all', requireAuth, adminController.previewAllCueCinemaMovies);
router.post('/movie-sync/run', requireAuth, adminController.runCueCinemaSync);
router.post('/player-settings/refresh-all-screens', requireAuth, adminController.refreshAllScreens);
router.post('/player-settings', requireAuth, adminController.savePlayerSettings);
router.post('/player-settings/reset-portrait', requireAuth, adminController.resetPortraitSettings);
router.post('/player-settings/reset-cinema-wall', requireAuth, adminController.resetCinemaWallSettings);
router.post('/media', requireAuth, upload.single('media_file'), adminController.uploadMedia);
router.post('/ads', requireAuth, adUpload.single('ad_file'), adminController.uploadAd);
router.post('/ads/import-from-folder', requireAuth, adminController.importAdFromFolder);
router.post('/ads/bulk-status', requireAuth, adminController.bulkUpdateAdsStatus);
router.post('/ads/bulk-delete', requireAuth, adminController.bulkDeleteAds);
router.post('/ads/bulk-duplicate', requireAuth, adminController.bulkDuplicateAds);
router.post('/ads/bulk-targets', requireAuth, adminController.bulkUpdateAdsTargets);
router.post('/ads/:id/compress', requireAuth, adminController.compressAdForSignage);
router.post('/ads/:id/import-optimized', requireAuth, adminController.importOptimizedAd);
router.post('/ads/:id/delete', requireAuth, adminController.deleteAd);
router.post('/ads/:id/sort', requireAuth, adminController.updateAdSortOrder);
router.post('/ads/:id/toggle', requireAuth, adminController.toggleAd);
router.post('/playlist/ads/:id/toggle', requireAuth, adminController.togglePlaylistAd);
router.post('/playlist/movies/:id/toggle', requireAuth, adminController.toggleMoviePlaylistVisibility);
router.post('/playlist', requireAuth, adminController.savePlaylist);

module.exports = router;
