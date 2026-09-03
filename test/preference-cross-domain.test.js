const test=require('node:test');
const assert=require('node:assert/strict');
const {INHERITORS}=require('../foundation/cross-domain-contract');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {proposeRelationship}=require('../relationship/service');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {buildHomeFeed}=require('../feed/home');
const {buildDiscoverySurface}=require('../discovery/read-service');
const {createPreference}=require('../preference/service');
const {loadPreferenceSurface}=require('../preference/read-service');

function ctx(db,store,a,extra={}){return{db,eventStore:store,authorize:evaluateAuthority,principalActorId:a,evaluatedAt:'2026-09-03T17:00:00Z',...extra};}
function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function setup(){
  const db=createTestDatabase();const store=new SQLiteEventStore(db);for(const a of ['actor:A','actor:B','actor:R'])reg(store,a);
  proposeRelationship({command_id:'follow',idempotency_key:'follow',principal_id:'principal:actor:A',source_entity_id:'actor:A',target_entity_id:'actor:B',relationship_type:'follows',visibility:'public'},ctx(db,store,'actor:A'));rebuildRelationshipProjection(db,store);
  createPublication({command_id:'pub',idempotency_key:'pub',principal_id:'principal:actor:B',publication_id:'pub:P',author_actor_id:'actor:B',publication_type:'post',body:'p',visibility:'public',audience_actor_ids:[]},ctx(db,store,'actor:B'));projectPublicationStream(db,store,'pub:P');
  return{db,store};
}
function command(id,type,target){return{command_id:`pref:${id}`,idempotency_key:`pref:${id}`,principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:type,target};}

test('Preference declares Foundation X1 X2 X3 inheritance',()=>{
  assert.deepEqual(INHERITORS.preference,['X1','X2','X3']);
});

test('X1 owner-only Preference surface exposes no raw Preference to non-owner or representative',()=>{
  const {db,store}=setup();createPreference(command('bookmark','bookmark_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'));
  assert.throws(()=>loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store}),/PREFERENCE_NOT_AUTHORIZED/);
  assert.throws(()=>loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore:store}),/PREFERENCE_NOT_AUTHORIZED/);
});

test('X2 representative read-as state cannot mutate owner Preference',()=>{
  const {db,store}=setup();
  assert.throws(()=>createPreference(command('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:R',{represents_actor_ids:['actor:A']})),e=>e&&e.code==='POLICY_DENIED');
});

test('Preference-only mutation leaves Discovery identical and bookmark leaves chronological Feed identical',()=>{
  const {db,store}=setup();
  const discoveryArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store};
  const feedArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store};
  const d0=buildDiscoverySurface(discoveryArgs);const f0=buildHomeFeed(feedArgs);
  createPreference(command('bookmark','bookmark_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'));
  assert.deepEqual(buildDiscoverySurface(discoveryArgs),d0);
  assert.deepEqual(buildHomeFeed(feedArgs),f0);
});

test('Preference command changes only preference canonical history, not source-domain histories',()=>{
  const {db,store}=setup();
  const before=Object.fromEntries(db.prepare(`SELECT stream_type,COUNT(*) AS n FROM canonical_events GROUP BY stream_type ORDER BY stream_type`).all().map(r=>[r.stream_type,r.n]));
  createPreference(command('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  const after=Object.fromEntries(db.prepare(`SELECT stream_type,COUNT(*) AS n FROM canonical_events GROUP BY stream_type ORDER BY stream_type`).all().map(r=>[r.stream_type,r.n]));
  for(const [type,count] of Object.entries(before)) assert.equal(after[type],count,`source history changed: ${type}`);
  assert.equal(after.preference,1);
});
