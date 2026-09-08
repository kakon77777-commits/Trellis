const { DatabaseSync } = require('node:sqlite');
const { loadMigrations } = require('../storage/migration-loader');

function openDatabase(filename = ':memory:') {
  return new DatabaseSync(filename);
}

function openMigratedDatabase(filename = ':memory:') {
  const db = openDatabase(filename);
  for (const migration of loadMigrations()) db.exec(migration.sql);
  return db;
}

module.exports = { openDatabase, openMigratedDatabase };
