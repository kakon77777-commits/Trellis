const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { createPublication } = require('../publication/service');
const { rebuildPublicationProjection } = require('../publication/projector');
const { createPreference } = require('../preference/service');
const { ConsumptionStore } = require('../consumption/store');
const { buildFeedSourceGraph } = require('../feed/source-graph');
const { collectHomePublicationItems } = require('../feed/publication-items');
const { collectHomeActivityItems } = require('../feed/activity-items');
const { buildPersonalizedHomeFeedSnapshot } = require('../feed/personalized-home');

function ctx(db, eventStore, actorId, extra = {}) {
  return {
    db,
    sql: db,
    eventStore,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    capabilityGrants: [],
    evaluatedAt: '2026-09-03T12:00:00.000Z',
    ...extra
  };
}
async function reg(eventStore,id){(await registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority}));}
async function community(eventStore,id){(await createCommunity({command_id:`community:${id}`,idempotency_key:`community:${id}`,principal_id:`principal:${id}`,community_id:id},{eventStore,authorize:evaluateAuthority}));}
async function relate(db,eventStore,source,target,type,id){return (await proposeRelationship({command_id:`rel:${id}`,idempotency_key:`rel:${id}`,principal_id:`principal:${source}`,source_entity_id:source,target_entity_id:target,relationship_type:type,visibility:'public'},ctx(db,eventStore,source))).relationship_id;}
async function join(db,eventStore,actorId,communityId,id){const pending=(await requestMembership({command_id:`join:${id}`,idempotency_key:`join:${id}`,principal_id:`principal:${actorId}`,actor_id:actorId,community_id:communityId},ctx(db,eventStore,actorId)));(await approveMembership({command_id:`approve:${id}`,idempotency_key:`approve:${id}`,principal_id:`principal:${communityId}`,community_id:communityId,relationship_id:pending.relationship_id,expected_version:1},ctx(db,eventStore,communityId)));return pending.relationship_id;}
async function collab(db,eventStore,a,b,id){const pending=(await proposeRelationship({command_id:`collab:${id}`,idempotency_key:`collab:${id}`,principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'collaborates_with',visibility:'public'},ctx(db,eventStore,a)));(await activateRelationship({command_id:`collab:activate:${id}`,idempotency_key:`collab:activate:${id}`,principal_id:`principal:${b}`,relationship_id:pending.relationship_id,expected_version:1},ctx(db,eventStore,b)));}
async function pub(db,eventStore,id,author,extra={}){const contextExtra=extra.context??{};const commandExtra={...extra};delete commandExtra.context;return (await createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...commandExtra},ctx(db,eventStore,author,contextExtra)));}
async function pref(db,eventStore,id,type,target){return (await createPreference({command_id:`pref:${id}`,idempotency_key:`pref:${id}`,principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:type,target},ctx(db,eventStore,'actor:A')));}

