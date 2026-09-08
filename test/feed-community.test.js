const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { setCommunityDiscoverability } = require('../community/product-commands');
const { requestMembership, approveMembership } = require('../community/membership');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { createPublication, withdrawPublication } = require('../publication/service');
const { rebuildPublicationProjection } = require('../publication/projector');
const { buildCommunityFeed } = require('../feed/community');

function ctx(db, store, actorId, extra={}) {
  return {db,sql:db,eventStore:store,authorize:evaluateAuthority,principalActorId:actorId,capabilityGrants:[],evaluatedAt:'2026-09-03T02:00:00Z',...extra};
}
async function reg(store,id){(await registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore:store,authorize:evaluateAuthority}));}
async function community(db,store,id,discoverability){
  (await createCommunity({command_id:`create:${id}`,idempotency_key:`create:${id}`,principal_id:`principal:${id}`,community_id:id},{eventStore:store,authorize:evaluateAuthority}));
  (await setCommunityDiscoverability({command_id:`disc:${id}`,idempotency_key:`disc:${id}`,principal_id:`principal:${id}`,community_id:id,value:discoverability},ctx(db,store,id)));
}
async function join(db,store,actor,communityId,suffix){
  const r=(await requestMembership({command_id:`join:${suffix}`,idempotency_key:`join:${suffix}`,principal_id:`principal:${actor}`,actor_id:actor,community_id:communityId},ctx(db,store,actor)));
  (await approveMembership({command_id:`approve:${suffix}`,idempotency_key:`approve:${suffix}`,principal_id:`principal:${communityId}`,community_id:communityId,relationship_id:r.relationship_id,expected_version:1},ctx(db,store,communityId)));
  return r.relationship_id;
}
function grant(actor,scope){return {active:true,principal_id:`principal:${actor}`,capability:'publication:create',scope_ref:scope};}
async function pub(db,store,id,author,overrides={},extra={}){
  return (await createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',...overrides},ctx(db,store,author,extra))).publication_id;
}
async function collab(db,store,a,b,scope,suffix){
  const r=(await proposeRelationship({command_id:`collab:${suffix}`,idempotency_key:`collab:${suffix}`,principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'collaborates_with',scope_ref:scope,visibility:'scope_members'},ctx(db,store,a)));
  (await activateRelationship({command_id:`activate:${suffix}`,idempotency_key:`activate:${suffix}`,principal_id:`principal:${b}`,relationship_id:r.relationship_id,expected_version:1},ctx(db,store,b)));
  return r.relationship_id;
}

async function setup(){
  const db=createTestDatabase(); let tick=0;
  const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T02:01:${String(tick++).padStart(2,'0')}Z`});
  for(const id of ['actor:A','actor:B','actor:X']) (await reg(store,id));
  (await community(db,store,'community:C','private'));
  (await community(db,store,'community:D','public'));
  (await join(db,store,'actor:A','community:C','a-c'));
  (await join(db,store,'actor:B','community:C','b-c'));
  (await join(db,store,'actor:B','community:D','b-d'));
  (await collab(db,store,'actor:A','actor:B','community:C','a-b-c'));
  (await rebuildRelationshipProjection(db,store));
  (await pub(db,store,'c-root','actor:B',{scope_ref:'community:C',visibility:'scope_members'},{capabilityGrants:[grant('actor:B','community:C')]}));
  (await pub(db,store,'global','actor:B'));
  (await pub(db,store,'c-reply','actor:A',{scope_ref:'community:C',visibility:'scope_members',reply_to_ref:'pub:c-root'},{capabilityGrants:[grant('actor:A','community:C')]}));
  (await pub(db,store,'d-root','actor:B',{scope_ref:'community:D',visibility:'scope_members'},{capabilityGrants:[grant('actor:B','community:D')]}));
  (await pub(db,store,'c-gone','actor:B',{scope_ref:'community:C',visibility:'scope_members'},{capabilityGrants:[grant('actor:B','community:C')]}));
  (await withdrawPublication({command_id:'withdraw:c-gone',idempotency_key:'withdraw:c-gone',principal_id:'principal:actor:B',publication_id:'pub:c-gone',expected_version:1},ctx(db,store,'actor:B')));
  (await rebuildPublicationProjection(db,store));
  return {db,store};
}

test('Community Feed contains only Community-scoped roots and allowlisted Community activities',async ()=>{
  const {db,store}=(await setup());
  const feed=(await buildCommunityFeed({communityId:'community:C',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store}));
  assert.ok(feed);
  assert.equal(feed.feed_type,'community');
  assert.equal(feed.community_id,'community:C');
  const pubs=feed.items.filter(i=>i.item_type==='publication').map(i=>i.source_ref).sort();
  assert.deepEqual(pubs,['pub:c-root']);
  assert.equal(feed.items.some(i=>i.source_ref==='pub:global'),false);
  assert.equal(feed.items.some(i=>i.source_ref==='pub:c-reply'),false);
  assert.equal(feed.items.some(i=>i.source_ref==='pub:d-root'),false);
  assert.equal(feed.items.some(i=>i.source_ref==='pub:c-gone'),false);
  const activities=feed.items.filter(i=>i.item_type==='social_activity').map(i=>i.activity.type);
  assert.equal(activities.filter(t=>t==='community_joined').length,2);
  assert.equal(activities.filter(t=>t==='collaboration_started').length,1);
});

test('outsider cannot obtain private Community Feed or aggregate signal',async ()=>{
  const {db,store}=(await setup());
  const feed=(await buildCommunityFeed({communityId:'community:C',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store}));
  assert.equal(feed,null);
});
