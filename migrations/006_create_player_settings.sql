CREATE TABLE IF NOT EXISTS player_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO player_settings (setting_key, setting_value) VALUES
  ('now_showing_duration_seconds', '8'),
  ('coming_soon_duration_seconds', '5');
