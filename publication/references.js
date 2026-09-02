const { InvalidTransitionError } = require('../core/errors');
const { isActiveCommunityMember } = require('../community/membership-read');

function invalid(message) { throw new InvalidTransitionError(message); }

function actorCanReadParentAtCreation(parent, actorId, db) {
  if (parent.author_actor_id === actorId) return true;
  switch (parent.visibility) {
    case 'public': return true;
    case 'private': return false;
    case 'participants': return parent.audience_actor_ids.includes(actorId);
    case 'scope_members': return isActiveCommunityMember(db, parent.scope_ref, actorId);
    default: return false;
  }
}

function effectiveParticipants(publication) {
  return new Set([publication.author_actor_id, ...(publication.audience_actor_ids ?? [])]);
}

function allIn(set, allowed) {
  for (const value of set) if (!allowed.has(value)) return false;
  return true;
}

function isChildAudienceSubsetOfParent({ childDraft, parentState, db }) {
  if (parentState.visibility === 'public') return true;

  if (parentState.visibility === 'private') {
    return childDraft.visibility === 'private';
  }

  if (parentState.visibility === 'participants') {
    if (childDraft.visibility === 'private') return true;
    if (childDraft.visibility !== 'participants') return false;
    return allIn(effectiveParticipants(childDraft), effectiveParticipants(parentState));
  }

  if (parentState.visibility === 'scope_members') {
    if (childDraft.visibility === 'private') return true;
    if (childDraft.visibility === 'scope_members') {
      if (childDraft.scope_ref !== parentState.scope_ref) invalid('PUBLICATION_REFERENCE_SCOPE_WIDENED');
      return true;
    }
    if (childDraft.visibility === 'participants') {
      return [...effectiveParticipants(childDraft)]
        .every(actorId => isActiveCommunityMember(db, parentState.scope_ref, actorId));
    }
    return false;
  }

  return false;
}

function validatePublicationReferenceCreation({ childDraft, parentState, actorId, db }) {
  if (!parentState || parentState.lifecycle === 'nonexistent') invalid('PUBLICATION_REFERENCE_NOT_FOUND');
  if (parentState.lifecycle !== 'active') invalid('PUBLICATION_REFERENCE_TARGET_WITHDRAWN');
  if (childDraft.publication_id === parentState.publication_id) invalid('PUBLICATION_SELF_REFERENCE');
  if (!actorCanReadParentAtCreation(parentState, actorId, db)) invalid('PUBLICATION_REFERENCE_NOT_READABLE');
  if (!isChildAudienceSubsetOfParent({ childDraft, parentState, db })) invalid('PUBLICATION_REFERENCE_AUDIENCE_WIDENED');
  return true;
}

module.exports = { validatePublicationReferenceCreation, isChildAudienceSubsetOfParent, actorCanReadParentAtCreation };

function resolveReferenceContext({ publication, viewerContext = {}, db, disclosurePolicy, membershipResolver }) {
  const targetRef = publication.reply_to_ref ?? publication.quote_of_ref ?? null;
  if (!targetRef) return null;
  const { normalizePublicationRow, canViewPublication } = require('./read-policy');
  const row = db.prepare('SELECT * FROM publications_current WHERE publication_id = ?').get(targetRef);
  const target = normalizePublicationRow(row);
  if (!target) return { status: 'unavailable' };
  if (!canViewPublication(target, viewerContext, disclosurePolicy, membershipResolver)) return { status: 'unavailable' };
  if (target.lifecycle === 'withdrawn') return { status: 'withdrawn', publication_id: target.publication_id };
  return {
    status: 'active',
    publication_id: target.publication_id,
    author_actor_id: target.author_actor_id,
    preview: target.current_body.slice(0, 160)
  };
}

module.exports.resolveReferenceContext = resolveReferenceContext;
