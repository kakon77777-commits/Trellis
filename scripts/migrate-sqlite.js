const path = require('node:path');
const { openDatabase } = require('../db/sqlite');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { loadMigrations, applyMigrations } = require('../storage/migration-loader');

async function migrateSqlite(filename) {
  const db = openDatabase(filename);
  const sql = new SQLiteAsyncAdapter(db);
  try {
    return await applyMigrations(sql, loadMigrations());
  } finally {
    db.close();
  }
}

async function main() {
  const filename = process.argv[2] ?? path.join(process.cwd(), 'trellis.sqlite');
  const applied = await migrateSqlite(filename);
  process.stdout.write(`applied ${applied.length} Trellis migrations to ${filename}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { migrateSqlite };
