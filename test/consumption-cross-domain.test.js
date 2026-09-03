const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {proposeRelationship}=require('../relationship/service');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {createPublication}=require('../publication/service');
const {rebuildPublicationProjection,projectPublicationStream}=require('../publication/projector');
const {loadPublicationSurface}=require('../publication/read-service');
const {buildHomeFeed}=require('../feed/home');
const {buildDiscoverySurface}=require('../discovery/read-service');
const {processSourceEvent}=require('../notification/service');
const {loadNotificationInboxSurface}=require('../notification/read-service');
const {recordSeen,recordOpened}=require('../consumption/service');
const {ConsumptionStore}=require('../consumption/store');
const {loadConsumptionSurface}=require('../consumption/read-service');
const {createPreference}=require('../preference/service');
const {loadPreferenceSurface}=require('../preference/read-service');

function ctx(db,eventStore,actorId,extra={}){return{db,eventStore,authorize:evaluateAuthority,principalActorId:actorId,evaluatedAt:'2026-09-03T22:00:00.000Z',capabilityGrants:[],...extra};}
function reg(eventStore,id){registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority});}
function follow(db,eventStore,a,b,id){return proposeRelationship({command_id:`follow:${id}`,idempotency_key:`follow:${id}`,principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'follows',visibility:'public'},ctx(db,eventStore,a)).relationship_id;}
function publication(db,eventStore,id,author,extra={}){const result=createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...extra},ctx(db,eventStore,author));projectPublicationStream(db,eventStore,`pub:${id}`);return result;}
function recorderGrant(){return{active:true,principal_id:'principal:surface',capability:'consumption:record',scope_ref:null};}
function recordCtx(db,eventStore,viewer){return{db,eventStore,recognizedViewerActorId:viewer,capabilityGrants:[recorderGrant()],now:()=> '2026-09-03T22:30:00.000Z'};}
function seen(id,consumer,pubId){return{command_id:`consume:${id}`,principal_id:'principal:surface',requested_consumer_actor_id:consumer,target:{publication_id:pubId}};}
function canonicalCounts(db){return{events:db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n,receipts:db.prepare('SELECT COUNT(*) AS n FROM command_receipts').get().n,by_stream:Object.fromEntries(db.prepare('SELECT stream_type,COUNT(*) AS n FROM canonical_events GROUP BY stream_type ORDER BY stream_type').all().map(r=>[r.stream_type,r.n]))};}
function setup(){
  const db=createTestDatabase();const eventStore=new SQLiteEventStore(db,{now:()=> '2026-09-03T22:00:01.000Z'});
  for(const id of ['actor:A','actor:B','actor:R'])reg(eventStore,id);
  follow(db,eventStore,'actor:A','actor:B','a-b');rebuildRelationshipProjection(db,eventStore);
  publication(db,eventStore,'A','actor:A');publication(db,eventStore,'B','actor:B');
  rebuildPublicationProjection(db,eventStore);
  return{db,eventStore};
}
function notificationForReply(db,eventStore){
  const reply=publication(db,eventStore,'Reply','actor:B',{reply_to_ref:'pub:A'});
  const sourceEventId=reply.receipt.result_event_ids[0];
  const grant={active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null};
  processSourceEvent({eventId:sourceEventId,commandId:'notify:reply',idempotencyKey:'notify:reply'},{db,eventStore,principalId:'principal:notification-processor',capabilityGrants:[grant],evaluatedAt:'2026-09-03T22:10:00.000Z'});
}

