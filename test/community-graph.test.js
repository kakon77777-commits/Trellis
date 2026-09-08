const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { setCommunityDiscoverability } = require('../community/product-commands');
const { requestMembership, approveMembership, leaveCommunity } = require('../community/membership');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { communityViewerScope, listVisibleMembers } = require('../community/read-policy');
const { buildCommunityLocalGraph } = require('../community/graph');

async function setup(discoverability='private') {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db);
  const authorize = evaluateAuthority;
  for (const id of ['A','B','X']) (await registerActor({ command_id:`cmd:${id}`, idempotency_key:`idem:${id}`, principal_id:`principal:${id}`, entity_id:`actor:${id}` }, { eventStore, authorize }));
  (await createCommunity({ command_id:'cmd:C', idempotency_key:'idem:C', principal_id:'principal:C', community_id:'community:C' }, { eventStore, authorize }));
  (await setCommunityDiscoverability({ command_id:'cmd:disc', idempotency_key:'idem:disc', principal_id:'principal:C', community_id:'community:C', value:discoverability }, { eventStore, authorize, principalActorId:'community:C' }));
  return { db, eventStore, authorize };
}

async function join(ctx, actor, suffix, visibility) {
  const pending = (await requestMembership({ command_id:`cmd:join-${suffix}`, idempotency_key:`idem:join-${suffix}`, principal_id:`principal:${actor}`, actor_id:`actor:${actor}`, community_id:'community:C', ...(visibility ? { visibility } : {}) }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:`actor:${actor}` }));
  (await approveMembership({ command_id:`cmd:approve-${suffix}`, idempotency_key:`idem:approve-${suffix}`, principal_id:'principal:C', community_id:'community:C', relationship_id:pending.relationship_id, expected_version:1 }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:'community:C' }));
  return pending.relationship_id;
}

test('private community is visible only to active members and acting-as community', async () => {
  const ctx = (await setup('private'));
  (await join(ctx, 'A', 'a'));
  (await rebuildRelationshipProjection(ctx.db, ctx.eventStore));
  assert.equal((await communityViewerScope({ communityId:'community:C', viewerContext:{ viewer_actor_id:'actor:A' }, db:ctx.db, eventStore:ctx.eventStore })), 'member');
  assert.equal((await communityViewerScope({ communityId:'community:C', viewerContext:{ viewer_actor_id:'community:C' }, db:ctx.db, eventStore:ctx.eventStore })), 'community');
  assert.equal((await communityViewerScope({ communityId:'community:C', viewerContext:{ viewer_actor_id:'actor:X' }, db:ctx.db, eventStore:ctx.eventStore })), null);
  assert.equal((await communityViewerScope({ communityId:'community:C', viewerContext:{}, db:ctx.db, eventStore:ctx.eventStore })), null);
});

test('public and unlisted communities allow direct public read scope', async () => {
  for (const discoverability of ['public','unlisted']) {
    const ctx = (await setup(discoverability));
    (await rebuildRelationshipProjection(ctx.db, ctx.eventStore));
    assert.equal((await communityViewerScope({ communityId:'community:C', viewerContext:{}, db:ctx.db, eventStore:ctx.eventStore })), 'public');
  }
});

test('member list filters before counting and does not leak private membership', async () => {
  const ctx = (await setup('public'));
  (await join(ctx, 'A', 'a-public', 'public'));
  (await join(ctx, 'B', 'b-private', 'private'));
  (await rebuildRelationshipProjection(ctx.db, ctx.eventStore));
  const publicList = (await listVisibleMembers({ communityId:'community:C', viewerContext:{}, db:ctx.db, eventStore:ctx.eventStore }));
  assert.deepEqual(publicList.visible_members.map(x => x.actor_id), ['actor:A']);
  assert.equal(publicList.visible_member_count, 1);
  assert.equal(JSON.stringify(publicList).includes('actor:B'), false);
  assert.equal(Object.hasOwn(publicList, 'total_member_count'), false);

  const communityList = (await listVisibleMembers({ communityId:'community:C', viewerContext:{ viewer_actor_id:'community:C' }, db:ctx.db, eventStore:ctx.eventStore }));
  assert.equal(communityList.visible_member_count, 2);
});

test('local graph contains scoped relationship only while both endpoints are active members', async () => {
  const ctx = (await setup('private'));
  const aMembership = (await join(ctx, 'A', 'a-local'));
  (await join(ctx, 'B', 'b-local'));
  const rel = (await proposeRelationship({ command_id:'cmd:collab', idempotency_key:'idem:collab', principal_id:'principal:A', source_entity_id:'actor:A', target_entity_id:'actor:B', relationship_type:'collaborates_with', scope_ref:'community:C', visibility:'scope_members' }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:'actor:A' }));
  (await activateRelationship({ command_id:'cmd:collab-activate', idempotency_key:'idem:collab-activate', principal_id:'principal:B', relationship_id:rel.relationship_id, expected_version:1 }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:'actor:B' }));
  (await rebuildRelationshipProjection(ctx.db, ctx.eventStore));
  let graph = (await buildCommunityLocalGraph({ communityId:'community:C', viewerContext:{ viewer_actor_id:'actor:A' }, db:ctx.db, eventStore:ctx.eventStore }));
  assert.deepEqual(graph.visible_scoped_relationships.map(x => x.relationship_id), [rel.relationship_id]);

  (await leaveCommunity({ command_id:'cmd:leave-a', idempotency_key:'idem:leave-a', principal_id:'principal:A', actor_id:'actor:A', community_id:'community:C', relationship_id:aMembership, expected_version:2 }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:'actor:A' }));
  (await rebuildRelationshipProjection(ctx.db, ctx.eventStore));
  graph = (await buildCommunityLocalGraph({ communityId:'community:C', viewerContext:{ viewer_actor_id:'actor:B' }, db:ctx.db, eventStore:ctx.eventStore }));
  assert.deepEqual(graph.visible_scoped_relationships, []);
  assert.equal(ctx.eventStore.readStream('relationship', rel.relationship_id).length, 2);
});
