const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication,withdrawPublication}=require('../publication/service');
const {createCommunity}=require('../community/service');
const {requestMembership,approveMembership,leaveCommunity}=require('../community/membership');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {recordSeen}=require('../consumption/service');
const {ConsumptionStore}=require('../consumption/store');
const {loadConsumptionSurface,purgeExpiredConsumption}=require('../consumption/read-service');

function ctx(db,eventStore,actorId,extra={}){return{db,sql:db,eventStore,authorize:evaluateAuthority,principalActorId:actorId,evaluatedAt:'2026-09-03T20:00:00.000Z',capabilityGrants:[],...extra};}
async function reg(eventStore,id){(await registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority}));}
function recorderGrant(){return{active:true,principal_id:'principal:surface',capability:'consumption:record',scope_ref:null};}
function recordCtx(db,eventStore,viewer,extra={}){return{db,sql:db,eventStore,recognizedViewerActorId:viewer,capabilityGrants:[recorderGrant()],now:()=> '2026-09-03T21:00:00.000Z',...extra};}
function seen(id,consumer,publicationId){return{command_id:`consume:${id}`,principal_id:'principal:surface',requested_consumer_actor_id:consumer,target:{publication_id:publicationId}};}
async function pub(db,eventStore,id,author,overrides={},extra={}){(await createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...overrides},ctx(db,eventStore,author,extra)));}
async function setup(){const db=createTestDatabase();const eventStore=new SQLiteEventStore(db);for(const id of ['actor:A','actor:B','actor:R'])(await reg(eventStore,id));(await pub(db,eventStore,'P','actor:B'));return{db,eventStore};}
async function join(db,eventStore,actorId,communityId,suffix){const r=(await requestMembership({command_id:`join:${suffix}`,idempotency_key:`join:${suffix}`,principal_id:`principal:${actorId}`,actor_id:actorId,community_id:communityId},ctx(db,eventStore,actorId)));(await approveMembership({command_id:`approve:${suffix}`,idempotency_key:`approve:${suffix}`,principal_id:`principal:${communityId}`,community_id:communityId,relationship_id:r.relationship_id,expected_version:1},ctx(db,eventStore,communityId)));return r.relationship_id;}

test('Consumption surface is owner-only and representative read authority does not include Consumption',async ()=>{
  const{db,eventStore}=(await setup());(await recordSeen(seen('owner','actor:A','pub:P'),recordCtx(db,eventStore,'actor:A')));
  const surface=(await loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore}));
  assert.equal(surface.consumer_actor_id,'actor:A');
  assert.equal(surface.items.length,1);
  assert.equal(surface.items[0].target_ref,'pub:P');
  await assert.rejects(async()=>(await loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore})),/CONSUMPTION_NOT_AUTHORIZED/);
  await assert.rejects(async()=>(await loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore})),/CONSUMPTION_NOT_AUTHORIZED/);
});

test('withdrawn target row remains stored but is omitted from normal Consumption surface',async ()=>{
  const{db,eventStore}=(await setup());(await recordSeen(seen('withdraw','actor:A','pub:P'),recordCtx(db,eventStore,'actor:A')));
  (await withdrawPublication({command_id:'withdraw:P',idempotency_key:'withdraw:P',principal_id:'principal:actor:B',publication_id:'pub:P',expected_version:1},ctx(db,eventStore,'actor:B')));
  assert.ok(await new ConsumptionStore(db).get('actor:A','publication','pub:P'));
  const surface=(await loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore}));
  assert.deepEqual(surface.items,[]);
});

test('current disclosure policy hidden target row remains stored but is omitted',async ()=>{
  const{db,eventStore}=(await setup());(await recordSeen(seen('policy','actor:A','pub:P'),recordCtx(db,eventStore,'actor:A')));
  const disclosurePolicy=value=>value.publication_id==='pub:P'?'deny':'allow';
  const surface=(await loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,disclosurePolicy}));
  assert.deepEqual(surface.items,[]);
  assert.ok(await new ConsumptionStore(db).get('actor:A','publication','pub:P'));
});

test('membership loss hides retained scoped Publication Consumption without deleting the row',async ()=>{
  const db=createTestDatabase();const eventStore=new SQLiteEventStore(db);for(const id of ['actor:A','actor:B'])(await reg(eventStore,id));
  (await createCommunity({command_id:'community:C',idempotency_key:'community:C',principal_id:'principal:community:C',community_id:'community:C'},{eventStore,authorize:evaluateAuthority}));
  const aMembership=(await join(db,eventStore,'actor:A','community:C','a-c'));(await join(db,eventStore,'actor:B','community:C','b-c'));
  (await rebuildRelationshipProjection(db,eventStore));
  const grant={active:true,principal_id:'principal:actor:B',capability:'publication:create',scope_ref:'community:C'};
  (await pub(db,eventStore,'Scoped','actor:B',{scope_ref:'community:C',visibility:'scope_members'},{capabilityGrants:[grant]}));
  (await recordSeen(seen('scoped','actor:A','pub:Scoped'),recordCtx(db,eventStore,'actor:A')));
  (await leaveCommunity({command_id:'leave:a-c',idempotency_key:'leave:a-c',principal_id:'principal:actor:A',community_id:'community:C',relationship_id:aMembership,actor_id:'actor:A',expected_version:2},ctx(db,eventStore,'actor:A')));
  (await rebuildRelationshipProjection(db,eventStore));
  assert.ok(await new ConsumptionStore(db).get('actor:A','publication','pub:Scoped'));
  const surface=(await loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore}));
  assert.deepEqual(surface.items,[]);
});

test('retention purge removes only expired operational rows and leaves canonical history counts unchanged',async ()=>{
  const{db,eventStore}=(await setup());const store=new ConsumptionStore(db);
  await store.recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:old',now:'2026-01-01T00:00:00.000Z'});
  const before=db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
  const deleted=await purgeExpiredConsumption({db,now:'2026-09-03T00:00:00.000Z'});
  const after=db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
  assert.equal(deleted,1);
  assert.equal(before,after);
  assert.equal(await store.get('actor:A','publication','pub:old'),null);
});
