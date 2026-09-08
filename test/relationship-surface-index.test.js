const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { proposeRelationship, activateRelationship, terminateRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');

function contextFor(store, actorId) {
  return { eventStore: store, principalActorId: actorId, evaluatedAt: '2026-09-02T09:00:00.000Z' };
}

async function propose(store, { key, source, target, visibility = 'participants', activate = false, terminate = false, type = 'collaborates_with' }) {
  const result = (await proposeRelationship({
    command_id: `cmd:${key}:propose`, idempotency_key: `idem:${key}:propose`,
    principal_id: `principal:${source}`, source_entity_id: source, target_entity_id: target,
    relationship_type: type, visibility, occurred_at: '2026-09-02T09:00:00.000Z'
  }, contextFor(store, source)));
  let version = 1;
  if (activate && type !== 'follows') {
    (await activateRelationship({
      command_id: `cmd:${key}:activate`, idempotency_key: `idem:${key}:activate`,
      principal_id: `principal:${target}`, relationship_id: result.relationship_id,
      expected_version: version, occurred_at: '2026-09-02T09:01:00.000Z'
    }, contextFor(store, target)));
    version += 1;
  }
  if (type === 'follows') version = 2;
  if (terminate) {
    (await terminateRelationship({
      command_id: `cmd:${key}:terminate`, idempotency_key: `idem:${key}:terminate`,
      principal_id: `principal:${source}`, relationship_id: result.relationship_id,
      expected_version: version, reason: 'revoked', occurred_at: '2026-09-02T09:02:00.000Z'
    }, contextFor(store, source)));
  }
  return result.relationship_id;
}

async function buildIndexFixture() {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  const ids = {
    publicActive: (await propose(store, { key: 'public-active', source: 'actor:A', target: 'actor:B', visibility: 'public', type: 'follows' })),
    pendingOutgoing: (await propose(store, { key: 'pending-out', source: 'actor:A', target: 'actor:D', visibility: 'participants' })),
    pendingIncoming: (await propose(store, { key: 'pending-in', source: 'actor:E', target: 'actor:A', visibility: 'participants' })),
    privateTerminated: (await propose(store, { key: 'private-term', source: 'actor:A', target: 'actor:F', visibility: 'private', activate: true, terminate: true })),
    publicTerminated: (await propose(store, { key: 'public-term', source: 'actor:G', target: 'actor:A', visibility: 'public', activate: true, terminate: true }))
  };
  (await rebuildRelationshipProjection(db, store));
  return { db, store, ids };
}

test('self relationship index categorizes active pending and historical relationships', async () => {
  const { buildRelationshipIndex } = require('../relationship-surface/index-service');
  const fx = (await buildIndexFixture());
  const index = (await buildRelationshipIndex({
    actorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db: fx.db
  }));

  assert.deepEqual(index.active.map(x => x.relationship_id), [fx.ids.publicActive]);
  assert.deepEqual(index.pending_outgoing.map(x => x.relationship_id), [fx.ids.pendingOutgoing]);
  assert.deepEqual(index.pending_incoming.map(x => x.relationship_id), [fx.ids.pendingIncoming]);
  assert.deepEqual(new Set(index.historical_terminated.map(x => x.relationship_id)), new Set([fx.ids.privateTerminated, fx.ids.publicTerminated]));
  assert.equal(index.counts.active, index.active.length);
  assert.equal(index.counts.pending_incoming, index.pending_incoming.length);
  assert.equal(index.counts.pending_outgoing, index.pending_outgoing.length);
  assert.equal(index.counts.historical_terminated, index.historical_terminated.length);
});

test('unrelated viewer sees no hidden pending or private historical aggregate signal', async () => {
  const { buildRelationshipIndex } = require('../relationship-surface/index-service');
  const fx = (await buildIndexFixture());
  const index = (await buildRelationshipIndex({
    actorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:C' },
    db: fx.db
  }));
  assert.deepEqual(index.active.map(x => x.relationship_id), [fx.ids.publicActive]);
  assert.deepEqual(index.pending_incoming, []);
  assert.deepEqual(index.pending_outgoing, []);
  assert.deepEqual(index.historical_terminated.map(x => x.relationship_id), [fx.ids.publicTerminated]);

  const serialized = JSON.stringify(index);
  assert.equal(serialized.includes(fx.ids.pendingIncoming), false);
  assert.equal(serialized.includes(fx.ids.pendingOutgoing), false);
  assert.equal(serialized.includes(fx.ids.privateTerminated), false);
  assert.equal(serialized.includes('actor:E'), false);
  assert.equal(serialized.includes('actor:F'), false);
});

test('disclosure policy filters before relationship counts are computed', async () => {
  const { buildRelationshipIndex } = require('../relationship-surface/index-service');
  const fx = (await buildIndexFixture());
  const index = (await buildRelationshipIndex({
    actorId: 'actor:A', viewerContext: {}, db: fx.db,
    disclosurePolicy: relationship => relationship.relationship_id === fx.ids.publicActive ? 'deny' : 'allow'
  }));
  assert.equal(index.counts.active, 0);
  assert.equal(index.active.length, 0);
  assert.equal(index.counts.historical_terminated, 1);
});
