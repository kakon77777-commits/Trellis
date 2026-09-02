const { represents } = require('../profile/read-policy');

function relationshipViewerScope(relationship, viewerContext = {}) {
  const viewerActorId = viewerContext.viewer_actor_id ?? null;
  if (viewerActorId && [relationship.source_entity_id, relationship.target_entity_id].includes(viewerActorId)) {
    return 'participant';
  }
  if ([relationship.source_entity_id, relationship.target_entity_id]
    .some(actorId => represents(viewerContext, actorId))) {
    return 'representative';
  }
  return 'public';
}

module.exports = { relationshipViewerScope };