async function setup(){
  const db=createTestDatabase(); let tick=0;
  const eventStore=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:00:${String(tick++).padStart(2,'0')}.000Z`});
  for(const id of ['actor:A','actor:B','actor:C','actor:X']) (await reg(eventStore,id));
  (await community(eventStore,'community:C1'));
  (await join(db,eventStore,'actor:A','community:C1','a-c1'));
  (await join(db,eventStore,'actor:B','community:C1','b-c1'));
  (await relate(db,eventStore,'actor:A','actor:B','subscribes_to','a-b-sub'));
  (await relate(db,eventStore,'actor:A','actor:C','follows','a-c-follow'));
  (await collab(db,eventStore,'actor:A','actor:C','a-c-collab'));
  (await rebuildRelationshipProjection(db,eventStore));
  (await pub(db,eventStore,'self','actor:A'));
  (await pub(db,eventStore,'sub','actor:B'));
  (await pub(db,eventStore,'follow','actor:C'));
  (await pub(db,eventStore,'comm','actor:B',{scope_ref:'community:C1',visibility:'scope_members',context:{capabilityGrants:[{active:true,principal_id:'principal:actor:B',capability:'publication:create',scope_ref:'community:C1'}]}}));
  (await rebuildPublicationProjection(db,eventStore));
  return {db,eventStore};
}

async function visibleV1PrePreference({db,eventStore}){
  const viewerContext={viewer_actor_id:'actor:A'};
  const sourceGraph=(await buildFeedSourceGraph({subjectActorId:'actor:A',viewerContext,db,eventStore}));
  return {
    sourceGraph,
    items:[
      ...(await collectHomePublicationItems({sourceGraph,viewerContext,db,eventStore})),
      ...(await collectHomeActivityItems({sourceGraph,subjectActorId:'actor:A',viewerContext,db,eventStore}))
    ]
  };
}
function ids(items){return items.map(item=>item.feed_item_id).sort();}

async function build(db,eventStore){return (await buildPersonalizedHomeFeedSnapshot({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,rankingReferenceTime:'2026-09-03T12:00:00.000Z'}));}

test('v2 starts from exactly the v1 viewer-safe pre-preference candidates',async ()=>{
  const{db,eventStore}=(await setup());
  const v1=await visibleV1PrePreference({db,eventStore});
  const v2=await build(db,eventStore);
  assert.deepEqual(ids(v2.visible_candidate_items),ids(v1.items));
  assert.deepEqual(v2.source_graph,v1.sourceGraph);
});

test('hard preference suppression happens before scoring and suppressed item has no score record',async ()=>{
  const{db,eventStore}=(await setup());
  (await pref(db,eventStore,'dismiss','dismiss_feed_item',{item_kind:'publication',source_ref:'pub:comm'}));
  const result=await build(db,eventStore);
  assert.equal(result.visible_candidate_items.some(i=>i.source_ref==='pub:comm'),true);
  assert.equal(result.items.some(i=>i.source_ref==='pub:comm'),false);
  assert.equal(result.items.some(i=>i.source_ref==='pub:comm'&&i.score),false);
});

test('seen and opened Consumption alter only exact item novelty',async ()=>{
  const{db,eventStore}=(await setup());const store=new ConsumptionStore(db);
  await store.recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:follow',now:'2026-09-03T11:00:00.000Z'});
  await store.recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:sub',now:'2026-09-03T11:05:00.000Z'});
  const result=await build(db,eventStore);
  const byRef=Object.fromEntries(result.items.filter(i=>i.item_type==='publication').map(i=>[i.source_ref,i]));
  assert.equal(byRef['pub:follow'].score.novelty_points,-500);
  assert.equal(byRef['pub:sub'].score.novelty_points,-1500);
  assert.equal(byRef['pub:self'].score.novelty_points,1000);
  assert.equal(byRef['pub:comm'].score.novelty_points,1000);
});

test('bookmark is neither a hard filter nor a ranking signal',async ()=>{
  const{db,eventStore}=(await setup());
  const before=(await build(db,eventStore)).items.map(i=>({id:i.feed_item_id,score:i.score,reasons:i.ranking_reasons}));
  (await pref(db,eventStore,'bookmark','bookmark_publication',{publication_id:'pub:self'}));
  const after=(await build(db,eventStore)).items.map(i=>({id:i.feed_item_id,score:i.score,reasons:i.ranking_reasons}));
  assert.deepEqual(after,before);
});

test('every scored item uses integer fixed-point components and exact explainability reconciliation',async ()=>{
  const{db,eventStore}=(await setup());
  const result=await build(db,eventStore);
  assert.equal(result.algorithm_ref,'trellis-feed:personalized:v2');
  assert.equal(result.projection_version,'trellis-feed:0.2');
  assert.equal(result.ranking_reference_time,'2026-09-03T12:00:00.000Z');
  for(const item of result.items){
    assert.ok(Object.values(item.score).every(Number.isInteger));
    assert.equal(item.ranking_reasons.reduce((sum,reason)=>sum+reason.points,0),item.score.total_points);
    assert.deepEqual(item.ranking_reasons.map(r=>r.component),['recency','source','novelty']);
  }
});
