const { all, run } = require('../config/database');

const DEFAULT_PLAYER_SETTINGS = {
  now_showing_duration_seconds: 8,
  coming_soon_duration_seconds: 5,
  enable_ads: true,
  ad_frequency_movies: 2,
  player_ads_enabled: true,
  cinema_ads_enabled: true,
  cinema_portrait_ads_enabled: true,
  cinema_3x2_ads_enabled: true,
  // Portrait Appearance
  portrait_strip_height_vh: 8.5,
  portrait_title_font_size_vh: 2.1,
  portrait_status_font_size_vh: 1.18,
  portrait_gap_vh: 0.35,
  portrait_showtime_height_vh: 2.65,
  portrait_badge_width_percent: 18.5,
  portrait_info_padding_vh: 1.6,
  // Cinema 3x3 Wall Appearance
  cinema_wall_gap_px: 30,
  cinema_wall_padding_px: 30,
  cinema_wall_title_font_rem: 2.2,
  cinema_wall_showtime_font_rem: 1.6,
  cinema_wall_status_font_rem: 1.2,
  cinema_wall_card_padding_px: 40,
  cinema_wall_poster_width_percent: 38,
  cinema_wall_radius_px: 0,
  cinema_wall_header_gap_px: 16,
  cinema_wall_content_scale: 1,
};

const SCREEN_PLAYER_SETTING_DEFAULTS = Object.freeze({
  now_showing_duration_seconds: 8,
  coming_soon_duration_seconds: 5,
  enable_ads: true,
  ad_frequency_movies: 2,
});

const SCREEN_PLAYER_SETTING_ORDER = ['signage', 'cinema', 'cinema-portrait', 'cinema-3x2'];
const SCREEN_PLAYER_SETTING_LABELS = Object.freeze({
  signage: 'Signage Player',
  cinema: 'Cinema Player',
  'cinema-portrait': 'Cinema Portrait Player',
  'cinema-3x2': 'Cinema 3x2 Player',
});

const LEGACY_SETTING_KEYS = {
  now_showing_duration: 'now_showing_duration_seconds',
  coming_soon_duration: 'coming_soon_duration_seconds',
};

