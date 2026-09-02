const { foldCommunityAssertions, resolveCommunityDiscoverability } = require('./fold');
const { communityViewerScope, listVisibleMembers } = require('./read-policy');
const { buildCommunityLocalGraph } = require('./graph');
const { availableCommunityActions } = require('./action-hints');

const PRESENTATION_FIELDS = {
  'community:name:v1': 'name',
  'community:description:v1': 'description',
  'community:avatar_url:v1': 'avatar_url'
};

function assertionReadable(assertion, viewerScope) {
  if (assertion.visibility === 'public') return true;
  if (assertion.visibility === 'private') return viewerScope === 'community';
  return false;
}

function assertionView(assertion) {
  return { value: assertion.value, assertion_id: assertion.assertion_id };
}

function buildCommunitySurface({ communityId, viewerContext = {}, db, eventStore, disclosurePolicy }) {
  const viewerScope = communityViewerScope({ communityId, viewerContext, db, eventStore });
  if (!viewerScope) return null;
  const events = eventStore.readStream('entity', communityId);
  if (events.length === 0) return null;
  const communityState = foldCommunityAssertions(events);
  const presentation = {};
  for (const [fieldRef, key] of Object.entries(PRESENTATION_FIELDS)) {
    const assertion = communityState.active_single[fieldRef];
    if (assertion && assertionReadable(assertion, viewerScope)) presentation[key] = assertionView(assertion);
  }
  const membership = listVisibleMembers({ communityId, viewerContext, db, eventStore, disclosurePolicy });
  const localGraph = buildCommunityLocalGraph({ communityId, viewerContext, db, eventStore, disclosurePolicy });
  return {
    community_id: communityId,
    presentation,
    discoverability: resolveCommunityDiscoverability(events),
    membership,
    local_graph: localGraph,
    available_actions: availableCommunityActions({ communityId, viewerContext, viewerScope }),
    execution_authority: {
      implied_by_membership: false,
      implied_by_social_role: false
    },
    viewer_scope: viewerScope,
    projection_version: 'community-surface:0.1'
  };
}

module.exports = { buildCommunitySurface };
