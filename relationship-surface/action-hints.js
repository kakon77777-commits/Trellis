const { resolveRelationshipPolicy } = require('../relationship/taxonomy');

function availableRelationshipActions({ relationship, viewerContext = {} }) {
  if (!relationship || typeof relationship !== 'object') return [];
  const viewerActorId = viewerContext.viewer_actor_id ?? null;
  const endpoint = viewerActorId && [relationship.source_entity_id, relationship.target_entity_id].includes(viewerActorId);
  if (!endpoint) return [];

  const actions = [];
  if (relationship.lifecycle === 'proposed') {
    const policy = resolveRelationshipPolicy(relationship.relationship_type, relationship.taxonomy_ref);
    if (viewerActorId === relationship.target_entity_id && policy.activation !== 'unilateral') {
      actions.push('activate');
    }
    actions.push('terminate');
  } else if (relationship.lifecycle === 'active') {
    actions.push('terminate');
  }

  if (['proposed', 'active', 'terminated'].includes(relationship.lifecycle)) {
    actions.push('open_contestation', 'add_evidence', 'add_annotation');
    if ((relationship.open_contestation_count ?? 0) > 0) actions.push('resolve_contestation');
  }
  return actions;
}

module.exports = { availableRelationshipActions };
