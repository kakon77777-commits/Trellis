const { foldEntity } = require('../entity/fold');
const { resolveCommunityDiscoverability } = require('./fold');
const { createMembershipResolver } = require('./membership-read');
const { isSelfOrRepresentative, canViewRelationship } = require('../profile/read-policy');

async function loadCommunityPolicyState(eventStore,communityId){
  const events=await eventStore.readStream('entity',communityId);
  if(events.length===0)return null;
  const entity=foldEntity(events);
  if(entity.lifecycle!=='active'||entity.entity_kind!=='community')return null;
  return{entity,events,discoverability:resolveCommunityDiscoverability(events)};
}

async function activeMemberViewer(db,communityId,viewerContext={},membershipResolver){
  const resolver=membershipResolver??await createMembershipResolver(db);
  const candidates=[viewerContext.viewer_actor_id??null,...(viewerContext.represents_actor_ids??[])].filter(Boolean);
  return candidates.some(actorId=>resolver(communityId,actorId));
}

async function communityViewerScope({communityId,viewerContext={},db,eventStore,membershipResolver}){
  const state=await loadCommunityPolicyState(eventStore,communityId);
  if(!state)return null;
  if(isSelfOrRepresentative(viewerContext,communityId))return'community';
  const resolver=membershipResolver??await createMembershipResolver(db);
  if(await activeMemberViewer(db,communityId,viewerContext,resolver))return'member';
  if(['public','unlisted'].includes(state.discoverability))return'public';
  return null;
}

async function listVisibleMembers({communityId,viewerContext={},db,eventStore,disclosurePolicy}){
  const resolver=await createMembershipResolver(db);
  const viewerScope=await communityViewerScope({communityId,viewerContext,db,eventStore,membershipResolver:resolver});
  if(!viewerScope)return null;
  const candidates=await db.all(`
    SELECT * FROM relationships_current
    WHERE relationship_type = 'member_of'
      AND target_entity_id = ?
      AND scope_ref = ?
      AND lifecycle = 'active'
    ORDER BY source_entity_id, relationship_id
  `,[communityId,communityId]);
  const visible=candidates.filter(row=>canViewRelationship(row,viewerContext,disclosurePolicy,resolver));
  const visibleMembers=visible.map(row=>({
    actor_id:row.source_entity_id,
    membership_relationship_id:row.relationship_id,
    detail_ref:`/relationships/${encodeURIComponent(row.relationship_id)}`
  }));
  return{
    viewer_is_member:await activeMemberViewer(db,communityId,viewerContext,resolver),
    visible_members:visibleMembers,
    visible_member_count:visibleMembers.length
  };
}

module.exports={loadCommunityPolicyState,communityViewerScope,listVisibleMembers,activeMemberViewer};
