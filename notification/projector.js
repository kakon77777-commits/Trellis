const {foldNotification}=require('./fold');
const MATERIALIZER_VERSION='notification-materializer:0.1';
function upsertNotificationStatement(state){return{sql:`
  INSERT INTO notifications_current (
    notification_id,recipient_actor_id,notification_type,source_event_ref,source_object_ref,source_actor_id,
    rule_ref,visibility,acknowledged,issued_event_id,acknowledged_event_id,issued_recorded_at,issued_global_offset,
    last_event_id,stream_version,materializer_version
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(notification_id) DO UPDATE SET
    recipient_actor_id=excluded.recipient_actor_id,notification_type=excluded.notification_type,
    source_event_ref=excluded.source_event_ref,source_object_ref=excluded.source_object_ref,source_actor_id=excluded.source_actor_id,
    rule_ref=excluded.rule_ref,visibility=excluded.visibility,acknowledged=excluded.acknowledged,
    issued_event_id=excluded.issued_event_id,acknowledged_event_id=excluded.acknowledged_event_id,
    issued_recorded_at=excluded.issued_recorded_at,issued_global_offset=excluded.issued_global_offset,
    last_event_id=excluded.last_event_id,stream_version=excluded.stream_version,materializer_version=excluded.materializer_version`,params:[state.notification_id,state.recipient_actor_id,state.notification_type,state.source_event_ref,state.source_object_ref,state.source_actor_id,state.rule_ref,state.visibility,state.acknowledged?1:0,state.issued_event_id,state.acknowledged_event_id,state.issued_recorded_at,state.issued_global_offset,state.last_event_id,state.stream_version,MATERIALIZER_VERSION]};}
async function projectNotificationStream(sql,eventStore,notificationId){const events=await eventStore.readStream('notification',notificationId);if(!events.length)return null;const state=foldNotification(events);await sql.batch([upsertNotificationStatement(state)]);return state;}
async function rebuildNotificationProjection(sql,eventStore){const rows=await sql.all("SELECT DISTINCT stream_id FROM canonical_events WHERE stream_type='notification' ORDER BY stream_id");const statements=[{sql:'DELETE FROM notifications_current',params:[]}];for(const row of rows){const events=await eventStore.readStream('notification',row.stream_id);if(events.length)statements.push(upsertNotificationStatement(foldNotification(events)));}await sql.batch(statements);}
module.exports={MATERIALIZER_VERSION,upsertNotificationStatement,projectNotificationStream,rebuildNotificationProjection};
