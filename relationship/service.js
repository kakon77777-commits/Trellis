const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { deriveId } = require('../core/ids');
const { PolicyDeniedError, InvalidTransitionError } = require('../core/errors');
const { evaluateAuthority } = require('../authority/policy');
const { resolveRelationshipPolicy, resolveVisibility } = require('./taxonomy');
const { foldRelationship } = require('./fold');

function digestCommand(command) {
  return createHash('sha256').update(canonicalStringify(command), 'utf8').digest('hex');
}

function ensureCommand(command, required) {
  if (!command || typeof command !== 'object') throw new TypeError('INVALID_RELATIONSHIP_COMMAND');
  for (const field of ['command_id', 'idempotency_key', 'principal_id', ...required]) {
    if (typeof command[field] !== 'string' || command[field].length === 0) {
      throw new TypeError(`INVALID_RELATIONSHIP_COMMAND:${field}`);
    }
  }
}

function baseEvent(command, context, eventType, suffix, payload) {
  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  return {
    event_id: `evt:${command.command_id}:${suffix}`,
    schema_version: '0.1',
    event_type: eventType,
    actor_id: context.principalActorId,
    principal_id: command.principal_id,
    causation_id: command.command_id,
    correlation_id: command.correlation_id ?? command.command_id,
    occurred_at: timestamp,
    recorded_at: timestamp,
    time_source: command.time_source ?? 'system',
    provenance_refs: command.provenance_refs ?? [],
    payload
  };
}

function authorityOrThrow(request) {
  const receipt = evaluateAuthority(request);
  if (receipt.decision !== 'allow') throw new PolicyDeniedError();
  return receipt;
}

function proposeRelationship(command, context) {
  ensureCommand(command, ['source_entity_id', 'target_entity_id', 'relationship_type']);
  const relationshipId = command.relationship_id ?? deriveId('rel', command.command_id);
  const policy = resolveRelationshipPolicy(command.relationship_type);
  const visibility = resolveVisibility({ requestedVisibility: command.visibility ?? null, policy });
  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();

  const authorityReceipt = authorityOrThrow({
    command_id: command.command_id,
    principal_id: command.principal_id,
    actor_id: context.principalActorId,
    principal_actor_id: context.principalActorId,
    requested_action: 'relationship.propose',
    aggregate_id: relationshipId,
    source_entity_id: command.source_entity_id,
    target_entity_id: command.target_entity_id,
    relationship_policy: policy,
    policy_ref: policy.relationship_policy_ref,
    credential_refs: context.credentialRefs ?? [],
    evaluated_at: context.evaluatedAt ?? timestamp
  });

  const proposalPayload = {
    relationship_id: relationshipId,
    source_entity_id: command.source_entity_id,
    target_entity_id: command.target_entity_id,
    relationship_type: command.relationship_type,
    scope_ref: command.scope_ref ?? null,
    taxonomy_ref: policy.taxonomy_ref,
    visibility,
    visibility_policy_ref: policy.visibility_policy_ref,
    relationship_policy_ref: policy.relationship_policy_ref
  };
  const events = [baseEvent(command, context, 'relationship.proposed', 'proposed', proposalPayload)];
  if (policy.activation === 'unilateral') {
    events.push(baseEvent(command, context, 'relationship.activated', 'activated', {}));
  }

  const receipt = context.eventStore.append({
    streamType: 'relationship',
    streamId: relationshipId,
    expectedVersion: 0,
    events,
    authorityReceipt,
    commandReceipt: {
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      command_digest: digestCommand(command),
      status: 'accepted',
      created_at: timestamp
    }
  });

  return { relationship_id: relationshipId, receipt };
}

function activateRelationship(command, context) {
  ensureCommand(command, ['relationship_id']);
  const events = context.eventStore.readStream('relationship', command.relationship_id);
  const state = foldRelationship(events);
  if (state.lifecycle !== 'proposed') throw new InvalidTransitionError('RELATIONSHIP_CANNOT_ACTIVATE');
  const policy = resolveRelationshipPolicy(state.relationship_type, state.taxonomy_ref);
  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  const authorityReceipt = authorityOrThrow({
    command_id: command.command_id,
    principal_id: command.principal_id,
    actor_id: context.principalActorId,
    principal_actor_id: context.principalActorId,
    requested_action: 'relationship.activate',
    aggregate_id: command.relationship_id,
    relationship_state: state,
    relationship_policy: policy,
    policy_ref: policy.relationship_policy_ref,
    credential_refs: context.credentialRefs ?? [],
    evaluated_at: context.evaluatedAt ?? timestamp
  });

  const receipt = context.eventStore.append({
    streamType: 'relationship',
    streamId: command.relationship_id,
    expectedVersion: command.expected_version,
    events: [baseEvent(command, context, 'relationship.activated', 'activated', {})],
    authorityReceipt,
    commandReceipt: {
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      command_digest: digestCommand(command),
      status: 'accepted',
      created_at: timestamp
    }
  });
  return { relationship_id: command.relationship_id, receipt };
}


