const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { proposeRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { createPublication } = require('../publication/service');
const { rebuildPublicationProjection, projectPublicationStream } = require('../publication/projector');
const { createPreference } = require('../preference/service');
const { ConsumptionStore } = require('../consumption/store');
const { createReaction, changeReaction, withdrawReaction } = require('../reaction/service');
const { processSourceEvent, acknowledgeNotification } = require('../notification/service');
const { buildHomeFeed } = require('../feed/home');
const { buildCommunityFeed } = require('../feed/community');
const { buildPersonalizedHomeFeed } = require('../feed/personalized-home');
const { loadPersonalizedHomeFeedSurface } = require('../feed/personalized-read-service');

function ctx(db,eventStore,actorId,extra={}) { return {db,eventStore,authorize:evaluateAuthority,principalActorId:actorId,capabilityGrants:[],evaluatedAt:'2026-09-03T12:00:00.000Z',...extra}; }
function reg(eventStore,id){registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority});}
function follow(db,eventStore,a,b,id,extra={}){return proposeRelationship({command_id:`rel:${id}`,idempotency_key:`rel:${id}`,principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'follows',visibility:'public',...extra},ctx(db,eventStore,a)).relationship_id;}
function pub(db,eventStore,id,author,extra={}){const context=extra.context??{};const commandExtra={...extra};delete commandExtra.context;const r=createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...commandExtra},ctx(db,eventStore,author,context));projectPublicationStream(db,eventStore,`pub:${id}`);return r;}
function personalized(db,eventStore,extra={}){return buildPersonalizedHomeFeed({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,rankingReferenceTime:'2026-09-03T12:00:00.000Z',...extra});}
function setupBasic(){const db=createTestDatabase();let tick=0;const eventStore=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:00:${String(tick++).padStart(2,'0')}.000Z`});for(const id of ['actor:A','actor:B','actor:C','actor:R'])reg(eventStore,id);follow(db,eventStore,'actor:A','actor:B','a-b');rebuildRelationshipProjection(db,eventStore);pub(db,eventStore,'A','actor:A');pub(db,eventStore,'B','actor:B');rebuildPublicationProjection(db,eventStore);return{db,eventStore};}
function reactionCommand(id,type='like',extra={}){return{command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:'principal:actor:B',actor_id:'actor:B',publication_id:'pub:A',reaction_type:type,...extra};}
function processorCtx(db,eventStore){return{db,eventStore,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T12:05:00.000Z'};}

test('same eligible inputs and same ranking reference time replay byte-equivalent personalized output',()=>{
  const{db,eventStore}=setupBasic();
  const a=personalized(db,eventStore);const b=personalized(db,eventStore);
  assert.deepEqual(b,a);
});

test('when every candidate has equal source plus novelty contribution v2 order equals v1 chronological order',()=>{
  const db=createTestDatabase();let tick=0;const eventStore=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:00:${String(tick++).padStart(2,'0')}.000Z`});reg(eventStore,'actor:A');
  pub(db,eventStore,'P1','actor:A');pub(db,eventStore,'P2','actor:A');pub(db,eventStore,'P3','actor:A');rebuildPublicationProjection(db,eventStore);
  const args={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const v1=buildHomeFeed(args);
  const v2=buildPersonalizedHomeFeed({...args,rankingReferenceTime:'2026-09-03T12:00:00.000Z'});
  assert.deepEqual(v2.items.map(i=>i.feed_item_id),v1.items.map(i=>i.feed_item_id));
});

test('Reaction lifecycle and Notification issue/ack are ranking and snapshot non-signals',()=>{
  const{db,eventStore}=setupBasic();const before=personalized(db,eventStore);
  const created=createReaction(reactionCommand('create'),ctx(db,eventStore,'actor:B'));
  const notification=processSourceEvent({eventId:created.receipt.result_event_ids[0],commandId:'notify:rx',idempotencyKey:'notify:rx'},processorCtx(db,eventStore));
  acknowledgeNotification({command_id:'notify:ack',idempotency_key:'notify:ack',principal_id:'principal:actor:A',notification_id:notification.notification_id,expected_version:1},ctx(db,eventStore,'actor:A'));
  changeReaction(reactionCommand('change','love',{expected_version:1}),ctx(db,eventStore,'actor:B'));
  withdrawReaction(reactionCommand('withdraw','love',{expected_version:2}),ctx(db,eventStore,'actor:B'));
  const after=personalized(db,eventStore);
  assert.deepEqual(after,before);
});

