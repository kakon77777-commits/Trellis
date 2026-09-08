async function activeMutedActors(db,ownerActorId){return new Set((await db.all(`SELECT target_ref FROM preferences_current WHERE owner_actor_id=? AND lifecycle='active' AND preference_type='mute_actor' ORDER BY target_ref`,[ownerActorId])).map(row=>row.target_ref));}
function filterMuted(ownerActorId,viewerContext,items,muted){if(viewerContext.viewer_actor_id!==ownerActorId||!muted.size)return items;return items.filter(item=>!muted.has(item.source_actor_id));}
async function applyOwnerNotificationPreferences({ownerActorId,viewerContext={},items,db}){return filterMuted(ownerActorId,viewerContext,items,await activeMutedActors(db,ownerActorId));}
module.exports={activeMutedActors,applyOwnerNotificationPreferences};
