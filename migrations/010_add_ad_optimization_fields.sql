ALTER TABLE ads ADD COLUMN optimized_file_path TEXT;
ALTER TABLE ads ADD COLUMN optimized_status TEXT NOT NULL DEFAULT 'idle' CHECK (optimized_status IN ('idle', 'queued', 'processing', 'completed', 'failed'));
ALTER TABLE ads ADD COLUMN optimized_error TEXT;
ALTER TABLE ads ADD COLUMN optimized_started_at TEXT;
ALTER TABLE ads ADD COLUMN optimized_completed_at TEXT;
ALTER TABLE ads ADD COLUMN optimized_source_size_bytes INTEGER;
ALTER TABLE ads ADD COLUMN optimized_output_size_bytes INTEGER;
