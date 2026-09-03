const { canViewRelationship } = require('../profile/read-policy');
const { createMembershipResolver } = require('../community/membership-read');
const { authorizeFeedSubject } = require('./context');

const ACTOR_SOURCE_TYPES = new Set(['follows', 'subscribes_to']);

function sourceRelationshipView(row) {
  return {
    relationship_id: row.relationship_id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    relationship_type: row.relationship_type,
    scope_ref: row.scope_ref ?? null,
    visibility: row.visibility,
    lifecycle: row.lifecycle
  };
}

function buildFeedSourceGraph({
  subjectActorId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy
}) {
  void eventStore;
  const { viewer_scope } = authorizeFeedSubject(subjectActorId, viewerContext);
  const membershipResolver = createMembershipResolver(db);
  const rows = db.prepare(`
    SELECT * FROM relationships_current
    WHERE source_entity_id = ?
      AND lifecycle = 'active'
      AND relationship_type IN ('follows', 'subscribes_to', 'member_of')
    ORDER BY relationship_id
  `).all(subjectActorId);

  const visible = rows.filter(row =>
    canViewRelationship(row, viewerContext, disclosurePolicy, membershipResolver)
  );

  const actorSourceIds = new Set();
  const communitySourceIds = new Set();
  for (const row of visible) {
    if (ACTOR_SOURCE_TYPES.has(row.relationship_type)) actorSourceIds.add(row.target_entity_id);
    else if (row.relationship_type === 'member_of') communitySourceIds.add(row.target_entity_id);
  }

  return {
    subject_actor_id: subjectActorId,
    viewer_scope,
    actor_source_ids: [...actorSourceIds].sort(),
    community_source_ids: [...communitySourceIds].sort(),
    source_relationships: visible.map(sourceRelationshipView)
  };
}

module.exports = { buildFeedSourceGraph, sourceRelationshipView };
