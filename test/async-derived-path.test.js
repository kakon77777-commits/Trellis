const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteAsyncAdapter}=require('../storage/sqlite-adapter');
const {AsyncSqlEventStore}=require('../events/async-sql-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {setDisplayName}=require('../profile/product-commands');
const {projectActorProfile}=require('../profile/projector');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {proposeRelationship}=require('../relationship/service');
const {projectRelationshipStream}=require('../projections/relationship-projector');
const {loadPublicFeed}=require('../feed/public');
const {buildDiscoverySurface}=require('../discovery/read-service');
const {processSourceEvent}=require('../notification/service');
const {loadNotificationInboxSurface}=require('../notification/read-service');

function setup(){
  const raw=createTestDatabase();
  const sql=new SQLiteAsyncAdapter(raw);
  let tick=0;
  const eventStore=new AsyncSqlEventStore(sql,{now:()=>`2026-09-08T02:00:${String(tick++).padStart(2,'0')}.000Z`,token:()=>`task3-token-${tick}`});
  return{raw,sql,eventStore};
}
function ctx(system,actorId,extra={}){return{db:system.sql,sql:system.sql,eventStore:system.eventStore,authorize:evaluateAuthority,principalActorId:actorId,capabilityGrants:[],evaluatedAt:'2026-09-08T02:00:00.000Z',...extra};}
async function register(system,actorId,name){
  await registerActor({command_id:`reg:${actorId}`,idempotency_key:`reg:${actorId}`,principal_id:`principal:${actorId}`,entity_id:actorId},{eventStore:system.eventStore,authorize:evaluateAuthority});
  await setDisplayName({command_id:`name:${actorId}`,idempotency_key:`name:${actorId}`,principal_id:`principal:${actorId}`,actor_id:actorId,value:name,visibility:'public'},ctx(system,actorId));
  await projectActorProfile(system.sql,system.eventStore,actorId);
}
async function publicPost(system,id,author,extra={}){
  await createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...extra},ctx(system,author));
  await projectPublicationStream(system.sql,system.eventStore,`pub:${id}`);
}

test('public Feed derived path is Promise-only over AsyncSqlPort',async()=>{
  const system=setup(); await register(system,'actor:A','Alpha'); await publicPost(system,'P','actor:A');
  const promise=loadPublicFeed({db:system.sql,eventStore:system.eventStore,limit:20});
  assert.equal(typeof promise?.then,'function');
  const feed=await promise;
  assert.equal(feed.items.some(item=>item.source_ref==='pub:P'),true);
});

test('Discovery derived path is Promise-only over AsyncSqlPort',async()=>{
  const system=setup(); await register(system,'actor:A','Alpha'); await register(system,'actor:B','Beta'); await register(system,'actor:C','Gamma');
  const ab=await proposeRelationship({command_id:'rel:A-B',idempotency_key:'rel:A-B',principal_id:'principal:actor:A',source_entity_id:'actor:A',target_entity_id:'actor:B',relationship_type:'follows',visibility:'public'},ctx(system,'actor:A'));
  const bc=await proposeRelationship({command_id:'rel:B-C',idempotency_key:'rel:B-C',principal_id:'principal:actor:B',source_entity_id:'actor:B',target_entity_id:'actor:C',relationship_type:'follows',visibility:'public'},ctx(system,'actor:B'));
  await projectRelationshipStream(system.sql,system.eventStore,ab.relationship_id);
  await projectRelationshipStream(system.sql,system.eventStore,bc.relationship_id);
  const promise=buildDiscoverySurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db:system.sql,eventStore:system.eventStore});
  assert.equal(typeof promise?.then,'function');
  const surface=await promise;
  assert.equal(surface.actor_discovery.candidates.some(item=>item.actor_id==='actor:C'),true);
});

test('Notification inbox derived path is Promise-only over AsyncSqlPort',async()=>{
  const system=setup(); await register(system,'actor:A','Alpha'); await register(system,'actor:B','Beta');
  await publicPost(system,'Parent','actor:A');
  await publicPost(system,'Reply','actor:B',{reply_to_ref:'pub:Parent'});
  const events=await system.eventStore.readStream('publication','pub:Reply');
  const created=events.find(event=>event.event_type==='publication.created');
  const issued=await processSourceEvent({eventId:created.event_id,commandId:'notify:reply',idempotencyKey:'notify:reply'},ctx(system,'actor:B',{
    principalId:'principal:notification-processor',
    capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}]
  }));
  assert.equal(issued.issued,true);
  const promise=loadNotificationInboxSurface({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db:system.sql,eventStore:system.eventStore});
  assert.equal(typeof promise?.then,'function');
  const inbox=await promise;
  assert.equal(inbox.items.length,1);
  assert.equal(inbox.items[0].notification_type,'reply_to_your_publication');
});
