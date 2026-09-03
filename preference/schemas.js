const { PREFERENCE_POLICY_REF, isPreferenceType, FEED_ITEM_KINDS } = require('./types');

const FORBIDDEN_AUDIENCE_FIELDS=['visibility','scope_ref','audience_actor_ids'];
function requireString(payload,field){if(typeof payload?.[field]!=='string'||payload[field].length===0) throw new TypeError(`INVALID_PREFERENCE:${field}`);}
function rejectAudienceOverrides(payload){for(const field of FORBIDDEN_AUDIENCE_FIELDS){if(Object.prototype.hasOwnProperty.call(payload,field)) throw new TypeError('PREFERENCE_AUDIENCE_OVERRIDE_FORBIDDEN');}}
function validatePreferenceCreationPayload(payload){
  if(!payload||typeof payload!=='object') throw new TypeError('INVALID_PREFERENCE');
  rejectAudienceOverrides(payload);
  for(const field of ['preference_id','owner_actor_id','preference_type','target_kind','target_ref','preference_policy_ref']) requireString(payload,field);
  if(!isPreferenceType(payload.preference_type)) throw new TypeError('PREFERENCE_TYPE_INVALID');
  if(payload.preference_policy_ref!==PREFERENCE_POLICY_REF) throw new TypeError('PREFERENCE_POLICY_REF_INVALID');
  const item=payload.target_item_kind ?? null;
  if(payload.preference_type==='dismiss_feed_item'){
    if(payload.target_kind!=='feed_item'||!FEED_ITEM_KINDS.includes(item)) throw new TypeError('PREFERENCE_TARGET_INVALID');
  } else if(payload.preference_type==='mute_actor'){
    if(payload.target_kind!=='actor'||item!==null) throw new TypeError('PREFERENCE_TARGET_INVALID');
  } else {
    if(payload.target_kind!=='publication'||item!==null) throw new TypeError('PREFERENCE_TARGET_INVALID');
  }
  return payload;
}
function validatePreferenceLifecyclePayload(payload={}){
  if(!payload||typeof payload!=='object') throw new TypeError('INVALID_PREFERENCE_EVENT');
  rejectAudienceOverrides(payload);
  return payload;
}
module.exports={validatePreferenceCreationPayload,validatePreferenceLifecyclePayload,FORBIDDEN_AUDIENCE_FIELDS};
