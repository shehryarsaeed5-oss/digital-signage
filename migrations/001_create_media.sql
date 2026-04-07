CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('image', 'video')),
  duration INTEGER
);
