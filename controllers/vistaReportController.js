const {
  createVistaReport,
  deleteVistaReport,
  getVistaReportWithItems,
  listVistaReports,
} = require('../repositories/vistaReportRepository');
const {
  DAY_KEYS,
  DAY_LABELS,
  buildHistoryPageViewModel,
  buildStoredReportView,
  calculateDailyReportFromForm,
  calculateWeeklyReportFromForm,
} = require('../services/vistaReportService');

function consumeFlash(req) {
  const flash = {
    success: req.session.flashMessage || '',
    error: req.session.flashError || '',
  };

  req.session.flashMessage = '';
  req.session.flashError = '';

  return flash;
}

function defaultDailyForm() {
  return {
    report_date: '',
    site_name: '',
    screen_on_time_hours: '',
    total_movie_posters_count: '',
    seconds_per_movie_poster: '',
    elevate_repeat_count: '',
    seconds_per_elevate_play: '',
    other_ads: {
      name: ['', '', ''],
      duration: ['', '', ''],
      plays: ['', '', ''],
    },
  };
}

function defaultWeeklyForm() {
  return {
    week_start_date: '',
    site_name: '',
    days: {},
  };
}

function renderIndex(res, options = {}) {
  res.render('admin/vista-report', {
    success: options.success || '',
    error: options.error || '',
    dailyForm: options.dailyForm || defaultDailyForm(),
    weeklyForm: options.weeklyForm || defaultWeeklyForm(),
    dailyResult: options.dailyResult || null,
    weeklyResult: options.weeklyResult || null,
    DAY_KEYS,
    DAY_LABELS,
  });
}

async function renderStoredReport(res, reportId, expectedType = null, viewName = 'admin/vista-report-detail', flash = {}) {
  const { report, items } = await getVistaReportWithItems(reportId);

  if (!report) {
    res.status(404).render(viewName, {
      report: null,
      reportView: null,
      error: 'Report not found.',
      success: flash.success || '',
    });
    return;
  }

  if (expectedType && report.report_type !== expectedType) {
    res.status(404).render(viewName, {
      report: null,
      reportView: null,
      error: 'Report type mismatch.',
      success: flash.success || '',
    });
    return;
  }

  res.render(viewName, {
    report,
    reportView: buildStoredReportView(report, items),
    error: flash.error || '',
    success: flash.success || '',
  });
}

exports.index = async (req, res, next) => {
  try {
    const flash = consumeFlash(req);
    renderIndex(res, {
      success: flash.success,
      error: flash.error,
    });
  } catch (error) {
    next(error);
  }
};

exports.calculateDaily = async (req, res, next) => {
  try {
    const result = calculateDailyReportFromForm(req.body.daily || {});
    if (result.errors.length > 0) {
      renderIndex(res, {
        error: result.errors.join(' '),
        dailyForm: result.formData,
      });
      return;
    }

    renderIndex(res, {
      dailyForm: result.formData,
      dailyResult: result.viewModel,
    });
  } catch (error) {
    next(error);
  }
};

exports.saveDaily = async (req, res, next) => {
  try {
    const result = calculateDailyReportFromForm(req.body.daily || {});
    if (result.errors.length > 0) {
      renderIndex(res, {
        error: result.errors.join(' '),
        dailyForm: result.formData,
      });
      return;
    }

    const savedReport = await createVistaReport(result.reportRecord, result.itemRecords);
    req.session.flashMessage = 'Daily report saved.';
    req.session.flashError = '';
    res.redirect(`/admin/vista-report/daily/${savedReport.id}`);
  } catch (error) {
    next(error);
  }
};

exports.calculateWeekly = async (req, res, next) => {
  try {
    const result = calculateWeeklyReportFromForm(req.body.weekly || {});
    if (result.errors.length > 0) {
      renderIndex(res, {
        error: result.errors.join(' '),
        weeklyForm: result.formData,
      });
      return;
    }

    renderIndex(res, {
      weeklyForm: result.formData,
      weeklyResult: result.viewModel,
    });
  } catch (error) {
    next(error);
  }
};

