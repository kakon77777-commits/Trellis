const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');

test('foundation migration creates canonical and projection tables', () => {
  const db = createTestDatabase();
  const rows = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `).all().map(row => row.name);

  for (const required of [
    'authority_receipts',
    'canonical_events',
    'command_receipts',
    'entities_current',
    'relationships_current'
  ]) {
    assert.ok(rows.includes(required), `missing ${required}`);
  }
});

function makeAuthorityReceipt(id = 'authz:test-1') {
  return {
    decision_id: id,
    principal_id: 'principal:A',
    actor_id: 'actor:A',
    policy_ref: 'policy:test:v1',
    requested_action: 'relationship.propose',
    aggregate_id: 'rel:test-1',
    credential_refs: [],
    decision: 'allow',
    evaluated_at: '2026-09-02T06:15:00.000Z'
  };
}

function makeCommandReceipt({
  commandId = 'cmd:test-1',
  idempotencyKey = 'idem:test-1',
  digest = 'digest:test-1'
} = {}) {
  return {
    command_id: commandId,
    idempotency_key: idempotencyKey,
    command_digest: digest,
    status: 'accepted',
    created_at: '2026-09-02T06:15:00.000Z'
  };
}

function makeEvent(eventId, type = 'relationship.proposed') {
  return {
    event_id: eventId,
    schema_version: '0.1',
    event_type: type,
    actor_id: 'actor:A',
    principal_id: 'principal:A',
    causation_id: 'cmd:test-1',
    correlation_id: 'corr:test-1',
    occurred_at: '2026-09-02T06:15:00.000Z',
    recorded_at: '2026-09-02T06:15:00.000Z',
    time_source: 'system',
    provenance_refs: [],
    payload: { relationship_id: 'rel:test-1' }
  };
}

test('append assigns monotonic per-stream sequence', () => {
  const { SQLiteEventStore } = require('../events/sqlite-event-store');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);

  store.append({
    streamType: 'relationship',
    streamId: 'rel:test-1',
    expectedVersion: 0,
    events: [makeEvent('evt:test-1')],
    authorityReceipt: makeAuthorityReceipt('authz:test-1'),
    commandReceipt: makeCommandReceipt()
  });

  store.append({
    streamType: 'relationship',
    streamId: 'rel:test-1',
    expectedVersion: 1,
    events: [makeEvent('evt:test-2', 'relationship.activated')],
    authorityReceipt: makeAuthorityReceipt('authz:test-2'),
    commandReceipt: makeCommandReceipt({
      commandId: 'cmd:test-2',
      idempotencyKey: 'idem:test-2',
      digest: 'digest:test-2'
    })
  });

  assert.deepEqual(
    store.readStream('relationship', 'rel:test-1').map(event => event.stream_seq),
    [1, 2]
  );
});

test('stale expectedVersion rejects without writing an event', () => {
  const { SQLiteEventStore } = require('../events/sqlite-event-store');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);

  store.append({
    streamType: 'relationship',
    streamId: 'rel:test-1',
    expectedVersion: 0,
    events: [makeEvent('evt:test-1')],
    authorityReceipt: makeAuthorityReceipt('authz:test-1'),
    commandReceipt: makeCommandReceipt()
  });

  assert.throws(() => store.append({
    streamType: 'relationship',
    streamId: 'rel:test-1',
    expectedVersion: 0,
    events: [makeEvent('evt:stale')],
    authorityReceipt: makeAuthorityReceipt('authz:stale'),
    commandReceipt: makeCommandReceipt({
      commandId: 'cmd:stale',
      idempotencyKey: 'idem:stale',
      digest: 'digest:stale'
    })
  }), error => error && error.code === 'VERSION_CONFLICT');

  assert.equal(store.readStream('relationship', 'rel:test-1').length, 1);
});

test('same idempotency key and same digest returns prior result without duplicate event', () => {
  const { SQLiteEventStore } = require('../events/sqlite-event-store');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  const request = {
    streamType: 'relationship',
    streamId: 'rel:test-1',
    expectedVersion: 0,
    events: [makeEvent('evt:test-1')],
    authorityReceipt: makeAuthorityReceipt('authz:test-1'),
    commandReceipt: makeCommandReceipt()
  };

  const first = store.append(request);
  const second = store.append(request);

  assert.deepEqual(second.result_event_ids, first.result_event_ids);
  assert.equal(second.deduplicated, true);
  assert.equal(store.readStream('relationship', 'rel:test-1').length, 1);
});

test('same idempotency key and different digest rejects', () => {
  const { SQLiteEventStore } = require('../events/sqlite-event-store');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);

  store.append({
    streamType: 'relationship',
    streamId: 'rel:test-1',
    expectedVersion: 0,
    events: [makeEvent('evt:test-1')],
    authorityReceipt: makeAuthorityReceipt('authz:test-1'),
    commandReceipt: makeCommandReceipt()
  });

  assert.throws(() => store.append({
    streamType: 'relationship',
    streamId: 'rel:test-1',
    expectedVersion: 1,
    events: [makeEvent('evt:test-2')],
    authorityReceipt: makeAuthorityReceipt('authz:test-2'),
    commandReceipt: makeCommandReceipt({ digest: 'digest:DIFFERENT' })
  }), error => error && error.code === 'IDEMPOTENCY_CONFLICT');

  assert.equal(store.readStream('relationship', 'rel:test-1').length, 1);
});

test('EventStore owns recorded_at and ignores caller-forged recorded time', () => {
  const { SQLiteEventStore } = require('../events/sqlite-event-store');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db, {
    now: () => '2026-09-02T10:00:00.000Z'
  });
  const draft = makeEvent('evt:recorded-at');
  draft.recorded_at = '1900-01-01T00:00:00.000Z';

  store.append({
    streamType: 'relationship',
    streamId: 'rel:recorded-at',
    expectedVersion: 0,
    events: [draft],
    authorityReceipt: {
      ...makeAuthorityReceipt('authz:recorded-at'),
      aggregate_id: 'rel:recorded-at'
    },
    commandReceipt: makeCommandReceipt({
      commandId: 'cmd:recorded-at',
      idempotencyKey: 'idem:recorded-at',
      digest: 'digest:recorded-at'
    })
  });

  assert.equal(
    store.readStream('relationship', 'rel:recorded-at')[0].recorded_at,
    '2026-09-02T10:00:00.000Z'
  );
});
