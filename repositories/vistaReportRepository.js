const { all, get, run } = require('../config/database');

function jsonValue(value) {
  if (value === undefined || value === null) {
    return '{}';
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function createVistaReport(reportData, itemRows = []) {
  await run('BEGIN TRANSACTION');

  try {
    const result = await run(
      `INSERT INTO vista_reports (
         report_type,
         site_name,
         report_date,
         week_start_date,
         total_on_hours,
         total_movie_posters,
         seconds_per_movie_poster,
         elevate_repeat_count,
         seconds_per_elevate_play,
         computed_summary_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        reportData.report_type,
        reportData.site_name,
        reportData.report_date || null,
        reportData.week_start_date || null,
        reportData.total_on_hours || 0,
        reportData.total_movie_posters || 0,
        reportData.seconds_per_movie_poster || 0,
        reportData.elevate_repeat_count || 0,
        reportData.seconds_per_elevate_play || 0,
        jsonValue(reportData.computed_summary_json),
      ]
    );

    const reportId = result.lastID;

    for (const [index, itemRow] of itemRows.entries()) {
      await run(
        `INSERT INTO vista_report_items (
           report_id,
           day_key,
           item_type,
           item_name,
           duration_seconds,
           plays_in_playlist,
           plays_one_hour,
           plays_in_period,
           total_screen_time_seconds,
           readable_time,
           sort_order
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reportId,
          itemRow.day_key || null,
          itemRow.item_type,
          itemRow.item_name,
          itemRow.duration_seconds || 0,
          itemRow.plays_in_playlist || 0,
          itemRow.plays_one_hour || 0,
          itemRow.plays_in_period || 0,
          itemRow.total_screen_time_seconds || 0,
          itemRow.readable_time || '',
          Number.isFinite(itemRow.sort_order) ? itemRow.sort_order : index,
        ]
      );
    }

    await run('COMMIT');
    return { id: reportId };
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

async function getVistaReportById(reportId) {
  return get(
    `SELECT *
     FROM vista_reports
     WHERE id = ?
     LIMIT 1`,
    [reportId]
  );
}

async function getVistaReportItems(reportId) {
  return all(
    `SELECT *
     FROM vista_report_items
     WHERE report_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [reportId]
  );
}

async function getVistaReportWithItems(reportId) {
  const [report, items] = await Promise.all([
    getVistaReportById(reportId),
    getVistaReportItems(reportId),
  ]);

  return { report, items };
}

async function listVistaReports(filters = {}) {
  const whereClauses = [];
  const params = [];

  if (filters.reportType) {
    whereClauses.push('report_type = ?');
    params.push(filters.reportType);
  }

  if (filters.siteName) {
    whereClauses.push('LOWER(site_name) LIKE LOWER(?)');
    params.push(`%${filters.siteName}%`);
  }

  if (filters.reportDate) {
    whereClauses.push('(report_date = ? OR week_start_date = ?)');
    params.push(filters.reportDate, filters.reportDate);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limitSql = Number.isFinite(Number(filters.limit)) && Number(filters.limit) > 0 ? 'LIMIT ?' : '';

  if (limitSql) {
    params.push(Number(filters.limit));
  }

  return all(
    `SELECT *
     FROM vista_reports
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     ${limitSql}`,
    params
  );
}

async function deleteVistaReport(reportId) {
  await run('BEGIN TRANSACTION');

  try {
    await run('DELETE FROM vista_report_items WHERE report_id = ?', [reportId]);
    await run('DELETE FROM vista_reports WHERE id = ?', [reportId]);
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK');
    throw error;
  }
}

module.exports = {
  createVistaReport,
  deleteVistaReport,
  getVistaReportById,
  getVistaReportItems,
  getVistaReportWithItems,
  listVistaReports,
};
