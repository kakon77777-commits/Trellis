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

function ctx(db,eventStore,actorId,extra={}) { return {db,sql:db,eventStore,authorize:evaluateAuthority,principalActorId:actorId,capabilityGrants:[],evaluatedAt:'2026-09-03T12:00:00.000Z',...extra}; }
async function reg(eventStore,id){(await registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority}));}
async function follow(db,eventStore,a,b,id,extra={}){return (await proposeRelationship({command_id:`rel:${id}`,idempotency_key:`rel:${id}`,principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'follows',visibility:'public',...extra},ctx(db,eventStore,a))).relationship_id;}
async function pub(db,eventStore,id,author,extra={}){const context=extra.context??{};const commandExtra={...extra};delete commandExtra.context;const r=(await createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...commandExtra},ctx(db,eventStore,author,context)));(await projectPublicationStream(db,eventStore,`pub:${id}`));return r;}
async function personalized(db,eventStore,extra={}){return (await buildPersonalizedHomeFeed({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,rankingReferenceTime:'2026-09-03T12:00:00.000Z',...extra}));}
async function setupBasic(){const db=createTestDatabase();let tick=0;const eventStore=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:00:${String(tick++).padStart(2,'0')}.000Z`});for(const id of ['actor:A','actor:B','actor:C','actor:R'])(await reg(eventStore,id));(await follow(db,eventStore,'actor:A','actor:B','a-b'));(await rebuildRelationshipProjection(db,eventStore));(await pub(db,eventStore,'A','actor:A'));(await pub(db,eventStore,'B','actor:B'));(await rebuildPublicationProjection(db,eventStore));return{db,eventStore};}
function reactionCommand(id,type='like',extra={}){return{command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:'principal:actor:B',actor_id:'actor:B',publication_id:'pub:A',reaction_type:type,...extra};}
function processorCtx(db,eventStore){return{db,sql:db,eventStore,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T12:05:00.000Z'};}

test('same eligible inputs and same ranking reference time replay byte-equivalent personalized output',async ()=>{
  const{db,eventStore}=(await setupBasic());
  const a=await personalized(db,eventStore);const b=await personalized(db,eventStore);
  assert.deepEqual(b,a);
});

test('when every candidate has equal source plus novelty contribution v2 order equals v1 chronological order',async ()=>{
  const db=createTestDatabase();let tick=0;const eventStore=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:00:${String(tick++).padStart(2,'0')}.000Z`});(await reg(eventStore,'actor:A'));
  (await pub(db,eventStore,'P1','actor:A'));(await pub(db,eventStore,'P2','actor:A'));(await pub(db,eventStore,'P3','actor:A'));(await rebuildPublicationProjection(db,eventStore));
  const args={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const v1=(await buildHomeFeed(args));
  const v2=(await buildPersonalizedHomeFeed({...args,rankingReferenceTime:'2026-09-03T12:00:00.000Z'}));
  assert.deepEqual(v2.items.map(i=>i.feed_item_id),v1.items.map(i=>i.feed_item_id));
});

test('Reaction lifecycle and Notification issue/ack are ranking and snapshot non-signals',async ()=>{
  const{db,eventStore}=(await setupBasic());const before=await personalized(db,eventStore);
  const created=(await createReaction(reactionCommand('create'),ctx(db,eventStore,'actor:B')));
  const notification=(await processSourceEvent({eventId:created.receipt.result_event_ids[0],commandId:'notify:rx',idempotencyKey:'notify:rx'},processorCtx(db,eventStore)));
  (await acknowledgeNotification({command_id:'notify:ack',idempotency_key:'notify:ack',principal_id:'principal:actor:A',notification_id:notification.notification_id,expected_version:1},ctx(db,eventStore,'actor:A')));
  (await changeReaction(reactionCommand('change','love',{expected_version:1}),ctx(db,eventStore,'actor:B')));
  (await withdrawReaction(reactionCommand('withdraw','love',{expected_version:2}),ctx(db,eventStore,'actor:B')));
  const after=await personalized(db,eventStore);
  assert.deepEqual(after,before);
});

test('bookmark canonical Preference is not a ranking signal',async ()=>{
  const{db,eventStore}=(await setupBasic());const before=await personalized(db,eventStore);
  (await createPreference({command_id:'pref:bookmark',idempotency_key:'pref:bookmark',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:'bookmark_publication',target:{publication_id:'pub:A'}},ctx(db,eventStore,'actor:A')));
  assert.deepEqual(await personalized(db,eventStore),before);
});

