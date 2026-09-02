const ACTOR_DISCOVERY_ALGORITHM_REF = 'trellis-discovery:actor-graph:v1';

function activeActorRelationships(snapshot) {
  return snapshot.relationships.filter(relationship =>
    relationship.lifecycle === 'active' &&
    relationship.relationship_type !== 'member_of' &&
    snapshot.actors[relationship.source_entity_id] &&
    snapshot.actors[relationship.target_entity_id]
  );
}

function buildAdjacency(snapshot) {
  const adjacency = new Map();
  function add(a, b, relationship) {
    if (!adjacency.has(a)) adjacency.set(a, new Map());
    const neighbors = adjacency.get(a);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(b).push(relationship);
  }
  for (const relationship of activeActorRelationships(snapshot)) {
    add(relationship.source_entity_id, relationship.target_entity_id, relationship);
    add(relationship.target_entity_id, relationship.source_entity_id, relationship);
  }
  for (const neighbors of adjacency.values()) {
    for (const edges of neighbors.values()) {
      edges.sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
    }
  }
  return adjacency;
}

function buildMemberships(snapshot) {
  const actorToCommunities = new Map();
  const communityToActors = new Map();
  for (const relationship of snapshot.relationships) {
    if (
      relationship.lifecycle !== 'active' ||
      relationship.relationship_type !== 'member_of' ||
      !snapshot.actors[relationship.source_entity_id] ||
      !snapshot.communities[relationship.target_entity_id]
    ) continue;
    const actorId = relationship.source_entity_id;
    const communityId = relationship.target_entity_id;
    if (!actorToCommunities.has(actorId)) actorToCommunities.set(actorId, new Set());
    if (!communityToActors.has(communityId)) communityToActors.set(communityId, new Set());
    actorToCommunities.get(actorId).add(communityId);
    communityToActors.get(communityId).add(actorId);
  }
  return { actorToCommunities, communityToActors };
}

function sortedIntersection(a, b) {
  if (!a || !b) return [];
  return [...a].filter(value => b.has(value)).sort();
}

function actorCandidateIds(snapshot, adjacency, memberships) {
  const subject = snapshot.subject_actor_id;
  const candidates = new Set();
  const subjectNeighbors = adjacency.get(subject) ?? new Map();
  for (const viaActorId of subjectNeighbors.keys()) {
    const viaNeighbors = adjacency.get(viaActorId) ?? new Map();
    for (const actorId of viaNeighbors.keys()) candidates.add(actorId);
  }
  const subjectCommunities = memberships.actorToCommunities.get(subject) ?? new Set();
  for (const communityId of subjectCommunities) {
    for (const actorId of memberships.communityToActors.get(communityId) ?? []) candidates.add(actorId);
  }
  candidates.delete(subject);
  for (const directActorId of subjectNeighbors.keys()) candidates.delete(directActorId);
  return [...candidates].filter(actorId => snapshot.actors[actorId]?.profile).sort();
}

function discoverActors(snapshot, { limit } = {}) {
  const subject = snapshot.subject_actor_id;
  const adjacency = buildAdjacency(snapshot);
  const memberships = buildMemberships(snapshot);
  const subjectNeighbors = adjacency.get(subject) ?? new Map();
  const subjectNeighborIds = new Set(subjectNeighbors.keys());
  const subjectCommunities = memberships.actorToCommunities.get(subject) ?? new Set();

  const candidates = [];
  for (const actorId of actorCandidateIds(snapshot, adjacency, memberships)) {
    const candidateNeighbors = adjacency.get(actorId) ?? new Map();
    const mutualActors = sortedIntersection(subjectNeighborIds, new Set(candidateNeighbors.keys()));
    const candidateCommunities = memberships.actorToCommunities.get(actorId) ?? new Set();
    const sharedCommunities = sortedIntersection(subjectCommunities, candidateCommunities);

    const pathReasons = [];
    for (const viaActorId of mutualActors) {
      const leftEdges = subjectNeighbors.get(viaActorId) ?? [];
      const rightEdges = candidateNeighbors.get(viaActorId) ?? [];
      for (const left of leftEdges) {
        for (const right of rightEdges) {
          pathReasons.push({
            type: 'visible_two_hop_path',
            via_actor_id: viaActorId,
            subject_relationship_id: left.relationship_id,
            candidate_relationship_id: right.relationship_id
          });
        }
      }
    }
    pathReasons.sort((a, b) =>
      a.via_actor_id.localeCompare(b.via_actor_id) ||
      a.subject_relationship_id.localeCompare(b.subject_relationship_id) ||
      a.candidate_relationship_id.localeCompare(b.candidate_relationship_id)
    );

    const scoreComponents = {
      mutual_visible_actors: mutualActors.length,
      shared_visible_communities: sharedCommunities.length,
      visible_two_hop_paths: pathReasons.length
    };
    const score =
      3 * scoreComponents.mutual_visible_actors +
      4 * scoreComponents.shared_visible_communities +
      scoreComponents.visible_two_hop_paths;
    if (score <= 0) continue;

    const reasons = [
      ...mutualActors.map(mutualActorId => ({ type: 'mutual_visible_actor', actor_id: mutualActorId })),
      ...sharedCommunities.map(communityId => ({ type: 'shared_visible_community', community_id: communityId })),
      ...pathReasons
    ];

    candidates.push({
      entity_type: 'actor',
      actor_id: actorId,
      score,
      score_components: scoreComponents,
      reasons,
      profile: snapshot.actors[actorId].profile,
      algorithm_ref: ACTOR_DISCOVERY_ALGORITHM_REF
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.actor_id.localeCompare(b.actor_id));
  return Number.isInteger(limit) && limit >= 0 ? candidates.slice(0, limit) : candidates;
}

module.exports = {
  ACTOR_DISCOVERY_ALGORITHM_REF,
  discoverActors,
  buildAdjacency,
  buildMemberships
};
