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


function publicationDecision(request) {
  const principalActorId = request.principal_actor_id;
  if (request.requested_action === 'publication.create') {
    if (principalActorId !== request.author_actor_id) return false;
    if (request.scope_ref && String(request.scope_ref).startsWith('community:')) {
      return request.active_membership === true && hasExplicitCapability({
        ...request,
        capability: 'publication:create',
        scope_ref: request.scope_ref
      });
    }
    return true;
  }
  if (request.requested_action === 'publication.revise' || request.requested_action === 'publication.withdraw') {
    return Boolean(request.publication_state) && principalActorId === request.publication_state.author_actor_id;
  }
  return false;
}


function reactionDecision(request) {
  const principalActorId = request.principal_actor_id;
  if (['reaction.create', 'reaction.change', 'reaction.restore'].includes(request.requested_action)) {
    return Boolean(
      request.actor_id &&
      principalActorId === request.actor_id &&
      request.publication_active === true &&
      request.publication_readable === true
    );
  }
  if (request.requested_action === 'reaction.withdraw') {
    return Boolean(
      request.reaction_state &&
      request.reaction_state.lifecycle === 'active' &&
      principalActorId === request.reaction_state.actor_id
    );
  }
  return false;
}



function preferenceDecision(request) {
  if (request.requested_action === 'preference.create') {
    return Boolean(request.owner_actor_id && request.principal_actor_id === request.owner_actor_id);
  }
  if (request.requested_action === 'preference.withdraw' || request.requested_action === 'preference.restore') {
    return Boolean(request.preference_state && request.principal_actor_id === request.preference_state.owner_actor_id);
  }
  return false;
}

function notificationDecision(request) {
  if (request.requested_action === 'notification.issue') {
    return hasExplicitCapability({ ...request, capability: 'notification:issue', scope_ref: null });
  }
  if (request.requested_action === 'notification.ack') {
    return Boolean(
      request.notification_state &&
      request.principal_actor_id &&
      request.principal_actor_id === request.notification_state.recipient_actor_id
    );
  }
  return false;
}

function evaluateAuthority(request) {
  validateAuthorityRequest(request);
  let allowed = false;
  let policyRef = request.policy_ref ?? 'policy:default-deny:v1';

  if (request.requested_action === 'entity.register') {
    allowed = Boolean(request.principal_id && request.actor_id);
    policyRef = request.policy_ref ?? 'policy:entity-register:v1';
  } else if (request.requested_action === 'entity.assertion_add') {
    allowed = Boolean(
      request.principal_id &&
      request.actor_id &&
      request.principal_actor_id &&
      request.target_entity_id &&
      request.principal_actor_id === request.target_entity_id
    );
    policyRef = request.policy_ref ?? 'policy:entity-self-assertion:v1';
  } else if (request.requested_action === 'protected.execute') {
    allowed = hasExplicitCapability(request);
    policyRef = request.policy_ref ?? 'policy:explicit-capability:v1';
  } else if (request.requested_action.startsWith('relationship.')) {
    allowed = relationshipDecision(request);
    policyRef = request.policy_ref ?? request.relationship_policy?.relationship_policy_ref ?? 'policy:relationship:v1';
  } else if (request.requested_action.startsWith('publication.')) {
    allowed = publicationDecision(request);
    policyRef = request.policy_ref ?? 'trellis-publication-policy:0.1';
  } else if (request.requested_action.startsWith('reaction.')) {
    allowed = reactionDecision(request);
    policyRef = request.policy_ref ?? 'policy:reaction-on-readable-publication:v1';
  } else if (request.requested_action.startsWith('notification.')) {
    allowed = notificationDecision(request);
    policyRef = request.policy_ref ?? 'policy:notification-processor:v1';
  } else if (request.requested_action.startsWith('preference.')) {
    allowed = preferenceDecision(request);
    policyRef = request.policy_ref ?? 'policy:preference-owner:v1';
  }

  return createAuthorityReceipt(request, allowed ? 'allow' : 'deny', policyRef);
}

module.exports = { evaluateAuthority };
