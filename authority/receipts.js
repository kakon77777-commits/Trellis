const { deriveId } = require('../core/ids');

function createAuthorityReceipt(request, decision, policyRef) {
  return {
    decision_id: deriveId('authz', `${request.command_id}:${request.requested_action}`),
    principal_id: request.principal_id,
    actor_id: request.actor_id,
    policy_ref: policyRef,
    requested_action: request.requested_action,
    aggregate_id: request.aggregate_id ?? null,
    credential_refs: request.credential_refs ?? [],
    decision,
    evaluated_at: request.evaluated_at ?? new Date().toISOString()
  };
}

module.exports = { createAuthorityReceipt };
