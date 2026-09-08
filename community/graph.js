const { canViewRelationship } = require('../profile/read-policy');
const { createMembershipResolver } = require('./membership-read');
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

async function buildCommunityLocalGraph({communityId,viewerContext={},db,eventStore,disclosurePolicy}){
  const resolver=await createMembershipResolver(db);
  const viewerScope=await communityViewerScope({communityId,viewerContext,db,eventStore,membershipResolver:resolver});
  if(!viewerScope)return null;
  const candidates=await db.all(`
    SELECT * FROM relationships_current
    WHERE scope_ref = ?
      AND lifecycle = 'active'
      AND relationship_type <> 'member_of'
    ORDER BY relationship_id
  `,[communityId]);
  const visible=candidates.filter(row=>
    resolver(communityId,row.source_entity_id)&&
    resolver(communityId,row.target_entity_id)&&
    canViewRelationship(row,viewerContext,disclosurePolicy,resolver)
  ).map(graphRelationshipView);
  return{visible_scoped_relationships:visible,visible_relationship_count:visible.length};
}

module.exports={buildCommunityLocalGraph,graphRelationshipView};
