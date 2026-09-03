const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { MATERIALIZER_VERSION: RELATIONSHIP_MATERIALIZER_VERSION } = require('../projections/relationship-projector');
const { MATERIALIZER_VERSION: PUBLICATION_MATERIALIZER_VERSION } = require('../publication/projector');
const { feedViewerIdentityKey } = require('./context');

const FEED_ALGORITHM_REF = 'trellis-feed:chronological:v1';
const FEED_PROJECTION_VERSION = 'trellis-feed:0.1';

function computeFeedSnapshotRef({ subjectActorId, viewerContext, viewerScope, sourceGraph, items }) {
  const material = {
    subject_actor_id: subjectActorId,
    viewer_scope: viewerScope,
    viewer_key: feedViewerIdentityKey(viewerContext),
    algorithm_ref: FEED_ALGORITHM_REF,
    projection_versions: {
      feed: FEED_PROJECTION_VERSION,
      relationship: RELATIONSHIP_MATERIALIZER_VERSION,
      publication: PUBLICATION_MATERIALIZER_VERSION
    },
    source_graph: sourceGraph,
    items
  };
  return createHash('sha256')
    .update(canonicalStringify(material), 'utf8')
    .digest('hex');
}

function computeCommunityFeedSnapshotRef({ communityId, viewerContext, viewerScope, communitySurface, items }) {
  const material = {
    community_id: communityId,
    viewer_scope: viewerScope,
    viewer_key: feedViewerIdentityKey(viewerContext),
    algorithm_ref: FEED_ALGORITHM_REF,
    projection_versions: {
      feed: FEED_PROJECTION_VERSION,
      relationship: RELATIONSHIP_MATERIALIZER_VERSION,
      publication: PUBLICATION_MATERIALIZER_VERSION
    },
    community: communitySurface,
    items
  };
  return createHash('sha256')
    .update(canonicalStringify(material), 'utf8')
    .digest('hex');
}

module.exports = {
  FEED_ALGORITHM_REF,
  FEED_PROJECTION_VERSION,
  computeFeedSnapshotRef,
  computeCommunityFeedSnapshotRef
};
