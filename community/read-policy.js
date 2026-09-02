const { foldEntity } = require('../entity/fold');
const { resolveCommunityDiscoverability } = require('./fold');
const { isActiveCommunityMember, createMembershipResolver } = require('./membership-read');
const { isSelfOrRepresentative, canViewRelationship } = require('../profile/read-policy');

function loadCommunityPolicyState(eventStore, communityId) {
  const events = eventStore.readStream('entity', communityId);
  if (events.length === 0) return null;
  const entity = foldEntity(events);
  if (entity.lifecycle !== 'active' || entity.entity_kind !== 'community') return null;
  return { entity, events, discoverability: resolveCommunityDiscoverability(events) };
}

function activeMemberViewer(db, communityId, viewerContext = {}) {
  const candidates = [viewerContext.viewer_actor_id ?? null, ...(viewerContext.represents_actor_ids ?? [])].filter(Boolean);
  return candidates.some(actorId => isActiveCommunityMember(db, communityId, actorId));
}

function communityViewerScope({ communityId, viewerContext = {}, db, eventStore }) {
  const state = loadCommunityPolicyState(eventStore, communityId);
  if (!state) return null;
  if (isSelfOrRepresentative(viewerContext, communityId)) return 'community';
  if (activeMemberViewer(db, communityId, viewerContext)) return 'member';
  if (['public', 'unlisted'].includes(state.discoverability)) return 'public';
  return null;
}

function listVisibleMembers({ communityId, viewerContext = {}, db, eventStore, disclosurePolicy }) {
  const viewerScope = communityViewerScope({ communityId, viewerContext, db, eventStore });
  if (!viewerScope) return null;
  const resolver = createMembershipResolver(db);
  const candidates = db.prepare(`
    SELECT * FROM relationships_current
    WHERE relationship_type = 'member_of'
      AND target_entity_id = ?
      AND scope_ref = ?
      AND lifecycle = 'active'
    ORDER BY source_entity_id, relationship_id
  `).all(communityId, communityId);
  const visible = candidates.filter(row => canViewRelationship(row, viewerContext, disclosurePolicy, resolver));
  const visibleMembers = visible.map(row => ({
    actor_id: row.source_entity_id,
    membership_relationship_id: row.relationship_id,
    detail_ref: `/relationships/${encodeURIComponent(row.relationship_id)}`
  }));
  return {
    viewer_is_member: activeMemberViewer(db, communityId, viewerContext),
    visible_members: visibleMembers,
    visible_member_count: visibleMembers.length
  };
}

module.exports = { loadCommunityPolicyState, communityViewerScope, listVisibleMembers, activeMemberViewer };
