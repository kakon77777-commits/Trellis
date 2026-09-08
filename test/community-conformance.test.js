const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../package.json');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { setDisplayName } = require('../profile/product-commands');
const { setCommunityName, setCommunityDiscoverability } = require('../community/product-commands');
const { requestMembership, approveMembership, leaveCommunity } = require('../community/membership');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { rebuildActorProfileProjection } = require('../profile/projector');
const { buildActorProfile } = require('../profile/read-service');
const { buildCommunitySurface } = require('../community/read-service');
const { loadRelationshipDetail } = require('../relationship-surface/read-service');
const { createMembershipResolver } = require('../community/membership-read');
const communityService = require('../community/service');
const communityMembership = require('../community/membership');
const communityActions = require('../community/action-hints');

function ctx(store, actorId) {
  return { eventStore:store, authorize:evaluateAuthority, principalActorId:actorId, evaluatedAt:'2026-09-02T12:00:00Z' };
}
async function register(store,id) {
  (await registerActor({ command_id:`reg:${id}`, idempotency_key:`reg:${id}`, principal_id:`principal:${id}`, entity_id:id }, { eventStore:store, authorize:evaluateAuthority }));
}
async function join(store, actor, suffix) {
  const pending=(await requestMembership({ command_id:`join:${suffix}`, idempotency_key:`join:${suffix}`, principal_id:`principal:${actor}`, actor_id:actor, community_id:'community:C' }, ctx(store,actor)));
  (await approveMembership({ command_id:`approve:${suffix}`, idempotency_key:`approve:${suffix}`, principal_id:'principal:C', community_id:'community:C', relationship_id:pending.relationship_id, expected_version:1 }, ctx(store,'community:C')));
  return pending.relationship_id;
}

