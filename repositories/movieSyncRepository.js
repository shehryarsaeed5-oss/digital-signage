const { get, run } = require('../config/database');

async function getMovieByTitleAndStatus(title, status) {
  return get(
    `SELECT *
     FROM movies
     WHERE title = ? AND status = ?`,
    [title, status]
  );
}

async function upsertMovie(movie) {
  await run(
     `INSERT INTO movies (
       title,
       poster_source,
       poster_url,
       local_poster_path,
       status,
       synopsis,
       release_date,
       runtime,
       genre,
       details_url,
       source_name,
       last_synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(title, status) DO UPDATE SET
       poster_source = excluded.poster_source,
       poster_url = excluded.poster_url,
       local_poster_path = excluded.local_poster_path,
       synopsis = excluded.synopsis,
       release_date = excluded.release_date,
       runtime = excluded.runtime,
       genre = excluded.genre,
       details_url = excluded.details_url,
       source_name = excluded.source_name,
       last_synced_at = CURRENT_TIMESTAMP`,
    [
      movie.title,
      movie.poster_source || null,
      movie.poster_url || null,
      movie.local_poster_path || null,
      movie.status,
      movie.synopsis || null,
      movie.release_date || null,
      movie.runtime || null,
      movie.genre || null,
      movie.details_url || null,
      movie.source_name,
    ]
  );

  return get(
    `SELECT *
     FROM movies
     WHERE title = ? AND status = ?`,
    [movie.title, movie.status]
  );
}

async function listMoviesBySourceName(sourceName) {
  const { all } = require('../config/database');

  return all(
    `SELECT *
     FROM movies
     WHERE source_name = ?`,
    [sourceName]
  );
}

async function countMoviesByLocalPosterPath(localPosterPath) {
  const row = await get(
    `SELECT COUNT(*) AS total
     FROM movies
     WHERE local_poster_path = ?`,
    [localPosterPath]
  );

  return row?.total || 0;
}

async function deleteMovieById(movieId) {
  await run('DELETE FROM movies WHERE id = ?', [movieId]);
}

async function deleteMovieShowtimes(movieId) {
  await run('DELETE FROM movie_showtimes WHERE movie_id = ?', [movieId]);
}

async function getMovieById(movieId) {
  return get(
    `SELECT *
     FROM movies
     WHERE id = ?`,
    [movieId]
  );
}

async function setMoviePlaylistVisibility(movieId, excludedFromPlaylist) {
  await run(
    `UPDATE movies
     SET excluded_from_playlist = ?
     WHERE id = ?`,
    [excludedFromPlaylist ? 1 : 0, movieId]
  );

  return getMovieById(movieId);
}

async function insertMovieShowtimes(movieId, showtimes = []) {
  for (const showtime of showtimes) {
    await run(
      `INSERT INTO movie_showtimes (
         movie_id,
         show_date,
         show_time
       ) VALUES (?, ?, ?)`,
      [movieId, showtime.show_date, showtime.show_time]
    );
  }
}

module.exports = {
  listMoviesBySourceName,
  countMoviesByLocalPosterPath,
  deleteMovieById,
  getMovieById,
  getMovieByTitleAndStatus,
  upsertMovie,
  deleteMovieShowtimes,
  insertMovieShowtimes,
  setMoviePlaylistVisibility,
};
