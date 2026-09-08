const ACTIVE_MEMBERSHIP_SQL = `
  SELECT source_entity_id,target_entity_id,scope_ref
  FROM relationships_current
  WHERE relationship_type = 'member_of'
    AND lifecycle = 'active'
`;

function membershipKey(communityId,actorId){return `${communityId}\u0000${actorId}`;}

async function isActiveCommunityMember(db,communityId,actorId){
  if(!db||!communityId||!actorId)return false;
  const row=await db.first(`${ACTIVE_MEMBERSHIP_SQL}
    AND target_entity_id = ?
    AND scope_ref = ?
    AND source_entity_id = ?
    LIMIT 1`,[communityId,communityId,actorId]);
  return Boolean(row);
}

async function createMembershipResolver(db){
  const rows=await db.all(`${ACTIVE_MEMBERSHIP_SQL} ORDER BY scope_ref,source_entity_id,target_entity_id`);
  const active=new Set(rows.map(row=>membershipKey(row.scope_ref,row.source_entity_id)));
  return (communityId,actorId)=>active.has(membershipKey(communityId,actorId));
}

module.exports={ACTIVE_MEMBERSHIP_SQL,isActiveCommunityMember,createMembershipResolver};
