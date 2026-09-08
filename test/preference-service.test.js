const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication,withdrawPublication}=require('../publication/service');
const {proposeRelationship,activateRelationship}=require('../relationship/service');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {derivePreferenceId}=require('../preference/types');
const {createPreference,withdrawPreference,restorePreference}=require('../preference/service');

function ctx(db,eventStore,actor,extra={}){return{db,sql:db,eventStore,principalActorId:actor,evaluatedAt:'2026-09-03T13:00:00Z',authorize:evaluateAuthority,...extra};}
async function register(store,id){(await registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore:store,authorize:evaluateAuthority}));}
async function pub(store,db,id='pub:P',author='actor:B'){
  (await createPublication({command_id:`create:${id}`,idempotency_key:`create:${id}`,principal_id:`principal:${author}`,publication_id:id,author_actor_id:author,publication_type:'post',body:'hello',visibility:'public',audience_actor_ids:[]},ctx(db,store,author)));
}
function command(id,type,target,owner='actor:A',extra={}){return{command_id:`cmd:${id}`,idempotency_key:`idem:${id}`,principal_id:`principal:${owner}`,owner_actor_id:owner,preference_type:type,target,...extra};}
async function setup(){const db=createTestDatabase();const store=new SQLiteEventStore(db,{now:()=> '2026-09-03T13:00:01Z'});(await register(store,'actor:A'));(await register(store,'actor:B'));(await register(store,'actor:R'));(await pub(store,db));return{db,store};}

test('owner creates deterministic preference and successful retry deduplicates before lifecycle preflight',async ()=>{
  const {db,store}=(await setup());
  const c=command('bookmark','bookmark_publication',{publication_id:'pub:P'});
  const first=(await createPreference(c,ctx(db,store,'actor:A')));
  const second=(await createPreference(c,ctx(db,store,'actor:A')));
  assert.equal(first.preference_id,derivePreferenceId('actor:A','bookmark_publication',{publication_id:'pub:P'}));
  assert.equal(second.receipt.deduplicated,true);
  assert.equal(store.readStream('preference',first.preference_id).length,1);
  await assert.rejects(async ()=>(await createPreference(command('bookmark-2','bookmark_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'))),/PREFERENCE_ALREADY_EXISTS/);
});

test('representative/read-as state does not grant Preference mutation authority',async ()=>{
  const {db,store}=(await setup());
  const c=command('mute','mute_actor',{actor_id:'actor:B'});
  await assert.rejects(async ()=>(await createPreference(c,ctx(db,store,'actor:R',{represents_actor_ids:['actor:A']}))),error=>error&&error.code==='POLICY_DENIED');
  const created=(await createPreference(c,ctx(db,store,'actor:A')));
  await assert.rejects(async ()=>(await withdrawPreference({command_id:'cmd:wd-bad',idempotency_key:'idem:wd-bad',principal_id:'principal:actor:R',owner_actor_id:'actor:A',preference_id:created.preference_id,expected_version:1},ctx(db,store,'actor:R',{represents_actor_ids:['actor:A']}))),error=>error&&error.code==='POLICY_DENIED');
});

test('publication preferences require active owner-readable publication and restore revalidates readability',async ()=>{
  const {db,store}=(await setup());
  await assert.rejects(async ()=>(await createPreference(command('missing','bookmark_publication',{publication_id:'pub:missing'}),ctx(db,store,'actor:A'))),/PREFERENCE_TARGET_NOT_FOUND/);
  const made=(await createPreference(command('ni','not_interested_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A')));
  (await withdrawPreference({command_id:'cmd:ni-w',idempotency_key:'idem:ni-w',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:made.preference_id,expected_version:1},ctx(db,store,'actor:A')));
  await assert.rejects(async ()=>(await restorePreference({command_id:'cmd:ni-r',idempotency_key:'idem:ni-r',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:made.preference_id,expected_version:2},ctx(db,store,'actor:A',{disclosurePolicy:()=> 'deny'}))),/PREFERENCE_TARGET_NOT_READABLE/);
});

