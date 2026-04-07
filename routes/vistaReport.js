const express = require('express');

const vistaReportController = require('../controllers/vistaReportController');

const router = express.Router();

router.get('/', vistaReportController.index);
router.post('/daily/calculate', vistaReportController.calculateDaily);
router.post('/daily/save', vistaReportController.saveDaily);
router.get('/daily/:id', vistaReportController.showDaily);
router.post('/weekly/calculate', vistaReportController.calculateWeekly);
router.post('/weekly/save', vistaReportController.saveWeekly);
router.get('/weekly/:id', vistaReportController.showWeekly);
router.get('/history', vistaReportController.history);
router.get('/:id/pdf', vistaReportController.printReport);
router.get('/:id', vistaReportController.showReport);
router.post('/:id/delete', vistaReportController.deleteReport);

module.exports = router;
