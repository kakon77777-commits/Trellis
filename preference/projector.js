const {foldPreference}=require('./fold');
const MATERIALIZER_VERSION='preference-current:0.1';
function upsertPreferenceStatement(state){return{sql:`
  INSERT INTO preferences_current (
    preference_id,owner_actor_id,preference_type,target_kind,target_ref,target_item_kind,lifecycle,
    created_event_id,restored_event_id,withdrawn_event_id,last_event_id,stream_version,materializer_version
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(preference_id) DO UPDATE SET
    owner_actor_id=excluded.owner_actor_id,preference_type=excluded.preference_type,target_kind=excluded.target_kind,
    target_ref=excluded.target_ref,target_item_kind=excluded.target_item_kind,lifecycle=excluded.lifecycle,
    created_event_id=excluded.created_event_id,restored_event_id=excluded.restored_event_id,
    withdrawn_event_id=excluded.withdrawn_event_id,last_event_id=excluded.last_event_id,
    stream_version=excluded.stream_version,materializer_version=excluded.materializer_version`,params:[state.preference_id,state.owner_actor_id,state.preference_type,state.target_kind,state.target_ref,state.target_item_kind??null,state.lifecycle,state.created_event_id,state.restored_event_id??null,state.withdrawn_event_id??null,state.last_event_id,state.stream_version,MATERIALIZER_VERSION]};}
async function projectPreferenceStream(sql,eventStore,preferenceId){const events=await eventStore.readStream('preference',preferenceId);if(!events.length)return null;const state=foldPreference(events);await sql.batch([upsertPreferenceStatement(state)]);return state;}
async function rebuildPreferenceProjection(sql,eventStore){const rows=await sql.all(`SELECT DISTINCT stream_id FROM canonical_events WHERE stream_type='preference' ORDER BY stream_id`);const statements=[{sql:'DELETE FROM preferences_current',params:[]}];for(const row of rows){const events=await eventStore.readStream('preference',row.stream_id);if(events.length)statements.push(upsertPreferenceStatement(foldPreference(events)));}await sql.batch(statements);}
module.exports={MATERIALIZER_VERSION,upsertPreferenceStatement,projectPreferenceStream,rebuildPreferenceProjection};
