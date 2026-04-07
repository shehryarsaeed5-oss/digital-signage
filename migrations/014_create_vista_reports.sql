CREATE TABLE IF NOT EXISTS vista_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly')),
  site_name TEXT NOT NULL,
  report_date TEXT,
  week_start_date TEXT,
  total_on_hours REAL NOT NULL DEFAULT 0,
  total_movie_posters INTEGER NOT NULL DEFAULT 0,
  seconds_per_movie_poster INTEGER NOT NULL DEFAULT 0,
  elevate_repeat_count INTEGER NOT NULL DEFAULT 0,
  seconds_per_elevate_play INTEGER NOT NULL DEFAULT 0,
  computed_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vista_report_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  day_key TEXT,
  item_type TEXT NOT NULL CHECK (item_type IN ('movie', 'elevate', 'ad')),
  item_name TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  plays_in_playlist INTEGER NOT NULL DEFAULT 0,
  plays_one_hour INTEGER NOT NULL DEFAULT 0,
  plays_in_period INTEGER NOT NULL DEFAULT 0,
  total_screen_time_seconds INTEGER NOT NULL DEFAULT 0,
  readable_time TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES vista_reports (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vista_reports_type_created_at
  ON vista_reports (report_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vista_reports_site_name
  ON vista_reports (site_name);

CREATE INDEX IF NOT EXISTS idx_vista_reports_report_date
  ON vista_reports (report_date);

CREATE INDEX IF NOT EXISTS idx_vista_reports_week_start_date
  ON vista_reports (week_start_date);

CREATE INDEX IF NOT EXISTS idx_vista_report_items_report_id
  ON vista_report_items (report_id);