test('bookmark canonical Preference is not a ranking signal',()=>{
  const{db,eventStore}=setupBasic();const before=personalized(db,eventStore);
  createPreference({command_id:'pref:bookmark',idempotency_key:'pref:bookmark',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:'bookmark_publication',target:{publication_id:'pub:A'}},ctx(db,eventStore,'actor:A'));
  assert.deepEqual(personalized(db,eventStore),before);
});

test('hidden source relationship and Consumption for its noncandidate target produce zero ranking signal',()=>{
  const{db,eventStore}=setupBasic();const hidden=new Set();const disclosurePolicy=value=>value.relationship_id&&hidden.has(value.relationship_id)?'deny':'allow';
  const before=personalized(db,eventStore,{disclosurePolicy});
  const hiddenRel=follow(db,eventStore,'actor:A','actor:C','a-c-hidden');hidden.add(hiddenRel);rebuildRelationshipProjection(db,eventStore);
  pub(db,eventStore,'C','actor:C');rebuildPublicationProjection(db,eventStore);
  new ConsumptionStore(db).recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:C',now:'2026-09-03T11:00:00.000Z'});
  const after=personalized(db,eventStore,{disclosurePolicy});
  assert.deepEqual(after,before);
});

test('loss of Consumption keeps Feed available and only resets exact-item novelty to unseen',()=>{
  const{db,eventStore}=setupBasic();const store=new ConsumptionStore(db);
  store.recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:B',now:'2026-09-03T11:00:00.000Z'});
  const seen=personalized(db,eventStore);const beforeItem=seen.items.find(i=>i.source_ref==='pub:B');
  assert.equal(beforeItem.score.novelty_points,-1500);
  store.clearAll();
  const reset=personalized(db,eventStore);const afterItem=reset.items.find(i=>i.source_ref==='pub:B');
  assert.equal(reset.algorithm_ref,'trellis-feed:personalized:v2');
  assert.deepEqual(reset.items.map(i=>i.feed_item_id).sort(),seen.items.map(i=>i.feed_item_id).sort());
  assert.equal(afterItem.score.novelty_points,1000);
});

test('representative fallback is deep-equal before and after owner-private Preference and Consumption changes',()=>{
  const{db,eventStore}=setupBasic();
  const args={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore,limit:20,now:()=> '2026-09-03T12:00:00.000Z'};
  const before=loadPersonalizedHomeFeedSurface(args);
  createPreference({command_id:'pref:mute',idempotency_key:'pref:mute',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:'mute_actor',target:{actor_id:'actor:B'}},ctx(db,eventStore,'actor:A'));
  new ConsumptionStore(db).recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:A',now:'2026-09-03T11:00:00.000Z'});
  const after=loadPersonalizedHomeFeedSurface(args);
  assert.equal(after.algorithm_ref,'trellis-feed:chronological:v1');
  assert.deepEqual(after,before);
});

test('Community Feed remains chronological v1 even when owner has private Preference and Consumption',()=>{
  const{db,eventStore}=setupBasic();
  createCommunity({command_id:'community:C1',idempotency_key:'community:C1',principal_id:'principal:community:C1',community_id:'community:C1'},{eventStore,authorize:evaluateAuthority});
  for(const actor of ['actor:A','actor:B']){
    const p=requestMembership({command_id:`join:${actor}`,idempotency_key:`join:${actor}`,principal_id:`principal:${actor}`,actor_id:actor,community_id:'community:C1'},ctx(db,eventStore,actor));
    approveMembership({command_id:`approve:${actor}`,idempotency_key:`approve:${actor}`,principal_id:'principal:community:C1',community_id:'community:C1',relationship_id:p.relationship_id,expected_version:1},ctx(db,eventStore,'community:C1'));
  }
  rebuildRelationshipProjection(db,eventStore);
  pub(db,eventStore,'CB','actor:B',{scope_ref:'community:C1',visibility:'scope_members',context:{capabilityGrants:[{active:true,principal_id:'principal:actor:B',capability:'publication:create',scope_ref:'community:C1'}]}});rebuildPublicationProjection(db,eventStore);
  const before=buildCommunityFeed({communityId:'community:C1',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  new ConsumptionStore(db).recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:CB',now:'2026-09-03T11:00:00.000Z'});
  const after=buildCommunityFeed({communityId:'community:C1',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  assert.equal(after.algorithm_ref,'trellis-feed:chronological:v1');
  assert.deepEqual(after,before);
});
