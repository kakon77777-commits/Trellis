const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MIGRATION_DIR = path.join(__dirname, '..', 'db', 'migrations');
const MIGRATION_NAME = /^\d+_.*\.sql$/;

function loadMigrations({ migrationDir = DEFAULT_MIGRATION_DIR } = {}) {
  return fs.readdirSync(migrationDir)
    .filter(name => MIGRATION_NAME.test(name))
    .sort()
    .map(name => Object.freeze({
      name,
      path: path.join(migrationDir, name),
      sql: fs.readFileSync(path.join(migrationDir, name), 'utf8')
    }));
}

async function applyMigrations(sql, migrations = loadMigrations()) {
  if (!sql || typeof sql.execMigration !== 'function') {
    throw new TypeError('MIGRATION_EXECUTOR_REQUIRED');
  }
  for (const migration of migrations) {
    await sql.execMigration(migration.sql);
  }
  return migrations.map(migration => migration.name);
}

module.exports = { DEFAULT_MIGRATION_DIR, loadMigrations, applyMigrations };
