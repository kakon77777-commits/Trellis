function activeMutedActors(db,ownerActorId){
  return new Set(db.prepare(`
    SELECT target_ref FROM preferences_current
    WHERE owner_actor_id=? AND lifecycle='active' AND preference_type='mute_actor'
    ORDER BY target_ref
  `).all(ownerActorId).map(row=>row.target_ref));
}
function applyOwnerNotificationPreferences({ownerActorId,viewerContext={},items,db}){
  if(viewerContext.viewer_actor_id!==ownerActorId) return items;
  const muted=activeMutedActors(db,ownerActorId);if(!muted.size)return items;
  return items.filter(item=>!muted.has(item.source_actor_id));
}
module.exports={activeMutedActors,applyOwnerNotificationPreferences};
