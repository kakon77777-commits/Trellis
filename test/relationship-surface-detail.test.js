const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { proposeRelationship, activateRelationship, terminateRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');

function contextFor(eventStore, principalActorId) {
  return { eventStore, principalActorId, evaluatedAt: '2026-09-02T08:00:00.000Z' };
}

function makeRelationship({ visibility = 'participants', activate = true, terminate = false } = {}) {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  const proposed = proposeRelationship({
    command_id: `cmd:propose:${visibility}:${activate}:${terminate}`,
    idempotency_key: `idem:propose:${visibility}:${activate}:${terminate}`,
    principal_id: 'principal:A',
    source_entity_id: 'actor:A',
    target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with',
    visibility,
    occurred_at: '2026-09-02T08:00:00.000Z'
  }, contextFor(store, 'actor:A'));
  let expectedVersion = 1;
  if (activate) {
    activateRelationship({
      command_id: `cmd:activate:${visibility}:${terminate}`,
      idempotency_key: `idem:activate:${visibility}:${terminate}`,
      principal_id: 'principal:B',
      relationship_id: proposed.relationship_id,
      expected_version: expectedVersion,
      occurred_at: '2026-09-02T08:01:00.000Z'
    }, contextFor(store, 'actor:B'));
    expectedVersion += 1;
  }
  if (terminate) {
    terminateRelationship({
      command_id: `cmd:terminate:${visibility}`,
      idempotency_key: `idem:terminate:${visibility}`,
      principal_id: 'principal:A',
      relationship_id: proposed.relationship_id,
      expected_version: expectedVersion,
      reason: 'revoked',
      occurred_at: '2026-09-02T08:02:00.000Z'
    }, contextFor(store, 'actor:A'));
  }
  rebuildRelationshipProjection(db, store);
  return { db, store, relationshipId: proposed.relationship_id };
}

test('public relationship is readable anonymously', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = makeRelationship({ visibility: 'public' });
  const detail = loadRelationshipDetail({ relationshipId: fx.relationshipId, eventStore: fx.store, db: fx.db });
  assert.equal(detail.relationship_id, fx.relationshipId);
  assert.equal(detail.visibility, 'public');
  assert.equal(detail.lifecycle, 'active');
  assert.equal(detail.viewer_scope, 'public');
});

test('participants relationship is unreadable to unrelated actor', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = makeRelationship();
  const detail = loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:C' },
    eventStore: fx.store,
    db: fx.db
  });
  assert.equal(detail, null);
});

test('participants relationship is readable to endpoint and representative', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = makeRelationship();
  const endpoint = loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:A' },
    eventStore: fx.store,
    db: fx.db
  });
  const representative = loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:C', represents_actor_ids: ['actor:B'] },
    eventStore: fx.store,
    db: fx.db
  });
  assert.equal(endpoint.viewer_scope, 'participant');
  assert.equal(representative.viewer_scope, 'representative');
});

test('current disclosure policy may hide public relationship', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = makeRelationship({ visibility: 'public' });
  const detail = loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    eventStore: fx.store,
    db: fx.db,
    disclosurePolicy: () => 'deny'
  });
  assert.equal(detail, null);
});

test('terminated visible relationship remains readable', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = makeRelationship({ visibility: 'participants', terminate: true });
  const detail = loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:B' },
    eventStore: fx.store,
    db: fx.db
  });
  assert.equal(detail.lifecycle, 'terminated');
  assert.equal(detail.termination_reason, 'revoked');
});
