const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { loadPublicationSurface } = require('../publication/read-service');
const { loadCreationEvent, publicationFeedItem } = require('./publication-items');
const { collectPublicActivityItems } = require('./activity-items');
const { sortFeedItems } = require('./chronological');
const { paginateFeed } = require('./cursor');

const PUBLIC_FEED_ALGORITHM_REF = 'trellis-feed:public-chronological:v1';
const PUBLIC_FEED_PROJECTION_VERSION = 'trellis-feed-public:0.1';

function collectPublicPublicationItems({ db, eventStore, disclosurePolicy }) {
  const rows = db.prepare(`
    SELECT publication_id
    FROM publications_current
    WHERE lifecycle='active'
      AND reply_to_ref IS NULL
    ORDER BY publication_id
  `).all();
  const items = [];
  for (const row of rows) {
    const surface = loadPublicationSurface({
      publicationId: row.publication_id,
      viewerContext: {},
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

function computePublicFeedSnapshotRef(items) {
  return createHash('sha256')
    .update(canonicalStringify({
      algorithm_ref: PUBLIC_FEED_ALGORITHM_REF,
      projection_version: PUBLIC_FEED_PROJECTION_VERSION,
      items
    }), 'utf8')
    .digest('hex');
}

function buildPublicFeed({ db, eventStore, disclosurePolicy }) {
  const publicationItems = collectPublicPublicationItems({ db, eventStore, disclosurePolicy });
  const activityItems = collectPublicActivityItems({
    viewerContext: {},
    db,
    eventStore,
    disclosurePolicy
  });
  const items = sortFeedItems([...publicationItems, ...activityItems]);
  return {
    feed_type: 'public',
    algorithm_ref: PUBLIC_FEED_ALGORITHM_REF,
    projection_version: PUBLIC_FEED_PROJECTION_VERSION,
    snapshot_ref: computePublicFeedSnapshotRef(items),
    items
  };
}

function loadPublicFeed({ db, eventStore, disclosurePolicy, limit = 20, cursor = null }) {
  const feed = buildPublicFeed({ db, eventStore, disclosurePolicy });
  const page = paginateFeed({ feed, limit, cursor });
  return { ...feed, items: page.items, next_cursor: page.next_cursor };
}

module.exports = {
  PUBLIC_FEED_ALGORITHM_REF,
  PUBLIC_FEED_PROJECTION_VERSION,
  collectPublicPublicationItems,
  computePublicFeedSnapshotRef,
  buildPublicFeed,
  loadPublicFeed
};
