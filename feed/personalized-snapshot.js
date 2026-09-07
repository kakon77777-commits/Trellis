const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { MATERIALIZER_VERSION: RELATIONSHIP_MATERIALIZER_VERSION } = require('../projections/relationship-projector');
const { MATERIALIZER_VERSION: PUBLICATION_MATERIALIZER_VERSION } = require('../publication/projector');
const { feedViewerIdentityKey } = require('./context');
const PERSONALIZED_FEED_ALGORITHM_REF = 'trellis-feed:personalized:v2';
const PERSONALIZED_FEED_PROJECTION_VERSION = 'trellis-feed:0.2';

function computePersonalizedFeedSnapshotRef({
  subjectActorId,
  viewerContext = {},
  viewerScope,
  sourceGraph,
  items,
  rankingReferenceTime
}) {
  if (typeof rankingReferenceTime !== 'string' || !Number.isFinite(Date.parse(rankingReferenceTime))) {
    throw new TypeError('INVALID_RANKING_REFERENCE_TIME');
  }
  const material = {
    subject_actor_id: subjectActorId,
    viewer_scope: viewerScope,
    viewer_key: feedViewerIdentityKey(viewerContext),
    algorithm_ref: PERSONALIZED_FEED_ALGORITHM_REF,
    projection_version: PERSONALIZED_FEED_PROJECTION_VERSION,
    ranking_reference_time: rankingReferenceTime,
    projection_versions: {
      relationship: RELATIONSHIP_MATERIALIZER_VERSION,
      publication: PUBLICATION_MATERIALIZER_VERSION
    },
    source_graph: sourceGraph,
    items
  };
  return createHash('sha256').update(canonicalStringify(material), 'utf8').digest('hex');
}

module.exports = { computePersonalizedFeedSnapshotRef };
