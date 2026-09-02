const { canViewRelationship } = require('../profile/read-policy');
const { createMembershipResolver, isActiveCommunityMember } = require('./membership-read');
const { communityViewerScope } = require('./read-policy');

function graphRelationshipView(row) {
  return {
    relationship_id: row.relationship_id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    relationship_type: row.relationship_type,
    scope_ref: row.scope_ref,
    visibility: row.visibility,
    detail_ref: `/relationships/${encodeURIComponent(row.relationship_id)}`
  };
}

function buildCommunityLocalGraph({ communityId, viewerContext = {}, db, eventStore, disclosurePolicy }) {
  const viewerScope = communityViewerScope({ communityId, viewerContext, db, eventStore });
  if (!viewerScope) return null;
  const resolver = createMembershipResolver(db);
  const candidates = db.prepare(`
    SELECT * FROM relationships_current
    WHERE scope_ref = ?
      AND lifecycle = 'active'
      AND relationship_type <> 'member_of'
    ORDER BY relationship_id
  `).all(communityId);
  const visible = candidates.filter(row =>
    isActiveCommunityMember(db, communityId, row.source_entity_id) &&
    isActiveCommunityMember(db, communityId, row.target_entity_id) &&
    canViewRelationship(row, viewerContext, disclosurePolicy, resolver)
  ).map(graphRelationshipView);
  return {
    visible_scoped_relationships: visible,
    visible_relationship_count: visible.length
  };
}

module.exports = { buildCommunityLocalGraph, graphRelationshipView };
