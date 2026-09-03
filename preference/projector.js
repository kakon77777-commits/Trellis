const {foldPreference}=require('./fold');
const MATERIALIZER_VERSION='preference-current:0.1';
function upsertPreferenceState(db,state){
  db.prepare(`
    INSERT INTO preferences_current (
      preference_id,owner_actor_id,preference_type,target_kind,target_ref,target_item_kind,lifecycle,
      created_event_id,restored_event_id,withdrawn_event_id,last_event_id,stream_version,materializer_version
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(preference_id) DO UPDATE SET
      owner_actor_id=excluded.owner_actor_id,preference_type=excluded.preference_type,target_kind=excluded.target_kind,
      target_ref=excluded.target_ref,target_item_kind=excluded.target_item_kind,lifecycle=excluded.lifecycle,
      created_event_id=excluded.created_event_id,restored_event_id=excluded.restored_event_id,
      withdrawn_event_id=excluded.withdrawn_event_id,last_event_id=excluded.last_event_id,
      stream_version=excluded.stream_version,materializer_version=excluded.materializer_version
  `).run(state.preference_id,state.owner_actor_id,state.preference_type,state.target_kind,state.target_ref,state.target_item_kind??null,state.lifecycle,state.created_event_id,state.restored_event_id??null,state.withdrawn_event_id??null,state.last_event_id,state.stream_version,MATERIALIZER_VERSION);
}
function projectPreferenceStream(db,eventStore,preferenceId){
  const events=eventStore.readStream('preference',preferenceId); if(!events.length) return null;
  const state=foldPreference(events); upsertPreferenceState(db,state); return state;
}
function rebuildPreferenceProjection(db,eventStore){
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec('DELETE FROM preferences_current');
    const rows=db.prepare(`SELECT DISTINCT stream_id FROM canonical_events WHERE stream_type='preference' ORDER BY stream_id`).all();
    for(const row of rows) projectPreferenceStream(db,eventStore,row.stream_id);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={MATERIALIZER_VERSION,projectPreferenceStream,rebuildPreferenceProjection};
