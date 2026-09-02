const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { deriveId } = require('../core/ids');
const { PolicyDeniedError, InvalidTransitionError, IdempotencyConflictError } = require('../core/errors');
const { foldEntity } = require('../entity/fold');
const { foldPublication } = require('./fold');
const { validatePublicationCreationPayload } = require('./schemas');
const { resolvePublicationCreationPolicy, activeCommunityMembership } = require('./policy');
const { evaluateAuthority } = require('../authority/policy');
const { validatePublicationReferenceCreation } = require('./references');

function digestCommand(command) {
  return createHash('sha256').update(canonicalStringify(command), 'utf8').digest('hex');
}

function requireString(command, field) {
  if (typeof command[field] !== 'string' || command[field].length === 0) throw new TypeError(`INVALID_PUBLICATION_COMMAND:${field}`);
}

function ensureCommand(command, required) {
  if (!command || typeof command !== 'object') throw new TypeError('INVALID_PUBLICATION_COMMAND');
  for (const field of ['command_id', 'idempotency_key', 'principal_id', ...required]) requireString(command, field);
}

function idempotencyGate(command, context, publicationId) {
  const commandDigest = digestCommand(command);
  const prior = context.eventStore.lookupIdempotency(command.idempotency_key);
  if (!prior) return { commandDigest, result: null };
  if (prior.command_digest !== commandDigest) throw new IdempotencyConflictError();
  return { commandDigest, result: { publication_id: publicationId, receipt: { ...prior, deduplicated: true } } };
}

function baseEvent(command, context, eventType, suffix, payload) {
  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  return {
    event_id: `evt:${command.command_id}:${suffix}`,
    schema_version: '0.1', event_type: eventType,
    actor_id: context.principalActorId, principal_id: command.principal_id,
    causation_id: command.command_id, correlation_id: command.correlation_id ?? command.command_id,
    occurred_at: timestamp, recorded_at: timestamp, time_source: command.time_source ?? 'system',
    provenance_refs: command.provenance_refs ?? [], payload
  };
}

function requireActiveActor(eventStore, actorId) {
  const state = foldEntity(eventStore.readStream('entity', actorId));
  if (state.lifecycle !== 'active' || state.entity_kind !== 'actor' || state.entity_id !== actorId) {
    throw new InvalidTransitionError('PUBLICATION_AUTHOR_NOT_ACTIVE');
  }
}

function authorityOrThrow(request) {
  const receipt = evaluateAuthority(request);
  if (!receipt || receipt.decision !== 'allow') throw new PolicyDeniedError();
  return receipt;
}

function normalizeAudience(command) {
  return [...new Set(command.audience_actor_ids ?? [])].sort();
}

function createPublication(command, context) {
  ensureCommand(command, ['author_actor_id', 'publication_type']);
  const publicationId = command.publication_id ?? deriveId('pub', command.command_id);
  const gate = idempotencyGate(command, context, publicationId);
  if (gate.result) return gate.result;
  for (const field of ['reference_preview', 'parent_body', 'quoted_body', 'cached_reference_body']) {
    if (Object.prototype.hasOwnProperty.call(command, field)) throw new TypeError('PUBLICATION_REFERENCE_COPY_FORBIDDEN');
  }
  requireActiveActor(context.eventStore, command.author_actor_id);
  const policy = resolvePublicationCreationPolicy(command);
  const payload = {
    publication_id: publicationId,
    author_actor_id: command.author_actor_id,
    publication_type: command.publication_type,
    scope_ref: policy.scope_ref,
    visibility: policy.visibility,
    audience_actor_ids: normalizeAudience(command),
    reply_to_ref: command.reply_to_ref ?? null,
    quote_of_ref: command.quote_of_ref ?? null,
    publication_policy_ref: policy.publication_policy_ref,
    revision_number: 1,
    body: command.body ?? ''
  };
  validatePublicationCreationPayload(payload);
  const targetRef = payload.reply_to_ref ?? payload.quote_of_ref;
  if (targetRef) {
    const parentEvents = context.eventStore.readStream('publication', targetRef);
    const parentState = parentEvents.length ? foldPublication(parentEvents) : null;
    validatePublicationReferenceCreation({ childDraft: payload, parentState, actorId: command.author_actor_id, db: context.db });
  }
  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  const authorityReceipt = authorityOrThrow({
    command_id: command.command_id, principal_id: command.principal_id,
    actor_id: command.author_actor_id, principal_actor_id: context.principalActorId,
    requested_action: 'publication.create', aggregate_id: publicationId,
    author_actor_id: command.author_actor_id, scope_ref: policy.scope_ref,
    active_membership: activeCommunityMembership(context.db, policy.scope_ref, command.author_actor_id),
    capability_grants: context.capabilityGrants ?? [],
    policy_ref: policy.publication_policy_ref, credential_refs: context.credentialRefs ?? [],
    evaluated_at: context.evaluatedAt ?? timestamp
  });
  const receipt = context.eventStore.append({
    streamType: 'publication', streamId: publicationId, expectedVersion: 0,
    events: [baseEvent(command, context, 'publication.created', 'created', payload)], authorityReceipt,
    commandReceipt: { command_id: command.command_id, idempotency_key: command.idempotency_key, command_digest: gate.commandDigest, status: 'accepted', created_at: timestamp }
  });
  return { publication_id: publicationId, receipt };
}

