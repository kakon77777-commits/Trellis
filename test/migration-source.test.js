const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  loadMigrations,
  applyMigrations
} = require('../storage/migration-loader');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { openDatabase } = require('../db/sqlite');
const { renderWranglerConfig } = require('../scripts/render-wrangler-config');

const ROOT = path.join(__dirname, '..');

test('one ordered db/migrations source is loaded for both SQLite and D1 tooling', () => {
  const migrations = loadMigrations();
  assert.deepEqual(migrations.map(m => m.name), [
    '001_foundation.sql',
    '002_actor_profile.sql',
    '003_notification.sql',
    '004_preference.sql',
    '005_consumption.sql',
    '006_storage_runtime.sql'
  ]);
  assert.ok(migrations.every(m => m.path.startsWith(path.join(ROOT, 'db', 'migrations'))));
  assert.ok(migrations.every(m => typeof m.sql === 'string' && m.sql.trim().length > 0));
});

test('SQLite migrations are applied explicitly through the maintenance-only async adapter primitive', async () => {
  const raw = new DatabaseSync(':memory:');
  const sql = new SQLiteAsyncAdapter(raw);
  assert.equal((await sql.first("SELECT name FROM sqlite_master WHERE type='table' AND name='canonical_events'")), null);
  await applyMigrations(sql, loadMigrations());
  assert.equal((await sql.first("SELECT name FROM sqlite_master WHERE type='table' AND name='canonical_events'")).name, 'canonical_events');
  assert.equal((await sql.first("SELECT name FROM sqlite_master WHERE type='table' AND name='stream_heads'")).name, 'stream_heads');
});

test('openDatabase opens storage only and never applies schema migrations implicitly', () => {
  const db = openDatabase(':memory:');
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='canonical_events'").get();
  assert.equal(row, undefined);
});

test('Cloudflare Worker startup imports no migration runner or migration source', () => {
  const source = fs.readFileSync(path.join(ROOT, 'cloudflare', 'worker.mjs'), 'utf8');
  assert.doesNotMatch(source, /migration-loader|db\/migrations|migrate/i);
});

test('Wrangler config renderer requires a real UUID and points DB at the shared migration directory', () => {
  assert.throws(() => renderWranglerConfig({ databaseId: '' }), /TRELLIS_D1_DATABASE_ID_REQUIRED/);
  assert.throws(() => renderWranglerConfig({ databaseId: 'not-a-uuid' }), /INVALID_TRELLIS_D1_DATABASE_ID/);
  const text = renderWranglerConfig({ databaseId: '123e4567-e89b-42d3-a456-426614174000' });
  assert.match(text, /main = "cloudflare\/worker\.mjs"/);
  assert.match(text, /compatibility_date = "2026-09-08"/);
  assert.match(text, /binding = "DB"/);
  assert.match(text, /database_name = "evemisslab-trellis"/);
  assert.match(text, /database_id = "123e4567-e89b-42d3-a456-426614174000"/);
  assert.match(text, /migrations_dir = "db\/migrations"/);
});
