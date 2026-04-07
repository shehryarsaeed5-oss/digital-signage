CREATE TABLE IF NOT EXISTS screen_player_settings (
  screen TEXT PRIMARY KEY,
  now_showing_duration_seconds INTEGER NOT NULL DEFAULT 8,
  coming_soon_duration_seconds INTEGER NOT NULL DEFAULT 5,
  enable_ads INTEGER NOT NULL DEFAULT 1,
  ad_frequency_movies INTEGER NOT NULL DEFAULT 2,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
