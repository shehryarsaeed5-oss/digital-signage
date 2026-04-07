const { all, get, run } = require('../config/database');

async function listAds({ status, screen, createdAtOrder = 'DESC' } = {}) {
  const params = [];
  const whereClauses = [];

  if (status) {
    whereClauses.push('status = ?');
    params.push(status);
  }

  const normalizedScreen = typeof screen === 'string'
    ? screen.toLowerCase().trim().replace(/\s+/g, '')
    : '';

  if (screen) {
    // Treat null/blank screen_targets as "all screens".
    // When targets are present, match exact comma-delimited tokens only.
    const targetsExpr = "LOWER(REPLACE(COALESCE(screen_targets, ''), ' ', ''))";
    const commaWrappedTargets = `(',' || ${targetsExpr} || ',')`;
    const commaWrappedScreen = `(',' || ? || ',')`;

    whereClauses.push(
      `(${targetsExpr} = '' OR INSTR(${commaWrappedTargets}, ${commaWrappedScreen}) > 0)`
    );
    params.push(normalizedScreen);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const normalizedCreatedAtOrder = String(createdAtOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  
  const sql = `
    SELECT *
    FROM ads
    ${whereSql}
    ORDER BY sort_order ASC, created_at ${normalizedCreatedAtOrder}
  `;

  const rows = await all(sql, params);
  return rows;
}

async function getAdById(adId) {
  return get('SELECT * FROM ads WHERE id = ?', [adId]);
}

async function createAd(ad) {
  const result = await run(
    `INSERT INTO ads (
       title,
       file_path,
       type,
       duration_seconds,
       status,
       sort_order,
       screen_targets,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      ad.title,
      ad.file_path,
      ad.type,
      ad.duration_seconds ?? null,
      ad.status || 'inactive',
      ad.sort_order ?? 0,
      ad.screen_targets ?? null,
    ]
  );

  return getAdById(result.lastID);
}

async function getAdByFilePath(filePath) {
  return get('SELECT * FROM ads WHERE file_path = ?', [filePath]);
}

async function deleteAd(adId) {
  await run('DELETE FROM ads WHERE id = ?', [adId]);
}

async function toggleAdStatus(adId, desiredStatus) {
  const ad = await getAdById(adId);
  if (!ad) {
    return null;
  }

  const nextStatus = desiredStatus || (ad.status === 'active' ? 'inactive' : 'active');
  await run(
    `UPDATE ads
     SET status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [nextStatus, adId]
  );

  return getAdById(adId);
}

async function updateSortOrder(adId, sortOrder) {
  const ad = await getAdById(adId);
  if (!ad) {
    return null;
  }

  await run(
    `UPDATE ads
     SET sort_order = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [sortOrder, adId]
  );

  return getAdById(adId);
}

async function updateAdCompressionState(adId, changes) {
  const allowedFields = [
    'optimized_file_path',
    'optimized_status',
    'optimized_error',
    'optimized_started_at',
    'optimized_completed_at',
    'optimized_source_size_bytes',
    'optimized_output_size_bytes',
  ];

  const entries = Object.entries(changes).filter(([key]) => allowedFields.includes(key));
  if (entries.length === 0) {
    return getAdById(adId);
  }

  const assignments = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) => value);

  await run(
    `UPDATE ads
     SET ${assignments.join(', ')},
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [...values, adId]
  );

  return getAdById(adId);
}

async function updateAd(adId, changes) {
  const ad = await getAdById(adId);
  if (!ad) {
    return null;
  }

  const allowedFields = [
    'title',
    'file_path',
    'type',
    'duration_seconds',
    'status',
    'sort_order',
    'screen_targets',
  ];

  const entries = Object.entries(changes).filter(([key]) => allowedFields.includes(key));
  if (entries.length === 0) {
    return ad;
  }

  const assignments = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) => value);

  await run(
    `UPDATE ads
     SET ${assignments.join(', ')},
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [...values, adId]
  );

  return getAdById(adId);
}

module.exports = {
  listAds,
  getAdById,
  getAdByFilePath,
  createAd,
  updateAd,
  deleteAd,
  toggleAdStatus,
  updateSortOrder,
  updateAdCompressionState,
};
