const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {proposeRelationship}=require('../relationship/service');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {createPublication,withdrawPublication}=require('../publication/service');
const {projectPublicationStream,rebuildPublicationProjection}=require('../publication/projector');
const {loadPublicationSurface}=require('../publication/read-service');
const {buildHomeFeed}=require('../feed/home');
const {buildDiscoverySurface}=require('../discovery/read-service');
const {createPreference}=require('../preference/service');
const {loadPreferenceSurface}=require('../preference/read-service');
const {recordSeen,recordOpened}=require('../consumption/service');
const {ConsumptionStore}=require('../consumption/store');
const {loadConsumptionSurface}=require('../consumption/read-service');
const {CONTRACT_REGISTRY,effectiveContracts}=require('../foundation/cross-domain-contract');

function ctx(db,eventStore,actorId,extra={}){return{db,eventStore,authorize:evaluateAuthority,principalActorId:actorId,evaluatedAt:'2026-09-03T23:00:00.000Z',capabilityGrants:[],...extra};}
function reg(eventStore,id){registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority});}
function follow(db,eventStore,a,b){proposeRelationship({command_id:'follow:a-b',idempotency_key:'follow:a-b',principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'follows',visibility:'public'},ctx(db,eventStore,a));rebuildRelationshipProjection(db,eventStore);}
function pub(db,eventStore,id,author){createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[]},ctx(db,eventStore,author));projectPublicationStream(db,eventStore,`pub:${id}`);}
function setup(){const db=createTestDatabase();const eventStore=new SQLiteEventStore(db);for(const id of ['actor:A','actor:B','actor:R'])reg(eventStore,id);follow(db,eventStore,'actor:A','actor:B');pub(db,eventStore,'P','actor:B');rebuildPublicationProjection(db,eventStore);return{db,eventStore};}
function grant(){return{active:true,principal_id:'principal:surface',capability:'consumption:record',scope_ref:null};}
function rctx(db,eventStore,viewer,extra={}){return{db,eventStore,recognizedViewerActorId:viewer,capabilityGrants:[grant()],now:()=> '2026-09-03T23:30:00.000Z',...extra};}
function seen(id,consumer){return{command_id:`consume:${id}`,principal_id:'principal:surface',requested_consumer_actor_id:consumer,target:{publication_id:'pub:P'}};}
function pref(){return{command_id:'pref:ni',idempotency_key:'pref:ni',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:'not_interested_publication',target:{publication_id:'pub:P'}};}
function canonicalSnapshot(db){return db.prepare('SELECT global_offset,event_id,stream_type,stream_id,event_type,event_hash FROM canonical_events ORDER BY global_offset').all();}

test('FR1-FR6 classify all current domains and preserve every pre-Consumption effective contract',()=>{
  const expected={profile:'derived_projection',relationship_surface:'derived_projection',community:'canonical',discovery:'derived_projection',publication:'canonical',feed:'derived_projection',reaction:'canonical',notification:'canonical',preference:'canonical',consumption:'operational'};
  for(const [domain,stateClass] of Object.entries(expected)){
    const entry=CONTRACT_REGISTRY[domain];assert.ok(entry,domain);assert.equal(entry.state_class,stateClass,domain);
    assert.ok(Array.isArray(entry.canonical_contracts));assert.ok(Array.isArray(entry.derived_contracts));assert.ok(Array.isArray(entry.operational_contracts));
    if(domain!=='consumption') assert.deepEqual(effectiveContracts(domain),['X1','X2','X3'],domain);
    if(stateClass==='canonical') assert.ok(entry.canonical_contracts.includes('X1'),domain);
  }
  assert.deepEqual(effectiveContracts('consumption'),['X2','X3']);
  assert.deepEqual(CONTRACT_REGISTRY.consumption.canonical_contracts,[]);
  assert.deepEqual(CONTRACT_REGISTRY.consumption.derived_contracts,[]);
});

test('K1-K3 Consumption is singleton-owner private and binds actual viewer rather than represented Feed subject',()=>{
  const{db,eventStore}=setup();
  recordSeen(seen('actual','actor:R'),rctx(db,eventStore,'actor:R'));
  assert.ok(new ConsumptionStore(db).get('actor:R','publication','pub:P'));
  assert.equal(new ConsumptionStore(db).get('actor:A','publication','pub:P'),null);
  assert.throws(()=>loadConsumptionSurface({consumerActorId:'actor:R',viewerContext:{viewer_actor_id:'actor:A',represents_actor_ids:['actor:R']},db,eventStore}),/CONSUMPTION_NOT_AUTHORIZED/);
  assert.throws(()=>recordSeen(seen('spoof','actor:A'),rctx(db,eventStore,'actor:R')),e=>e&&e.code==='POLICY_DENIED');
});

test('K4-K6 fetches do not record and only currently readable targets may be recorded',()=>{
  const{db,eventStore}=setup();
  buildHomeFeed({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  loadPublicationSurface({publicationId:'pub:P',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n,0);
  const disclosurePolicy=value=>value.publication_id==='pub:P'?'deny':'allow';
  assert.throws(()=>recordSeen(seen('hidden','actor:A'),rctx(db,eventStore,'actor:A',{disclosurePolicy})),e=>e&&e.code==='INVALID_TRANSITION');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n,0);
});

test('K7-K8-K12 Consumption is non-canonical disposable state and deletion cannot rewrite social history',()=>{
  const{db,eventStore}=setup();const before=canonicalSnapshot(db);
  recordSeen(seen('operational','actor:A'),rctx(db,eventStore,'actor:A'));
  recordOpened({command_id:'consume:opened',principal_id:'principal:surface',requested_consumer_actor_id:'actor:A',target:{publication_id:'pub:P'}},rctx(db,eventStore,'actor:A'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='consumption'").get().n,0);
  assert.deepEqual(canonicalSnapshot(db),before);
  new ConsumptionStore(db).clearAll();
  assert.deepEqual(canonicalSnapshot(db),before);
});

test('K9-K10-K11-K13 seen/opened are weak non-endorsement signals and explicit Preference remains dominant',()=>{
  const{db,eventStore}=setup();
  createPreference(pref(),ctx(db,eventStore,'actor:A'));
  const feedArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const discoveryArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore};
  const preferenceBefore=loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  const before={feed:buildHomeFeed(feedArgs),discovery:buildDiscoverySurface(discoveryArgs)};
  assert.equal(before.feed.items.some(i=>i.source_ref==='pub:P'),false);
  recordOpened({command_id:'consume:weak',principal_id:'principal:surface',requested_consumer_actor_id:'actor:A',target:{publication_id:'pub:P'}},rctx(db,eventStore,'actor:A'));
  assert.deepEqual({feed:buildHomeFeed(feedArgs),discovery:buildDiscoverySurface(discoveryArgs)},before);
  assert.deepEqual(loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore}),preferenceBefore);
  assert.equal(eventStore.readStream('reaction','reaction:any').length,0);
  const disclosurePolicy=value=>value.publication_id==='pub:P'?'deny':'allow';
  assert.deepEqual(loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,disclosurePolicy}).items,[]);
});

test('release syntax gate explicitly checks consumption modules',()=>{
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  assert.match(pkg.scripts.check,/consumption\/\*\.js/);
});
