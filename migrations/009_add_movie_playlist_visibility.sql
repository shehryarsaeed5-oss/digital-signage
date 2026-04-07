ALTER TABLE movies ADD COLUMN excluded_from_playlist INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_movies_excluded_from_playlist ON movies(excluded_from_playlist);
