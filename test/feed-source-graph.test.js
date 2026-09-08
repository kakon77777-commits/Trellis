const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { proposeRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { buildFeedSourceGraph } = require('../feed/source-graph');

function ctx(store, actorId) {
  return {
    eventStore: store,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    evaluatedAt: '2026-09-03T00:10:00Z'
  };
}

async function register(store, actorId) {
  (await registerActor({
    command_id: `reg:${actorId}`,
    idempotency_key: `reg:${actorId}`,
    principal_id: `principal:${actorId}`,
    entity_id: actorId
  }, { eventStore: store, authorize: evaluateAuthority }));
}

async function createTestCommunity(store, communityId) {
  (await createCommunity({
    command_id: `create:${communityId}`,
    idempotency_key: `create:${communityId}`,
    principal_id: `principal:${communityId}`,
    community_id: communityId
  }, { eventStore: store, authorize: evaluateAuthority }));
}

async function relate(store, source, target, type, suffix, extra = {}) {
  return (await proposeRelationship({
    command_id: `rel:${suffix}`,
    idempotency_key: `rel:${suffix}`,
    principal_id: `principal:${source}`,
    source_entity_id: source,
    target_entity_id: target,
    relationship_type: type,
    ...extra
  }, ctx(store, source))).relationship_id;
}

async function join(store, actorId, communityId, suffix) {
  const pending = (await requestMembership({
    command_id: `join:${suffix}`,
    idempotency_key: `join:${suffix}`,
    principal_id: `principal:${actorId}`,
    actor_id: actorId,
    community_id: communityId
  }, ctx(store, actorId)));
  (await approveMembership({
    command_id: `approve:${suffix}`,
    idempotency_key: `approve:${suffix}`,
    principal_id: `principal:${communityId}`,
    community_id: communityId,
    relationship_id: pending.relationship_id,
    expected_version: 1
  }, ctx(store, communityId)));
  return pending.relationship_id;
}

async function setup() {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db, { now: () => '2026-09-03T00:11:00Z' });
  for (const id of ['actor:A', 'actor:B', 'actor:X', 'actor:Y', 'actor:T', 'actor:C']) (await register(store, id));
  (await createTestCommunity(store, 'community:C1'));
  (await createTestCommunity(store, 'community:C2'));

  const followB = (await relate(store, 'actor:A', 'actor:B', 'follows', 'a-b'));
  const followX = (await relate(store, 'actor:A', 'actor:X', 'follows', 'a-x'));
  (await relate(store, 'actor:A', 'actor:Y', 'subscribes_to', 'a-y'));
  (await relate(store, 'actor:A', 'actor:T', 'trusts', 'a-t'));
  (await relate(store, 'actor:A', 'actor:C', 'collaborates_with', 'a-c'));
  const memberC1 = (await join(store, 'actor:A', 'community:C1', 'a-c1'));
  const memberC2 = (await join(store, 'actor:A', 'community:C2', 'a-c2'));
  (await rebuildRelationshipProjection(db, store));
  return { db, store, followB, followX, memberC1, memberC2 };
}

test('Feed source graph uses only viewer-visible explicit content-source relationships', async () => {
  const { db, store, followX, memberC2 } = (await setup());
  const beforeEvents = db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
  const disclosurePolicy = value =>
    [followX, memberC2].includes(value.relationship_id) ? 'deny' : 'allow';

  const graph = (await buildFeedSourceGraph({
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store,
    disclosurePolicy
  }));

  assert.equal(graph.subject_actor_id, 'actor:A');
  assert.equal(graph.viewer_scope, 'self');
  assert.deepEqual(graph.actor_source_ids, ['actor:B', 'actor:Y']);
  assert.deepEqual(graph.community_source_ids, ['community:C1']);
  assert.equal(graph.source_relationships.some(r => r.target_entity_id === 'actor:X'), false);
  assert.equal(graph.source_relationships.some(r => r.relationship_type === 'trusts'), false);
  assert.equal(graph.source_relationships.some(r => r.relationship_type === 'collaborates_with'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n, beforeEvents);
});

test('representative viewer keeps the Feed subject unchanged', async () => {
  const { db, store } = (await setup());
  const graph = (await buildFeedSourceGraph({
    subjectActorId: 'actor:A',
    viewerContext: {
      viewer_actor_id: 'actor:R',
      represents_actor_ids: ['actor:A']
    },
    db,
    eventStore: store
  }));
  assert.equal(graph.subject_actor_id, 'actor:A');
  assert.equal(graph.viewer_scope, 'representative');
});
