const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { IdempotencyConflictError, InvalidTransitionError, PolicyDeniedError } = require('../core/errors');
const { foldEntity } = require('../entity/fold');
const { foldPublication } = require('../publication/fold');
const { canViewPublication } = require('../publication/read-policy');
const { createMembershipResolver } = require('../community/membership-read');
const { evaluateAuthority } = require('../authority/policy');
const { foldReaction } = require('./fold');
const { deriveReactionId, REACTION_POLICY_REF, isReactionType } = require('./types');
const { projectReactionStream } = require('./projector');

function digestCommand(command) {
  return createHash('sha256').update(canonicalStringify(command), 'utf8').digest('hex');
}
function requireString(command, field) {
  if (typeof command[field] !== 'string' || command[field].length === 0) throw new TypeError(`INVALID_REACTION_COMMAND:${field}`);
}
function ensureCommand(command, { typeRequired = false } = {}) {
  if (!command || typeof command !== 'object') throw new TypeError('INVALID_REACTION_COMMAND');
  for (const field of ['command_id','idempotency_key','principal_id','actor_id','publication_id']) requireString(command,field);
  if (typeRequired && !isReactionType(command.reaction_type)) throw new TypeError('REACTION_TYPE_INVALID');
  for (const field of ['visibility','scope_ref','audience_actor_ids']) {
    if (Object.prototype.hasOwnProperty.call(command, field)) throw new TypeError('REACTION_AUDIENCE_OVERRIDE_FORBIDDEN');
  }
  const derived = deriveReactionId(command.actor_id, command.publication_id);
  if (command.reaction_id && command.reaction_id !== derived) throw new TypeError('REACTION_ID_MISMATCH');
  return derived;
}
async function idempotencyGate(command, context, reactionId) {
  const commandDigest = digestCommand(command);
  const prior = await context.eventStore.lookupIdempotency(command.idempotency_key);
  if (!prior) return {commandDigest,result:null};
  if (prior.command_digest !== commandDigest) throw new IdempotencyConflictError();
  return {commandDigest,result:{reaction_id:reactionId,receipt:{...prior,deduplicated:true}}};
}
function baseEvent(command, context, eventType, suffix, payload) {
  const timestamp=command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  return {
    event_id:`evt:${command.command_id}:${suffix}`,schema_version:'0.1',event_type:eventType,
    actor_id:command.actor_id,principal_id:command.principal_id,causation_id:command.command_id,
    correlation_id:command.correlation_id ?? command.command_id,occurred_at:timestamp,recorded_at:timestamp,
    time_source:command.time_source ?? 'system',provenance_refs:command.provenance_refs ?? [],payload
  };
}
async function requireActiveActor(eventStore, actorId) {
  const state=foldEntity(await eventStore.readStream('entity',actorId));
  if (state.lifecycle!=='active' || state.entity_kind!=='actor' || state.entity_id!==actorId) throw new InvalidTransitionError('REACTION_ACTOR_NOT_ACTIVE');
}
async function loadTarget(command, context) {
  const events=await context.eventStore.readStream('publication',command.publication_id);
  if (events.length===0) throw new InvalidTransitionError('REACTION_TARGET_NOT_FOUND');
  return foldPublication(events);
}
async function targetReadable(target, actorId, context) {
  const membershipResolver=await createMembershipResolver(context.db);
  return canViewPublication(target,{viewer_actor_id:actorId},context.disclosurePolicy,membershipResolver);
}
async function requireActiveReadableTarget(command, context) {
  const target=await loadTarget(command,context);
  if (target.lifecycle!=='active') throw new InvalidTransitionError('REACTION_TARGET_NOT_ACTIVE');
  if (!(await targetReadable(target,command.actor_id,context))) throw new InvalidTransitionError('REACTION_TARGET_NOT_READABLE');
  return target;
}
async function loadReaction(reactionId, context) {
  const events=await context.eventStore.readStream('reaction',reactionId);
  return {events,state:events.length?foldReaction(events):null};
}
function authorityOrThrow(request) {
  const receipt=evaluateAuthority(request);
  if (!receipt || receipt.decision!=='allow') throw new PolicyDeniedError();
  return receipt;
}
function authorityRequest(command, context, reactionId, action, extra={}) {
  return {
    command_id:command.command_id,principal_id:command.principal_id,actor_id:command.actor_id,
    principal_actor_id:context.principalActorId,requested_action:action,aggregate_id:reactionId,
    policy_ref:'policy:reaction-on-readable-publication:v1',credential_refs:context.credentialRefs ?? [],
    evaluated_at:context.evaluatedAt ?? command.occurred_at ?? new Date().toISOString(),...extra
  };
}
async function append(command, context, reactionId, expectedVersion, eventType, suffix, payload, authorityReceipt, commandDigest) {
  const timestamp=command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  const receipt=await context.eventStore.append({
    streamType:'reaction',streamId:reactionId,expectedVersion,
    events:[baseEvent(command,context,eventType,suffix,payload)],authorityReceipt,
    commandReceipt:{command_id:command.command_id,idempotency_key:command.idempotency_key,command_digest:commandDigest,status:'accepted',created_at:timestamp}
  });
  await projectReactionStream(context.sql,context.eventStore,reactionId);
  return {reaction_id:reactionId,receipt};
}

