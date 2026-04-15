const {
  exportPlaybackLogsCsv,
  getAdPerformanceReport,
  getPlaybackSummary,
  getRecentPlaybackLogs,
  getScreenActivityReport,
} = require('../repositories/reportRepository');
const {
  SCREEN_PLAYER_SETTING_LABELS,
  SCREEN_PLAYER_SETTING_ORDER,
  normalizeScreenName,
} = require('../repositories/playerSettingsRepository');

const SCREEN_FILTER_OPTIONS = [
  { value: '', label: 'All Screens' },
  ...SCREEN_PLAYER_SETTING_ORDER.map((screen) => ({
    value: screen,
    label: SCREEN_PLAYER_SETTING_LABELS[screen] || screen,
  })),
];

const ITEM_TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All Item Types' },
  { value: 'movie', label: 'Movie' },
  { value: 'ad', label: 'Ad' },
];

function consumeFlash(req) {
  const flash = {
    success: req.session.flashMessage || '',
    error: req.session.flashError || '',
  };

  req.session.flashMessage = '';
  req.session.flashError = '';

  return flash;
}

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function buildDefaultDateRange() {
  const today = new Date();
  const dateTo = formatDateInput(today);
  const dateFromDate = new Date(today);
  dateFromDate.setDate(dateFromDate.getDate() - 6);

  return {
    dateFrom: formatDateInput(dateFromDate),
    dateTo,
  };
}

function normalizeDateInput(value, fallback) {
  const text = String(value || '').trim();
  if (!text) {
    return fallback;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function normalizeItemType(value) {
  const text = String(value || '').toLowerCase().trim();
  if (text === 'movie' || text === 'ad') {
    return text;
  }

  return '';
}

function buildFilters(query = {}) {
  const defaults = buildDefaultDateRange();

  return {
    dateFrom: normalizeDateInput(query.date_from, defaults.dateFrom),
    dateTo: normalizeDateInput(query.date_to, defaults.dateTo),
    screen: normalizeScreenName(query.screen) || '',
    itemType: normalizeItemType(query.item_type),
  };
}

function buildQueryString(filters = {}) {
  const params = new URLSearchParams();

  if (filters.dateFrom) {
    params.set('date_from', filters.dateFrom);
  }

  if (filters.dateTo) {
    params.set('date_to', filters.dateTo);
  }

  if (filters.screen) {
    params.set('screen', filters.screen);
  }

  if (filters.itemType) {
    params.set('item_type', filters.itemType);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

function formatTimestamp(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatSeconds(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return '0.0 min';
  }

  return `${(numericValue / 60).toFixed(1)} min`;
}

function screenLabel(screen) {
  if (!screen) {
    return 'All Screens';
  }

  return SCREEN_PLAYER_SETTING_LABELS[screen] || screen;
}

function mapLogRow(row) {
  return {
    ...row,
    itemTypeLabel: row.item_type === 'ad' ? 'Ad' : 'Movie',
    statusLabel: String(row.status || '').toLowerCase() || 'played',
    startedAtLabel: formatTimestamp(row.started_at),
    endedAtLabel: formatTimestamp(row.ended_at),
    durationLabel: formatSeconds(row.duration_seconds),
  };
}

function mapAdPerformanceRow(row) {
  const screenTargets = String(row.screen_targets || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    ...row,
    targetScreensLabel: screenTargets.length > 0
      ? screenTargets.map((value) => screenLabel(value)).join(', ')
      : 'All Screens',
    totalDisplayLabel: formatSeconds(row.total_display_seconds),
    lastPlayedLabel: formatTimestamp(row.last_played_at),
  };
}

function mapScreenRow(row) {
  return {
    ...row,
    onlineLabel: row.connection_status === 'online' ? 'Online' : 'Offline',
    lastSeenLabel: formatTimestamp(row.last_seen_at),
  };
}

async function buildOverviewViewModel(filters) {
  const [summary, recentLogs] = await Promise.all([
    getPlaybackSummary(filters),
    getRecentPlaybackLogs({
      ...filters,
      limit: 20,
    }),
  ]);

  return {
    summary: {
      totalEvents: summary.totalEvents,
      moviePlays: summary.moviePlays,
      adPlays: summary.adPlays,
      estimatedMinutes: (summary.totalDurationSeconds / 60).toFixed(1),
    },
    recentLogs: recentLogs.map(mapLogRow),
  };
}

async function buildAdReportViewModel(filters) {
  const rows = await getAdPerformanceReport(filters);

  return {
    rows: rows.map(mapAdPerformanceRow),
  };
}

async function buildScreenReportViewModel() {
  const rows = await getScreenActivityReport();
  return {
    rows: rows.map(mapScreenRow),
  };
}

exports.index = async (req, res, next) => {
  try {
    const flash = consumeFlash(req);
    const filters = buildFilters(req.query);
    const overview = await buildOverviewViewModel(filters);

    res.render('admin/reports', {
      success: flash.success,
      error: flash.error,
      filters,
      filterOptions: {
        screens: SCREEN_FILTER_OPTIONS,
        itemTypes: ITEM_TYPE_FILTER_OPTIONS,
      },
      exportUrl: `/admin/reports/export.csv${buildQueryString(filters)}`,
      screenLabel: screenLabel(filters.screen),
      ...overview,
    });
  } catch (error) {
    next(error);
  }
};

exports.ads = async (req, res, next) => {
  try {
    const flash = consumeFlash(req);
    const filters = buildFilters(req.query);
    const report = await buildAdReportViewModel(filters);

    res.render('admin/reports-ads', {
      success: flash.success,
      error: flash.error,
      filters,
      filterOptions: {
        screens: SCREEN_FILTER_OPTIONS,
      },
      exportUrl: `/admin/reports/export.csv${buildQueryString({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        screen: filters.screen,
        itemType: 'ad',
      })}`,
      ...report,
    });
  } catch (error) {
    next(error);
  }
};

exports.screens = async (req, res, next) => {
  try {
    const flash = consumeFlash(req);
    const report = await buildScreenReportViewModel();

    res.render('admin/reports-screens', {
      success: flash.success,
      error: flash.error,
      ...report,
    });
  } catch (error) {
    next(error);
  }
};

exports.exportCsv = async (req, res, next) => {
  try {
    const filters = buildFilters(req.query);
    const csv = await exportPlaybackLogsCsv(filters);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="playback-report.csv"');
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
};
