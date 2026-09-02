function isActiveCommunityMember(db, communityId, actorId) {
  if (!db || !communityId || !actorId) return false;
  const row = db.prepare(`
    SELECT 1 AS ok
    FROM relationships_current
    WHERE relationship_type = 'member_of'
      AND target_entity_id = ?
      AND scope_ref = ?
      AND source_entity_id = ?
      AND lifecycle = 'active'
    LIMIT 1
  `).get(communityId, communityId, actorId);
  return Boolean(row);
}

function createMembershipResolver(db) {
  return (communityId, actorId) => isActiveCommunityMember(db, communityId, actorId);
}

module.exports = { isActiveCommunityMember, createMembershipResolver };
