const { openMigratedDatabase } = require('../../db/sqlite');
const { SQLiteAsyncAdapter } = require('../../storage/sqlite-adapter');

function createTestDatabase() {
  const db = openMigratedDatabase(':memory:');
  const sql = new SQLiteAsyncAdapter(db);
  // Test-only dual facade: legacy assertions may still use db.prepare(), while
  // migrated projectors/services receive the same database through AsyncSqlPort.
  db.first = sql.first.bind(sql);
  db.all = sql.all.bind(sql);
  db.run = sql.run.bind(sql);
  db.batch = sql.batch.bind(sql);
  db.session = sql.session.bind(sql);
  db.sql = sql;
  return db;
}

module.exports = { createTestDatabase };
