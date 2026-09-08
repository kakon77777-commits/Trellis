const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { proposeRelationship, activateRelationship, terminateRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');

function contextFor(eventStore, principalActorId) {
  return { eventStore, principalActorId, evaluatedAt: '2026-09-02T08:00:00.000Z' };
}

async function makeRelationship({ visibility = 'participants', activate = true, terminate = false } = {}) {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  const proposed = (await proposeRelationship({
    command_id: `cmd:propose:${visibility}:${activate}:${terminate}`,
    idempotency_key: `idem:propose:${visibility}:${activate}:${terminate}`,
    principal_id: 'principal:A',
    source_entity_id: 'actor:A',
    target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with',
    visibility,
    occurred_at: '2026-09-02T08:00:00.000Z'
  }, contextFor(store, 'actor:A')));
  let expectedVersion = 1;
  if (activate) {
    (await activateRelationship({
      command_id: `cmd:activate:${visibility}:${terminate}`,
      idempotency_key: `idem:activate:${visibility}:${terminate}`,
      principal_id: 'principal:B',
      relationship_id: proposed.relationship_id,
      expected_version: expectedVersion,
      occurred_at: '2026-09-02T08:01:00.000Z'
    }, contextFor(store, 'actor:B')));
    expectedVersion += 1;
  }
  if (terminate) {
    (await terminateRelationship({
      command_id: `cmd:terminate:${visibility}`,
      idempotency_key: `idem:terminate:${visibility}`,
      principal_id: 'principal:A',
      relationship_id: proposed.relationship_id,
      expected_version: expectedVersion,
      reason: 'revoked',
      occurred_at: '2026-09-02T08:02:00.000Z'
    }, contextFor(store, 'actor:A')));
  }
  (await rebuildRelationshipProjection(db, store));
  return { db, store, relationshipId: proposed.relationship_id };
}

test('public relationship is readable anonymously', async () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = (await makeRelationship({ visibility: 'public' }));
  const detail = (await loadRelationshipDetail({ relationshipId: fx.relationshipId, eventStore: fx.store, db: fx.db }));
  assert.equal(detail.relationship_id, fx.relationshipId);
  assert.equal(detail.visibility, 'public');
  assert.equal(detail.lifecycle, 'active');
  assert.equal(detail.viewer_scope, 'public');
});

test('participants relationship is unreadable to unrelated actor', async () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = (await makeRelationship());
  const detail = (await loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:C' },
    eventStore: fx.store,
    db: fx.db
  }));
  assert.equal(detail, null);
});

test('participants relationship is readable to endpoint and representative', async () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = (await makeRelationship());
  const endpoint = (await loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:A' },
    eventStore: fx.store,
    db: fx.db
  }));
  const representative = (await loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:C', represents_actor_ids: ['actor:B'] },
    eventStore: fx.store,
    db: fx.db
  }));
  assert.equal(endpoint.viewer_scope, 'participant');
  assert.equal(representative.viewer_scope, 'representative');
});

test('current disclosure policy may hide public relationship', async () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = (await makeRelationship({ visibility: 'public' }));
  const detail = (await loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    eventStore: fx.store,
    db: fx.db,
    disclosurePolicy: () => 'deny'
  }));
  assert.equal(detail, null);
});

test('terminated visible relationship remains readable', async () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = (await makeRelationship({ visibility: 'participants', terminate: true }));
  const detail = (await loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:B' },
    eventStore: fx.store,
    db: fx.db
  }));
  assert.equal(detail.lifecycle, 'terminated');
  assert.equal(detail.termination_reason, 'revoked');
});
