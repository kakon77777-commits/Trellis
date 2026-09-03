const {createHash}=require('node:crypto');
const {canonicalStringify}=require('../core/canonical-json');
const {PolicyDeniedError,InvalidTransitionError,IdempotencyConflictError}=require('../core/errors');
const {foldEntity}=require('../entity/fold');
const {foldPublication}=require('../publication/fold');
const {foldRelationship}=require('../relationship/fold');
const {canViewPublication}=require('../publication/read-policy');
const {canViewRelationship}=require('../profile/read-policy');
const {createMembershipResolver}=require('../community/membership-read');
const {evaluateAuthority}=require('../authority/policy');
const {ACTIVITY_TYPES}=require('../feed/activity-items');
const {derivePreferenceId,normalizePreferenceTarget,PREFERENCE_POLICY_REF,isPreferenceType}=require('./types');
const {foldPreference}=require('./fold');
const {projectPreferenceStream}=require('./projector');

function digest(value){return createHash('sha256').update(canonicalStringify(value),'utf8').digest('hex');}
function requireString(value,code){if(typeof value!=='string'||!value) throw new TypeError(code);}
function rejectAudienceOverrides(value){for(const field of ['visibility','scope_ref','audience_actor_ids']) if(value&&Object.prototype.hasOwnProperty.call(value,field)) throw new TypeError('PREFERENCE_AUDIENCE_OVERRIDE_FORBIDDEN');}
function requireBaseCommand(command){
  if(!command||typeof command!=='object') throw new TypeError('INVALID_PREFERENCE_COMMAND');
  for(const f of ['command_id','idempotency_key','principal_id','owner_actor_id']) requireString(command[f],`INVALID_PREFERENCE_COMMAND:${f}`);
  rejectAudienceOverrides(command); rejectAudienceOverrides(command.target);
}
function requireMutationCommand(command){requireBaseCommand(command);requireString(command.preference_id,'INVALID_PREFERENCE_COMMAND:preference_id');if(!Number.isInteger(command.expected_version)||command.expected_version<1) throw new TypeError('INVALID_PREFERENCE_COMMAND:expected_version');}
function idempotencyGate(command,context,preferenceId){const commandDigest=digest(command);const prior=context.eventStore.lookupIdempotency(command.idempotency_key);if(!prior)return{commandDigest,result:null};if(prior.command_digest!==commandDigest)throw new IdempotencyConflictError();return{commandDigest,result:{preference_id:preferenceId,receipt:{...prior,deduplicated:true}}};}
function requireActiveActor(eventStore,actorId,code='PREFERENCE_OWNER_NOT_ACTIVE'){const events=eventStore.readStream('entity',actorId);const state=events.length?foldEntity(events):null;if(!state||state.lifecycle!=='active'||state.entity_kind!=='actor'||state.actor_capable!==true) throw new InvalidTransitionError(code);return state;}
function publicationTarget(targetRef,ownerActorId,context,{rootOnly=false}={}){
  const events=context.eventStore.readStream('publication',targetRef);if(!events.length) throw new InvalidTransitionError('PREFERENCE_TARGET_NOT_FOUND');
  const state=foldPublication(events);if(state.lifecycle!=='active') throw new InvalidTransitionError('PREFERENCE_TARGET_NOT_ACTIVE');
  if(rootOnly&&state.reply_to_ref) throw new InvalidTransitionError('PREFERENCE_FEED_ITEM_NOT_ROOT');
  const membershipResolver=createMembershipResolver(context.db);
  if(!canViewPublication(state,{viewer_actor_id:ownerActorId},context.disclosurePolicy,membershipResolver)) throw new InvalidTransitionError('PREFERENCE_TARGET_NOT_READABLE');
  return state;
}
function socialActivityTarget(eventId,ownerActorId,context){
  const event=context.eventStore.readEvent(eventId);if(!event||event.stream_type!=='relationship'||event.event_type!=='relationship.activated') throw new InvalidTransitionError('PREFERENCE_FEED_ACTIVITY_INVALID');
  const events=context.eventStore.readStream('relationship',event.stream_id);if(!events.length) throw new InvalidTransitionError('PREFERENCE_FEED_ACTIVITY_INVALID');
  const relationship=foldRelationship(events);if(!ACTIVITY_TYPES[relationship.relationship_type]) throw new InvalidTransitionError('PREFERENCE_FEED_ACTIVITY_INVALID');
  const membershipResolver=createMembershipResolver(context.db);
  if(!canViewRelationship(relationship,{viewer_actor_id:ownerActorId},context.disclosurePolicy,membershipResolver)) throw new InvalidTransitionError('PREFERENCE_TARGET_NOT_READABLE');
  return relationship;
}
function validateTarget(type,normalized,ownerActorId,context){
  if(type==='bookmark_publication'||type==='not_interested_publication') return publicationTarget(normalized.target_ref,ownerActorId,context);
  if(type==='mute_actor') return requireActiveActor(context.eventStore,normalized.target_ref,'PREFERENCE_TARGET_ACTOR_NOT_ACTIVE');
  if(type==='dismiss_feed_item'&&normalized.target_item_kind==='publication') return publicationTarget(normalized.target_ref,ownerActorId,context,{rootOnly:true});
  if(type==='dismiss_feed_item'&&normalized.target_item_kind==='social_activity') return socialActivityTarget(normalized.target_ref,ownerActorId,context);
  throw new InvalidTransitionError('PREFERENCE_TARGET_INVALID');
}
function authorityOrThrow(request){const receipt=evaluateAuthority(request);if(!receipt||receipt.decision!=='allow') throw new PolicyDeniedError();return receipt;}
function authorityRequest(command,context,preferenceId,action,state=null){return{command_id:command.command_id,principal_id:command.principal_id,actor_id:command.owner_actor_id,principal_actor_id:context.principalActorId,requested_action:action,aggregate_id:preferenceId,owner_actor_id:command.owner_actor_id,preference_state:state,policy_ref:'policy:preference-owner:v1',credential_refs:context.credentialRefs??[],evaluated_at:context.evaluatedAt??command.occurred_at??new Date().toISOString()};}
function baseEvent(command,context,eventType,suffix,payload){const timestamp=command.occurred_at??context.evaluatedAt??new Date().toISOString();return{event_id:`evt:${command.command_id}:${suffix}`,schema_version:'0.1',event_type:eventType,actor_id:command.owner_actor_id,principal_id:command.principal_id,causation_id:command.command_id,correlation_id:command.correlation_id??command.command_id,occurred_at:timestamp,recorded_at:timestamp,time_source:command.time_source??'system',provenance_refs:command.provenance_refs??[],payload};}
function append(command,context,preferenceId,expectedVersion,eventType,suffix,payload,authorityReceipt,commandDigest){const timestamp=command.occurred_at??context.evaluatedAt??new Date().toISOString();const receipt=context.eventStore.append({streamType:'preference',streamId:preferenceId,expectedVersion,events:[baseEvent(command,context,eventType,suffix,payload)],authorityReceipt,commandReceipt:{command_id:command.command_id,idempotency_key:command.idempotency_key,command_digest:commandDigest,status:'accepted',created_at:timestamp}});projectPreferenceStream(context.db,context.eventStore,preferenceId);return{preference_id:preferenceId,receipt};}
function createPreference(command,context){
  requireBaseCommand(command);requireString(command.preference_type,'INVALID_PREFERENCE_COMMAND:preference_type');if(!isPreferenceType(command.preference_type)) throw new TypeError('PREFERENCE_TYPE_INVALID');
  const normalized=normalizePreferenceTarget(command.preference_type,command.target??{});const preferenceId=derivePreferenceId(command.owner_actor_id,command.preference_type,command.target??{});if(command.preference_id&&command.preference_id!==preferenceId) throw new TypeError('PREFERENCE_ID_MISMATCH');
  const gate=idempotencyGate(command,context,preferenceId);if(gate.result)return gate.result;
  requireActiveActor(context.eventStore,command.owner_actor_id);
  if(context.eventStore.readStream('preference',preferenceId).length) throw new InvalidTransitionError('PREFERENCE_ALREADY_EXISTS');
  validateTarget(command.preference_type,normalized,command.owner_actor_id,context);
  const authorityReceipt=authorityOrThrow(authorityRequest(command,context,preferenceId,'preference.create'));
  const payload={preference_id:preferenceId,owner_actor_id:command.owner_actor_id,preference_type:command.preference_type,...normalized,preference_policy_ref:PREFERENCE_POLICY_REF};
  return append(command,context,preferenceId,0,'preference.created','created',payload,authorityReceipt,gate.commandDigest);
}
function loadForMutation(command,context){const events=context.eventStore.readStream('preference',command.preference_id);if(!events.length) throw new InvalidTransitionError('PREFERENCE_NOT_FOUND');const state=foldPreference(events);if(state.owner_actor_id!==command.owner_actor_id) throw new InvalidTransitionError('PREFERENCE_OWNER_MISMATCH');return{events,state};}
function withdrawPreference(command,context){
  requireMutationCommand(command);const gate=idempotencyGate(command,context,command.preference_id);if(gate.result)return gate.result;const{state}=loadForMutation(command,context);if(state.lifecycle!=='active') throw new InvalidTransitionError('PREFERENCE_CANNOT_WITHDRAW');
  const authorityReceipt=authorityOrThrow(authorityRequest(command,context,state.preference_id,'preference.withdraw',state));return append(command,context,state.preference_id,command.expected_version,'preference.withdrawn','withdrawn',{reason:command.reason??'owner_withdrawn'},authorityReceipt,gate.commandDigest);
}
function restorePreference(command,context){
  requireMutationCommand(command);const gate=idempotencyGate(command,context,command.preference_id);if(gate.result)return gate.result;const{state}=loadForMutation(command,context);if(state.lifecycle!=='withdrawn') throw new InvalidTransitionError('PREFERENCE_CANNOT_RESTORE');
  requireActiveActor(context.eventStore,state.owner_actor_id);validateTarget(state.preference_type,{target_kind:state.target_kind,target_ref:state.target_ref,target_item_kind:state.target_item_kind},state.owner_actor_id,context);
  const authorityReceipt=authorityOrThrow(authorityRequest(command,context,state.preference_id,'preference.restore',state));return append(command,context,state.preference_id,command.expected_version,'preference.restored','restored',{},authorityReceipt,gate.commandDigest);
}
module.exports={createPreference,withdrawPreference,restorePreference};