test('hidden source relationship and Consumption for its noncandidate target produce zero ranking signal',async ()=>{
  const{db,eventStore}=(await setupBasic());const hidden=new Set();const disclosurePolicy=value=>value.relationship_id&&hidden.has(value.relationship_id)?'deny':'allow';
  const before=await personalized(db,eventStore,{disclosurePolicy});
  const hiddenRel=(await follow(db,eventStore,'actor:A','actor:C','a-c-hidden'));hidden.add(hiddenRel);(await rebuildRelationshipProjection(db,eventStore));
  (await pub(db,eventStore,'C','actor:C'));(await rebuildPublicationProjection(db,eventStore));
  await new ConsumptionStore(db).recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:C',now:'2026-09-03T11:00:00.000Z'});
  const after=await personalized(db,eventStore,{disclosurePolicy});
  assert.deepEqual(after,before);
});

test('loss of Consumption keeps Feed available and only resets exact-item novelty to unseen',async ()=>{
  const{db,eventStore}=(await setupBasic());const store=new ConsumptionStore(db);
  await store.recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:B',now:'2026-09-03T11:00:00.000Z'});
  const seen=await personalized(db,eventStore);const beforeItem=seen.items.find(i=>i.source_ref==='pub:B');
  assert.equal(beforeItem.score.novelty_points,-1500);
  await store.clearAll();
  const reset=await personalized(db,eventStore);const afterItem=reset.items.find(i=>i.source_ref==='pub:B');
  assert.equal(reset.algorithm_ref,'trellis-feed:personalized:v2');
  assert.deepEqual(reset.items.map(i=>i.feed_item_id).sort(),seen.items.map(i=>i.feed_item_id).sort());
  assert.equal(afterItem.score.novelty_points,1000);
});

test('representative fallback is deep-equal before and after owner-private Preference and Consumption changes',async ()=>{
  const{db,eventStore}=(await setupBasic());
  const args={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore,limit:20,now:()=> '2026-09-03T12:00:00.000Z'};
  const before=await loadPersonalizedHomeFeedSurface(args);
  (await createPreference({command_id:'pref:mute',idempotency_key:'pref:mute',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:'mute_actor',target:{actor_id:'actor:B'}},ctx(db,eventStore,'actor:A')));
  await new ConsumptionStore(db).recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:A',now:'2026-09-03T11:00:00.000Z'});
  const after=await loadPersonalizedHomeFeedSurface(args);
  assert.equal(after.algorithm_ref,'trellis-feed:chronological:v1');
  assert.deepEqual(after,before);
});

test('Community Feed remains chronological v1 even when owner has private Preference and Consumption',async ()=>{
  const{db,eventStore}=(await setupBasic());
  (await createCommunity({command_id:'community:C1',idempotency_key:'community:C1',principal_id:'principal:community:C1',community_id:'community:C1'},{eventStore,authorize:evaluateAuthority}));
  for(const actor of ['actor:A','actor:B']){
    const p=(await requestMembership({command_id:`join:${actor}`,idempotency_key:`join:${actor}`,principal_id:`principal:${actor}`,actor_id:actor,community_id:'community:C1'},ctx(db,eventStore,actor)));
    (await approveMembership({command_id:`approve:${actor}`,idempotency_key:`approve:${actor}`,principal_id:'principal:community:C1',community_id:'community:C1',relationship_id:p.relationship_id,expected_version:1},ctx(db,eventStore,'community:C1')));
  }
  (await rebuildRelationshipProjection(db,eventStore));
  (await pub(db,eventStore,'CB','actor:B',{scope_ref:'community:C1',visibility:'scope_members',context:{capabilityGrants:[{active:true,principal_id:'principal:actor:B',capability:'publication:create',scope_ref:'community:C1'}]}}));(await rebuildPublicationProjection(db,eventStore));
  const before=(await buildCommunityFeed({communityId:'community:C1',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore}));
  await new ConsumptionStore(db).recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:CB',now:'2026-09-03T11:00:00.000Z'});
  const after=(await buildCommunityFeed({communityId:'community:C1',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore}));
  assert.equal(after.algorithm_ref,'trellis-feed:chronological:v1');
  assert.deepEqual(after,before);
});
