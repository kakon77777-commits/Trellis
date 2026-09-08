const { AsyncSqlPort } = require('./port');
const { plainRow, plainRows, normalizeRunResult } = require('./results');

function bind(statement, params) {
  return Array.isArray(params) ? params : [];
}

class SQLiteAsyncAdapter extends AsyncSqlPort {
  constructor(db) {
    super();
    this.db = db;
  }

  async first(sql, params = []) {
    const row = this.db.prepare(sql).get(...bind(sql, params));
    return plainRow(row);
  }

  async all(sql, params = []) {
    const rows = this.db.prepare(sql).all(...bind(sql, params));
    return plainRows(rows);
  }

  async run(sql, params = []) {
    return normalizeRunResult(this.db.prepare(sql).run(...bind(sql, params)));
  }

  async execMigration(sqlText) {
    if (typeof sqlText !== 'string' || sqlText.trim() === '') throw new TypeError('MIGRATION_SQL_REQUIRED');
    this.db.exec(sqlText);
    return { changes: null, last_row_id: null, rows_read: null, rows_written: null };
  }

  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const entry of statements) {
        results.push(normalizeRunResult(
          this.db.prepare(entry.sql).run(...bind(entry.sql, entry.params ?? []))
        ));
      }
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  session({ consistency } = {}) {
    if (consistency !== undefined && consistency !== 'primary') {
      throw new TypeError(`UNSUPPORTED_CONSISTENCY:${consistency}`);
    }
    return new SQLiteAsyncAdapter(this.db);
  }
}

module.exports = { SQLiteAsyncAdapter };
