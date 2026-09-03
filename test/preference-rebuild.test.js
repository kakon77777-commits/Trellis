const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {canonicalStringify}=require('../core/canonical-json');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {createAuthorityReceipt}=require('../authority/receipts');
const {derivePreferenceId,PREFERENCE_POLICY_REF,normalizePreferenceTarget}=require('../preference/types');
const {projectPreferenceStream,rebuildPreferenceProjection}=require('../preference/projector');

function digest(value){return createHash('sha256').update(canonicalStringify(value)).digest('hex');}
function draft(id,event_type,payload){return{event_id:`evt:${id}`,schema_version:'0.1',event_type,actor_id:'actor:A',principal_id:'principal:A',causation_id:id,correlation_id:id,occurred_at:'2026-09-03T12:00:00Z',recorded_at:'forged',time_source:'system',provenance_refs:[],payload};}
function append(store,pid,seq,id,event_type,payload){
  const command={id,event_type,payload};
  const receipt=createAuthorityReceipt({command_id:id,principal_id:'principal:A',actor_id:'actor:A',requested_action:event_type,aggregate_id:pid,evaluated_at:'2026-09-03T12:00:00Z'},'allow',PREFERENCE_POLICY_REF);
  store.append({streamType:'preference',streamId:pid,expectedVersion:seq-1,events:[draft(id,event_type,payload)],authorityReceipt:receipt,commandReceipt:{command_id:id,idempotency_key:`idem:${id}`,command_digest:digest(command),status:'accepted',created_at:'2026-09-03T12:00:00Z'}});
}

test('Preference projection can be destroyed and rebuilt exactly from canonical history',()=>{
  const db=createTestDatabase();
  const store=new SQLiteEventStore(db,{now:()=> '2026-09-03T12:00:01Z'});
  const target={actor_id:'actor:B'};
  const pid=derivePreferenceId('actor:A','mute_actor',target);
  const normalized=normalizePreferenceTarget('mute_actor',target);
  append(store,pid,1,'pref:1','preference.created',{preference_id:pid,owner_actor_id:'actor:A',preference_type:'mute_actor',...normalized,preference_policy_ref:PREFERENCE_POLICY_REF});
  append(store,pid,2,'pref:2','preference.withdrawn',{reason:'owner_withdrawn'});
  append(store,pid,3,'pref:3','preference.restored',{});
  projectPreferenceStream(db,store,pid);
  const before=db.prepare('SELECT * FROM preferences_current ORDER BY preference_id').all();
  assert.equal(before.length,1);
  assert.equal(before[0].preference_id,pid);
  assert.equal(before[0].lifecycle,'active');
  assert.equal(before[0].stream_version,3);
  db.exec('DELETE FROM preferences_current');
  assert.deepEqual(db.prepare('SELECT * FROM preferences_current').all(),[]);
  rebuildPreferenceProjection(db,store);
  assert.deepEqual(db.prepare('SELECT * FROM preferences_current ORDER BY preference_id').all(),before);
});
