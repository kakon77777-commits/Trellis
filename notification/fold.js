const {InvalidTransitionError}=require('../core/errors');
const {validateNotificationIssuedPayload,validateNotificationAcknowledgedPayload}=require('./schemas');

const IMMUTABLE=['notification_id','recipient_actor_id','notification_type','source_event_ref','source_object_ref','source_actor_id','rule_ref','visibility'];
function assertNoImmutableOverride(state,payload){
  for(const field of IMMUTABLE){
    if(Object.prototype.hasOwnProperty.call(payload,field) && payload[field]!==state[field]) throw new InvalidTransitionError('NOTIFICATION_IMMUTABLE_FIELD');
  }
}
function foldNotification(events){
  if(!Array.isArray(events)||events.length===0) return {lifecycle:'nonexistent',acknowledged:false,stream_version:0};
  let state={lifecycle:'nonexistent',acknowledged:false,stream_version:0};
  for(let i=0;i<events.length;i+=1){
    const event=events[i];
    if(i===0 && event.event_type!=='notification.issued') throw new InvalidTransitionError('NOTIFICATION_MUST_START_ISSUED');
    if(event.event_type==='notification.issued'){
      if(state.lifecycle!=='nonexistent') throw new InvalidTransitionError('NOTIFICATION_ALREADY_ISSUED');
      const p=validateNotificationIssuedPayload(event.payload);
      state={
        ...p,lifecycle:'issued',acknowledged:false,
        issued_event_id:event.event_id,acknowledged_event_id:null,
        issued_recorded_at:event.recorded_at,issued_global_offset:event.global_offset,
        last_event_id:event.event_id,stream_version:event.stream_seq ?? 1
      };
    } else if(event.event_type==='notification.acknowledged'){
      if(state.lifecycle!=='issued') throw new InvalidTransitionError('NOTIFICATION_NOT_ISSUED');
      if(state.acknowledged) throw new InvalidTransitionError('NOTIFICATION_ALREADY_ACKNOWLEDGED');
      const p=validateNotificationAcknowledgedPayload(event.payload);
      assertNoImmutableOverride(state,p);
      if(p.notification_id!==state.notification_id) throw new InvalidTransitionError('NOTIFICATION_IMMUTABLE_FIELD');
      state={...state,acknowledged:true,acknowledged_event_id:event.event_id,last_event_id:event.event_id,stream_version:event.stream_seq ?? state.stream_version+1};
    } else {
      throw new InvalidTransitionError('NOTIFICATION_EVENT_TYPE_INVALID');
    }
  }
  return state;
}
module.exports={foldNotification};
