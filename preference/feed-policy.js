function activeOwnerPreferences(db,ownerActorId){
  return db.prepare(`SELECT preference_type,target_ref,target_item_kind FROM preferences_current WHERE owner_actor_id=? AND lifecycle='active' ORDER BY preference_id`).all(ownerActorId);
}
function itemStableTarget(item){
  if(item?.item_type==='publication') return {item_kind:'publication',source_ref:item.source_ref};
  if(item?.item_type==='social_activity') return {item_kind:'social_activity',source_ref:item.source_event_ref};
  return null;
}
function itemInvolvesActor(item,actorId){
  if(item?.item_type==='publication') return item.publication?.author_actor_id===actorId;
  if(item?.item_type!=='social_activity') return false;
  const a=item.activity??{};
  return a.actor_id===actorId||a.source_actor_id===actorId||a.target_actor_id===actorId;
}
function applyOwnerFeedPreferences({ownerActorId,viewerContext={},items,db}){
  if(viewerContext.viewer_actor_id!==ownerActorId) return items;
  const prefs=activeOwnerPreferences(db,ownerActorId);
  if(!prefs.length) return items;
  const dismissed=new Set();const notInterested=new Set();const muted=new Set();
  for(const p of prefs){
    if(p.preference_type==='dismiss_feed_item') dismissed.add(`${p.target_item_kind}|${p.target_ref}`);
    else if(p.preference_type==='not_interested_publication') notInterested.add(p.target_ref);
    else if(p.preference_type==='mute_actor') muted.add(p.target_ref);
  }
  return items.filter(item=>{
    const stable=itemStableTarget(item);
    if(stable&&dismissed.has(`${stable.item_kind}|${stable.source_ref}`)) return false;
    if(item.item_type==='publication'&&notInterested.has(item.source_ref)) return false;
    for(const actorId of muted) if(itemInvolvesActor(item,actorId)) return false;
    return true;
  });
}
module.exports={applyOwnerFeedPreferences,itemStableTarget,itemInvolvesActor};
