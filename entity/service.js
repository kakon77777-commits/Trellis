const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { deriveId } = require('../core/ids');
const { PolicyDeniedError } = require('../core/errors');
const { validateRegisterActorCommand } = require('./schemas');

function digestCommand(command) {
  return createHash('sha256').update(canonicalStringify(command), 'utf8').digest('hex');
}

function registerActor(command, { eventStore, authorize }) {
  validateRegisterActorCommand(command);
  const entityId = command.entity_id ?? deriveId('actor', command.command_id);
  const actorId = entityId;
  const occurredAt = command.occurred_at ?? new Date().toISOString();
  const authorityReceipt = authorize({
    command_id: command.command_id,
    principal_id: command.principal_id,
    actor_id: actorId,
    requested_action: 'entity.register',
    aggregate_id: entityId,
    policy_ref: 'policy:entity-register:v1',
    credential_refs: command.credential_refs ?? [],
    evaluated_at: occurredAt
  });
  if (!authorityReceipt || authorityReceipt.decision !== 'allow') {
    throw new PolicyDeniedError();
  }

  const events = [{
    event_id: `evt:${command.command_id}:registered`,
    schema_version: '0.1',
    event_type: 'entity.registered',
    actor_id: actorId,
    principal_id: command.principal_id,
    causation_id: command.command_id,
    correlation_id: command.correlation_id ?? command.command_id,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    time_source: command.time_source ?? 'system',
    provenance_refs: command.provenance_refs ?? [],
    payload: {
      entity_id: entityId,
      entity_kind: 'actor',
      actor_capable: true,
      display_name: command.display_name ?? null
    }
  }];

  if (command.runtime_tag) {
    events.push({
      event_id: `evt:${command.command_id}:runtime`,
      schema_version: '0.1',
      event_type: 'entity.runtime_binding_added',
      actor_id: actorId,
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

module.exports = { registerActor };
