const test = require('node:test');
const assert = require('node:assert/strict');
const { openMigratedDatabase } = require('../../db/sqlite');
const { SQLiteAsyncAdapter } = require('../../storage/sqlite-adapter');
const { AsyncSqlEventStore } = require('../../events/async-sql-event-store');
const { seedPublicFixture, addHiddenFixture, verifyIntegrationFixture } = require('./integration-fixture');

test('Layer C integration fixture seeds and verifies canonical state through normal domain services', async () => {
  const db = openMigratedDatabase(':memory:');
  const sql = new SQLiteAsyncAdapter(db);
  const store = new AsyncSqlEventStore(sql, { now: () => '2026-09-08T01:00:00.000Z', token: (()=>{let n=0;return()=>`layer-c-${++n}`;})() });
  try {
    const seeded = await seedPublicFixture({ sql, eventStore: store });
    assert.equal(seeded.publication_id, 'pub:p1');
    const before = await verifyIntegrationFixture({ sql, eventStore: store });
    assert.equal(before.hash_chain.ok, true);
    assert.equal(before.command_receipt.idempotency_key, 'pub:p1');
    assert.equal(before.projection.publication_id, 'pub:p1');
    await addHiddenFixture({ sql, eventStore: store });
    const after = await verifyIntegrationFixture({ sql, eventStore: store });
    assert.equal(after.hash_chain.ok, true);
    assert.ok(after.canonical_event_count > before.canonical_event_count);
  } finally {
    db.close();
  }
});
