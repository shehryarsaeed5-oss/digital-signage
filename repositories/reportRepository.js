const { all, get, run } = require('../config/database');

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : '';
}

function normalizeOptionalText(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function normalizePlayerMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (mode === 'live' || mode === 'cached' || mode === 'waiting') {
    return mode;
  }

  return 'waiting';
}

function normalizeScreenName(value) {
  return normalizeOptionalText(value);
}

function normalizePlaybackStatus(value, fallback = 'played') {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'played' || status === 'failed' || status === 'skipped' || status === 'interrupted') {
    return status;
  }

  return fallback;
}

function normalizeIsoDate(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function normalizeDurationSeconds(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numericValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  return numericValue;
}

function normalizeMetadataJson(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return null;
  }
}

function normalizeScreenFilter(screen) {
  return normalizeText(screen);
}

function normalizePlaybackSessionId(value) {
  return normalizeOptionalText(value);
}

function resolveDurationSeconds(payload = {}) {
  const explicitDuration = normalizeDurationSeconds(payload.duration_seconds);
  if (explicitDuration !== null) {
    return explicitDuration;
  }

  const startedAt = normalizeIsoDate(payload.started_at);
  const endedAt = normalizeIsoDate(payload.ended_at);
  if (!startedAt || !endedAt) {
    return null;
  }

  const diffMs = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(diffMs / 1000));
}

async function findPlaybackBySessionId(playbackSessionId) {
  if (!playbackSessionId) {
    return null;
  }

  return get(
    `SELECT id, ended_at
     FROM playback_logs
     WHERE playback_session_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [playbackSessionId]
  );
}

async function findOpenPlaybackRow(payload = {}) {
  const screen = normalizeText(payload.screen);
  const itemType = normalizeText(payload.item_type);
  const itemId = normalizeOptionalText(payload.item_id);
  const itemTitle = normalizeText(payload.item_title);
  const startedAt = normalizeIsoDate(payload.started_at);

  if (!screen || !itemType || !startedAt) {
    return null;
  }

  if (itemId) {
    const byItemId = await get(
      `SELECT id, ended_at
       FROM playback_logs
       WHERE screen = ?
         AND item_type = ?
         AND item_id = ?
         AND started_at = ?
         AND ended_at IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [screen, itemType, itemId, startedAt]
    );

    if (byItemId) {
      return byItemId;
    }
  }

  if (!itemTitle) {
    return null;
  }

  return get(
    `SELECT id, ended_at
     FROM playback_logs
     WHERE screen = ?
       AND item_type = ?
       AND item_title = ?
       AND started_at = ?
       AND ended_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [screen, itemType, itemTitle, startedAt]
  );
}

async function updatePlaybackRow(id, payload = {}) {
  const itemId = normalizeOptionalText(payload.item_id);
  const endedAt = normalizeIsoDate(payload.ended_at) || new Date().toISOString();
  const durationSeconds = resolveDurationSeconds(payload);
  const status = normalizePlaybackStatus(payload.status);
  const metadataJson = normalizeMetadataJson(payload.metadata);

  await run(
    `UPDATE playback_logs
     SET item_id = COALESCE(?, item_id),
         ended_at = COALESCE(?, ended_at),
         duration_seconds = COALESCE(?, duration_seconds),
         status = ?,
         metadata_json = COALESCE(?, metadata_json)
     WHERE id = ?`,
    [itemId, endedAt, durationSeconds, status, metadataJson, id]
  );

  return id;
}

function buildPlaybackWhereClauses(filters = {}) {
  const whereClauses = [];
  const params = [];

  if (filters.dateFrom) {
    whereClauses.push('date(started_at) >= date(?)');
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    whereClauses.push('date(started_at) <= date(?)');
    params.push(filters.dateTo);
  }

  if (filters.screen) {
    whereClauses.push('screen = ?');
    params.push(filters.screen);
  }

  if (filters.itemType && filters.itemType !== 'all') {
    whereClauses.push('item_type = ?');
    params.push(filters.itemType);
  }

  return {
    whereSql: whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '',
    params,
  };
}

async function logPlaybackStart(payload = {}) {
  const screen = normalizeText(payload.screen);
  const itemType = normalizeText(payload.item_type);
  const itemTitle = normalizeText(payload.item_title);
  const startedAt = normalizeIsoDate(payload.started_at);
  const playbackSessionId = normalizePlaybackSessionId(payload.playback_session_id);

  if (!screen || !itemType || !itemTitle || !startedAt) {
    throw new Error('Missing required playback start fields.');
  }

  const itemId = normalizeOptionalText(payload.item_id);
  const metadataJson = normalizeMetadataJson(payload.metadata);
  const status = normalizePlaybackStatus(payload.status, 'played');

  const result = await run(
    `INSERT INTO playback_logs (
       playback_session_id,
       screen,
       item_type,
       item_id,
       item_title,
       started_at,
       status,
       metadata_json,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(playback_session_id) DO NOTHING`,
    [playbackSessionId, screen, itemType, itemId, itemTitle, startedAt, status, metadataJson]
  );

  return result.lastID;
}

async function logPlaybackEnd(payload = {}) {
  const playbackSessionId = normalizePlaybackSessionId(payload.playback_session_id);
  const status = normalizePlaybackStatus(payload.status, 'played');

  if (!normalizeText(payload.screen) || !normalizeText(payload.item_type) || !normalizeText(payload.item_title) || !normalizeIsoDate(payload.started_at)) {
    throw new Error('Missing required playback end fields.');
  }

  if (playbackSessionId) {
    const existingBySession = await findPlaybackBySessionId(playbackSessionId);
    if (existingBySession) {
      if (existingBySession.ended_at !== null) {
        return existingBySession.id;
      }

      return updatePlaybackRow(existingBySession.id, {
        ...payload,
        status,
      });
    }
  }

  const existing = await findOpenPlaybackRow(payload);
  if (existing) {
    return updatePlaybackRow(existing.id, {
      ...payload,
      status,
    });
  }

  const result = await run(
    `INSERT INTO playback_logs (
       playback_session_id,
       screen,
       item_type,
       item_id,
       item_title,
       started_at,
       ended_at,
       duration_seconds,
       status,
       metadata_json,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      playbackSessionId,
      normalizeText(payload.screen),
      normalizeText(payload.item_type),
      normalizeOptionalText(payload.item_id),
      normalizeText(payload.item_title),
      normalizeIsoDate(payload.started_at),
      normalizeIsoDate(payload.ended_at) || new Date().toISOString(),
      resolveDurationSeconds(payload),
      status,
      normalizeMetadataJson(payload.metadata),
    ]
  );

  return result.lastID;
}

