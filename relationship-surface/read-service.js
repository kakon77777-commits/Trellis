const { canViewRelationship } = require('../profile/read-policy');
const { foldRelationship } = require('../relationship/fold');
const { relationshipViewerScope } = require('./read-policy');
const { projectRelationshipHistory } = require('./history');
const { availableRelationshipActions } = require('./action-hints');

function loadRelationshipRow(db, relationshipId) {
  return db.prepare(`
    SELECT * FROM relationships_current
    WHERE relationship_id = ?
  `).get(relationshipId) ?? null;
}

function loadRelationshipDetail({
  relationshipId,
  viewerContext = {},
  eventStore,
  db,
  disclosurePolicy
}) {
  const relationship = loadRelationshipRow(db, relationshipId);
  if (!relationship) return null;
  if (!canViewRelationship(relationship, viewerContext, disclosurePolicy)) return null;

  const events = eventStore.readStream('relationship', relationshipId);
  if (events.length === 0) return null;
  const state = foldRelationship(events);
  const projectedHistory = projectRelationshipHistory({ events, db });
  return {
    relationship_id: state.relationship_id,
    source_actor: {
      actor_id: state.source_entity_id,
      profile_ref: `/actors/${encodeURIComponent(state.source_entity_id)}`
    },
    target_actor: {
      actor_id: state.target_entity_id,
      profile_ref: `/actors/${encodeURIComponent(state.target_entity_id)}`
    },
    relationship_type: state.relationship_type,
    scope_ref: state.scope_ref ?? null,
    taxonomy_ref: state.taxonomy_ref,
    visibility: state.visibility,
    lifecycle: state.lifecycle,
    termination_reason: state.termination_reason ?? null,
    history: projectedHistory.history,
    evidence: projectedHistory.evidence,
    contestations: projectedHistory.contestations,
    annotations: projectedHistory.annotations,
    available_actions: availableRelationshipActions({ relationship: state, viewerContext }),
    execution_authority: { implied_by_relationship: false },
    viewer_scope: relationshipViewerScope(state, viewerContext),
    projection_version: 'relationship-surface:0.1'
  };
}

module.exports = { loadRelationshipDetail, loadRelationshipRow };
