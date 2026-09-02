function represents(viewerContext, actorId) {
  return (viewerContext?.represents_actor_ids ?? []).includes(actorId);
}

function availablePublicationActions({ publication, viewerContext = {} }) {
  if (!publication || publication.lifecycle !== 'active') return [];
  const viewerActorId = viewerContext.viewer_actor_id ?? null;
  if (!viewerActorId) return [];
  const actions = ['reply', 'quote'];
  if (viewerActorId === publication.author_actor_id || represents(viewerContext, publication.author_actor_id)) {
    actions.push('revise', 'withdraw');
  }
  return actions;
}

module.exports = { availablePublicationActions };
