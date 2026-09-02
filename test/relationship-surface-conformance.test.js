const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../package.json');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { setDisplayName } = require('../profile/product-commands');
const {
  proposeRelationship,
  activateRelationship,
  addEvidence,
  openContestation,
  resolveContestation,
  terminateRelationship
} = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { rebuildActorProfileProjection } = require('../profile/projector');
const { buildActorProfile } = require('../profile/read-service');
const { buildRelationshipIndex } = require('../relationship-surface/index-service');
const { loadRelationshipDetail } = require('../relationship-surface/read-service');
const productCommands = require('../relationship-surface/product-commands');
const renderJson = require('../relationship-surface/render-json');
const renderHtml = require('../relationship-surface/render-html');

function context(store, actorId, at = '2026-09-02T11:30:00.000Z') {
  return {
    eventStore: store,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    evaluatedAt: at
  };
}

function register(store, actorId) {
  registerActor({
    command_id: `reg:${actorId}`, idempotency_key: `reg:${actorId}`,
    principal_id: `principal:${actorId}`, entity_id: actorId,
    occurred_at: '2026-09-02T11:30:00.000Z'
  }, { eventStore: store, authorize: evaluateAuthority });
}

test('Relationship Surface vertical slice survives projection destruction and rebuild', () => {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db, { now: () => '2026-09-02T11:30:59.000Z' });
  register(store, 'actor:A');
  register(store, 'actor:B');

  setDisplayName({
    command_id: 'profile:A:name', idempotency_key: 'profile:A:name',
    principal_id: 'principal:actor:A', actor_id: 'actor:A',
    value: 'Actor A', visibility: 'public'
  }, context(store, 'actor:A'));
  setDisplayName({
    command_id: 'profile:B:name', idempotency_key: 'profile:B:name',
    principal_id: 'principal:actor:B', actor_id: 'actor:B',
    value: 'Actor B', visibility: 'public'
  }, context(store, 'actor:B'));

  const proposed = proposeRelationship({
    command_id: 'rel:ab:propose', idempotency_key: 'rel:ab:propose',
    principal_id: 'principal:actor:A', source_entity_id: 'actor:A', target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with', visibility: 'participants', scope_ref: 'project:X',
    occurred_at: '2026-09-02T11:31:00.000Z'
  }, context(store, 'actor:A'));

  rebuildRelationshipProjection(db, store);
  rebuildActorProfileProjection(db, store);

  const pendingForB = buildRelationshipIndex({
    actorId: 'actor:B', viewerContext: { viewer_actor_id: 'actor:B' }, db
  });
  assert.deepEqual(pendingForB.pending_incoming.map(x => x.relationship_id), [proposed.relationship_id]);
  assert.equal(pendingForB.counts.pending_incoming, 1);

  activateRelationship({
    command_id: 'rel:ab:activate', idempotency_key: 'rel:ab:activate',
    principal_id: 'principal:actor:B', relationship_id: proposed.relationship_id,
    expected_version: 1, occurred_at: '2026-09-02T11:32:00.000Z'
  }, context(store, 'actor:B'));
  addEvidence({
    command_id: 'rel:ab:evidence', idempotency_key: 'rel:ab:evidence',
    principal_id: 'principal:actor:A', relationship_id: proposed.relationship_id,
    expected_version: 2, evidence_ref: 'artifact:X', occurred_at: '2026-09-02T11:33:00.000Z'
  }, context(store, 'actor:A'));
  openContestation({
    command_id: 'rel:ab:contest-open', idempotency_key: 'rel:ab:contest-open',
    principal_id: 'principal:actor:B', relationship_id: proposed.relationship_id,
    expected_version: 3, contestation_id: 'contest:X', claim: 'claim',
    occurred_at: '2026-09-02T11:34:00.000Z'
  }, context(store, 'actor:B'));
  resolveContestation({
    command_id: 'rel:ab:contest-resolve', idempotency_key: 'rel:ab:contest-resolve',
    principal_id: 'principal:actor:A', relationship_id: proposed.relationship_id,
    expected_version: 4, contestation_id: 'contest:X', resolution: 'dismissed',
    occurred_at: '2026-09-02T11:35:00.000Z'
  }, context(store, 'actor:A'));
  terminateRelationship({
    command_id: 'rel:ab:terminate', idempotency_key: 'rel:ab:terminate',
    principal_id: 'principal:actor:A', relationship_id: proposed.relationship_id,
    expected_version: 5, reason: 'revoked', occurred_at: '2026-09-02T11:36:00.000Z'
  }, context(store, 'actor:A'));

  rebuildRelationshipProjection(db, store);
  rebuildActorProfileProjection(db, store);

  const viewerA = { viewer_actor_id: 'actor:A', represents_actor_ids: [] };
  const profileBefore = buildActorProfile({ actorId: 'actor:A', viewerContext: viewerA, eventStore: store, db });
  const indexBefore = buildRelationshipIndex({ actorId: 'actor:A', viewerContext: viewerA, db });
  const detailBefore = loadRelationshipDetail({ relationshipId: proposed.relationship_id, viewerContext: viewerA, eventStore: store, db });

  assert.equal(detailBefore.lifecycle, 'terminated');
  assert.equal(detailBefore.termination_reason, 'revoked');
  assert.equal(detailBefore.evidence.length, 1);
  assert.equal(detailBefore.contestations[0].status, 'resolved');
  assert.equal(detailBefore.available_actions.includes('activate'), false);
  assert.deepEqual(indexBefore.historical_terminated.map(x => x.relationship_id), [proposed.relationship_id]);

  const publicDetail = loadRelationshipDetail({ relationshipId: proposed.relationship_id, viewerContext: {}, eventStore: store, db });
  const publicIndex = buildRelationshipIndex({ actorId: 'actor:A', viewerContext: {}, db });
  assert.equal(publicDetail, null);
  assert.equal(publicIndex.counts.historical_terminated, 0);
  assert.equal(JSON.stringify(publicIndex).includes(proposed.relationship_id), false);

  db.exec(`
    DELETE FROM actor_profile_assertions_current;
    DELETE FROM actor_profile_current;
    DELETE FROM relationships_current;
  `);
  rebuildRelationshipProjection(db, store);
  rebuildActorProfileProjection(db, store);

  const profileAfter = buildActorProfile({ actorId: 'actor:A', viewerContext: viewerA, eventStore: store, db });
  const indexAfter = buildRelationshipIndex({ actorId: 'actor:A', viewerContext: viewerA, db });
  const detailAfter = loadRelationshipDetail({ relationshipId: proposed.relationship_id, viewerContext: viewerA, eventStore: store, db });

  assert.deepEqual(profileAfter, profileBefore);
  assert.deepEqual(indexAfter, indexBefore);
  assert.deepEqual(detailAfter, detailBefore);
  assert.deepEqual(store.verifyHashChain('entity', 'actor:A'), { ok: true, failureAt: null });
  assert.deepEqual(store.verifyHashChain('entity', 'actor:B'), { ok: true, failureAt: null });
  assert.deepEqual(store.verifyHashChain('relationship', proposed.relationship_id), { ok: true, failureAt: null });
});

test('Relationship Surface exports no forbidden state-authority shortcuts', () => {
  const exported = new Set([
    ...Object.keys(productCommands),
    ...Object.keys(renderJson),
    ...Object.keys(renderHtml)
  ]);
  for (const forbidden of [
    'updateRelationshipRow',
    'deleteRelationshipEvent',
    'reactivateRelationship',
    'grantCapabilityFromRelationship',
    'promoteAiBoardCandidate',
    'writeRelationshipProjectionAsTruth'
  ]) {
    assert.equal(exported.has(forbidden), false, `forbidden API exported: ${forbidden}`);
  }
});

test('syntax release gate includes every relationship surface module', () => {
  assert.match(packageJson.scripts.check, /relationship-surface\/\*\.js/);
});
