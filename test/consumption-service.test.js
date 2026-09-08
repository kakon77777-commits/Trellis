const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication,withdrawPublication}=require('../publication/service');
const {proposeRelationship,activateRelationship}=require('../relationship/service');
const {recordSeen,recordOpened}=require('../consumption/service');
const {ConsumptionStore}=require('../consumption/store');

function actorCtx(db,eventStore,actorId,extra={}){return{db,sql:db,eventStore,authorize:evaluateAuthority,principalActorId:actorId,evaluatedAt:'2026-09-03T20:00:00.000Z',capabilityGrants:[],...extra};}
async function reg(eventStore,id){(await registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority}));}
async function pub(db,eventStore,id,author,overrides={}){return (await createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...overrides},actorCtx(db,eventStore,author)));}
function recorderGrant(){return{active:true,principal_id:'principal:surface',capability:'consumption:record',scope_ref:null};}
function recordCtx(db,eventStore,viewer,extra={}){return{db,sql:db,eventStore,recognizedViewerActorId:viewer,capabilityGrants:[recorderGrant()],now:()=> '2026-09-03T21:00:00.000Z',...extra};}
function seen(id,consumer,target){return{command_id:`consume:${id}`,principal_id:'principal:surface',requested_consumer_actor_id:consumer,target};}
function opened(id,consumer,target){return{command_id:`consume:${id}`,principal_id:'principal:surface',requested_consumer_actor_id:consumer,target};}
async function setup(){const db=createTestDatabase();const eventStore=new SQLiteEventStore(db);for(const id of ['actor:A','actor:B','actor:R'])(await reg(eventStore,id));(await pub(db,eventStore,'P','actor:B'));(await pub(db,eventStore,'Private','actor:B',{visibility:'private'}));return{db,eventStore};}

async function publicCollaboration(db,eventStore){
  const proposed=(await proposeRelationship({command_id:'collab:ab',idempotency_key:'collab:ab',principal_id:'principal:actor:A',source_entity_id:'actor:A',target_entity_id:'actor:B',relationship_type:'collaborates_with',visibility:'public'},actorCtx(db,eventStore,'actor:A')));
  const activated=(await activateRelationship({command_id:'collab:ab:activate',idempotency_key:'collab:ab:activate',principal_id:'principal:actor:B',relationship_id:proposed.relationship_id,expected_version:1},actorCtx(db,eventStore,'actor:B')));
  return{relationship_id:proposed.relationship_id,event_id:activated.receipt.result_event_ids[0]};
}

test('trusted recorder records seen only for the Authority-recognized actual viewer using server time',async ()=>{
  const{db,eventStore}=(await setup());
  const result=(await recordSeen(seen('seen-a','actor:A',{publication_id:'pub:P'}),recordCtx(db,eventStore,'actor:A')));
  assert.equal(result.consumer_actor_id,'actor:A');
  assert.equal(result.target_kind,'publication');
  assert.equal(result.target_ref,'pub:P');
  assert.equal(result.first_seen_at,'2026-09-03T21:00:00.000Z');
  assert.equal((await new ConsumptionStore(db).get('actor:A','publication','pub:P')).first_seen_at,'2026-09-03T21:00:00.000Z');
});

test('recorder capability cannot spoof the consumer when recognized viewer is another Actor',async ()=>{
  const{db,eventStore}=(await setup());
  await assert.rejects(async ()=>(await recordSeen(seen('spoof','actor:A',{publication_id:'pub:P'}),recordCtx(db,eventStore,'actor:B'))),e=>e&&e.code==='POLICY_DENIED');
  assert.equal(await new ConsumptionStore(db).get('actor:A','publication','pub:P'),null);
});

test('recognized viewer still needs explicit consumption:record recorder capability',async ()=>{
  const{db,eventStore}=(await setup());
  await assert.rejects(async ()=>(await recordSeen(seen('no-cap','actor:A',{publication_id:'pub:P'}),recordCtx(db,eventStore,'actor:A',{capabilityGrants:[]}))),e=>e&&e.code==='POLICY_DENIED');
});

test('client-supplied observation timestamps are rejected',async ()=>{
  const{db,eventStore}=(await setup());
  const command={...seen('time-spoof','actor:A',{publication_id:'pub:P'}),occurred_at:'1999-01-01T00:00:00Z'};
  await assert.rejects(async ()=>(await recordSeen(command,recordCtx(db,eventStore,'actor:A'))),/CONSUMPTION_CLIENT_TIME_FORBIDDEN/);
});

test('currently unreadable or withdrawn Publication cannot be recorded',async ()=>{
  const{db,eventStore}=(await setup());
  await assert.rejects(async ()=>(await recordSeen(seen('private','actor:A',{publication_id:'pub:Private'}),recordCtx(db,eventStore,'actor:A'))),e=>e&&e.code==='INVALID_TRANSITION'&&/CONSUMPTION_TARGET_NOT_READABLE/.test(e.message));
  (await withdrawPublication({command_id:'withdraw:P',idempotency_key:'withdraw:P',principal_id:'principal:actor:B',publication_id:'pub:P',expected_version:1},actorCtx(db,eventStore,'actor:B')));
  await assert.rejects(async ()=>(await recordSeen(seen('withdrawn','actor:A',{publication_id:'pub:P'}),recordCtx(db,eventStore,'actor:A'))),e=>e&&e.code==='INVALID_TRANSITION'&&/CONSUMPTION_TARGET_NOT_ACTIVE/.test(e.message));
});

test('current disclosure policy may make an otherwise public Publication unrecordable',async ()=>{
  const{db,eventStore}=(await setup());
  const disclosurePolicy=value=>value.publication_id==='pub:P'?'deny':'allow';
  await assert.rejects(async ()=>(await recordSeen(seen('policy-hidden','actor:A',{publication_id:'pub:P'}),recordCtx(db,eventStore,'actor:A',{disclosurePolicy}))),e=>e&&e.code==='INVALID_TRANSITION'&&/CONSUMPTION_TARGET_NOT_READABLE/.test(e.message));
});

test('visible allowlisted social activity may be seen, but hidden activity and opened activity are denied',async ()=>{
  const{db,eventStore}=(await setup());const activity=(await publicCollaboration(db,eventStore));
  const ok=(await recordSeen(seen('activity','actor:A',{social_activity_event_id:activity.event_id}),recordCtx(db,eventStore,'actor:A')));
  assert.equal(ok.target_kind,'social_activity');
  assert.equal(ok.target_ref,activity.event_id);
  const disclosurePolicy=value=>value.relationship_id===activity.relationship_id?'deny':'allow';
  await assert.rejects(async ()=>(await recordSeen(seen('activity-hidden','actor:A',{social_activity_event_id:activity.event_id}),recordCtx(db,eventStore,'actor:A',{disclosurePolicy}))),e=>e&&e.code==='INVALID_TRANSITION'&&/CONSUMPTION_TARGET_NOT_READABLE/.test(e.message));
  await assert.rejects(async ()=>(await recordOpened(opened('activity-open','actor:A',{social_activity_event_id:activity.event_id}),recordCtx(db,eventStore,'actor:A'))),/CONSUMPTION_OPENED_TARGET_INVALID/);
});

test('nonexistent target is denied without creating operational state',async ()=>{
  const{db,eventStore}=(await setup());
  await assert.rejects(async ()=>(await recordSeen(seen('missing','actor:A',{publication_id:'pub:missing'}),recordCtx(db,eventStore,'actor:A'))),e=>e&&e.code==='INVALID_TRANSITION'&&/CONSUMPTION_TARGET_NOT_FOUND/.test(e.message));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n,0);
});
