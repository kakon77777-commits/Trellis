const {PolicyDeniedError}=require('../core/errors');
const {evaluateAuthority}=require('../authority/policy');
const {ConsumptionStore}=require('./store');
const {resolveConsumptionTargetAsync}=require('./eligibility');

const CLIENT_TIME_FIELDS=Object.freeze(['occurred_at','recorded_at','first_seen_at','first_opened_at','last_touched_at','expires_at']);
function requireString(value,code){if(typeof value!=='string'||!value)throw new TypeError(code);return value;}
function requireCommand(command){
  if(!command||typeof command!=='object')throw new TypeError('INVALID_CONSUMPTION_COMMAND');
  for(const f of ['command_id','principal_id','requested_consumer_actor_id'])requireString(command[f],`INVALID_CONSUMPTION_COMMAND:${f}`);
  if(!command.target||typeof command.target!=='object')throw new TypeError('INVALID_CONSUMPTION_COMMAND:target');
  for(const f of CLIENT_TIME_FIELDS)if(Object.prototype.hasOwnProperty.call(command,f))throw new TypeError('CONSUMPTION_CLIENT_TIME_FORBIDDEN');
}
function trustedNow(context){const value=typeof context.now==='function'?context.now():new Date().toISOString();if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new TypeError('CONSUMPTION_TIME_INVALID');return new Date(Date.parse(value)).toISOString();}
function authorityOrThrow(command,context,target){
  const receipt=evaluateAuthority({
    command_id:command.command_id,
    principal_id:command.principal_id,
    actor_id:command.requested_consumer_actor_id,
    principal_actor_id:context.principalActorId??context.recognizedViewerActorId,
    recognized_viewer_actor_id:context.recognizedViewerActorId,
    requested_action:'consumption.record',
    aggregate_id:`${target.target_kind}:${target.target_ref}`,
    target_readable:true,
    capability_grants:context.capabilityGrants??[],
    policy_ref:'policy:consumption-recorder:v1',
    credential_refs:context.credentialRefs??[],
    evaluated_at:context.evaluatedAt??trustedNow(context)
  });
  if(!receipt||receipt.decision!=='allow')throw new PolicyDeniedError();
  return receipt;
}
async function recordObservation(observation,command,context){
  requireCommand(command);
  requireString(context?.recognizedViewerActorId,'CONSUMPTION_VIEWER_NOT_RECOGNIZED');
  const target=await resolveConsumptionTargetAsync({observation,target:command.target,viewerActorId:context.recognizedViewerActorId,db:context.db,eventStore:context.eventStore,disclosurePolicy:context.disclosurePolicy});
  authorityOrThrow(command,context,target);
  const now=trustedNow(context);
  const store=new ConsumptionStore(context.sql);
  if(observation==='opened')return await store.recordOpened({consumerActorId:command.requested_consumer_actor_id,targetKind:target.target_kind,targetRef:target.target_ref,now});
  return await store.recordSeen({consumerActorId:command.requested_consumer_actor_id,targetKind:target.target_kind,targetRef:target.target_ref,now});
}
async function recordSeen(command,context){return await recordObservation('seen',command,context);}
async function recordOpened(command,context){return await recordObservation('opened',command,context);}
module.exports={recordSeen,recordOpened,recordObservation,CLIENT_TIME_FIELDS};
