const { resolvePublicationPolicy } = require('./types');
const { isActiveCommunityMember } = require('../community/membership-read');

function isCommunityScope(scopeRef) {
  return typeof scopeRef === 'string' && scopeRef.startsWith('community:');
}

function resolvePublicationCreationPolicy(command) {
  const policy = resolvePublicationPolicy(command.publication_type);
  const scopeRef = command.scope_ref ?? null;
  const visibility = command.visibility ?? (isCommunityScope(scopeRef) ? 'scope_members' : 'public');
  return { ...policy, scope_ref: scopeRef, visibility };
}

async function activeCommunityMembership(db, scopeRef, actorId) {
  if (!isCommunityScope(scopeRef)) return false;
  return await isActiveCommunityMember(db, scopeRef, actorId);
}

module.exports = { isCommunityScope, resolvePublicationCreationPolicy, activeCommunityMembership };