test('Feed and Publication fetches do not implicitly mark seen or opened',()=>{
  const{db,eventStore}=setup();
  const before=db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n;
  buildHomeFeed({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  loadPublicationSurface({publicationId:'pub:B',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  const after=db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n;
  assert.equal(before,0);assert.equal(after,0);
});

test('representative viewing A Feed records Consumption only for the actual representative viewer',()=>{
  const{db,eventStore}=setup();
  const feed=buildHomeFeed({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore});
  assert.ok(feed.items.some(i=>i.source_ref==='pub:B'));
  recordSeen(seen('rep','actor:R','pub:B'),recordCtx(db,eventStore,'actor:R'));
  const store=new ConsumptionStore(db);
  assert.ok(store.get('actor:R','publication','pub:B'));
  assert.equal(store.get('actor:A','publication','pub:B'),null);
});

test('Consumption writes change neither canonical events nor canonical command receipts',()=>{
  const{db,eventStore}=setup();const before=canonicalCounts(db);
  recordSeen(seen('canonical','actor:A','pub:B'),recordCtx(db,eventStore,'actor:A'));
  recordOpened({command_id:'consume:open',principal_id:'principal:surface',requested_consumer_actor_id:'actor:A',target:{publication_id:'pub:B'}},recordCtx(db,eventStore,'actor:A'));
  assert.deepEqual(canonicalCounts(db),before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='consumption'").get().n,0);
});

test('Consumption-only state leaves Feed Discovery and Notification v0.1 outputs identical',()=>{
  const{db,eventStore}=setup();notificationForReply(db,eventStore);
  const feedArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const discoveryArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const inboxArgs={recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const before={feed:buildHomeFeed(feedArgs),discovery:buildDiscoverySurface(discoveryArgs),inbox:loadNotificationInboxSurface(inboxArgs)};
  recordSeen(seen('non-signal','actor:A','pub:B'),recordCtx(db,eventStore,'actor:A'));
  recordOpened({command_id:'consume:non-signal-open',principal_id:'principal:surface',requested_consumer_actor_id:'actor:A',target:{publication_id:'pub:B'}},recordCtx(db,eventStore,'actor:A'));
  const after={feed:buildHomeFeed(feedArgs),discovery:buildDiscoverySurface(discoveryArgs),inbox:loadNotificationInboxSurface(inboxArgs)};
  assert.deepEqual(after,before);
});


function pref(id,type,target){return{command_id:`pref:${id}`,idempotency_key:`pref:${id}`,principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:type,target};}

test('explicit not-interested Preference remains dominant after opened Consumption is recorded',()=>{
  const{db,eventStore}=setup();
  createPreference(pref('ni','not_interested_publication',{publication_id:'pub:B'}),ctx(db,eventStore,'actor:A'));
  const feedArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const beforeFeed=buildHomeFeed(feedArgs);
  const beforePreference=loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  assert.equal(beforeFeed.items.some(i=>i.source_ref==='pub:B'),false);
  recordOpened({command_id:'consume:preference-open',principal_id:'principal:surface',requested_consumer_actor_id:'actor:A',target:{publication_id:'pub:B'}},recordCtx(db,eventStore,'actor:A'));
  const afterFeed=buildHomeFeed(feedArgs);
  const afterPreference=loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  assert.deepEqual(afterFeed,beforeFeed);
  assert.deepEqual(afterPreference,beforePreference);
  assert.equal(eventStore.readStream('preference',beforePreference.preferences[0].preference_id).length,1);
});

test('retained Consumption for a now-hidden target produces no visible personalization signal',()=>{
  const{db,eventStore}=setup();notificationForReply(db,eventStore);
  recordSeen(seen('hidden-retained','actor:A','pub:B'),recordCtx(db,eventStore,'actor:A'));
  const disclosurePolicy=value=>value.publication_id==='pub:B'?'deny':'allow';
  const feedArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,disclosurePolicy};
  const discoveryArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,disclosurePolicy};
  const inboxArgs={recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,disclosurePolicy};
  const withHiddenRow={feed:buildHomeFeed(feedArgs),discovery:buildDiscoverySurface(discoveryArgs),inbox:loadNotificationInboxSurface(inboxArgs)};
  const consumption=loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,disclosurePolicy});
  assert.equal(consumption.items.some(i=>i.target_ref==='pub:B'),false);
  new ConsumptionStore(db).clearAll();
  const withoutRow={feed:buildHomeFeed(feedArgs),discovery:buildDiscoverySurface(discoveryArgs),inbox:loadNotificationInboxSurface(inboxArgs)};
  assert.deepEqual(withoutRow,withHiddenRow);
});

test('deleting all Consumption State changes only private operational memory, not social or derived state',()=>{
  const{db,eventStore}=setup();notificationForReply(db,eventStore);
  recordSeen(seen('delete','actor:A','pub:B'),recordCtx(db,eventStore,'actor:A'));
  const feedArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const discoveryArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const inboxArgs={recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const canonicalBefore=canonicalCounts(db);
  const before={feed:buildHomeFeed(feedArgs),discovery:buildDiscoverySurface(discoveryArgs),inbox:loadNotificationInboxSurface(inboxArgs)};
  assert.equal(loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore}).items.length,1);
  const deleted=new ConsumptionStore(db).clearAll();
  assert.equal(deleted,1);
  assert.deepEqual(canonicalCounts(db),canonicalBefore);
  const after={feed:buildHomeFeed(feedArgs),discovery:buildDiscoverySurface(discoveryArgs),inbox:loadNotificationInboxSurface(inboxArgs)};
  assert.deepEqual(after,before);
  assert.deepEqual(loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore}).items,[]);
});