exports.saveWeekly = async (req, res, next) => {
  try {
    const result = calculateWeeklyReportFromForm(req.body.weekly || {});
    if (result.errors.length > 0) {
      renderIndex(res, {
        error: result.errors.join(' '),
        weeklyForm: result.formData,
      });
      return;
    }

    const savedReport = await createVistaReport(result.reportRecord, result.itemRecords);
    req.session.flashMessage = 'Weekly report saved.';
    req.session.flashError = '';
    res.redirect(`/admin/vista-report/weekly/${savedReport.id}`);
  } catch (error) {
    next(error);
  }
};

exports.showDaily = async (req, res, next) => {
  try {
    const reportId = Number.parseInt(req.params.id, 10);
    const flash = consumeFlash(req);
    if (!Number.isFinite(reportId)) {
      res.status(400).render('admin/vista-report-detail', {
        report: null,
        reportView: null,
        error: 'Invalid report identifier.',
        success: flash.success || '',
      });
      return;
    }

    await renderStoredReport(res, reportId, 'daily', 'admin/vista-report-detail', flash);
  } catch (error) {
    next(error);
  }
};

exports.showWeekly = async (req, res, next) => {
  try {
    const reportId = Number.parseInt(req.params.id, 10);
    const flash = consumeFlash(req);
    if (!Number.isFinite(reportId)) {
      res.status(400).render('admin/vista-report-detail', {
        report: null,
        reportView: null,
        error: 'Invalid report identifier.',
        success: flash.success || '',
      });
      return;
    }

    await renderStoredReport(res, reportId, 'weekly', 'admin/vista-report-detail', flash);
  } catch (error) {
    next(error);
  }
};

exports.showReport = async (req, res, next) => {
  try {
    const reportId = Number.parseInt(req.params.id, 10);
    const flash = consumeFlash(req);
    if (!Number.isFinite(reportId)) {
      res.status(400).render('admin/vista-report-detail', {
        report: null,
        reportView: null,
        error: 'Invalid report identifier.',
        success: flash.success || '',
      });
      return;
    }

    await renderStoredReport(res, reportId, null, 'admin/vista-report-detail', flash);
  } catch (error) {
    next(error);
  }
};

exports.printReport = async (req, res, next) => {
  try {
    const reportId = Number.parseInt(req.params.id, 10);
    const flash = consumeFlash(req);
    if (!Number.isFinite(reportId)) {
      res.status(400).render('admin/vista-report-print', {
        report: null,
        reportView: null,
        error: 'Invalid report identifier.',
        success: flash.success || '',
      });
      return;
    }

    await renderStoredReport(res, reportId, null, 'admin/vista-report-print', flash);
  } catch (error) {
    next(error);
  }
};

exports.history = async (req, res, next) => {
  try {
    const flash = consumeFlash(req);
    const filters = {
      reportType: req.query.type || '',
      siteName: req.query.site || '',
      reportDate: req.query.date || '',
    };

    const reports = await listVistaReports({
      reportType: filters.reportType || undefined,
      siteName: filters.siteName || undefined,
      reportDate: filters.reportDate || undefined,
      limit: 200,
    });

    res.render('admin/vista-report-history', {
      ...buildHistoryPageViewModel(reports, filters),
      success: flash.success,
      error: flash.error,
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteReport = async (req, res, next) => {
  try {
    const reportId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(reportId)) {
      req.session.flashError = 'Invalid report identifier.';
      req.session.flashMessage = '';
      res.redirect('/admin/vista-report/history');
      return;
    }

    await deleteVistaReport(reportId);
    req.session.flashMessage = 'Report deleted.';
    req.session.flashError = '';
    res.redirect('/admin/vista-report/history');
  } catch (error) {
    next(error);
  }
};
