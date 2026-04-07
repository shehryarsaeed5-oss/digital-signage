const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { initDatabase } = require('./config/database');
const { ensureAdsUploadsDir } = require('./config/adStorage');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const { startMovieSyncScheduler } = require('./services/movieSyncScheduler');

const app = express();
const PORT = process.env.PORT || 3001;
const ROOT_DIR = __dirname;
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const LEGACY_UPLOADS_DIR = path.join(ROOT_DIR, 'public', 'uploads');
const UPLOADS_DIR = path.join(ROOT_DIR, 'public', 'uploads_test');

fs.mkdirSync(STORAGE_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
ensureAdsUploadsDir();

if (fs.existsSync(LEGACY_UPLOADS_DIR)) {
  for (const fileName of fs.readdirSync(LEGACY_UPLOADS_DIR)) {
    const sourcePath = path.join(LEGACY_UPLOADS_DIR, fileName);
    const targetPath = path.join(UPLOADS_DIR, fileName);

    if (!fs.statSync(sourcePath).isFile() || fs.existsSync(targetPath)) {
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT_DIR, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.sqlite',
      dir: STORAGE_DIR,
    }),
    secret: process.env.SESSION_SECRET || 'digital-signage-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.use(express.static(path.join(ROOT_DIR, 'public')));

app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.get('/player/cinema', (req, res) => {
  res.render('player-cinema');
});

app.get('/player/cinema-3x2', (req, res) => {
  res.render('player-cinema-3x2');
});

app.get('/player/cinema-portrait', (req, res) => {
  res.render('player-cinema-portrait');
});

app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

app.use((error, req, res, next) => {
  if (
    req.method === 'POST' &&
    (req.path === '/admin/media' || req.path === '/admin/playlist')
  ) {
    req.session.flashError = error.message || 'Request failed.';
    res.redirect('/admin');
    return;
  }

  if (req.path === '/admin/ads') {
    req.session.flashError = error.message || 'Request failed.';
    req.session.flashMessage = '';
    req.session.flashAdForm = {
      title: req.body?.title?.trim?.() || '',
      duration_seconds: req.body?.duration_seconds || 10,
      sort_order: req.body?.sort_order || 0,
      status: req.body?.status === 'active' ? 'active' : 'inactive',
    };
    res.redirect('/admin/ads/new');
    return;
  }

  console.error(error);
  res.status(500).send('Internal server error');
});

initDatabase()
  .then(() => {
    startMovieSyncScheduler();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Digital signage app running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });
