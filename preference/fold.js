const { InvalidTransitionError } = require('../core/errors');
const { validatePreferenceCreationPayload, validatePreferenceLifecyclePayload } = require('./schemas');

const IMMUTABLE_FIELDS=['preference_id','owner_actor_id','preference_type','target_kind','target_ref','target_item_kind','preference_policy_ref'];
function invalid(message){throw new InvalidTransitionError(message);}
function equal(a,b){return JSON.stringify(a??null)===JSON.stringify(b??null);}
function rejectImmutable(payload,state){for(const field of IMMUTABLE_FIELDS){if(Object.prototype.hasOwnProperty.call(payload,field)&&!equal(payload[field],state[field])) invalid(`PREFERENCE_IMMUTABLE_FIELD_CHANGED:${field}`);}}
function foldPreference(events){
  let state={lifecycle:'nonexistent',stream_version:0,created_event_id:null,restored_event_id:null,withdrawn_event_id:null,last_event_id:null,withdrawal_reason:null};
  for(const event of events){
    const payload=event.payload??{};
    switch(event.event_type){
      case 'preference.created':
        if(state.lifecycle!=='nonexistent') invalid('PREFERENCE_ALREADY_CREATED');
        try{validatePreferenceCreationPayload(payload);}catch(error){invalid(error.message);}
        state={...state,preference_id:payload.preference_id,owner_actor_id:payload.owner_actor_id,preference_type:payload.preference_type,target_kind:payload.target_kind,target_ref:payload.target_ref,target_item_kind:payload.target_item_kind??null,preference_policy_ref:payload.preference_policy_ref,lifecycle:'active',created_event_id:event.event_id,withdrawal_reason:null};
        break;
      case 'preference.withdrawn':
        if(state.lifecycle!=='active') invalid('PREFERENCE_CANNOT_WITHDRAW');
        try{validatePreferenceLifecyclePayload(payload);}catch(error){invalid(error.message);}
        rejectImmutable(payload,state);
        state.lifecycle='withdrawn'; state.withdrawn_event_id=event.event_id; state.withdrawal_reason=payload.reason??'owner_withdrawn';
        break;
      case 'preference.restored':
        if(state.lifecycle!=='withdrawn') invalid('PREFERENCE_CANNOT_RESTORE');
        try{validatePreferenceLifecyclePayload(payload);}catch(error){invalid(error.message);}
        rejectImmutable(payload,state);
        state.lifecycle='active'; state.restored_event_id=event.event_id; state.withdrawal_reason=null;
        break;
      default: invalid(`UNKNOWN_PREFERENCE_EVENT:${event.event_type}`);
    }
    state.stream_version=event.stream_seq; state.last_event_id=event.event_id;
  }
  return state;
}
module.exports={foldPreference};