test('withdraw remains available after target publication is withdrawn',async ()=>{
  const {db,store}=(await setup());
  const made=(await createPreference(command('bookmark-live','bookmark_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A')));
  (await withdrawPublication({command_id:'withdraw:pub',idempotency_key:'withdraw:pub',principal_id:'principal:actor:B',publication_id:'pub:P',expected_version:1},ctx(db,store,'actor:B')));
  const result=(await withdrawPreference({command_id:'cmd:pref-w',idempotency_key:'idem:pref-w',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:made.preference_id,expected_version:1},ctx(db,store,'actor:A')));
  assert.equal(result.receipt.status,'accepted');
});

test('mute target must be an active Actor entity',async ()=>{
  const {db,store}=(await setup());
  await assert.rejects(async ()=>(await createPreference(command('mute-missing','mute_actor',{actor_id:'actor:missing'}),ctx(db,store,'actor:A'))),/PREFERENCE_TARGET_ACTOR_NOT_ACTIVE/);
  await assert.doesNotReject(async()=>{ await createPreference(command('mute-b','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A')); });
});

test('dismiss publication target must be active readable root publication',async ()=>{
  const {db,store}=(await setup());
  await assert.doesNotReject(async()=>{ await createPreference(command('dismiss-p','dismiss_feed_item',{item_kind:'publication',source_ref:'pub:P'}),ctx(db,store,'actor:A')); });
  (await createPublication({command_id:'create:reply',idempotency_key:'create:reply',principal_id:'principal:actor:A',publication_id:'pub:R',author_actor_id:'actor:A',publication_type:'post',body:'reply',visibility:'public',audience_actor_ids:[],reply_to_ref:'pub:P'},ctx(db,store,'actor:A')));
  await assert.rejects(async ()=>(await createPreference(command('dismiss-reply','dismiss_feed_item',{item_kind:'publication',source_ref:'pub:R'}),ctx(db,store,'actor:A'))),/PREFERENCE_FEED_ITEM_NOT_ROOT/);
});

test('dismiss social activity requires allowlisted activated relationship event readable by owner',async ()=>{
  const {db,store}=(await setup());
  const rel=(await proposeRelationship({command_id:'collab:ab',idempotency_key:'collab:ab',principal_id:'principal:actor:A',source_entity_id:'actor:A',target_entity_id:'actor:B',relationship_type:'collaborates_with',visibility:'public'},ctx(db,store,'actor:A'))).relationship_id;
  (await activateRelationship({command_id:'collab:ab:activate',idempotency_key:'collab:ab:activate',principal_id:'principal:actor:B',relationship_id:rel,expected_version:1},ctx(db,store,'actor:B')));
  (await rebuildRelationshipProjection(db,store));
  const activation=store.readStream('relationship',rel).find(e=>e.event_type==='relationship.activated');
  await assert.doesNotReject(async()=>{ await createPreference(command('dismiss-a','dismiss_feed_item',{item_kind:'social_activity',source_ref:activation.event_id}),ctx(db,store,'actor:A')); });
  const proposal=store.readStream('relationship',rel).find(e=>e.event_type==='relationship.proposed');
  await assert.rejects(async ()=>(await createPreference(command('dismiss-proposal','dismiss_feed_item',{item_kind:'social_activity',source_ref:proposal.event_id}),ctx(db,store,'actor:A'))),/PREFERENCE_FEED_ACTIVITY_INVALID/);
});

test('commands forbid audience and visibility override fields',async ()=>{
  const {db,store}=(await setup());
  for(const [field,value] of [['visibility','public'],['scope_ref','community:C'],['audience_actor_ids',['actor:A']]]){
    await assert.rejects(async ()=>(await createPreference({...command(`override-${field}`,'bookmark_publication',{publication_id:'pub:P'}),[field]:value},ctx(db,store,'actor:A'))),/PREFERENCE_AUDIENCE_OVERRIDE_FORBIDDEN/);
  }
});
