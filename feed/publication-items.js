const { loadPublicationSurface } = require('../publication/read-service');

function loadCreationEvent(db, publicationId) {
  return db.prepare(`
    SELECT event_id, recorded_at, global_offset
    FROM canonical_events
    WHERE stream_type='publication'
      AND stream_id=?
      AND event_type='publication.created'
    ORDER BY stream_seq ASC
    LIMIT 1
  `).get(publicationId) ?? null;
}

function publicationFeedItem({ publicationSurface, creationEvent }) {
  if (!publicationSurface || !creationEvent) return null;
  return {
    feed_item_id: `feed:publication:${publicationSurface.publication_id}`,
    item_type: 'publication',
    source_ref: publicationSurface.publication_id,
    sort: {
      recorded_at: creationEvent.recorded_at,
      global_offset: creationEvent.global_offset
    },
    publication: publicationSurface
  };
}

function publicationCandidateAllowed(row, sourceGraph) {
  if (row.author_actor_id === sourceGraph.subject_actor_id) return true;
  if (row.scope_ref === null || row.scope_ref === undefined) {
    return sourceGraph.actor_source_ids.includes(row.author_actor_id);
  }
  return sourceGraph.community_source_ids.includes(row.scope_ref);
}

function collectHomePublicationItems({
  sourceGraph,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy
}) {
  const rows = db.prepare(`
    SELECT * FROM publications_current
    WHERE lifecycle='active'
      AND reply_to_ref IS NULL
    ORDER BY publication_id
  `).all();
  const items = [];
  for (const row of rows) {
    if (!publicationCandidateAllowed(row, sourceGraph)) continue;
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

module.exports = {
  collectHomePublicationItems,
  publicationFeedItem,
  loadCreationEvent,
  publicationCandidateAllowed
};
