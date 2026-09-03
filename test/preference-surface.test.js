const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication,withdrawPublication}=require('../publication/service');
const {createPreference,withdrawPreference}=require('../preference/service');
const {loadPreferenceSurface}=require('../preference/read-service');
const {renderPreferenceJson}=require('../preference/render-json');
const {renderPreferenceHtml}=require('../preference/render-html');

function ctx(db,store,actor,extra={}){return{db,eventStore:store,principalActorId:actor,evaluatedAt:'2026-09-03T14:00:00Z',authorize:evaluateAuthority,...extra};}
function setup(){
  const db=createTestDatabase();const store=new SQLiteEventStore(db,{now:()=> '2026-09-03T14:00:01Z'});
  for(const id of ['actor:A','actor:B','actor:R']) registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore:store,authorize:evaluateAuthority});
  createPublication({command_id:'pub',idempotency_key:'pub',principal_id:'principal:actor:B',publication_id:'pub:P',author_actor_id:'actor:B',publication_type:'post',body:'hello',visibility:'public',audience_actor_ids:[]},ctx(db,store,'actor:B'));
  return{db,store};
}
function pref(id,type,target){return{command_id:`cmd:${id}`,idempotency_key:`idem:${id}`,principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:type,target};}

test('raw Preference surface is owner-only and representative is not audience',()=>{
  const {db,store}=setup();
  createPreference(pref('bookmark','bookmark_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'));
  assert.doesNotThrow(()=>loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store}));
  assert.throws(()=>loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore:store}),/PREFERENCE_NOT_AUTHORIZED/);
  assert.throws(()=>loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store}),/PREFERENCE_NOT_AUTHORIZED/);
});

test('surface returns deterministic active directive order and omits withdrawn directives',()=>{
  const {db,store}=setup();
  const mute=createPreference(pref('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  createPreference(pref('bookmark','bookmark_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'));
  createPreference(pref('ni','not_interested_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'));
  withdrawPreference({command_id:'cmd:mute-w',idempotency_key:'idem:mute-w',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:mute.preference_id,expected_version:1},ctx(db,store,'actor:A'));
  const surface=loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});
  assert.deepEqual(surface.preferences.map(p=>p.preference_type),['bookmark_publication','not_interested_publication']);
  assert.equal(surface.preferences.some(p=>Object.hasOwn(p,'visibility')),false);
});

test('bookmark projection resolves current target and hides unavailable target without erasing Preference',()=>{
  const {db,store}=setup();
  createPreference(pref('bookmark','bookmark_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'));
  let surface=loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});
  assert.deepEqual(surface.bookmarks,[{preference_id:surface.preferences[0].preference_id,publication_id:'pub:P',detail_ref:'/publications/pub%3AP'}]);
  withdrawPublication({command_id:'pub-w',idempotency_key:'pub-w',principal_id:'principal:actor:B',publication_id:'pub:P',expected_version:1},ctx(db,store,'actor:B'));
  surface=loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});
  assert.equal(surface.preferences.length,1);
  assert.deepEqual(surface.bookmarks,[]);
});

test('Preference read does not append events and HTML/JSON render the same filtered surface',()=>{
  const {db,store}=setup();
  createPreference(pref('bookmark','bookmark_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'));
  const before=db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
  const surface=loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});
  const after=db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
  assert.equal(after,before);
  assert.deepEqual(JSON.parse(renderPreferenceJson(surface)),surface);
  const html=renderPreferenceHtml(surface);
  assert.match(html,/actor:A/);assert.match(html,/bookmark_publication/);assert.match(html,/pub:P/);
});
