const { buildFeedSourceGraph } = require('./source-graph');
const { collectHomePublicationItems } = require('./publication-items');
const { collectHomeActivityItems } = require('./activity-items');
const { applyOwnerFeedPreferences } = require('../preference/feed-policy');
const { sourceComponentForItem } = require('./source-tier');
const { consumptionForFeedItem } = require('./consumption-signal');
const { scoreItem, comparePersonalizedFeedItemsDesc } = require('./personalized-score');
const { computePersonalizedFeedSnapshotRef } = require('./personalized-snapshot');

const PERSONALIZED_FEED_ALGORITHM_REF = 'trellis-feed:personalized:v2';
const PERSONALIZED_FEED_PROJECTION_VERSION = 'trellis-feed:0.2';

function requireOwnerView(subjectActorId, viewerContext = {}) {
  if (viewerContext.viewer_actor_id !== subjectActorId) {
    const error = new Error('FEED_V2_OWNER_VIEW_REQUIRED');
    error.code = 'FEED_V2_OWNER_VIEW_REQUIRED';
    throw error;
  }
}

async function buildPersonalizedHomeFeedSnapshot({
  subjectActorId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy,
  rankingReferenceTime
}) {
  requireOwnerView(subjectActorId, viewerContext);
  const sourceGraph = await buildFeedSourceGraph({
    subjectActorId,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });
  const publicationItems = await collectHomePublicationItems({
    sourceGraph,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });
  const activityItems = await collectHomeActivityItems({
    sourceGraph,
    subjectActorId,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });
  const visibleCandidateItems = [...publicationItems, ...activityItems];
  const preferenceFilteredItems = await applyOwnerFeedPreferences({
    ownerActorId: subjectActorId,
    viewerContext,
    items: visibleCandidateItems,
    db
  });
  const items = [];
  for (const item of preferenceFilteredItems) {
    items.push(scoreItem({
      item,
      sourceComponent: sourceComponentForItem(item, sourceGraph),
      consumptionState: await consumptionForFeedItem({ ownerActorId: subjectActorId, item, db, rankingReferenceTime }),
      rankingReferenceTime
    }));
  }
  items.sort(comparePersonalizedFeedItemsDesc);
  const snapshotRef = computePersonalizedFeedSnapshotRef({
    subjectActorId,
    viewerContext,
    viewerScope: sourceGraph.viewer_scope,
    sourceGraph,
    items,
    rankingReferenceTime
  });

  return {
    feed_type: 'home',
    subject_actor_id: subjectActorId,
    viewer_scope: sourceGraph.viewer_scope,
    algorithm_ref: PERSONALIZED_FEED_ALGORITHM_REF,
    projection_version: PERSONALIZED_FEED_PROJECTION_VERSION,
    ranking_reference_time: rankingReferenceTime,
    snapshot_ref: snapshotRef,
    source_graph: sourceGraph,
    visible_candidate_items: visibleCandidateItems,
    preference_filtered_items: preferenceFilteredItems,
    items
  };
}

async function buildPersonalizedHomeFeed(args) {
  const snapshot = await buildPersonalizedHomeFeedSnapshot(args);
  return {
    feed_type: snapshot.feed_type,
    subject_actor_id: snapshot.subject_actor_id,
    viewer_scope: snapshot.viewer_scope,
    algorithm_ref: snapshot.algorithm_ref,
    ranking_reference_time: snapshot.ranking_reference_time,
    snapshot_ref: snapshot.snapshot_ref,
    items: snapshot.items,
    projection_version: snapshot.projection_version
  };
}

module.exports = {
  PERSONALIZED_FEED_ALGORITHM_REF,
  PERSONALIZED_FEED_PROJECTION_VERSION,
  requireOwnerView,
  buildPersonalizedHomeFeedSnapshot,
  buildPersonalizedHomeFeed
};
