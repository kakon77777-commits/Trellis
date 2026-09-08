const { createTestDatabase } = require('./test-db');
const { SQLiteEventStore } = require('../../events/sqlite-event-store');
const { evaluateAuthority } = require('../../authority/policy');
const { registerActor } = require('../../entity/service');
const { createCommunity } = require('../../community/service');
const { setDisplayName } = require('../../profile/product-commands');
const { setCommunityName, setCommunityDiscoverability } = require('../../community/product-commands');
const { requestMembership, approveMembership } = require('../../community/membership');
const { proposeRelationship } = require('../../relationship/service');
const { rebuildRelationshipProjection } = require('../../projections/relationship-projector');

function ctx(store, actorId) {
  return { eventStore:store, authorize:evaluateAuthority, principalActorId:actorId, evaluatedAt:'2026-09-02T18:00:00Z' };
}
async function register(store,id,name=id) {
  (await registerActor({ command_id:`reg:${id}`, idempotency_key:`reg:${id}`, principal_id:`principal:${id}`, entity_id:id }, { eventStore:store, authorize:evaluateAuthority }));
  (await setDisplayName({ command_id:`name:${id}`, idempotency_key:`name:${id}`, principal_id:`principal:${id}`, actor_id:id, value:name }, ctx(store,id)));
}
async function createCommunityWithMetadata(store,id,discoverability='public',name=id) {
  (await createCommunity({ command_id:`create:${id}`, idempotency_key:`create:${id}`, principal_id:`principal:${id}`, community_id:id }, { eventStore:store, authorize:evaluateAuthority }));
  (await setCommunityName({ command_id:`cname:${id}`, idempotency_key:`cname:${id}`, principal_id:`principal:${id}`, community_id:id, value:name }, ctx(store,id)));
  (await setCommunityDiscoverability({ command_id:`cdisc:${id}`, idempotency_key:`cdisc:${id}`, principal_id:`principal:${id}`, community_id:id, value:discoverability }, ctx(store,id)));
}
async function join(store,actorId,communityId,suffix) {
  const pending=(await requestMembership({ command_id:`join:${suffix}`, idempotency_key:`join:${suffix}`, principal_id:`principal:${actorId}`, actor_id:actorId, community_id:communityId }, ctx(store,actorId)));
  (await approveMembership({ command_id:`approve:${suffix}`, idempotency_key:`approve:${suffix}`, principal_id:`principal:${communityId}`, community_id:communityId, relationship_id:pending.relationship_id, expected_version:1 }, ctx(store,communityId)));
  return pending.relationship_id;
}
async function follow(store,source,target,suffix,visibility) {
  return (await proposeRelationship({ command_id:`follow:${suffix}`, idempotency_key:`follow:${suffix}`, principal_id:`principal:${source}`, source_entity_id:source, target_entity_id:target, relationship_type:'follows', ...(visibility?{visibility}:{}) }, ctx(store,source))).relationship_id;
}
async function setupDiscoverySystem({ candidateName='Actor B' }={}) {
  const db=createTestDatabase();
  const store=new SQLiteEventStore(db,{now:()=> '2026-09-02T18:59:00Z'});
  (await register(store,'actor:A','Actor A'));
  (await register(store,'actor:B',candidateName));
  (await register(store,'actor:X','Actor X'));
  (await register(store,'actor:Y','Actor Y'));
  (await createCommunityWithMetadata(store,'community:C1','public','Community One'));
  (await createCommunityWithMetadata(store,'community:C2','public','Community Two'));
  (await createCommunityWithMetadata(store,'community:Cprivate','private','Private Community'));
  (await follow(store,'actor:A','actor:X','ax'));
  (await follow(store,'actor:X','actor:B','xb'));
  (await follow(store,'actor:X','actor:Y','xy-hidden','participants'));
  (await join(store,'actor:A','community:C1','a-c1'));
  (await join(store,'actor:B','community:C1','b-c1'));
  (await join(store,'actor:X','community:C2','x-c2'));
  (await join(store,'actor:Y','community:Cprivate','y-private'));
  (await rebuildRelationshipProjection(db,store));
  return {db,store};
}
module.exports={ctx,register,createCommunityWithMetadata,join,follow,setupDiscoverySystem};
