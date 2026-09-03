const { buildFeedSourceGraph } = require('./source-graph');
const { collectHomePublicationItems } = require('./publication-items');
const { collectHomeActivityItems } = require('./activity-items');
const { sortFeedItems } = require('./chronological');
const { FEED_ALGORITHM_REF, FEED_PROJECTION_VERSION, computeFeedSnapshotRef } = require('./snapshot');

function buildHomeFeedSnapshot({
  subjectActorId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy
}) {
  const sourceGraph = buildFeedSourceGraph({
    subjectActorId,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });
  const publicationItems = collectHomePublicationItems({
    sourceGraph,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });
  const activityItems = collectHomeActivityItems({
    sourceGraph,
    subjectActorId,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });
  const items = sortFeedItems([...publicationItems, ...activityItems]);
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

function buildHomeFeed(args) {
  const snapshot = buildHomeFeedSnapshot(args);
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
