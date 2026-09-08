const { buildFeedSourceGraph } = require('./source-graph');
const { collectHomePublicationItems } = require('./publication-items');
const { collectHomeActivityItems } = require('./activity-items');
const { sortFeedItems } = require('./chronological');
const { FEED_ALGORITHM_REF, FEED_PROJECTION_VERSION, computeFeedSnapshotRef } = require('./snapshot');
const { applyOwnerFeedPreferences } = require('../preference/feed-policy');

async function buildHomeFeedSnapshot({
  subjectActorId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy
}) {
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
  const visibleItems = [...publicationItems, ...activityItems];
  const preferredItems = await applyOwnerFeedPreferences({ ownerActorId: subjectActorId, viewerContext, items: visibleItems, db });
  const items = sortFeedItems(preferredItems);
  const snapshotRef = computeFeedSnapshotRef({
    subjectActorId,
    viewerContext,
    viewerScope: sourceGraph.viewer_scope,
    sourceGraph,
    items
  });
  return {
    snapshot_ref: snapshotRef,
    source_graph: sourceGraph,
    publication_items: publicationItems,
    activity_items: activityItems,
    items
  };
}

async function buildHomeFeed(args) {
  const snapshot = await buildHomeFeedSnapshot(args);
  return {
    feed_type: 'home',
    subject_actor_id: args.subjectActorId,
    viewer_scope: snapshot.source_graph.viewer_scope,
    algorithm_ref: FEED_ALGORITHM_REF,
    snapshot_ref: snapshot.snapshot_ref,
    items: snapshot.items,
    projection_version: FEED_PROJECTION_VERSION
  };
}

module.exports = { buildHomeFeedSnapshot, buildHomeFeed };
