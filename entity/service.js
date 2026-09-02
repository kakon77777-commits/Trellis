const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { deriveId } = require('../core/ids');
const { PolicyDeniedError } = require('../core/errors');
const { validateRegisterEntityCommand, validateRegisterActorCommand } = require('./schemas');

function digestCommand(command) {
  return createHash('sha256').update(canonicalStringify(command), 'utf8').digest('hex');
}

function registerEntity(command, { eventStore, authorize }) {
  validateRegisterEntityCommand(command);
  const entityId = command.entity_id ?? deriveId(command.entity_kind, command.command_id);
  const occurredAt = command.occurred_at ?? new Date().toISOString();
  const authorityReceipt = authorize({
    command_id: command.command_id,
    principal_id: command.principal_id,
    actor_id: entityId,
    requested_action: 'entity.register',
    aggregate_id: entityId,
    policy_ref: 'policy:entity-register:v1',
    credential_refs: command.credential_refs ?? [],
    evaluated_at: occurredAt
  });
  if (!authorityReceipt || authorityReceipt.decision !== 'allow') throw new PolicyDeniedError();

  const events = [{
    event_id: `evt:${command.command_id}:registered`,
    schema_version: '0.1',
    event_type: 'entity.registered',
    actor_id: entityId,
    principal_id: command.principal_id,
    causation_id: command.command_id,
    correlation_id: command.correlation_id ?? command.command_id,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    time_source: command.time_source ?? 'system',
    provenance_refs: command.provenance_refs ?? [],
    payload: {
      entity_id: entityId,
      entity_kind: command.entity_kind,
      actor_capable: command.actor_capable,
      display_name: command.display_name ?? null
    }
  }];

  if (command.runtime_tag) {
    events.push({
      event_id: `evt:${command.command_id}:runtime`,
      schema_version: '0.1',
      event_type: 'entity.runtime_binding_added',
      actor_id: entityId,
      principal_id: command.principal_id,
      causation_id: command.command_id,
      correlation_id: command.correlation_id ?? command.command_id,
      occurred_at: occurredAt,
      recorded_at: occurredAt,
      time_source: command.time_source ?? 'system',
      provenance_refs: command.provenance_refs ?? [],
      payload: {
        runtime_id: command.runtime_tag,
        model: command.model ?? null,
        provider: command.provider ?? null
      }
    });
  }

  const receipt = eventStore.append({
    streamType: 'entity',
    streamId: entityId,
    expectedVersion: 0,
    events,
    authorityReceipt,
    commandReceipt: {
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      command_digest: digestCommand(command),
      status: 'accepted',
      created_at: occurredAt
    }
  });
  return { entity_id: entityId, receipt };
}

function registerActor(command, context) {
  validateRegisterActorCommand(command);
  return registerEntity({
    ...command,
    entity_kind: 'actor',
    actor_capable: true
  }, context);
}

module.exports = { registerEntity, registerActor };
