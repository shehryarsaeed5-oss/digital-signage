const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const DB_PATH = path.join(STORAGE_DIR, 'database.sqlite');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

fs.mkdirSync(STORAGE_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

async function initDatabase() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  await run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const file of files) {
    const alreadyRun = await get('SELECT id FROM migrations WHERE name = ?', [file]);
    if (alreadyRun) {
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await run('BEGIN TRANSACTION');

    try {
      await new Promise((resolve, reject) => {
        db.exec(sql, (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await run('INSERT INTO migrations (name) VALUES (?)', [file]);
      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK');
      throw error;
    }
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  initDatabase,
};