function normalizeScreenName(screen) {
  const text = String(screen || '').toLowerCase().trim();
  if (!text) {
    return '';
  }

  const normalized = text
    .replace(/^\/player\//, '')
    .replace(/\s+/g, '-')
    .replace(/player$/, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (normalized === 'signage' || normalized === 'signage-player') {
    return 'signage';
  }

  if (normalized === 'cinema' || normalized === 'cinema-player') {
    return 'cinema';
  }

  if (normalized === 'portrait' || normalized === 'cinema-portrait' || normalized === 'cinema-portrait-player') {
    return 'cinema-portrait';
  }

  if (normalized === '3x2' || normalized === 'cinema-3x2' || normalized === 'cinema-3x2-player') {
    return 'cinema-3x2';
  }

  return '';
}

function parseBooleanSetting(value) {
  return value === 1 || value === '1' || value === true || value === 'true';
}

function rowToScreenPlayerSettings(row) {
  if (!row) {
    return null;
  }

  return {
    screen: row.screen,
    now_showing_duration_seconds: Number.parseInt(row.now_showing_duration_seconds, 10),
    coming_soon_duration_seconds: Number.parseInt(row.coming_soon_duration_seconds, 10),
    enable_ads: parseBooleanSetting(row.enable_ads),
    ad_frequency_movies: Number.parseInt(row.ad_frequency_movies, 10),
    updated_at: row.updated_at || '',
  };
}

function sanitizeScreenPlayerSettings(settings = {}) {
  const nowShowing = Number.parseInt(settings.now_showing_duration_seconds, 10);
  const comingSoon = Number.parseInt(settings.coming_soon_duration_seconds, 10);
  const adFrequency = Number.parseInt(settings.ad_frequency_movies, 10);

  return {
    now_showing_duration_seconds: Number.isFinite(nowShowing) && nowShowing > 0 ? nowShowing : SCREEN_PLAYER_SETTING_DEFAULTS.now_showing_duration_seconds,
    coming_soon_duration_seconds: Number.isFinite(comingSoon) && comingSoon > 0 ? comingSoon : SCREEN_PLAYER_SETTING_DEFAULTS.coming_soon_duration_seconds,
    enable_ads: settings.enable_ads === false || settings.enable_ads === 'false' ? 0 : 1,
    ad_frequency_movies: Number.isFinite(adFrequency) && adFrequency > 0 ? adFrequency : SCREEN_PLAYER_SETTING_DEFAULTS.ad_frequency_movies,
  };
}

async function getPlayerSettings() {
  const rows = await all(
    `SELECT setting_key, setting_value
     FROM player_settings`
  );

  const settings = { ...DEFAULT_PLAYER_SETTINGS };

  for (const row of rows) {
    const normalizedKey = LEGACY_SETTING_KEYS[row.setting_key] || row.setting_key;

    if (!(normalizedKey in settings)) {
      continue;
    }

    if (
      normalizedKey === 'enable_ads' ||
      normalizedKey === 'player_ads_enabled' ||
      normalizedKey === 'cinema_ads_enabled' ||
      normalizedKey === 'cinema_portrait_ads_enabled' ||
      normalizedKey === 'cinema_3x2_ads_enabled'
    ) {
      settings[normalizedKey] = row.setting_value === 'true';
      continue;
    }

    if (normalizedKey.startsWith('portrait_') || normalizedKey.startsWith('cinema_wall_')) {
      const floatValue = Number.parseFloat(row.setting_value);
      if (Number.isFinite(floatValue) && floatValue >= 0 && floatValue <= 500) {
        settings[normalizedKey] = floatValue;
      }
      continue;
    }

    const numericValue = Number.parseInt(row.setting_value, 10);
    const isAdFrequency = normalizedKey === 'ad_frequency_movies';
    const minValue = isAdFrequency ? 1 : 1;
    const maxValue = isAdFrequency ? 10 : 60;

    if (Number.isFinite(numericValue) && numericValue >= minValue && numericValue <= maxValue) {
      settings[normalizedKey] = numericValue;
    }
  }

  return settings;
}

async function upsertPlayerSettings(settings) {
  const entries = Object.entries(settings);

  for (const [settingKey, settingValue] of entries) {
    await run(
      `INSERT INTO player_settings (setting_key, setting_value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value = excluded.setting_value,
         updated_at = CURRENT_TIMESTAMP`,
      [settingKey, String(settingValue)]
    );
  }

  return getPlayerSettings();
}

async function listScreenPlayerSettings() {
  const rows = await all(
    `SELECT screen, now_showing_duration_seconds, coming_soon_duration_seconds, enable_ads, ad_frequency_movies, updated_at
     FROM screen_player_settings
     ORDER BY CASE screen
       WHEN 'signage' THEN 1
       WHEN 'cinema' THEN 2
       WHEN 'cinema-portrait' THEN 3
       WHEN 'cinema-3x2' THEN 4
       ELSE 99
     END, screen ASC`
  );

  return rows.map(rowToScreenPlayerSettings);
}

async function getScreenPlayerSettings(screen) {
  const normalizedScreen = normalizeScreenName(screen);
  if (!normalizedScreen) {
    return null;
  }

  const row = await all(
    `SELECT screen, now_showing_duration_seconds, coming_soon_duration_seconds, enable_ads, ad_frequency_movies, updated_at
     FROM screen_player_settings
     WHERE screen = ?
     LIMIT 1`,
    [normalizedScreen]
  );

  return rowToScreenPlayerSettings(row?.[0]);
}

async function upsertScreenPlayerSettings(screen, settings) {
  const normalizedScreen = normalizeScreenName(screen);
  if (!normalizedScreen) {
    throw new Error('Invalid screen selected.');
  }

  const payload = sanitizeScreenPlayerSettings(settings);

  await run(
    `INSERT INTO screen_player_settings (
       screen,
       now_showing_duration_seconds,
       coming_soon_duration_seconds,
       enable_ads,
       ad_frequency_movies,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(screen) DO UPDATE SET
       now_showing_duration_seconds = excluded.now_showing_duration_seconds,
       coming_soon_duration_seconds = excluded.coming_soon_duration_seconds,
       enable_ads = excluded.enable_ads,
       ad_frequency_movies = excluded.ad_frequency_movies,
       updated_at = CURRENT_TIMESTAMP`,
    [
      normalizedScreen,
      payload.now_showing_duration_seconds,
      payload.coming_soon_duration_seconds,
      payload.enable_ads,
      payload.ad_frequency_movies,
    ]
  );

  return getScreenPlayerSettings(normalizedScreen);
}

module.exports = {
  DEFAULT_PLAYER_SETTINGS,
  SCREEN_PLAYER_SETTING_DEFAULTS,
  SCREEN_PLAYER_SETTING_LABELS,
  SCREEN_PLAYER_SETTING_ORDER,
  normalizeScreenName,
  getPlayerSettings,
  upsertPlayerSettings,
  getScreenPlayerSettings,
  listScreenPlayerSettings,
  upsertScreenPlayerSettings,
};
