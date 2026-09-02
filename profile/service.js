const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { deriveId } = require('../core/ids');
const { PolicyDeniedError, InvalidTransitionError, IdempotencyConflictError } = require('../core/errors');
const { foldEntity } = require('../entity/fold');
const { foldProfileAssertions } = require('./fold');
const {
  PROFILE_FIELD_REGISTRY_REF,
  getProfileField,
  resolveAssertionVisibility
} = require('./field-registry');
const { validateAssertionPayload } = require('./schemas');

function digestCommand(command) {
  return createHash('sha256').update(canonicalStringify(command), 'utf8').digest('hex');
}

function requireString(command, field) {
  if (typeof command[field] !== 'string' || command[field].length === 0) {
    throw new TypeError(`INVALID_PROFILE_COMMAND:${field}`);
  }
}

function validateCommandEnvelope(command) {
  if (!command || typeof command !== 'object') throw new TypeError('INVALID_PROFILE_COMMAND');
  for (const field of ['command_id', 'idempotency_key', 'principal_id', 'actor_id', 'field_ref', 'operation']) {
    requireString(command, field);
  }
  if (Object.prototype.hasOwnProperty.call(command, 'scope_ref')) {
    throw new TypeError('PROFILE_ASSERTION_SCOPE_FORBIDDEN');
  }
  if (Object.prototype.hasOwnProperty.call(command, 'verified')) {
    throw new TypeError('PROFILE_ASSERTION_VERIFICATION_FORBIDDEN');
  }
  return command;
}

function authorityOrThrow(authorize, request) {
  const receipt = authorize(request);
  if (!receipt || receipt.decision !== 'allow') throw new PolicyDeniedError();
  return receipt;
}

function addEntityAssertion(command, context) {
  validateCommandEnvelope(command);
  const commandDigest = digestCommand(command);
  const assertionId = command.assertion_id ?? deriveId('assert', command.command_id);
  const prior = context.eventStore.lookupIdempotency(command.idempotency_key);
  if (prior) {
    if (prior.command_digest !== commandDigest) throw new IdempotencyConflictError();
    return { assertion_id: assertionId, receipt: { ...prior, deduplicated: true } };
  }

  const history = context.eventStore.readStream('entity', command.actor_id);
  const entityState = foldEntity(history);
  if (entityState.lifecycle !== 'active' || entityState.entity_id !== command.actor_id) {
    throw new InvalidTransitionError('ENTITY_NOT_ACTIVE');
  }

  const profileState = foldProfileAssertions(history);
  const field = getProfileField(command.field_ref);
  let target = null;
  if (command.operation === 'retract') {
    target = profileState.assertions_by_id[command.target_assertion_id];
    if (!target || !target.active) throw new InvalidTransitionError('PROFILE_RETRACT_TARGET_NOT_ACTIVE');
  }

  const requestedVisibility = command.visibility ?? command.requested_visibility ?? null;
  const visibility = resolveAssertionVisibility(
    field,
    requestedVisibility ?? (command.operation === 'retract' ? target.visibility : null)
  );
  const payload = {
    assertion_id: assertionId,
    field_ref: command.field_ref,
    operation: command.operation,
    visibility,
    field_registry_ref: PROFILE_FIELD_REGISTRY_REF
  };

  if (command.operation === 'assert') {
    payload.value = command.value;
    payload.supersedes_assertion_id = command.supersedes_assertion_id ?? null;
  } else {
    payload.target_assertion_id = command.target_assertion_id;
  }
  validateAssertionPayload(payload);

  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  const draft = {
    event_id: `evt:${command.command_id}:assertion`,
    schema_version: '0.1',
    event_type: 'entity.assertion_added',
    actor_id: command.actor_id,
    principal_id: command.principal_id,
    causation_id: command.command_id,
    correlation_id: command.correlation_id ?? command.command_id,
    occurred_at: timestamp,
    recorded_at: timestamp,
    time_source: command.time_source ?? 'system',
    provenance_refs: command.provenance_refs ?? [],
    payload
  };

  // Semantic preflight is derived from canonical history only.
  foldProfileAssertions([
    ...history,
    { ...draft, stream_seq: entityState.stream_version + 1 }
  ]);

  const authorityReceipt = authorityOrThrow(context.authorize, {
    command_id: command.command_id,
    principal_id: command.principal_id,
    actor_id: command.actor_id,
    principal_actor_id: context.principalActorId,
    target_entity_id: command.actor_id,
    requested_action: 'entity.assertion_add',
    aggregate_id: command.actor_id,
    policy_ref: 'policy:entity-self-assertion:v1',
    credential_refs: context.credentialRefs ?? [],
    evaluated_at: context.evaluatedAt ?? timestamp
  });

  const receipt = context.eventStore.append({
    streamType: 'entity',
    streamId: command.actor_id,
    expectedVersion: entityState.stream_version,
    events: [draft],
    authorityReceipt,
    commandReceipt: {
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      command_digest: commandDigest,
      status: 'accepted',
      created_at: timestamp
    }
  });

  return { assertion_id: assertionId, receipt };
}

module.exports = { addEntityAssertion };
