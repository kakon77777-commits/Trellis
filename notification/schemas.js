const {isNotificationType}=require('./types');
const COPY_FIELDS=['source_body','cached_publication_body','cached_reply_preview','cached_reaction_text','preview','body'];
function requireString(payload,field){if(typeof payload?.[field]!=='string'||payload[field].length===0) throw new TypeError(`INVALID_NOTIFICATION_PAYLOAD:${field}`);}
function validateNotificationIssuedPayload(payload){
  if(!payload||typeof payload!=='object') throw new TypeError('INVALID_NOTIFICATION_PAYLOAD');
  for(const field of ['notification_id','recipient_actor_id','notification_type','source_event_ref','source_object_ref','source_actor_id','rule_ref','visibility']) requireString(payload,field);
  if(!isNotificationType(payload.notification_type)) throw new TypeError('NOTIFICATION_TYPE_INVALID');
  if(payload.visibility!=='private') throw new TypeError('NOTIFICATION_VISIBILITY_INVALID');
  for(const field of COPY_FIELDS) if(Object.prototype.hasOwnProperty.call(payload,field)) throw new TypeError('NOTIFICATION_SOURCE_COPY_FORBIDDEN');
  return payload;
}
function validateNotificationAcknowledgedPayload(payload){
  if(!payload||typeof payload!=='object') throw new TypeError('INVALID_NOTIFICATION_PAYLOAD');
  requireString(payload,'notification_id');
  return payload;
}
module.exports={validateNotificationIssuedPayload,validateNotificationAcknowledgedPayload,COPY_FIELDS};
