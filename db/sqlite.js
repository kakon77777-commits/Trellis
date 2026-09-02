const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  const migrationDir = path.join(__dirname, 'migrations');
  const migrations = fs.readdirSync(migrationDir)
    .filter(name => /^\d+_.*\.sql$/.test(name))
    .sort();
  for (const name of migrations) {
    db.exec(fs.readFileSync(path.join(migrationDir, name), 'utf8'));
  }
  return db;
}

module.exports = { openDatabase };
