function availableCommunityActions({ communityId, viewerContext = {}, viewerScope }) {
  if (!viewerScope) return [];
  if (viewerScope === 'community') return ['approve_membership', 'remove_member'];
  if (viewerScope === 'member') return ['leave'];
  if (viewerScope === 'public' && viewerContext.viewer_actor_id) return ['request_membership'];
  return [];
}
module.exports = { availableCommunityActions };
