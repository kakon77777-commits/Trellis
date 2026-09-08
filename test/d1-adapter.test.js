const test = require('node:test');
const assert = require('node:assert/strict');
const { D1Adapter } = require('../storage/d1-adapter');

function prepared(binding, sql) {
  return {
    bind(...params) {
      return {
        first: async () => binding.firstResult(sql, params),
        all: async () => binding.allResult(sql, params),
        run: async () => binding.runResult(sql, params),
        __sql: sql,
        __params: params
      };
    }
  };
}

function makeBinding() {
  const calls = [];
  const binding = {
    calls,
    prepare(sql) { calls.push(['prepare', sql]); return prepared(binding, sql); },
    firstResult(sql, params) { calls.push(['first', sql, params]); return Object.assign(Object.create(null), { id: 7, value: 'x' }); },
    allResult(sql, params) { calls.push(['all', sql, params]); return { success: true, results: [Object.assign(Object.create(null), { id: 1 }), Object.assign(Object.create(null), { id: 2 })], meta: { rows_read: 2 } }; },
    runResult(sql, params) { calls.push(['run', sql, params]); return { success: true, results: [], meta: { changes: 1, last_row_id: 9, rows_read: 0, rows_written: 1, duration: 0.1 } }; },
    async batch(statements) {
      calls.push(['batch', statements.map(s => [s.__sql, s.__params])]);
      return statements.map((_, i) => ({ success: true, meta: { changes: 1, last_row_id: i + 10, rows_read: 0, rows_written: 1 } }));
    },
    withSession(mode) {
      calls.push(['withSession', mode]);
      return { ...binding, withSession: undefined };
    }
  };
  return binding;
}

test('D1Adapter translates binding shape and never leaks D1Result upward', async () => {
  const binding = makeBinding();
  const sql = new D1Adapter(binding);

  const first = await sql.first('SELECT * FROM t WHERE id=?', [7]);
  const all = await sql.all('SELECT id FROM t', []);
  const run = await sql.run('UPDATE t SET value=?', ['v']);
  const batch = await sql.batch([{ sql: 'DELETE FROM t WHERE id=?', params: [1] }]);

  assert.deepEqual(first, { id: 7, value: 'x' });
  assert.deepEqual(all, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(run, { changes: 1, last_row_id: 9, rows_read: 0, rows_written: 1 });
  assert.deepEqual(batch, [{ changes: 1, last_row_id: 10, rows_read: 0, rows_written: 1 }]);
  assert.equal('success' in run, false);
  assert.equal('meta' in run, false);
});

test('D1Adapter primary session requests first-primary consistency', async () => {
  const binding = makeBinding();
  const sql = new D1Adapter(binding);
  const session = sql.session({ consistency: 'primary' });
  assert.ok(session instanceof D1Adapter);
  assert.deepEqual(binding.calls.find(call => call[0] === 'withSession'), ['withSession', 'first-primary']);
  assert.deepEqual(await session.first('SELECT 1'), { id: 7, value: 'x' });
});
