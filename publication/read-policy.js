const { isActiveCommunityMember } = require('../community/membership-read');

function representedActors(viewerContext = {}) {
  return viewerContext.represents_actor_ids ?? [];
}

function isAuthorOrRepresentative(publication, viewerContext = {}) {
  return viewerContext.viewer_actor_id === publication.author_actor_id || representedActors(viewerContext).includes(publication.author_actor_id);
}

function viewerCandidates(viewerContext = {}) {
  return [viewerContext.viewer_actor_id ?? null, ...representedActors(viewerContext)].filter(Boolean);
}

function normalizePublicationRow(row) {
  if (!row) return null;
  return {
    ...row,
    audience_actor_ids: Array.isArray(row.audience_actor_ids)
      ? row.audience_actor_ids
      : JSON.parse(row.audience_actor_ids_json ?? '[]')
  };
}

function canonicalPublicationReadable(publication, viewerContext = {}, membershipResolver) {
  if (isAuthorOrRepresentative(publication, viewerContext)) return true;
  switch (publication.visibility) {
    case 'public': return true;
    case 'private': return false;
    case 'participants': {
      const allowed = new Set(publication.audience_actor_ids ?? []);
      return viewerCandidates(viewerContext).some(actorId => allowed.has(actorId));
    }
    case 'scope_members': {
      const resolver = membershipResolver ?? ((scopeRef, actorId) => false);
      return viewerCandidates(viewerContext).some(actorId => resolver(publication.scope_ref, actorId));
    }
    default: return false;
  }
}

function canViewPublication(publicationInput, viewerContext = {}, disclosurePolicy, membershipResolver) {
  const publication = normalizePublicationRow(publicationInput);
  if (!publication) return false;
  if (!canonicalPublicationReadable(publication, viewerContext, membershipResolver)) return false;
  if (disclosurePolicy && disclosurePolicy(publication, viewerContext) === 'deny') return false;
  return true;
}

function publicationViewerScope(publicationInput, viewerContext = {}, membershipResolver) {
  const publication = normalizePublicationRow(publicationInput);
  if (!publication) return null;
  if (isAuthorOrRepresentative(publication, viewerContext)) return 'author';
  if (publication.visibility === 'scope_members') {
    const resolver = membershipResolver ?? (() => false);
    if (viewerCandidates(viewerContext).some(actorId => resolver(publication.scope_ref, actorId))) return 'scope_member';
  }
  if (publication.visibility === 'participants') return 'participant';
  return 'public';
}

module.exports = { normalizePublicationRow, canViewPublication, publicationViewerScope, isAuthorOrRepresentative };