function loadPublicationForMutation(command, context) {
  const events = context.eventStore.readStream('publication', command.publication_id);
  if (events.length === 0) throw new InvalidTransitionError('PUBLICATION_NOT_FOUND');
  return { events, state: foldPublication(events) };
}

function revisePublication(command, context) {
  ensureCommand(command, ['publication_id']);
  if (typeof command.body !== 'string') throw new TypeError('INVALID_PUBLICATION_COMMAND:body');
  const gate = idempotencyGate(command, context, command.publication_id);
  if (gate.result) return gate.result;
  const { events, state } = loadPublicationForMutation(command, context);
  if (state.lifecycle !== 'active') throw new InvalidTransitionError('PUBLICATION_CANNOT_REVISE');
  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  const authorityReceipt = authorityOrThrow({
    command_id: command.command_id, principal_id: command.principal_id, actor_id: state.author_actor_id,
    principal_actor_id: context.principalActorId, requested_action: 'publication.revise', aggregate_id: command.publication_id,
    publication_state: state, policy_ref: state.publication_policy_ref, credential_refs: context.credentialRefs ?? [],
    evaluated_at: context.evaluatedAt ?? timestamp
  });
  const draft = baseEvent(command, context, 'publication.revision_added', 'revision', {
    revision_number: state.current_revision + 1, supersedes_revision: state.current_revision, body: command.body
  });
  foldPublication([...events, { ...draft, stream_seq: state.stream_version + 1 }]);
  const receipt = context.eventStore.append({
    streamType: 'publication', streamId: command.publication_id, expectedVersion: command.expected_version,
    events: [draft], authorityReceipt,
    commandReceipt: { command_id: command.command_id, idempotency_key: command.idempotency_key, command_digest: gate.commandDigest, status: 'accepted', created_at: timestamp }
  });
  return { publication_id: command.publication_id, receipt };
}

function withdrawPublication(command, context) {
  ensureCommand(command, ['publication_id']);
  const gate = idempotencyGate(command, context, command.publication_id);
  if (gate.result) return gate.result;
  const { events, state } = loadPublicationForMutation(command, context);
  if (state.lifecycle !== 'active') throw new InvalidTransitionError('PUBLICATION_CANNOT_WITHDRAW');
  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  const authorityReceipt = authorityOrThrow({
    command_id: command.command_id, principal_id: command.principal_id, actor_id: state.author_actor_id,
    principal_actor_id: context.principalActorId, requested_action: 'publication.withdraw', aggregate_id: command.publication_id,
    publication_state: state, policy_ref: state.publication_policy_ref, credential_refs: context.credentialRefs ?? [],
    evaluated_at: context.evaluatedAt ?? timestamp
  });
  const draft = baseEvent(command, context, 'publication.withdrawn', 'withdrawn', { reason: command.reason ?? 'author_withdrawn' });
  foldPublication([...events, { ...draft, stream_seq: state.stream_version + 1 }]);
  const receipt = context.eventStore.append({
    streamType: 'publication', streamId: command.publication_id, expectedVersion: command.expected_version,
    events: [draft], authorityReceipt,
    commandReceipt: { command_id: command.command_id, idempotency_key: command.idempotency_key, command_digest: gate.commandDigest, status: 'accepted', created_at: timestamp }
  });
  return { publication_id: command.publication_id, receipt };
}

module.exports = { createPublication, revisePublication, withdrawPublication };
