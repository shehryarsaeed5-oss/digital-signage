const express = require('express');

const reportController = require('../controllers/reportController');

const router = express.Router();

router.get('/', reportController.index);
router.get('/ads', reportController.ads);
router.get('/screens', reportController.screens);
router.get('/export.csv', reportController.exportCsv);

module.exports = router;
