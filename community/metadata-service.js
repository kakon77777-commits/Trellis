const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { deriveId } = require('../core/ids');
const { PolicyDeniedError, InvalidTransitionError, IdempotencyConflictError } = require('../core/errors');
const { foldEntity } = require('../entity/fold');
const { foldCommunityAssertions } = require('./fold');
const { COMMUNITY_FIELD_REGISTRY_REF, getCommunityField, resolveCommunityAssertionVisibility } = require('./field-registry');
const { validateCommunityAssertionPayload } = require('./schemas');

function digestCommand(command) { return createHash('sha256').update(canonicalStringify(command), 'utf8').digest('hex'); }
function required(command, field) { if (typeof command[field] !== 'string' || command[field].length === 0) throw new TypeError(`INVALID_COMMUNITY_COMMAND:${field}`); }

function addCommunityAssertion(command, context) {
  if (!command || typeof command !== 'object') throw new TypeError('INVALID_COMMUNITY_COMMAND');
  for (const field of ['command_id','idempotency_key','principal_id','community_id','field_ref']) required(command, field);
  const commandDigest = digestCommand(command);
  const assertionId = command.assertion_id ?? deriveId('assert', command.command_id);
  const prior = context.eventStore.lookupIdempotency(command.idempotency_key);
  if (prior) {
    if (prior.command_digest !== commandDigest) throw new IdempotencyConflictError();
    return { assertion_id: assertionId, receipt:{ ...prior, deduplicated:true } };
  }

  const history = context.eventStore.readStream('entity', command.community_id);
  const entityState = foldEntity(history);
  if (entityState.lifecycle !== 'active' || entityState.entity_kind !== 'community' || entityState.entity_id !== command.community_id) {
    throw new InvalidTransitionError('COMMUNITY_NOT_ACTIVE');
  }
  const communityState = foldCommunityAssertions(history);
  const field = getCommunityField(command.field_ref);
  const visibility = resolveCommunityAssertionVisibility(field, command.visibility ?? null);
  const payload = {
    assertion_id: assertionId,
    field_ref: command.field_ref,
    operation: 'assert',
    value: command.value,
    visibility,
    field_registry_ref: COMMUNITY_FIELD_REGISTRY_REF,
    supersedes_assertion_id: command.supersedes_assertion_id ?? null
  };
  validateCommunityAssertionPayload(payload);
  const timestamp = command.occurred_at ?? context.evaluatedAt ?? new Date().toISOString();
  const draft = {
    event_id:`evt:${command.command_id}:assertion`, schema_version:'0.1', event_type:'entity.assertion_added',
    actor_id:command.community_id, principal_id:command.principal_id, causation_id:command.command_id,
    correlation_id:command.correlation_id ?? command.command_id, occurred_at:timestamp, recorded_at:timestamp,
    time_source:command.time_source ?? 'system', provenance_refs:command.provenance_refs ?? [], payload
  };
  foldCommunityAssertions([...history, { ...draft, stream_seq:entityState.stream_version+1 }]);

  const authorityReceipt = context.authorize({
    command_id:command.command_id, principal_id:command.principal_id, actor_id:command.community_id,
    principal_actor_id:context.principalActorId, target_entity_id:command.community_id,
    requested_action:'entity.assertion_add', aggregate_id:command.community_id,
    policy_ref:'policy:entity-self-assertion:v1', credential_refs:context.credentialRefs ?? [],
    evaluated_at:context.evaluatedAt ?? timestamp
  });
  if (!authorityReceipt || authorityReceipt.decision !== 'allow') throw new PolicyDeniedError();

  const receipt = context.eventStore.append({
    streamType:'entity', streamId:command.community_id, expectedVersion:entityState.stream_version,
    events:[draft], authorityReceipt,
    commandReceipt:{ command_id:command.command_id, idempotency_key:command.idempotency_key, command_digest:commandDigest, status:'accepted', created_at:timestamp }
  });
  return { assertion_id:assertionId, receipt };
}

module.exports = { addCommunityAssertion };
