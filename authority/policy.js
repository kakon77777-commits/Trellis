const { validateAuthorityRequest } = require('./schemas');
const { createAuthorityReceipt } = require('./receipts');

function hasExplicitCapability(request) {
  return (request.capability_grants ?? []).some(grant =>
    grant.active === true &&
    grant.principal_id === request.principal_id &&
    grant.capability === request.capability &&
    (grant.scope_ref ?? null) === (request.scope_ref ?? null)
  );
}

function relationshipDecision(request) {
  const state = request.relationship_state;
  const policy = request.relationship_policy;
  const principalActorId = request.principal_actor_id;

  switch (request.requested_action) {
    case 'relationship.propose':
      return principalActorId === request.source_entity_id;
    case 'relationship.activate':
      if (!state || !policy) return false;
      if (policy.activation === 'unilateral') {
        return principalActorId === state.source_entity_id;
      }
      if (['bilateral_consent', 'bilateral_plus_authority_check', 'membership_policy'].includes(policy.activation)) {
        return principalActorId === state.target_entity_id;
      }
      return false;
    case 'relationship.terminate':
    case 'relationship.contestation_open':
    case 'relationship.contestation_resolve':
    case 'relationship.evidence_add':
    case 'relationship.annotation_add':
      if (!state) return false;
      return [state.source_entity_id, state.target_entity_id].includes(principalActorId);
    default:
      return false;
  }
}

function evaluateAuthority(request) {
  validateAuthorityRequest(request);
  let allowed = false;
  let policyRef = request.policy_ref ?? 'policy:default-deny:v1';

  if (request.requested_action === 'entity.register') {
    allowed = Boolean(request.principal_id && request.actor_id);
    policyRef = request.policy_ref ?? 'policy:entity-register:v1';
  } else if (request.requested_action === 'protected.execute') {
    allowed = hasExplicitCapability(request);
    policyRef = request.policy_ref ?? 'policy:explicit-capability:v1';
  } else if (request.requested_action.startsWith('relationship.')) {
    allowed = relationshipDecision(request);
    policyRef = request.policy_ref ?? request.relationship_policy?.relationship_policy_ref ?? 'policy:relationship:v1';
  }

  return createAuthorityReceipt(request, allowed ? 'allow' : 'deny', policyRef);
}

module.exports = { evaluateAuthority };
