const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { AsyncSqlPort } = require('../storage/port');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');

test('AsyncSqlPort methods are Promise-only and fail closed when unimplemented', async () => {
  const port = new AsyncSqlPort();
  for (const call of [
    () => port.first('SELECT 1'),
    () => port.all('SELECT 1'),
    () => port.run('SELECT 1'),
    () => port.batch([])
  ]) {
    const result = call();
    assert.equal(typeof result?.then, 'function');
    await assert.rejects(result, /NOT_IMPLEMENTED/);
  }
});

test('SQLiteAsyncAdapter normalizes null-prototype SQLite rows to plain objects', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample(value) VALUES (\'a\'),(\'b\');');
  const raw = db.prepare('SELECT id,value FROM sample ORDER BY id LIMIT 1').get();
  assert.equal(Object.getPrototypeOf(raw), null, 'fixture must expose node:sqlite null-prototype row');

  const sql = new SQLiteAsyncAdapter(db);
  const first = await sql.first('SELECT id,value FROM sample ORDER BY id LIMIT 1');
  const all = await sql.all('SELECT id,value FROM sample ORDER BY id');

  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.getPrototypeOf(all[0]), Object.prototype);
  assert.deepEqual(first, { id: 1, value: 'a' });
  assert.deepEqual(all, [{ id: 1, value: 'a' }, { id: 2, value: 'b' }]);
  assert.equal(await sql.first('SELECT id FROM sample WHERE id=?', [999]), null);
});

test('SQLiteAsyncAdapter run/batch return normalized metadata and batch is atomic', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT UNIQUE);');
  const sql = new SQLiteAsyncAdapter(db);

  const run = await sql.run('INSERT INTO sample(value) VALUES (?)', ['a']);
  assert.deepEqual(Object.keys(run).sort(), ['changes', 'last_row_id', 'rows_read', 'rows_written'].sort());
  assert.equal(run.changes, 1);
  assert.equal(run.last_row_id, 1);

  const batch = await sql.batch([
    { sql: 'INSERT INTO sample(value) VALUES (?)', params: ['b'] },
    { sql: 'INSERT INTO sample(value) VALUES (?)', params: ['c'] }
  ]);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].changes, 1);
  assert.equal(batch[1].changes, 1);

  await assert.rejects(sql.batch([
    { sql: 'INSERT INTO sample(value) VALUES (?)', params: ['rolled-back'] },
    { sql: 'INSERT INTO sample(value) VALUES (?)', params: ['a'] }
  ]));
  assert.equal(await sql.first('SELECT id FROM sample WHERE value=?', ['rolled-back']), null);
});

test('SQLiteAsyncAdapter primary session preserves the same async contract', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sample(value TEXT); INSERT INTO sample(value) VALUES (\'x\');');
  const sql = new SQLiteAsyncAdapter(db);
  const session = sql.session({ consistency: 'primary' });
  assert.notEqual(session, null);
  assert.deepEqual(await session.first('SELECT value FROM sample'), { value: 'x' });
});

test('release syntax gate covers storage runtime modules', async () => {
  const pkg = require('../package.json');
  assert.match(pkg.scripts.check, /storage\/\*\.js/);
});
