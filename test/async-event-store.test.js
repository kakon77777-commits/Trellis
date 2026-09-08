const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { AsyncSqlEventStore } = require('../events/async-sql-event-store');

function authority(id, aggregateId = 'rel:test') {
  return {
    decision_id: id,
    principal_id: 'principal:A',
    actor_id: 'actor:A',
    policy_ref: 'policy:test:v1',
    requested_action: 'relationship.propose',
    aggregate_id: aggregateId,
    credential_refs: [],
    decision: 'allow',
    evaluated_at: '2026-09-07T12:00:00.000Z'
  };
}

function command(id, key = `idem:${id}`, digest = `digest:${id}`) {
  return {
    command_id: `cmd:${id}`,
    idempotency_key: key,
    command_digest: digest,
    status: 'accepted',
    created_at: '2026-09-07T12:00:00.000Z'
  };
}

function event(id, type = 'relationship.proposed') {
  return {
    event_id: `evt:${id}`,
    schema_version: '0.1',
    event_type: type,
    actor_id: 'actor:A',
    principal_id: 'principal:A',
    causation_id: `cmd:${id}`,
    correlation_id: `corr:${id}`,
    occurred_at: '2026-09-07T12:00:00.000Z',
    recorded_at: '1900-01-01T00:00:00.000Z',
    time_source: 'system',
    provenance_refs: [],
    payload: { relationship_id: 'rel:test' }
  };
}

function request(id, expectedVersion, { key, digest, streamId = 'rel:test', type } = {}) {
  return {
    streamType: 'relationship',
    streamId,
    expectedVersion,
    events: [event(id, type)],
    authorityReceipt: authority(`authz:${id}`, streamId),
    commandReceipt: command(id, key, digest)
  };
}

async function setup() {
  const db = createTestDatabase();
  const sql = new SQLiteAsyncAdapter(db);
  let tick = 0;
  const store = new AsyncSqlEventStore(sql, {
    now: () => `2026-09-07T12:00:${String(tick++).padStart(2, '0')}.000Z`,
    token: () => `append-token-${tick}`
  });
  return { db, sql, store };
}

test('storage runtime migration creates stream heads and CAS guard tables', async () => {
  const { sql } = await setup();
  const names = (await sql.all(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)).map(row => row.name);
  assert.ok(names.includes('stream_heads'));
  assert.ok(names.includes('append_batch_guards'));
});

test('AsyncSqlEventStore append/read/hash chain preserve legacy event semantics', async () => {
  const { sql, store } = await setup();
  const first = await store.append(request('one', 0));
  const second = await store.append(request('two', 1, { type: 'relationship.activated' }));

  assert.equal(first.stream_version_before, 0);
  assert.equal(first.stream_version_after, 1);
  assert.equal(second.stream_version_before, 1);
  assert.equal(second.stream_version_after, 2);

  const events = await store.readStream('relationship', 'rel:test');
  assert.deepEqual(events.map(e => e.stream_seq), [1, 2]);
  assert.equal(events[0].recorded_at, '2026-09-07T12:00:00.000Z');
  assert.notEqual(events[0].recorded_at, event('one').recorded_at);
  assert.equal((await store.readEvent('evt:one')).event_id, 'evt:one');
  assert.equal(await store.readEvent('evt:missing'), null);
  assert.deepEqual(await store.verifyHashChain('relationship', 'rel:test'), { ok: true, failureAt: null });

  const head = await sql.first(`SELECT version,event_hash,last_event_id FROM stream_heads WHERE stream_type=? AND stream_id=?`, ['relationship', 'rel:test']);
  assert.deepEqual(head, { version: 2, event_hash: events[1].event_hash, last_event_id: 'evt:two' });
  assert.equal((await sql.first('SELECT COUNT(*) AS n FROM append_batch_guards')).n, 0);
});

test('stale expectedVersion is semantic VersionConflict and writes nothing', async () => {
  const { sql, store } = await setup();
  await store.append(request('one', 0));
  await assert.rejects(store.append(request('stale', 0)), error => error?.code === 'VERSION_CONFLICT');
  assert.equal((await store.readStream('relationship', 'rel:test')).length, 1);
  assert.equal(await store.lookupIdempotency('idem:stale'), null);
  assert.equal((await sql.first('SELECT COUNT(*) AS n FROM append_batch_guards')).n, 0);
});

test('same idempotency key and digest deduplicates; different digest conflicts', async () => {
  const { store } = await setup();
  const firstRequest = request('one', 0, { key: 'idem:same', digest: 'digest:same' });
  const first = await store.append(firstRequest);
  const duplicate = await store.append(request('duplicate', 1, { key: 'idem:same', digest: 'digest:same' }));
  assert.deepEqual(duplicate.result_event_ids, first.result_event_ids);
  assert.equal(duplicate.deduplicated, true);

  await assert.rejects(
    store.append(request('different', 1, { key: 'idem:same', digest: 'digest:different' })),
    error => error?.code === 'IDEMPOTENCY_CONFLICT'
  );
  assert.equal((await store.readStream('relationship', 'rel:test')).length, 1);
});

test('storage runtime migration backfills stream_heads from legacy canonical history', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { SQLiteEventStore } = require('../events/sqlite-event-store');
  const db = new DatabaseSync(':memory:');
  const migrationDir = path.join(__dirname, '..', 'db', 'migrations');
  for (const name of fs.readdirSync(migrationDir).filter(n => /^00[1-5]_.*\.sql$/.test(n)).sort()) {
    db.exec(fs.readFileSync(path.join(migrationDir, name), 'utf8'));
  }
  const legacy = new SQLiteEventStore(db, { now: () => '2026-09-07T11:00:01Z' });
  legacy.append(request('legacy-one', 0, { streamId: 'rel:legacy' }));
  legacy.append(request('legacy-two', 1, { streamId: 'rel:legacy', type: 'relationship.activated' }));

  db.exec(fs.readFileSync(path.join(migrationDir, '006_storage_runtime.sql'), 'utf8'));
  const head = db.prepare(`SELECT version,event_hash,last_event_id,append_token FROM stream_heads WHERE stream_type=? AND stream_id=?`).get('relationship', 'rel:legacy');
  const last = legacy.readStream('relationship', 'rel:legacy').at(-1);
  assert.deepEqual({ ...head }, { version: 2, event_hash: last.event_hash, last_event_id: 'evt:legacy-two', append_token: null });
});

test('unexpected append storage failure is normalized and never leaks raw SQLite error', async () => {
  const { store } = await setup();
  await store.append(request('unique-event', 0, { streamId: 'rel:first' }));
  await assert.rejects(
    store.append(request('unique-event', 0, { streamId: 'rel:second', key: 'idem:second', digest: 'digest:second' })),
    error => error?.code === 'STORAGE_INVARIANT' && error?.cause instanceof Error
  );
});
