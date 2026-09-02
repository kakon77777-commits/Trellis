const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { setDisplayName } = require('../profile/product-commands');
const { setCommunityName, setCommunityDiscoverability } = require('../community/product-commands');
const { requestMembership, approveMembership } = require('../community/membership');
const { proposeRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { buildDiscoverySnapshot } = require('../discovery/visible-graph');

function ctx(store, actorId) {
  return {
    eventStore: store,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    evaluatedAt: '2026-09-02T16:00:00Z'
  };
}

function register(store, id) {
  registerActor({
    command_id: `reg:${id}`,
    idempotency_key: `reg:${id}`,
    principal_id: `principal:${id}`,
    entity_id: id
  }, { eventStore: store, authorize: evaluateAuthority });
  setDisplayName({
    command_id: `name:${id}`,
    idempotency_key: `name:${id}`,
    principal_id: `principal:${id}`,
    actor_id: id,
    value: id.replace('actor:', 'Actor ')
  }, ctx(store, id));
}

function community(store, id, discoverability) {
  createCommunity({
    command_id: `create:${id}`,
    idempotency_key: `create:${id}`,
    principal_id: `principal:${id}`,
    community_id: id
  }, { eventStore: store, authorize: evaluateAuthority });
  setCommunityName({
    command_id: `community-name:${id}`,
    idempotency_key: `community-name:${id}`,
    principal_id: `principal:${id}`,
    community_id: id,
    value: id.replace('community:', 'Community ')
  }, ctx(store, id));
  setCommunityDiscoverability({
    command_id: `community-disc:${id}`,
    idempotency_key: `community-disc:${id}`,
    principal_id: `principal:${id}`,
    community_id: id,
    value: discoverability
  }, ctx(store, id));
}

function join(store, actorId, communityId, suffix) {
  const pending = requestMembership({
    command_id: `join:${suffix}`,
    idempotency_key: `join:${suffix}`,
    principal_id: `principal:${actorId}`,
    actor_id: actorId,
    community_id: communityId
  }, ctx(store, actorId));
  approveMembership({
    command_id: `approve:${suffix}`,
    idempotency_key: `approve:${suffix}`,
    principal_id: `principal:${communityId}`,
    community_id: communityId,
    relationship_id: pending.relationship_id,
    expected_version: 1
  }, ctx(store, communityId));
  return pending.relationship_id;
}

function follow(store, source, target, suffix, visibility) {
  return proposeRelationship({
    command_id: `follow:${suffix}`,
    idempotency_key: `follow:${suffix}`,
    principal_id: `principal:${source}`,
    source_entity_id: source,
    target_entity_id: target,
    relationship_type: 'follows',
    ...(visibility ? { visibility } : {})
  }, ctx(store, source)).relationship_id;
}

function setup() {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db, { now: () => '2026-09-02T16:59:00Z' });
  for (const id of ['actor:A', 'actor:B', 'actor:X', 'actor:Y']) register(store, id);
  community(store, 'community:C1', 'public');
  community(store, 'community:Cprivate', 'private');
  follow(store, 'actor:A', 'actor:X', 'ax');
  follow(store, 'actor:X', 'actor:B', 'xb');
  follow(store, 'actor:X', 'actor:Y', 'xy-hidden', 'participants');
  join(store, 'actor:A', 'community:C1', 'a-c1');
  join(store, 'actor:B', 'community:C1', 'b-c1');
  join(store, 'actor:Y', 'community:Cprivate', 'y-private');
  rebuildRelationshipProjection(db, store);
  return { db, store };
}

test('discovery snapshot contains viewer-visible graph only', () => {
  const { db, store } = setup();
  const snapshot = buildDiscoverySnapshot({
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  });

  assert.equal(snapshot.subject_actor_id, 'actor:A');
  assert.equal(snapshot.viewer_scope, 'self');
  assert.deepEqual(Object.keys(snapshot.actors).sort(), ['actor:A', 'actor:B', 'actor:X']);
  assert.deepEqual(Object.keys(snapshot.communities), ['community:C1']);
  assert.equal(snapshot.relationships.some(row => row.source_entity_id === 'actor:Y' || row.target_entity_id === 'actor:Y'), false);
  assert.equal(JSON.stringify(snapshot).includes('community:Cprivate'), false);
  assert.equal(snapshot.actors['actor:B'].profile.presentation.display_name.value, 'Actor B');
});

test('adding a hidden fact does not change visible discovery snapshot hash', () => {
  const { db, store } = setup();
  const before = buildDiscoverySnapshot({
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  });

  follow(store, 'actor:B', 'actor:Y', 'by-hidden', 'participants');
  rebuildRelationshipProjection(db, store);

  const after = buildDiscoverySnapshot({
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  });

  assert.equal(after.snapshot_ref, before.snapshot_ref);
  assert.deepEqual(after.actors, before.actors);
  assert.deepEqual(after.communities, before.communities);
  assert.deepEqual(after.relationships, before.relationships);
});
