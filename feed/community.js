const { buildCommunitySurface } = require('../community/read-service');
const { loadPublicationSurface } = require('../publication/read-service');
const { loadCreationEvent, publicationFeedItem } = require('./publication-items');
const { collectCommunityActivityItems } = require('./activity-items');
const { sortFeedItems } = require('./chronological');
const {
  FEED_ALGORITHM_REF,
  FEED_PROJECTION_VERSION,
  computeCommunityFeedSnapshotRef
} = require('./snapshot');

function collectCommunityPublicationItems({
  communityId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy
}) {
  const rows = db.prepare(`
    SELECT publication_id
    FROM publications_current
    WHERE scope_ref = ?
      AND lifecycle = 'active'
      AND reply_to_ref IS NULL
    ORDER BY publication_id
  `).all(communityId);
  const items = [];
  for (const row of rows) {
    const surface = loadPublicationSurface({
      publicationId: row.publication_id,
      viewerContext,
      db,
      eventStore,
      disclosurePolicy,
      includeReactionDecoration: false
    });
    if (!surface || surface.lifecycle !== 'active') continue;
    const creationEvent = loadCreationEvent(db, row.publication_id);
    const item = publicationFeedItem({ publicationSurface: surface, creationEvent });
    if (item) items.push(item);
  }
  return items;
}

function buildCommunityFeed({
  communityId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy
}) {
  const communitySurface = buildCommunitySurface({
    communityId,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });
  if (!communitySurface) return null;

  const publicationItems = collectCommunityPublicationItems({
    communityId,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });
  const activityItems = collectCommunityActivityItems({
    communityId,
    viewerContext,
    db,
    eventStore,
    disclosurePolicy
  });
  const items = sortFeedItems([...publicationItems, ...activityItems]);
  const snapshotRef = computeCommunityFeedSnapshotRef({
    communityId,
    viewerContext,
    viewerScope: communitySurface.viewer_scope,
    communitySurface,
    items
  });
  return {
    feed_type: 'community',
    community_id: communityId,
    viewer_scope: communitySurface.viewer_scope,
    algorithm_ref: FEED_ALGORITHM_REF,
    snapshot_ref: snapshotRef,
    items,
    projection_version: FEED_PROJECTION_VERSION
  };
}

module.exports = { buildCommunityFeed, collectCommunityPublicationItems };
