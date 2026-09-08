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
const { createPublication, revisePublication, withdrawPublication } = require('../publication/service');
const { rebuildPublicationProjection, projectPublicationStream } = require('../publication/projector');
const { buildFeedSourceGraph } = require('../feed/source-graph');
const { collectHomePublicationItems } = require('../feed/publication-items');
const { sortFeedItems } = require('../feed/chronological');

function ctx(db, store, actorId, extra = {}) {
  return {
    db,
    eventStore: store,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    capabilityGrants: [],
    evaluatedAt: '2026-09-03T00:30:00Z',
    ...extra
  };
}

async function reg(store, id) {
  (await registerActor({
    command_id: `reg:${id}`,
    idempotency_key: `reg:${id}`,
    principal_id: `principal:${id}`,
    entity_id: id
  }, { eventStore: store, authorize: evaluateAuthority }));
}

async function community(store, id) {
  (await createCommunity({
    command_id: `create:${id}`,
    idempotency_key: `create:${id}`,
    principal_id: `principal:${id}`,
    community_id: id
  }, { eventStore: store, authorize: evaluateAuthority }));
}

async function join(db, store, actorId, communityId, suffix) {
  const pending = (await requestMembership({
    command_id: `join:${suffix}`,
    idempotency_key: `join:${suffix}`,
    principal_id: `principal:${actorId}`,
    actor_id: actorId,
    community_id: communityId
  }, ctx(db, store, actorId)));
  (await approveMembership({
    command_id: `approve:${suffix}`,
    idempotency_key: `approve:${suffix}`,
    principal_id: `principal:${communityId}`,
    community_id: communityId,
    relationship_id: pending.relationship_id,
    expected_version: 1
  }, ctx(db, store, communityId)));
  return pending.relationship_id;
}

async function follow(db, store, source, target, suffix) {
  return (await proposeRelationship({
    command_id: `follow:${suffix}`,
    idempotency_key: `follow:${suffix}`,
    principal_id: `principal:${source}`,
    source_entity_id: source,
    target_entity_id: target,
    relationship_type: 'follows'
  }, ctx(db, store, source))).relationship_id;
}

function grant(actorId, scopeRef) {
  return {
    active: true,
    principal_id: `principal:${actorId}`,
    capability: 'publication:create',
    scope_ref: scopeRef
  };
}

async function pub(db, store, id, author, overrides = {}, extraCtx = {}) {
  return (await createPublication({
    command_id: `pub:${id}`,
    idempotency_key: `pub:${id}`,
    principal_id: `principal:${author}`,
    publication_id: `pub:${id}`,
    author_actor_id: author,
    publication_type: 'post',
    body: `body:${id}`,
    visibility: 'public',
    ...overrides
  }, ctx(db, store, author, extraCtx))).publication_id;
}

async function setup() {
  const db = createTestDatabase();
  let tick = 0;
  const store = new SQLiteEventStore(db, {
    now: () => `2026-09-03T00:31:${String(tick++).padStart(2, '0')}Z`
  });
  for (const id of ['actor:A', 'actor:B', 'actor:X']) (await reg(store, id));
  (await community(store, 'community:C'));
  (await join(db, store, 'actor:A', 'community:C', 'a-c'));
  (await join(db, store, 'actor:B', 'community:C', 'b-c'));
  const followB = (await follow(db, store, 'actor:A', 'actor:B', 'a-b'));
  const followX = (await follow(db, store, 'actor:A', 'actor:X', 'a-x'));
  (await rebuildRelationshipProjection(db, store));
  return { db, store, followB, followX };
}

test('Home Feed Publication collector includes only readable root Publications from explicit sources', async () => {
  const { db, store, followX } = (await setup());
  (await pub(db, store, 'p1', 'actor:B'));
  (await pub(db, store, 'p2', 'actor:X'));
  (await pub(db, store, 'p3', 'actor:A'));
  (await pub(db, store, 'p4', 'actor:B', { reply_to_ref: 'pub:p1' }));
  (await pub(db, store, 'p5', 'actor:B', {
    scope_ref: 'community:C',
    visibility: 'scope_members'
  }, { capabilityGrants: [grant('actor:B', 'community:C')] }));
  (await pub(db, store, 'gone', 'actor:B'));
  (await withdrawPublication({
    command_id: 'withdraw:gone',
    idempotency_key: 'withdraw:gone',
    principal_id: 'principal:actor:B',
    publication_id: 'pub:gone',
    expected_version: 1
  }, ctx(db, store, 'actor:B')));
  (await rebuildPublicationProjection(db, store));

  const disclosurePolicy = value => value.relationship_id === followX ? 'deny' : 'allow';
  const sourceGraph = (await buildFeedSourceGraph({
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store,
    disclosurePolicy
  }));
  const items = (await collectHomePublicationItems({
    sourceGraph,
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store,
    disclosurePolicy
  }));
  const ids = items.map(item => item.source_ref).sort();

  assert.deepEqual(ids, ['pub:p1', 'pub:p3', 'pub:p5']);
  assert.equal(JSON.stringify(items).includes('pub:p2'), false);
  assert.equal(items.some(item => item.source_ref === 'pub:p4'), false);
  assert.equal(JSON.stringify(items).includes('pub:gone'), false);
});

test('revision updates Feed body without changing creation-time sort metadata or resurfacing item', async () => {
  const { db, store } = (await setup());
  (await pub(db, store, 'older', 'actor:B', { body: 'older v1' }));
  (await pub(db, store, 'newer', 'actor:B', { body: 'newer' }));
  (await rebuildPublicationProjection(db, store));

  const sourceGraph = (await buildFeedSourceGraph({
    subjectActorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  }));
  const before = sortFeedItems((await collectHomePublicationItems({
    sourceGraph,
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  })));
  const beforeOlder = before.find(item => item.source_ref === 'pub:older');
  assert.deepEqual(before.map(item => item.source_ref), ['pub:newer', 'pub:older']);

  (await revisePublication({
    command_id: 'revise:older',
    idempotency_key: 'revise:older',
    principal_id: 'principal:actor:B',
    publication_id: 'pub:older',
    expected_version: 1,
    body: 'older v2'
  }, ctx(db, store, 'actor:B')));
  (await projectPublicationStream(db, store, 'pub:older'));

  const after = sortFeedItems((await collectHomePublicationItems({
    sourceGraph,
    viewerContext: { viewer_actor_id: 'actor:A' },
    db,
    eventStore: store
  })));
  const afterOlder = after.find(item => item.source_ref === 'pub:older');
  assert.deepEqual(after.map(item => item.source_ref), ['pub:newer', 'pub:older']);
  assert.equal(afterOlder.publication.content.body, 'older v2');
  assert.deepEqual(afterOlder.sort, beforeOlder.sort);
});
