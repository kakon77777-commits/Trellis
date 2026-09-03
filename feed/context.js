const { canonicalStringify } = require('../core/canonical-json');

function representedActors(viewerContext = {}) {
  return [...new Set(viewerContext.represents_actor_ids ?? [])].sort();
}

function authorizeFeedSubject(subjectActorId, viewerContext = {}) {
  if (typeof subjectActorId !== 'string' || subjectActorId.length === 0) {
    throw new TypeError('INVALID_FEED_SUBJECT');
  }
  if (viewerContext.viewer_actor_id === subjectActorId) {
    return { viewer_scope: 'self' };
  }
  if (representedActors(viewerContext).includes(subjectActorId)) {
    return { viewer_scope: 'representative' };
  }
  throw new Error('FEED_NOT_AUTHORIZED');
}

function feedViewerIdentityKey(viewerContext = {}) {
  return canonicalStringify({
    viewer_actor_id: viewerContext.viewer_actor_id ?? null,
    represents_actor_ids: representedActors(viewerContext)
  });
}

module.exports = { authorizeFeedSubject, feedViewerIdentityKey, representedActors };
