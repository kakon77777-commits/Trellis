const { buildAdjacency } = require('./actor-discovery');

const COMMUNITY_DISCOVERY_ALGORITHM_REF = 'trellis-discovery:community-graph:v1';

function activeMembershipIndex(snapshot) {
  const byCommunity = new Map();
  const byActor = new Map();
  for (const relationship of snapshot.relationships) {
    if (
      relationship.lifecycle !== 'active' ||
      relationship.relationship_type !== 'member_of' ||
      !snapshot.actors[relationship.source_entity_id] ||
      !snapshot.communities[relationship.target_entity_id]
    ) continue;
    const actorId = relationship.source_entity_id;
    const communityId = relationship.target_entity_id;
    if (!byCommunity.has(communityId)) byCommunity.set(communityId, new Map());
    if (!byCommunity.get(communityId).has(actorId)) byCommunity.get(communityId).set(actorId, []);
    byCommunity.get(communityId).get(actorId).push(relationship);
    if (!byActor.has(actorId)) byActor.set(actorId, new Set());
    byActor.get(actorId).add(communityId);
  }
  for (const actorMap of byCommunity.values()) {
    for (const edges of actorMap.values()) edges.sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  }
  return { byCommunity, byActor };
}

function pendingSubjectCommunities(snapshot) {
  const subject = snapshot.subject_actor_id;
  return new Set(snapshot.relationships
    .filter(relationship =>
      relationship.lifecycle === 'proposed' &&
      relationship.relationship_type === 'member_of' &&
      relationship.source_entity_id === subject
    )
    .map(relationship => relationship.target_entity_id));
}

function discoverCommunities(snapshot, { limit } = {}) {
  const subject = snapshot.subject_actor_id;
  const adjacency = buildAdjacency(snapshot);
  const directNeighbors = adjacency.get(subject) ?? new Map();
  const memberships = activeMembershipIndex(snapshot);
  const subjectCommunities = memberships.byActor.get(subject) ?? new Set();
  const pending = pendingSubjectCommunities(snapshot);
  const candidates = [];

  for (const communityId of Object.keys(snapshot.communities).sort()) {
    const community = snapshot.communities[communityId];
    if (community.discoverability !== 'public') continue;
    if (subjectCommunities.has(communityId) || pending.has(communityId)) continue;

    const memberMap = memberships.byCommunity.get(communityId) ?? new Map();
    const connectedMembers = [...memberMap.keys()]
      .filter(actorId => directNeighbors.has(actorId))
      .sort();

    const pathReasons = [];
    for (const actorId of connectedMembers) {
      const subjectEdges = directNeighbors.get(actorId) ?? [];
      const membershipEdges = memberMap.get(actorId) ?? [];
      for (const subjectRelationship of subjectEdges) {
        for (const membershipRelationship of membershipEdges) {
          pathReasons.push({
            type: 'visible_community_path',
            via_actor_id: actorId,
            subject_relationship_id: subjectRelationship.relationship_id,
            membership_relationship_id: membershipRelationship.relationship_id
          });
        }
      }
    }
    pathReasons.sort((a, b) =>
      a.via_actor_id.localeCompare(b.via_actor_id) ||
      a.subject_relationship_id.localeCompare(b.subject_relationship_id) ||
      a.membership_relationship_id.localeCompare(b.membership_relationship_id)
    );

    const overlapReasons = [];
    for (const actorId of [...memberMap.keys()].sort()) {
      const actorCommunities = memberships.byActor.get(actorId) ?? new Set();
      const overlappingSubjectCommunities = [...subjectCommunities]
        .filter(subjectCommunityId => actorCommunities.has(subjectCommunityId))
        .sort();
      if (overlappingSubjectCommunities.length > 0) {
        overlapReasons.push({
          type: 'visible_membership_overlap',
          actor_id: actorId,
          subject_community_ids: overlappingSubjectCommunities
        });
      }
    }

    const scoreComponents = {
      connected_visible_members: connectedMembers.length,
      visible_paths: pathReasons.length,
      visible_membership_overlap: overlapReasons.length
    };
    const score =
      4 * scoreComponents.connected_visible_members +
      scoreComponents.visible_paths +
      3 * scoreComponents.visible_membership_overlap;
    if (score <= 0) continue;

    const reasons = [
      ...connectedMembers.map(actorId => ({ type: 'connected_visible_member', actor_id: actorId })),
      ...pathReasons,
      ...overlapReasons
    ];

    candidates.push({
      entity_type: 'community',
      community_id: communityId,
      score,
      score_components: scoreComponents,
      reasons,
      community,
      algorithm_ref: COMMUNITY_DISCOVERY_ALGORITHM_REF
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.community_id.localeCompare(b.community_id));
  return Number.isInteger(limit) && limit >= 0 ? candidates.slice(0, limit) : candidates;
}

module.exports = {
  COMMUNITY_DISCOVERY_ALGORITHM_REF,
  discoverCommunities,
  activeMembershipIndex,
  pendingSubjectCommunities
};
