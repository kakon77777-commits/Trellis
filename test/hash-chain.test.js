const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');

function appendSingle(store) {
  return store.append({
    streamType: 'relationship',
    streamId: 'rel:hash-1',
    expectedVersion: 0,
    events: [{
      event_id: 'evt:hash-1',
      schema_version: '0.1',
      event_type: 'relationship.proposed',
      actor_id: 'actor:A',
      principal_id: 'principal:A',
      causation_id: 'cmd:hash-1',
      correlation_id: 'corr:hash-1',
      occurred_at: '2026-09-02T06:30:00.000Z',
      recorded_at: '2026-09-02T06:30:00.000Z',
      time_source: 'system',
      provenance_refs: [],
      payload: { relationship_id: 'rel:hash-1', relationship_type: 'follows' }
    }],
    authorityReceipt: {
      decision_id: 'authz:hash-1',
      principal_id: 'principal:A',
      actor_id: 'actor:A',
      policy_ref: 'policy:test:v1',
      requested_action: 'relationship.propose',
      aggregate_id: 'rel:hash-1',
      credential_refs: [],
      decision: 'allow',
      evaluated_at: '2026-09-02T06:30:00.000Z'
    },
    commandReceipt: {
      command_id: 'cmd:hash-1',
      idempotency_key: 'idem:hash-1',
      command_digest: 'digest:hash-1',
      status: 'accepted',
      created_at: '2026-09-02T06:30:00.000Z'
    }
  });
}

test('verifyHashChain accepts an untampered stream', () => {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  appendSingle(store);

  assert.deepEqual(
    store.verifyHashChain('relationship', 'rel:hash-1'),
    { ok: true, failureAt: null }
  );
});

test('verifyHashChain reports the tampered stream sequence', () => {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  appendSingle(store);

  db.prepare(`
    UPDATE canonical_events
    SET payload_json = ?
    WHERE event_id = ?
  `).run(JSON.stringify({ relationship_id: 'rel:hash-1', relationship_type: 'trusts' }), 'evt:hash-1');

  assert.deepEqual(
    store.verifyHashChain('relationship', 'rel:hash-1'),
    { ok: false, failureAt: 1 }
  );
});
