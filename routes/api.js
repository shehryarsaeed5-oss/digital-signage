const express = require('express');

const apiController = require('../controllers/apiController');

const router = express.Router();

router.get('/player-settings', apiController.playerSettings);
router.get('/player-settings/refresh-token', apiController.playerSettingsRefreshToken);
router.get('/playlist', apiController.playlist);
router.get('/ads', apiController.ads);
router.post('/ads', apiController.createAdApi);
router.put('/ads/:id', apiController.updateAdApi);
router.delete('/ads/:id', apiController.deleteAdApi);
router.get('/share/movie-schedule', apiController.movieScheduleShare);
router.get('/cinema-movies', apiController.cinemaMovies);
router.post('/reports/playback/start', apiController.logPlaybackStart);
router.post('/reports/playback/end', apiController.logPlaybackEnd);
router.post('/reports/playback/failure', apiController.logPlaybackFailure);
router.post('/reports/heartbeat', apiController.logHeartbeat);
router.post('/player/heartbeat', apiController.logHeartbeat);

module.exports = router;
