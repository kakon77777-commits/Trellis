const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { D1Adapter } = require('../storage/d1-adapter');
const { AsyncSqlEventStore } = require('../events/async-sql-event-store');

const workerPath = path.join(__dirname, '..', 'cloudflare', 'worker.mjs');

function bindingShapeSpy() {
  return {
    prepare() { throw new Error('NO_SQL_EXPECTED_FOR_MACHINE_ROUTE'); },
    batch() { throw new Error('NO_SQL_EXPECTED_FOR_MACHINE_ROUTE'); },
    withSession() { return this; }
  };
}

test('Cloudflare composition root is env.DB -> D1Adapter -> AsyncSqlEventStore', async () => {
  const worker = await import(pathToFileURL(workerPath).href);
  const binding = bindingShapeSpy();
  const deps = worker.buildWorkerDependencies({ DB: binding });

  assert.ok(deps.sql instanceof D1Adapter);
  assert.equal(deps.sql.binding, binding);
  assert.ok(deps.eventStore instanceof AsyncSqlEventStore);
  assert.equal(deps.eventStore.sql, deps.sql);
});

test('Worker fetch reuses the same async HTTP app for a no-SQL machine route', async () => {
  const worker = await import(pathToFileURL(workerPath).href);
  const response = await worker.default.fetch(
    new Request('https://trellis.evemisslab.com/.well-known/trellis.json'),
    { DB: bindingShapeSpy() }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.name, 'Trellis');
  assert.equal(body.writes_enabled, false);
});

test('Worker is the only HTTP/Web source allowed to reference env.DB or D1Adapter', async () => {
  const source = fs.readFileSync(workerPath, 'utf8');
  assert.match(source, /env\.DB/);
  assert.match(source, /D1Adapter/);
  for (const dir of ['http/routes', 'http/view-models', 'web']) {
    const root = path.join(__dirname, '..', dir);
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(target);
        else if (/\.js$/.test(entry.name)) {
          const text = fs.readFileSync(target, 'utf8');
          assert.equal(text.includes('env.DB'), false, `${target} leaks env.DB`);
          assert.equal(text.includes('D1Adapter'), false, `${target} imports D1Adapter`);
        }
      }
    }
  }
});

test('Node composition root is SQLiteAsyncAdapter -> AsyncSqlEventStore', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
  const { createNodeDependencies } = require('../http/server');
  const db = new DatabaseSync(':memory:');
  try {
    const deps = createNodeDependencies({ db });
    assert.ok(deps.sql instanceof SQLiteAsyncAdapter);
    assert.equal(deps.sql.db, db);
    assert.ok(deps.eventStore instanceof AsyncSqlEventStore);
    assert.equal(deps.eventStore.sql, deps.sql);
  } finally {
    db.close();
  }
});
