CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  poster_url TEXT,
  local_poster_path TEXT,
  status TEXT NOT NULL,
  synopsis TEXT,
  release_date TEXT,
  runtime TEXT,
  genre TEXT,
  details_url TEXT,
  source_name TEXT NOT NULL,
  last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (title, status)
);

CREATE TABLE IF NOT EXISTS movie_showtimes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movie_id INTEGER NOT NULL,
  show_date TEXT NOT NULL,
  show_time TEXT NOT NULL,
  FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movies_status ON movies(status);
CREATE INDEX IF NOT EXISTS idx_movies_source_name ON movies(source_name);
CREATE INDEX IF NOT EXISTS idx_movie_showtimes_movie_id ON movie_showtimes(movie_id);
CREATE INDEX IF NOT EXISTS idx_movie_showtimes_show_date ON movie_showtimes(show_date);
