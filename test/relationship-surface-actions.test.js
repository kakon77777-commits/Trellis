const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { foldRelationship } = require('../relationship/fold');
const { evaluateAuthority } = require('../authority/policy');

function contextFor(store, actorId) {
  return { eventStore: store, principalActorId: actorId, evaluatedAt: '2026-09-02T09:30:00.000Z' };
}

function pendingFixture() {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  const proposed = proposeRelationship({
    command_id: 'cmd:actions:propose', idempotency_key: 'idem:actions:propose',
    principal_id: 'principal:A', source_entity_id: 'actor:A', target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with', occurred_at: '2026-09-02T09:30:00.000Z'
  }, contextFor(store, 'actor:A'));
  return { db, store, relationshipId: proposed.relationship_id };
}

test('target endpoint sees activate hint on bilateral pending relationship', () => {
  const { availableRelationshipActions } = require('../relationship-surface/action-hints');
  const fx = pendingFixture();
  const state = foldRelationship(fx.store.readStream('relationship', fx.relationshipId));
  const actions = availableRelationshipActions({ relationship: state, viewerContext: { viewer_actor_id: 'actor:B' } });
  assert.equal(actions.includes('activate'), true);
  assert.equal(actions.includes('terminate'), true);
});

test('source and unrelated viewer do not receive bilateral activate hint', () => {
  const { availableRelationshipActions } = require('../relationship-surface/action-hints');
  const fx = pendingFixture();
  const state = foldRelationship(fx.store.readStream('relationship', fx.relationshipId));
  assert.equal(availableRelationshipActions({ relationship: state, viewerContext: { viewer_actor_id: 'actor:A' } }).includes('activate'), false);
  assert.deepEqual(availableRelationshipActions({ relationship: state, viewerContext: { viewer_actor_id: 'actor:C' } }), []);
});

test('terminated relationship never advertises activate', () => {
  const { availableRelationshipActions } = require('../relationship-surface/action-hints');
  const state = {
    relationship_id: 'rel:terminated', source_entity_id: 'actor:A', target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with', taxonomy_ref: 'ai-fb-relations:0.1', lifecycle: 'terminated',
    open_contestation_count: 0
  };
  const actions = availableRelationshipActions({ relationship: state, viewerContext: { viewer_actor_id: 'actor:B' } });
  assert.equal(actions.includes('activate'), false);
});

test('stale activate hint does not bypass canonical state or authority checks', () => {
  const surface = require('../relationship-surface/product-commands');
  const fx = pendingFixture();
  const command = {
    command_id: 'cmd:actions:activate', idempotency_key: 'idem:actions:activate',
    principal_id: 'principal:B', relationship_id: fx.relationshipId, expected_version: 1,
    occurred_at: '2026-09-02T09:31:00.000Z'
  };
  const first = surface.activate(command, contextFor(fx.store, 'actor:B'));
  const retry = surface.activate(command, contextFor(fx.store, 'actor:B'));
  assert.equal(retry.receipt.deduplicated, true);
  assert.equal(first.relationship_id, retry.relationship_id);

  assert.throws(() => surface.activate({
    ...command,
    command_id: 'cmd:actions:activate-stale',
    idempotency_key: 'idem:actions:activate-stale'
  }, contextFor(fx.store, 'actor:B')), error => error && error.code === 'INVALID_TRANSITION');
});

test('social delegates_to relationship cannot authorize protected execution', () => {
  const receipt = evaluateAuthority({
    command_id: 'cmd:protected', principal_id: 'principal:B', actor_id: 'actor:B',
    requested_action: 'protected.execute', aggregate_id: 'resource:R',
    capability: 'github:write', scope_ref: 'repo:R', capability_grants: [],
    credential_refs: [], evaluated_at: '2026-09-02T09:32:00.000Z'
  });
  assert.equal(receipt.decision, 'deny');
});

test('product command surface exposes only existing relationship service adapters', () => {
  const surface = require('../relationship-surface/product-commands');
  assert.deepEqual(Object.keys(surface).sort(), [
    'activate', 'addAnnotation', 'addEvidence', 'openContestation',
    'propose', 'resolveContestation', 'terminate'
  ].sort());
});
