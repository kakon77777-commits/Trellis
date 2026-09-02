const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  const migration = fs.readFileSync(
    path.join(__dirname, 'migrations', '001_foundation.sql'),
    'utf8'
  );
  db.exec(migration);
  return db;
}

module.exports = { openDatabase };
