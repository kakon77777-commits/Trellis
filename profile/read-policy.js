function represents(viewerContext, actorId) {
  return (viewerContext?.represents_actor_ids ?? []).includes(actorId);
}

function isSelfOrRepresentative(viewerContext, actorId) {
  return viewerContext?.viewer_actor_id === actorId || represents(viewerContext, actorId);
}

function isRelationshipEndpointViewer(relationship, viewerContext) {
  const viewerActorId = viewerContext?.viewer_actor_id ?? null;
  if (viewerActorId && [relationship.source_entity_id, relationship.target_entity_id].includes(viewerActorId)) return true;
  return [relationship.source_entity_id, relationship.target_entity_id]
    .some(actorId => represents(viewerContext, actorId));
}

function scopeMembersReadable(relationship, viewerContext, membershipResolver) {
  if (isRelationshipEndpointViewer(relationship, viewerContext)) return true;
  if (!relationship.scope_ref || typeof membershipResolver !== 'function') return false;
  const candidates = [
    viewerContext?.viewer_actor_id ?? null,
    ...(viewerContext?.represents_actor_ids ?? [])
  ].filter(Boolean);
  return candidates.some(actorId => membershipResolver(relationship.scope_ref, actorId));
}

function canonicalRelationshipReadable(relationship, viewerContext, membershipResolver) {
  switch (relationship.visibility) {
    case 'public': return true;
    case 'participants':
    case 'private': return isRelationshipEndpointViewer(relationship, viewerContext);
    case 'scope_members': return scopeMembersReadable(relationship, viewerContext, membershipResolver);
    default: return false;
  }
}

function currentPolicyAllows(value, viewerContext, disclosurePolicy) {
  if (!disclosurePolicy) return true;
  return disclosurePolicy(value, viewerContext) !== 'deny';
}

function canViewRelationship(relationship, viewerContext, disclosurePolicy, membershipResolver) {
  if (!canonicalRelationshipReadable(relationship, viewerContext, membershipResolver)) return false;
  return currentPolicyAllows(relationship, viewerContext, disclosurePolicy);
}

function hasQualifiedDirectRelationship(actorId, viewerContext, relationships, disclosurePolicy, membershipResolver) {
  const viewerActorId = viewerContext?.viewer_actor_id ?? null;
  if (!viewerActorId || viewerActorId === actorId) return false;
  return relationships.some(relationship => {
    if (relationship.lifecycle !== 'active') return false;
    const isDirectPair =
      (relationship.source_entity_id === actorId && relationship.target_entity_id === viewerActorId) ||
      (relationship.target_entity_id === actorId && relationship.source_entity_id === viewerActorId);
    return isDirectPair && canViewRelationship(relationship, viewerContext, disclosurePolicy, membershipResolver);
  });
}

function canViewAssertion(assertion, actorId, viewerContext, relationships, disclosurePolicy, membershipResolver) {
  let canonicalAllowed = false;
  if (assertion.visibility === 'public') canonicalAllowed = true;
  else if (assertion.visibility === 'private') canonicalAllowed = isSelfOrRepresentative(viewerContext, actorId);
  else if (assertion.visibility === 'participants') {
    canonicalAllowed = isSelfOrRepresentative(viewerContext, actorId) ||
      hasQualifiedDirectRelationship(actorId, viewerContext, relationships, disclosurePolicy, membershipResolver);
  }
  if (!canonicalAllowed) return false;
  return currentPolicyAllows(assertion, viewerContext, disclosurePolicy);
}

module.exports = {
  represents,
  isSelfOrRepresentative,
  canViewRelationship,
  canViewAssertion,
  hasQualifiedDirectRelationship,
  scopeMembersReadable
};
