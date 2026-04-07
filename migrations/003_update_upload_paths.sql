UPDATE media
SET file_path = REPLACE(file_path, '/uploads/', '/uploads_test/')
WHERE file_path LIKE '/uploads/%';
