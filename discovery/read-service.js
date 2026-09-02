const { buildDiscoverySnapshot } = require('./visible-graph');
const { discoverActors, ACTOR_DISCOVERY_ALGORITHM_REF } = require('./actor-discovery');
const { discoverCommunities, COMMUNITY_DISCOVERY_ALGORITHM_REF } = require('./community-discovery');
const { paginateCandidates } = require('./cursor');

function buildDiscoverySurface({
  subjectActorId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy,
  actorLimit = 20,
  actorCursor = null,
  communityLimit = 20,
  communityCursor = null
}) {
  const snapshot = buildDiscoverySnapshot({
    subjectActorId,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });

  const actorCandidates = discoverActors(snapshot);
  const actorPage = paginateCandidates(actorCandidates, {
    limit: actorLimit,
    cursor: actorCursor,
    algorithmRef: ACTOR_DISCOVERY_ALGORITHM_REF,
    snapshotRef: snapshot.snapshot_ref
  });

  const communityCandidates = discoverCommunities(snapshot);
  const communityPage = paginateCandidates(communityCandidates, {
    limit: communityLimit,
    cursor: communityCursor,
    algorithmRef: COMMUNITY_DISCOVERY_ALGORITHM_REF,
    snapshotRef: snapshot.snapshot_ref
  });

  return {
    subject_actor_id: subjectActorId,
    viewer_scope: snapshot.viewer_scope,
    snapshot_ref: snapshot.snapshot_ref,
    actor_discovery: {
      algorithm_ref: ACTOR_DISCOVERY_ALGORITHM_REF,
      candidates: actorPage.candidates,
      next_cursor: actorPage.next_cursor
    },
    community_discovery: {
      algorithm_ref: COMMUNITY_DISCOVERY_ALGORITHM_REF,
      candidates: communityPage.candidates,
      next_cursor: communityPage.next_cursor
    },
    execution_authority: {
      implied_by_discovery_read: false
    },
    projection_version: 'discovery-surface:0.1'
  };
}

module.exports = { buildDiscoverySurface };
