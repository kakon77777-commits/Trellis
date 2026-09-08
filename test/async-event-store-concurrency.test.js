const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { AsyncSqlEventStore } = require('../events/async-sql-event-store');

function request(id, expectedVersion, { key = `idem:${id}`, digest = `digest:${id}` } = {}) {
  return {
    streamType: 'relationship', streamId: 'rel:race', expectedVersion,
    events: [{
      event_id: `evt:${id}`, schema_version: '0.1', event_type: 'relationship.proposed',
      actor_id: 'actor:A', principal_id: 'principal:A', causation_id: `cmd:${id}`,
      correlation_id: `corr:${id}`, occurred_at: '2026-09-07T13:00:00Z',
      time_source: 'system', provenance_refs: [], payload: { id }
    }],
    authorityReceipt: {
      decision_id: `authz:${id}`, principal_id: 'principal:A', actor_id: 'actor:A',
      policy_ref: 'policy:test:v1', requested_action: 'relationship.propose', aggregate_id: 'rel:race',
      credential_refs: [], decision: 'allow', evaluated_at: '2026-09-07T13:00:00Z'
    },
    commandReceipt: {
      command_id: `cmd:${id}`, idempotency_key: key, command_digest: digest,
      status: 'accepted', created_at: '2026-09-07T13:00:00Z'
    }
  };
}

function setup() {
  const db = createTestDatabase();
  const sql = new SQLiteAsyncAdapter(db);
  let token = 0;
  const store = new AsyncSqlEventStore(sql, {
    now: () => '2026-09-07T13:00:01Z',
    token: () => `race-token-${++token}`
  });
  return { db, sql, store };
}

function split(results) {
  return {
    fulfilled: results.filter(r => r.status === 'fulfilled'),
    rejected: results.filter(r => r.status === 'rejected')
  };
}

async function assertGuardsEmpty(sql) {
  assert.equal((await sql.first('SELECT COUNT(*) AS n FROM append_batch_guards')).n, 0);
}

test('new-stream race: exactly one append commits and loser is VersionConflict', async () => {
  const { sql, store } = setup();
  const result = split(await Promise.allSettled([
    store.append(request('a', 0)),
    store.append(request('b', 0))
  ]));
  assert.equal(result.fulfilled.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason?.code, 'VERSION_CONFLICT');
  assert.equal((await store.readStream('relationship', 'rel:race')).length, 1);
  await assertGuardsEmpty(sql);
});

test('existing-stream race: exactly one expected-version append commits', async () => {
  const { sql, store } = setup();
  await store.append(request('seed', 0));
  const result = split(await Promise.allSettled([
    store.append(request('a', 1)),
    store.append(request('b', 1))
  ]));
  assert.equal(result.fulfilled.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason?.code, 'VERSION_CONFLICT');
  assert.equal((await store.readStream('relationship', 'rel:race')).length, 2);
  await assertGuardsEmpty(sql);
});

test('same-idempotency race: one append commits and the other deduplicates same digest', async () => {
  const { sql, store } = setup();
  const result = split(await Promise.allSettled([
    store.append(request('a', 0, { key: 'idem:race', digest: 'digest:same' })),
    store.append(request('b', 0, { key: 'idem:race', digest: 'digest:same' }))
  ]));
  assert.equal(result.rejected.length, 0);
  assert.equal(result.fulfilled.length, 2);
  assert.deepEqual(result.fulfilled.map(r => Boolean(r.value.deduplicated)).sort(), [false, true]);
  assert.equal((await store.readStream('relationship', 'rel:race')).length, 1);
  await assertGuardsEmpty(sql);
});

test('different-digest idempotency race: winner commits and loser gets IdempotencyConflict', async () => {
  const { sql, store } = setup();
  const result = split(await Promise.allSettled([
    store.append(request('a', 0, { key: 'idem:race', digest: 'digest:a' })),
    store.append(request('b', 0, { key: 'idem:race', digest: 'digest:b' }))
  ]));
  assert.equal(result.fulfilled.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason?.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await store.readStream('relationship', 'rel:race')).length, 1);
  await assertGuardsEmpty(sql);
});
