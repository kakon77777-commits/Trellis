const {createHash}=require('node:crypto');
const {canonicalStringify}=require('../core/canonical-json');
const {PolicyDeniedError,InvalidTransitionError,IdempotencyConflictError}=require('../core/errors');
const {evaluateAuthority}=require('../authority/policy');
const {deriveNotificationId}=require('./types');
const {deriveNotificationCandidate}=require('./source-rules');
const {projectNotificationStream}=require('./projector');
const {foldNotification}=require('./fold');
const {resolveCurrentNotificationContext}=require('./read-policy');

function digest(value){return createHash('sha256').update(canonicalStringify(value),'utf8').digest('hex');}
function requireInput(input){for(const f of ['eventId','commandId','idempotencyKey']) if(typeof input?.[f]!=='string'||!input[f]) throw new TypeError(`INVALID_NOTIFICATION_PROCESSOR_INPUT:${f}`);}
function processSourceEvent(input,context){
  requireInput(input);
  const sourceEvent=context.eventStore.readEvent(input.eventId);
  if(!sourceEvent) throw new InvalidTransitionError('NOTIFICATION_SOURCE_EVENT_NOT_FOUND');
  const derived=deriveNotificationCandidate(sourceEvent,context);
  if(!derived.candidate) return {issued:false,reason:derived.reason};
  const c=derived.candidate;
  const notificationId=deriveNotificationId(c.recipient_actor_id,sourceEvent.event_id,c.rule_ref);
  const existing=context.eventStore.readStream('notification',notificationId);
  if(existing.length) return {issued:true,notification_id:notificationId,deduplicated:true};
  const principalId=context.principalId ?? 'principal:notification-processor';
  const authorityReceipt=evaluateAuthority({
    command_id:input.commandId,principal_id:principalId,actor_id:c.source_actor_id,
    requested_action:'notification.issue',aggregate_id:notificationId,
    capability_grants:context.capabilityGrants ?? [],policy_ref:'policy:notification-processor:v1',
    credential_refs:context.credentialRefs ?? [],evaluated_at:context.evaluatedAt ?? new Date().toISOString()
  });
  if(authorityReceipt.decision!=='allow') throw new PolicyDeniedError();
  const timestamp=context.evaluatedAt ?? new Date().toISOString();
  const payload={notification_id:notificationId,recipient_actor_id:c.recipient_actor_id,notification_type:c.notification_type,source_event_ref:sourceEvent.event_id,source_object_ref:c.source_object_ref,source_actor_id:c.source_actor_id,rule_ref:c.rule_ref,visibility:'private'};
  const receipt=context.eventStore.append({
    streamType:'notification',streamId:notificationId,expectedVersion:0,
    events:[{event_id:`evt:${input.commandId}:issued`,schema_version:'0.1',event_type:'notification.issued',actor_id:c.source_actor_id,principal_id:principalId,causation_id:sourceEvent.event_id,correlation_id:sourceEvent.correlation_id ?? sourceEvent.event_id,occurred_at:timestamp,recorded_at:timestamp,time_source:'system',provenance_refs:[sourceEvent.event_id],payload}],
    authorityReceipt,
    commandReceipt:{command_id:input.commandId,idempotency_key:input.idempotencyKey,command_digest:digest({input,notification_id:notificationId}),status:'accepted',created_at:timestamp}
  });
  projectNotificationStream(context.db,context.eventStore,notificationId);
  return {issued:true,notification_id:notificationId,receipt};
}


function requireAckCommand(command){
  if(!command||typeof command!=='object') throw new TypeError('INVALID_NOTIFICATION_ACK_COMMAND');
  for(const f of ['command_id','idempotency_key','principal_id','notification_id']) if(typeof command[f]!=='string'||!command[f]) throw new TypeError(`INVALID_NOTIFICATION_ACK_COMMAND:${f}`);
  if(!Number.isInteger(command.expected_version)||command.expected_version<1) throw new TypeError('INVALID_NOTIFICATION_ACK_COMMAND:expected_version');
}
function acknowledgeNotification(command,context){
  requireAckCommand(command);
  const commandDigest=digest(command);
  const prior=context.eventStore.lookupIdempotency(command.idempotency_key);
  if(prior){
    if(prior.command_digest!==commandDigest) throw new IdempotencyConflictError();
    return {notification_id:command.notification_id,receipt:{...prior,deduplicated:true}};
  }
  const events=context.eventStore.readStream('notification',command.notification_id);
  if(!events.length) throw new InvalidTransitionError('NOTIFICATION_NOT_FOUND');
  const state=foldNotification(events);
  const authorityReceipt=evaluateAuthority({
    command_id:command.command_id,principal_id:command.principal_id,actor_id:state.recipient_actor_id,
    principal_actor_id:context.principalActorId,requested_action:'notification.ack',aggregate_id:state.notification_id,
    notification_state:state,policy_ref:'policy:notification-recipient-ack:v1',credential_refs:context.credentialRefs ?? [],
    evaluated_at:context.evaluatedAt ?? command.occurred_at ?? new Date().toISOString()
  });
  if(authorityReceipt.decision!=='allow') throw new PolicyDeniedError();
  if(state.acknowledged) throw new InvalidTransitionError('NOTIFICATION_ALREADY_ACKNOWLEDGED');
  const source=resolveCurrentNotificationContext(state,{db:context.db,eventStore:context.eventStore,disclosurePolicy:context.disclosurePolicy});
  if(!source) throw new InvalidTransitionError('NOTIFICATION_NOT_VISIBLE');
  const timestamp=command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  const receipt=context.eventStore.append({
    streamType:'notification',streamId:state.notification_id,expectedVersion:command.expected_version,
    events:[{event_id:`evt:${command.command_id}:acknowledged`,schema_version:'0.1',event_type:'notification.acknowledged',actor_id:state.recipient_actor_id,principal_id:command.principal_id,causation_id:command.command_id,correlation_id:command.correlation_id ?? command.command_id,occurred_at:timestamp,recorded_at:timestamp,time_source:command.time_source ?? 'system',provenance_refs:command.provenance_refs ?? [],payload:{notification_id:state.notification_id}}],
    authorityReceipt,
    commandReceipt:{command_id:command.command_id,idempotency_key:command.idempotency_key,command_digest:commandDigest,status:'accepted',created_at:timestamp}
  });
  projectNotificationStream(context.db,context.eventStore,state.notification_id);
  return {notification_id:state.notification_id,receipt};
}

module.exports={processSourceEvent,acknowledgeNotification};
