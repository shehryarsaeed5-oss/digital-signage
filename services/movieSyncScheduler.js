const cron = require('node-cron');

const { saveCueCinemaMovies } = require('./movieSyncService');

const MOVIE_SYNC_CRON = '*/30 * * * *';

let activeTask = null;
let isSyncRunning = false;

async function runScheduledMovieSync() {
  if (isSyncRunning) {
    console.log('[movie-sync] sync skipped because a previous run is still in progress');
    return;
  }

  isSyncRunning = true;
  console.log('[movie-sync] sync start');

  try {
    const summary = await saveCueCinemaMovies();
    console.log(
      `[movie-sync] sync success | movies=${summary.moviesSaved} posters=${summary.postersDownloaded} errors=${summary.errorsCount}`
    );
  } catch (error) {
    console.error(`[movie-sync] sync failure | ${error.message}`);
  } finally {
    isSyncRunning = false;
  }
}

function startMovieSyncScheduler() {
  if (process.env.ENABLE_MOVIE_SYNC !== 'true') {
    console.log('[movie-sync] scheduler disabled (set ENABLE_MOVIE_SYNC=true to enable)');
    return null;
  }

  if (activeTask) {
    return activeTask;
  }

  activeTask = cron.schedule(MOVIE_SYNC_CRON, () => {
    void runScheduledMovieSync();
  });

  console.log(`[movie-sync] scheduler enabled | cron="${MOVIE_SYNC_CRON}"`);
  return activeTask;
}

module.exports = {
  MOVIE_SYNC_CRON,
  runScheduledMovieSync,
  startMovieSyncScheduler,
};