const IMMUTABLE_COMMAND_FIELDS = [
  'source_entity_id',
  'target_entity_id',
  'relationship_type',
  'scope_ref',
  'taxonomy_ref',
  'visibility',
  'visibility_policy_ref'
];

function rejectImmutableMutationAttempt(command) {
  for (const field of IMMUTABLE_COMMAND_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(command, field)) {
      throw new InvalidTransitionError(`IMMUTABLE_FIELD_CHANGED:${field}`);
    }
  }
}

function appendRelationshipEvent(command, context, { eventType, suffix, action, payload }) {
  ensureCommand(command, ['relationship_id']);
  rejectImmutableMutationAttempt(command);
  const history = context.eventStore.readStream('relationship', command.relationship_id);
  const state = foldRelationship(history);
  const policy = resolveRelationshipPolicy(state.relationship_type, state.taxonomy_ref);
  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  const authorityReceipt = authorityOrThrow({
    command_id: command.command_id,
    principal_id: command.principal_id,
    actor_id: context.principalActorId,
    principal_actor_id: context.principalActorId,
    requested_action: action,
    aggregate_id: command.relationship_id,
    relationship_state: state,
    relationship_policy: policy,
    policy_ref: policy.relationship_policy_ref,
    credential_refs: context.credentialRefs ?? [],
    evaluated_at: context.evaluatedAt ?? timestamp
  });
  const draft = baseEvent(command, context, eventType, suffix, payload);

  // Semantic preflight. The EventStore still owns concurrency enforcement.
  foldRelationship([
    ...history,
    { ...draft, stream_seq: state.stream_version + 1 }
  ]);

  const receipt = context.eventStore.append({
    streamType: 'relationship',
    streamId: command.relationship_id,
    expectedVersion: command.expected_version,
    events: [draft],
    authorityReceipt,
    commandReceipt: {
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      command_digest: digestCommand(command),
      status: 'accepted',
      created_at: timestamp
    }
  });
  return { relationship_id: command.relationship_id, receipt };
}

function terminateRelationship(command, context) {
  return appendRelationshipEvent(command, context, {
    eventType: 'relationship.terminated',
    suffix: 'terminated',
    action: 'relationship.terminate',
    payload: { reason: command.reason ?? 'other' }
  });
}

function openContestation(command, context) {
  ensureCommand(command, ['relationship_id', 'contestation_id']);
  return appendRelationshipEvent(command, context, {
    eventType: 'relationship.contestation_opened',
    suffix: 'contestation-opened',
    action: 'relationship.contestation_open',
    payload: {
      contestation_id: command.contestation_id,
      claim: command.claim ?? null,
      evidence_refs: command.evidence_refs ?? []
    }
  });
}

function resolveContestation(command, context) {
  ensureCommand(command, ['relationship_id', 'contestation_id', 'resolution']);
  return appendRelationshipEvent(command, context, {
    eventType: 'relationship.contestation_resolved',
    suffix: 'contestation-resolved',
    action: 'relationship.contestation_resolve',
    payload: {
      contestation_id: command.contestation_id,
      resolution: command.resolution,
      evidence_refs: command.evidence_refs ?? []
    }
  });
}

function addEvidence(command, context) {
  ensureCommand(command, ['relationship_id', 'evidence_ref']);
  return appendRelationshipEvent(command, context, {
    eventType: 'relationship.evidence_added',
    suffix: 'evidence-added',
    action: 'relationship.evidence_add',
    payload: { evidence_ref: command.evidence_ref }
  });
}

function addAnnotation(command, context) {
  ensureCommand(command, ['relationship_id', 'note']);
  return appendRelationshipEvent(command, context, {
    eventType: 'relationship.annotation_added',
    suffix: 'annotation-added',
    action: 'relationship.annotation_add',
    payload: { note: command.note }
  });
}

module.exports = {
  proposeRelationship,
  activateRelationship,
  terminateRelationship,
  openContestation,
  resolveContestation,
  addEvidence,
  addAnnotation
};
