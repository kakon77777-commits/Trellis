const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const {
  proposeRelationship,
  activateRelationship,
  terminateRelationship,
  openContestation,
  addEvidence
} = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { buildFeedSourceGraph } = require('../feed/source-graph');
const { collectHomeActivityItems } = require('../feed/activity-items');

function ctx(store, actorId) {
  return {
    eventStore: store,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    evaluatedAt: '2026-09-03T01:00:00Z'
  };
}

function reg(store, id) {
  registerActor({
    command_id: `reg:${id}`,
    idempotency_key: `reg:${id}`,
    principal_id: `principal:${id}`,
    entity_id: id
  }, { eventStore: store, authorize: evaluateAuthority });
}

function community(store, id) {
  createCommunity({
    command_id: `create:${id}`,
    idempotency_key: `create:${id}`,
    principal_id: `principal:${id}`,
    community_id: id
  }, { eventStore: store, authorize: evaluateAuthority });
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

function follow(store, source, target, suffix) {
  return proposeRelationship({
    command_id: `follow:${suffix}`,
    idempotency_key: `follow:${suffix}`,
    principal_id: `principal:${source}`,
    source_entity_id: source,
    target_entity_id: target,
    relationship_type: 'follows'
  }, ctx(store, source)).relationship_id;
}

function collaborate(store, source, target, suffix, extra = {}) {
  const pending = proposeRelationship({
    command_id: `collab:${suffix}`,
    idempotency_key: `collab:${suffix}`,
    principal_id: `principal:${source}`,
    source_entity_id: source,
    target_entity_id: target,
    relationship_type: 'collaborates_with',
    ...extra
  }, ctx(store, source));
  activateRelationship({
    command_id: `activate:${suffix}`,
    idempotency_key: `activate:${suffix}`,
    principal_id: `principal:${target}`,
    relationship_id: pending.relationship_id,
    expected_version: 1
  }, ctx(store, target));
  return pending.relationship_id;
}

function setup() {
  const db = createTestDatabase();
  let tick = 0;
  const store = new SQLiteEventStore(db, {
    now: () => `2026-09-03T01:01:${String(tick++).padStart(2, '0')}Z`
  });
  for (const id of ['actor:A', 'actor:B', 'actor:X', 'actor:Y']) reg(store, id);
  community(store, 'community:C');
  join(store, 'actor:A', 'community:C', 'a-c');
  const membershipB = join(store, 'actor:B', 'community:C', 'b-c');
  follow(store, 'actor:A', 'actor:B', 'a-b');
  const collabAB = collaborate(store, 'actor:B', 'actor:X', 'b-x', { visibility: 'public' });
  const collabHidden = collaborate(store, 'actor:B', 'actor:Y', 'b-y', { visibility: 'public' });
  rebuildRelationshipProjection(db, store);
  return { db, store, membershipB, collabAB, collabHidden };
}

test('Feed activity projector allowlists only membership and collaboration activation', () => {
  const { db, store } = setup();
  const sourceGraph = buildFeedSourceGraph({
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  });
  const items = collectHomeActivityItems({
    sourceGraph,
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  });
  const types = items.map(item => item.activity.type).sort();
  assert.deepEqual(types, ['collaboration_started', 'collaboration_started', 'community_joined', 'community_joined']);
  assert.equal(items.some(item => item.activity.type === 'followed'), false);
});

test('termination contestation and evidence never create Feed activity items', () => {
  const { db, store, collabAB } = setup();
  terminateRelationship({
    command_id: 'terminate:b-x',
    idempotency_key: 'terminate:b-x',
    principal_id: 'principal:actor:B',
    relationship_id: collabAB,
    expected_version: 2
  }, ctx(store, 'actor:B'));
  const newCollab = collaborate(store, 'actor:A', 'actor:B', 'a-b-2');
  openContestation({
    command_id: 'contest:a-b-2',
    idempotency_key: 'contest:a-b-2',
    principal_id: 'principal:actor:A',
    relationship_id: newCollab,
    contestation_id: 'contest:1',
    expected_version: 2
  }, ctx(store, 'actor:A'));
  addEvidence({
    command_id: 'evidence:a-b-2',
    idempotency_key: 'evidence:a-b-2',
    principal_id: 'principal:actor:A',
    relationship_id: newCollab,
    evidence_ref: 'artifact:X',
    expected_version: 3
  }, ctx(store, 'actor:A'));
  rebuildRelationshipProjection(db, store);

  const sourceGraph = buildFeedSourceGraph({
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  });
  const items = collectHomeActivityItems({
    sourceGraph,
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  });
  assert.equal(items.some(item => /terminate|contest|evidence/.test(item.activity.type)), false);
  assert.equal(items.filter(item => item.source_event_ref.includes('contest')).length, 0);
  assert.equal(items.filter(item => item.source_event_ref.includes('evidence')).length, 0);
});

test('current disclosure policy hides activity source before item projection', () => {
  const { db, store, membershipB, collabHidden } = setup();
  const disclosurePolicy = value =>
    [membershipB, collabHidden].includes(value.relationship_id) ? 'deny' : 'allow';
  const sourceGraph = buildFeedSourceGraph({
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store,
    disclosurePolicy
  });
  const items = collectHomeActivityItems({
    sourceGraph,
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store,
    disclosurePolicy
  });
  assert.equal(items.some(item => item.activity.relationship_id === membershipB), false);
  assert.equal(items.some(item => item.activity.relationship_id === collabHidden), false);
  assert.equal(JSON.stringify(items).includes('actor:Y'), false);
});