async function createReaction(command, context) {
  const reactionId=ensureCommand(command,{typeRequired:true});
  const gate=await idempotencyGate(command,context,reactionId); if (gate.result) return gate.result;
  await requireActiveActor(context.eventStore,command.actor_id);
  const existing=await loadReaction(reactionId,context);
  if (existing.events.length) throw new InvalidTransitionError('REACTION_ALREADY_EXISTS');
  const target=await requireActiveReadableTarget(command,context);
  const authorityReceipt=authorityOrThrow(authorityRequest(command,context,reactionId,'reaction.create',{publication_active:true,publication_readable:true}));
  const payload={
    reaction_id:reactionId,actor_id:command.actor_id,publication_id:command.publication_id,
    scope_ref:target.scope_ref ?? null,visibility:target.visibility,audience_actor_ids:[...(target.audience_actor_ids ?? [])],
    reaction_policy_ref:REACTION_POLICY_REF,reaction_type:command.reaction_type
  };
  return await append(command,context,reactionId,0,'reaction.created','created',payload,authorityReceipt,gate.commandDigest);
}

async function changeReaction(command, context) {
  const reactionId=ensureCommand(command,{typeRequired:true});
  const gate=await idempotencyGate(command,context,reactionId); if (gate.result) return gate.result;
  const {events,state}=await loadReaction(reactionId,context);
  if (!events.length) throw new InvalidTransitionError('REACTION_NOT_FOUND');
  if (state.lifecycle!=='active') throw new InvalidTransitionError('REACTION_CANNOT_CHANGE');
  await requireActiveActor(context.eventStore,command.actor_id);
  await requireActiveReadableTarget(command,context);
  const authorityReceipt=authorityOrThrow(authorityRequest(command,context,reactionId,'reaction.change',{publication_active:true,publication_readable:true,reaction_state:state}));
  return await append(command,context,reactionId,command.expected_version,'reaction.changed','changed',{reaction_type:command.reaction_type},authorityReceipt,gate.commandDigest);
}

async function withdrawReaction(command, context) {
  const reactionId=ensureCommand(command);
  const gate=await idempotencyGate(command,context,reactionId); if (gate.result) return gate.result;
  const {events,state}=await loadReaction(reactionId,context);
  if (!events.length) throw new InvalidTransitionError('REACTION_NOT_FOUND');
  if (state.lifecycle!=='active') throw new InvalidTransitionError('REACTION_CANNOT_WITHDRAW');
  const authorityReceipt=authorityOrThrow(authorityRequest(command,context,reactionId,'reaction.withdraw',{reaction_state:state}));
  return await append(command,context,reactionId,command.expected_version,'reaction.withdrawn','withdrawn',{reason:command.reason ?? 'actor_withdrawn'},authorityReceipt,gate.commandDigest);
}

async function restoreReaction(command, context) {
  const reactionId=ensureCommand(command,{typeRequired:true});
  const gate=await idempotencyGate(command,context,reactionId); if (gate.result) return gate.result;
  const {events,state}=await loadReaction(reactionId,context);
  if (!events.length) throw new InvalidTransitionError('REACTION_NOT_FOUND');
  if (state.lifecycle!=='withdrawn') throw new InvalidTransitionError('REACTION_CANNOT_RESTORE');
  await requireActiveActor(context.eventStore,command.actor_id);
  await requireActiveReadableTarget(command,context);
  const authorityReceipt=authorityOrThrow(authorityRequest(command,context,reactionId,'reaction.restore',{publication_active:true,publication_readable:true,reaction_state:state}));
  return await append(command,context,reactionId,command.expected_version,'reaction.restored','restored',{reaction_type:command.reaction_type},authorityReceipt,gate.commandDigest);
}

module.exports={createReaction,changeReaction,withdrawReaction,restoreReaction};