async function logPlaybackFailure(payload = {}) {
  const playbackSessionId = normalizePlaybackSessionId(payload.playback_session_id);
  const status = normalizePlaybackStatus(payload.status, 'failed');

  if (!normalizeText(payload.screen) || !normalizeText(payload.item_type) || !normalizeText(payload.item_title) || !normalizeIsoDate(payload.started_at)) {
    throw new Error('Missing required playback failure fields.');
  }

  if (playbackSessionId) {
    const existingBySession = await findPlaybackBySessionId(playbackSessionId);
    if (existingBySession) {
      if (existingBySession.ended_at !== null) {
        return existingBySession.id;
      }

      return updatePlaybackRow(existingBySession.id, {
        ...payload,
        status,
      });
    }
  }

  const existing = await findOpenPlaybackRow(payload);
  if (existing) {
    return updatePlaybackRow(existing.id, {
      ...payload,
      status,
    });
  }

  const result = await run(
    `INSERT INTO playback_logs (
       playback_session_id,
       screen,
       item_type,
       item_id,
       item_title,
       started_at,
       ended_at,
       duration_seconds,
       status,
       metadata_json,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      playbackSessionId,
      normalizeText(payload.screen),
      normalizeText(payload.item_type),
      normalizeOptionalText(payload.item_id),
      normalizeText(payload.item_title),
      normalizeIsoDate(payload.started_at),
      normalizeIsoDate(payload.ended_at) || new Date().toISOString(),
      resolveDurationSeconds(payload),
      status,
      normalizeMetadataJson(payload.metadata),
    ]
  );

  return result.lastID;
}

async function upsertScreenHeartbeat(payload = {}) {
  const screen = normalizeText(payload.screen);
  const lastSeenAt = normalizeIsoDate(payload.last_seen_at) || new Date().toISOString();

  if (!screen) {
    throw new Error('Missing required heartbeat screen.');
  }

  const currentItemType = normalizeOptionalText(payload.current_item_type);
  const currentItemId = normalizeOptionalText(payload.current_item_id);
  const currentItemTitle = normalizeOptionalText(payload.current_item_title);
  const playerPath = normalizeOptionalText(payload.player_path);
  const screenName = normalizeScreenName(payload.screen_name);
  const playerMode = normalizePlayerMode(payload.player_mode);
  const status = normalizeText(payload.status) || 'online';

  await run(
    `INSERT INTO screen_heartbeats (
       screen,
       current_item_type,
       current_item_id,
       current_item_title,
       player_path,
       screen_name,
       player_mode,
       last_seen_at,
       status,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(screen) DO UPDATE SET
       current_item_type = excluded.current_item_type,
       current_item_id = excluded.current_item_id,
       current_item_title = excluded.current_item_title,
       player_path = excluded.player_path,
       screen_name = excluded.screen_name,
       player_mode = excluded.player_mode,
       last_seen_at = excluded.last_seen_at,
       status = excluded.status,
       updated_at = CURRENT_TIMESTAMP`,
    [screen, currentItemType, currentItemId, currentItemTitle, playerPath, screenName, playerMode, lastSeenAt, status]
  );

  return get(
    `SELECT *
     FROM screen_heartbeats
     WHERE screen = ?
     LIMIT 1`,
    [screen]
  );
}

async function getPlaybackSummary({ dateFrom, dateTo, screen, itemType } = {}) {
  const { whereSql, params } = buildPlaybackWhereClauses({
    dateFrom,
    dateTo,
    screen,
    itemType,
  });

  const row = await get(
    `SELECT
       COUNT(*) AS total_events,
       SUM(CASE WHEN item_type = 'movie' THEN 1 ELSE 0 END) AS movie_plays,
       SUM(CASE WHEN item_type = 'ad' THEN 1 ELSE 0 END) AS ad_plays,
       COALESCE(SUM(COALESCE(duration_seconds, 0)), 0) AS total_duration_seconds
     FROM playback_logs
     ${whereSql}`,
    params
  );

  return {
    totalEvents: row?.total_events || 0,
    moviePlays: row?.movie_plays || 0,
    adPlays: row?.ad_plays || 0,
    totalDurationSeconds: row?.total_duration_seconds || 0,
  };
}

async function getAdPerformanceReport({ dateFrom, dateTo, screen } = {}) {
  const { whereSql, params } = buildPlaybackWhereClauses({
    dateFrom,
    dateTo,
    screen,
    itemType: 'ad',
  });

  return all(
    `SELECT
       playback_logs.item_id,
       playback_logs.item_title,
       COALESCE(ads.screen_targets, '') AS screen_targets,
       COUNT(*) AS total_plays,
       COALESCE(SUM(COALESCE(playback_logs.duration_seconds, 0)), 0) AS total_display_seconds,
       MAX(playback_logs.started_at) AS last_played_at
     FROM playback_logs
     LEFT JOIN ads
       ON playback_logs.item_type = 'ad'
      AND CAST(ads.id AS TEXT) = playback_logs.item_id
     ${whereSql}
     GROUP BY playback_logs.item_id, playback_logs.item_title, ads.screen_targets
     ORDER BY last_played_at DESC, total_plays DESC, playback_logs.item_title ASC`,
    params
  );
}

async function getScreenActivityReport() {
  return all(
    `SELECT
       screen,
       current_item_type,
       current_item_id,
       current_item_title,
       player_path,
       screen_name,
       COALESCE(player_mode, 'waiting') AS player_mode,
       last_seen_at,
       status,
       CASE
         WHEN datetime(last_seen_at) >= datetime('now', '-90 seconds') THEN 'online'
         ELSE 'offline'
       END AS connection_status,
       created_at,
       updated_at
     FROM screen_heartbeats
     ORDER BY last_seen_at DESC, screen ASC`
  );
}

async function getRecentPlaybackLogs({ dateFrom, dateTo, screen, itemType, limit = 20 } = {}) {
  const { whereSql, params } = buildPlaybackWhereClauses({
    dateFrom,
    dateTo,
    screen,
    itemType,
  });

  const limitValue = Number.parseInt(limit, 10);
  const limitSql = Number.isFinite(limitValue) && limitValue > 0 ? 'LIMIT ?' : '';
  if (limitSql) {
    params.push(limitValue);
  }

  return all(
    `SELECT *
     FROM playback_logs
     ${whereSql}
     ORDER BY started_at DESC, id DESC
     ${limitSql}`,
    params
  );
}

function escapeCsvValue(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

async function exportPlaybackLogsCsv({ dateFrom, dateTo, screen, itemType } = {}) {
  const rows = await getRecentPlaybackLogs({
    dateFrom,
    dateTo,
    screen,
    itemType,
    limit: 0,
  });

  const header = [
    'screen',
    'item_type',
    'item_id',
    'item_title',
    'started_at',
    'ended_at',
    'duration_seconds',
    'status',
  ];

  const lines = [header.map(escapeCsvValue).join(',')];

  for (const row of rows) {
    lines.push([
      row.screen,
      row.item_type,
      row.item_id,
      row.item_title,
      row.started_at,
      row.ended_at,
      row.duration_seconds,
      row.status,
    ].map(escapeCsvValue).join(','));
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  logPlaybackStart,
  logPlaybackEnd,
  logPlaybackFailure,
  upsertScreenHeartbeat,
  normalizePlayerMode,
  normalizeScreenName,
  getPlaybackSummary,
  getAdPerformanceReport,
  getScreenActivityReport,
  getRecentPlaybackLogs,
  exportPlaybackLogsCsv,
};