test('Community Graph vertical slice survives projection destruction and rebuild', async () => {
  const db=createTestDatabase();
  const store=new SQLiteEventStore(db,{ now:()=> '2026-09-02T12:59:00Z' });
  (await register(store,'actor:A')); (await register(store,'actor:B'));
  (await setDisplayName({ command_id:'name:A', idempotency_key:'name:A', principal_id:'principal:actor:A', actor_id:'actor:A', value:'Actor A' }, ctx(store,'actor:A')));
  (await setDisplayName({ command_id:'name:B', idempotency_key:'name:B', principal_id:'principal:actor:B', actor_id:'actor:B', value:'Actor B' }, ctx(store,'actor:B')));
  (await createCommunity({ command_id:'create:C', idempotency_key:'create:C', principal_id:'principal:C', community_id:'community:C' }, { eventStore:store, authorize:evaluateAuthority }));
  (await setCommunityName({ command_id:'community:name', idempotency_key:'community:name', principal_id:'principal:C', community_id:'community:C', value:'Research Lab' }, ctx(store,'community:C')));
  (await setCommunityDiscoverability({ command_id:'community:disc', idempotency_key:'community:disc', principal_id:'principal:C', community_id:'community:C', value:'private' }, ctx(store,'community:C')));
  const memberA=(await join(store,'actor:A','A'));
  const memberB=(await join(store,'actor:B','B'));
  const collab=(await proposeRelationship({ command_id:'collab:propose', idempotency_key:'collab:propose', principal_id:'principal:actor:A', source_entity_id:'actor:A', target_entity_id:'actor:B', relationship_type:'collaborates_with', scope_ref:'community:C', visibility:'scope_members' }, ctx(store,'actor:A')));
  (await activateRelationship({ command_id:'collab:activate', idempotency_key:'collab:activate', principal_id:'principal:actor:B', relationship_id:collab.relationship_id, expected_version:1 }, ctx(store,'actor:B')));
  (await rebuildRelationshipProjection(db,store));
  (await rebuildActorProfileProjection(db,store));

  assert.equal((await buildCommunitySurface({ communityId:'community:C', viewerContext:{}, db, eventStore:store })), null);
  const beforeLeave=(await buildCommunitySurface({ communityId:'community:C', viewerContext:{viewer_actor_id:'actor:B'}, db, eventStore:store }));
  assert.equal(beforeLeave.membership.visible_member_count,2);
  assert.deepEqual(beforeLeave.local_graph.visible_scoped_relationships.map(x=>x.relationship_id),[collab.relationship_id]);

  (await leaveCommunity({ command_id:'leave:A', idempotency_key:'leave:A', principal_id:'principal:actor:A', actor_id:'actor:A', community_id:'community:C', relationship_id:memberA, expected_version:2 }, ctx(store,'actor:A')));
  (await rebuildRelationshipProjection(db,store));
  (await rebuildActorProfileProjection(db,store));

  const resolver=(await createMembershipResolver(db));
  const communityBefore=(await buildCommunitySurface({ communityId:'community:C', viewerContext:{viewer_actor_id:'actor:B'}, db, eventStore:store }));
  const profileBefore=(await buildActorProfile({ actorId:'actor:B', viewerContext:{viewer_actor_id:'actor:B'}, eventStore:store, db, membershipResolver:resolver }));
  const detailBefore=(await loadRelationshipDetail({ relationshipId:collab.relationship_id, viewerContext:{viewer_actor_id:'actor:B'}, eventStore:store, db, membershipResolver:resolver }));
  assert.equal(communityBefore.membership.visible_member_count,1);
  assert.deepEqual(communityBefore.local_graph.visible_scoped_relationships,[]);
  assert.equal(store.readStream('relationship',collab.relationship_id).length,2);

  db.exec('DELETE FROM actor_profile_assertions_current; DELETE FROM actor_profile_current; DELETE FROM relationships_current;');
  (await rebuildRelationshipProjection(db,store));
  (await rebuildActorProfileProjection(db,store));
  const resolverAfter=(await createMembershipResolver(db));
  const communityAfter=(await buildCommunitySurface({ communityId:'community:C', viewerContext:{viewer_actor_id:'actor:B'}, db, eventStore:store }));
  const profileAfter=(await buildActorProfile({ actorId:'actor:B', viewerContext:{viewer_actor_id:'actor:B'}, eventStore:store, db, membershipResolver:resolverAfter }));
  const detailAfter=(await loadRelationshipDetail({ relationshipId:collab.relationship_id, viewerContext:{viewer_actor_id:'actor:B'}, eventStore:store, db, membershipResolver:resolverAfter }));
  assert.deepEqual(communityAfter,communityBefore);
  assert.deepEqual(profileAfter,profileBefore);
  assert.deepEqual(detailAfter,detailBefore);
  for (const [type,id] of [['entity','community:C'],['relationship',memberA],['relationship',memberB],['relationship',collab.relationship_id]]) {
    assert.deepEqual(store.verifyHashChain(type,id),{ok:true,failureAt:null});
  }
});

test('Actor Profile projector and read service do not treat Community as an Actor profile', async () => {
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  (await createCommunity({ command_id:'create:sep', idempotency_key:'create:sep', principal_id:'principal:C', community_id:'community:separate' }, { eventStore:store, authorize:evaluateAuthority }));
  (await setCommunityName({ command_id:'name:sep', idempotency_key:'name:sep', principal_id:'principal:C', community_id:'community:separate', value:'Not An Actor' }, ctx(store,'community:separate')));
  (await rebuildActorProfileProjection(db,store));
  assert.equal(db.prepare('SELECT * FROM actor_profile_current WHERE actor_id=?').get('community:separate'), undefined);
  assert.equal((await buildActorProfile({ actorId:'community:separate', viewerContext:{viewer_actor_id:'community:separate'}, eventStore:store, db })), null);
});

test('Community exports no authority or second-truth shortcuts', async () => {
  const exported=new Set([...Object.keys(communityService),...Object.keys(communityMembership),...Object.keys(communityActions)]);
  for (const forbidden of ['grantCommunityAuthority','actAsCommunityFromRole','setMembers','updateMemberList','createFeed','promoteAiBoardCandidate']) {
    assert.equal(exported.has(forbidden),false,`forbidden API exported: ${forbidden}`);
  }
});

test('syntax release gate includes every Community module', async () => {
  assert.match(packageJson.scripts.check,/community\/\*\.js/);
});
