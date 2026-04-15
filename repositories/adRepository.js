const { all, get, run } = require('../config/database');

function normalizeScheduleDateTime(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  const normalizedText = text.includes('T') || text.includes(' ')
    ? text.replace(' ', 'T')
    : text;
  const parsed = Date.parse(normalizedText);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

async function listAds({ status, screen, createdAtOrder = 'DESC', eligibleNow = false } = {}) {
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

  if (eligibleNow) {
    whereClauses.push("(start_at IS NULL OR datetime(start_at) <= datetime('now'))");
    whereClauses.push("(end_at IS NULL OR datetime(end_at) >= datetime('now'))");
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
  const durationSeconds = ad.duration_seconds ?? null;
  const startAt = normalizeScheduleDateTime(ad.start_at);
  const endAt = normalizeScheduleDateTime(ad.end_at);
  const result = await run(
    `INSERT INTO ads (
       title,
       file_path,
       type,
       duration_seconds,
       status,
       sort_order,
       screen_targets,
       start_at,
       end_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      ad.title,
      ad.file_path,
      ad.type,
      durationSeconds,
      ad.status || 'inactive',
      ad.sort_order ?? 0,
      ad.screen_targets ?? null,
      startAt,
      endAt,
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

async function deleteAds(adIds) {
  const uniqueIds = Array.from(
    new Set(
      (Array.isArray(adIds) ? adIds : [])
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  if (uniqueIds.length === 0) {
    return { changes: 0 };
  }

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const result = await run(`DELETE FROM ads WHERE id IN (${placeholders})`, uniqueIds);

  return {
    changes: result.changes || 0,
  };
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

async function updateAdStatuses(adIds, desiredStatus) {
  const normalizedStatus = String(desiredStatus || '').toLowerCase().trim();
  if (normalizedStatus !== 'active' && normalizedStatus !== 'inactive') {
    throw new Error('Invalid ad status.');
  }

  const uniqueIds = Array.from(
    new Set(
      (Array.isArray(adIds) ? adIds : [])
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  if (uniqueIds.length === 0) {
    return { changes: 0 };
  }

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const result = await run(
    `UPDATE ads
     SET status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders})`,
    [normalizedStatus, ...uniqueIds]
  );

  return {
    changes: result.changes || 0,
  };
}

async function updateAdScreenTargets(adIds, screenTargets) {
  const uniqueIds = Array.from(
    new Set(
      (Array.isArray(adIds) ? adIds : [])
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  if (uniqueIds.length === 0) {
    return { changes: 0 };
  }

  const normalizedTargets = String(screenTargets || '').trim() || null;
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const result = await run(
    `UPDATE ads
     SET screen_targets = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders})`,
    [normalizedTargets, ...uniqueIds]
  );

  return {
    changes: result.changes || 0,
  };
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
    'start_at',
    'end_at',
  ];

  const normalizedChanges = {
    ...changes,
    start_at: normalizeScheduleDateTime(changes.start_at),
    end_at: normalizeScheduleDateTime(changes.end_at),
  };

  const entries = Object.entries(normalizedChanges).filter(([key]) => allowedFields.includes(key));
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
  deleteAds,
  toggleAdStatus,
  updateAdStatuses,
  updateAdScreenTargets,
  updateSortOrder,
  updateAdCompressionState,
  normalizeScheduleDateTime,
};
