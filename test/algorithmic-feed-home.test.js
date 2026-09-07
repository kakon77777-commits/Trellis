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
    eventStore,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    capabilityGrants: [],
    evaluatedAt: '2026-09-03T12:00:00.000Z',
    ...extra
  };
}
function reg(eventStore,id){registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority});}
function community(eventStore,id){createCommunity({command_id:`community:${id}`,idempotency_key:`community:${id}`,principal_id:`principal:${id}`,community_id:id},{eventStore,authorize:evaluateAuthority});}
function relate(db,eventStore,source,target,type,id){return proposeRelationship({command_id:`rel:${id}`,idempotency_key:`rel:${id}`,principal_id:`principal:${source}`,source_entity_id:source,target_entity_id:target,relationship_type:type,visibility:'public'},ctx(db,eventStore,source)).relationship_id;}
function join(db,eventStore,actorId,communityId,id){const pending=requestMembership({command_id:`join:${id}`,idempotency_key:`join:${id}`,principal_id:`principal:${actorId}`,actor_id:actorId,community_id:communityId},ctx(db,eventStore,actorId));approveMembership({command_id:`approve:${id}`,idempotency_key:`approve:${id}`,principal_id:`principal:${communityId}`,community_id:communityId,relationship_id:pending.relationship_id,expected_version:1},ctx(db,eventStore,communityId));return pending.relationship_id;}
function collab(db,eventStore,a,b,id){const pending=proposeRelationship({command_id:`collab:${id}`,idempotency_key:`collab:${id}`,principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'collaborates_with',visibility:'public'},ctx(db,eventStore,a));activateRelationship({command_id:`collab:activate:${id}`,idempotency_key:`collab:activate:${id}`,principal_id:`principal:${b}`,relationship_id:pending.relationship_id,expected_version:1},ctx(db,eventStore,b));}
function pub(db,eventStore,id,author,extra={}){const contextExtra=extra.context??{};const commandExtra={...extra};delete commandExtra.context;return createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...commandExtra},ctx(db,eventStore,author,contextExtra));}
function pref(db,eventStore,id,type,target){return createPreference({command_id:`pref:${id}`,idempotency_key:`pref:${id}`,principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:type,target},ctx(db,eventStore,'actor:A'));}

function setup(){
  const db=createTestDatabase(); let tick=0;
  const eventStore=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:00:${String(tick++).padStart(2,'0')}.000Z`});
  for(const id of ['actor:A','actor:B','actor:C','actor:X']) reg(eventStore,id);
  community(eventStore,'community:C1');
  join(db,eventStore,'actor:A','community:C1','a-c1');
  join(db,eventStore,'actor:B','community:C1','b-c1');
  relate(db,eventStore,'actor:A','actor:B','subscribes_to','a-b-sub');
  relate(db,eventStore,'actor:A','actor:C','follows','a-c-follow');
  collab(db,eventStore,'actor:A','actor:C','a-c-collab');
  rebuildRelationshipProjection(db,eventStore);
  pub(db,eventStore,'self','actor:A');
  pub(db,eventStore,'sub','actor:B');
  pub(db,eventStore,'follow','actor:C');
  pub(db,eventStore,'comm','actor:B',{scope_ref:'community:C1',visibility:'scope_members',context:{capabilityGrants:[{active:true,principal_id:'principal:actor:B',capability:'publication:create',scope_ref:'community:C1'}]}});
  rebuildPublicationProjection(db,eventStore);
  return {db,eventStore};
}

function visibleV1PrePreference({db,eventStore}){
  const viewerContext={viewer_actor_id:'actor:A'};
  const sourceGraph=buildFeedSourceGraph({subjectActorId:'actor:A',viewerContext,db,eventStore});
  return {
    sourceGraph,
    items:[
      ...collectHomePublicationItems({sourceGraph,viewerContext,db,eventStore}),
      ...collectHomeActivityItems({sourceGraph,subjectActorId:'actor:A',viewerContext,db,eventStore})
    ]
  };
}
function ids(items){return items.map(item=>item.feed_item_id).sort();}

function build(db,eventStore){return buildPersonalizedHomeFeedSnapshot({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,rankingReferenceTime:'2026-09-03T12:00:00.000Z'});}

test('v2 starts from exactly the v1 viewer-safe pre-preference candidates',()=>{
  const{db,eventStore}=setup();
  const v1=visibleV1PrePreference({db,eventStore});
  const v2=build(db,eventStore);
  assert.deepEqual(ids(v2.visible_candidate_items),ids(v1.items));
  assert.deepEqual(v2.source_graph,v1.sourceGraph);
});

test('hard preference suppression happens before scoring and suppressed item has no score record',()=>{
  const{db,eventStore}=setup();
  pref(db,eventStore,'dismiss','dismiss_feed_item',{item_kind:'publication',source_ref:'pub:comm'});
  const result=build(db,eventStore);
  assert.equal(result.visible_candidate_items.some(i=>i.source_ref==='pub:comm'),true);
  assert.equal(result.items.some(i=>i.source_ref==='pub:comm'),false);
  assert.equal(result.items.some(i=>i.source_ref==='pub:comm'&&i.score),false);
});

test('seen and opened Consumption alter only exact item novelty',()=>{
  const{db,eventStore}=setup();const store=new ConsumptionStore(db);
  store.recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:follow',now:'2026-09-03T11:00:00.000Z'});
  store.recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:sub',now:'2026-09-03T11:05:00.000Z'});
  const result=build(db,eventStore);
  const byRef=Object.fromEntries(result.items.filter(i=>i.item_type==='publication').map(i=>[i.source_ref,i]));
  assert.equal(byRef['pub:follow'].score.novelty_points,-500);
  assert.equal(byRef['pub:sub'].score.novelty_points,-1500);
  assert.equal(byRef['pub:self'].score.novelty_points,1000);
  assert.equal(byRef['pub:comm'].score.novelty_points,1000);
});

test('bookmark is neither a hard filter nor a ranking signal',()=>{
  const{db,eventStore}=setup();
  const before=build(db,eventStore).items.map(i=>({id:i.feed_item_id,score:i.score,reasons:i.ranking_reasons}));
  pref(db,eventStore,'bookmark','bookmark_publication',{publication_id:'pub:self'});
  const after=build(db,eventStore).items.map(i=>({id:i.feed_item_id,score:i.score,reasons:i.ranking_reasons}));
  assert.deepEqual(after,before);
});

test('every scored item uses integer fixed-point components and exact explainability reconciliation',()=>{
  const{db,eventStore}=setup();
  const result=build(db,eventStore);
  assert.equal(result.algorithm_ref,'trellis-feed:personalized:v2');
  assert.equal(result.projection_version,'trellis-feed:0.2');
  assert.equal(result.ranking_reference_time,'2026-09-03T12:00:00.000Z');
  for(const item of result.items){
    assert.ok(Object.values(item.score).every(Number.isInteger));
    assert.equal(item.ranking_reasons.reduce((sum,reason)=>sum+reason.points,0),item.score.total_points);
    assert.deepEqual(item.ranking_reasons.map(r=>r.component),['recency','source','novelty']);
  }
});
