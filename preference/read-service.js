const {foldPublication}=require('../publication/fold');
const {canViewPublication}=require('../publication/read-policy');
const {createMembershipResolver}=require('../community/membership-read');

const PROJECTION_VERSION='preference-surface:0.1';
function assertPreferenceReadAuthorized(ownerActorId,viewerContext={}){
  if(viewerContext.viewer_actor_id!==ownerActorId){const error=new Error('PREFERENCE_NOT_AUTHORIZED');error.code='PREFERENCE_NOT_AUTHORIZED';throw error;}
}
function activeRows(db,ownerActorId){return db.prepare(`
  SELECT * FROM preferences_current
  WHERE owner_actor_id=? AND lifecycle='active'
  ORDER BY preference_type ASC,target_kind ASC,target_ref ASC,preference_id ASC
`).all(ownerActorId);}
function normalizePreferenceRow(row){if(!row)return null;return{preference_id:row.preference_id,owner_actor_id:row.owner_actor_id,preference_type:row.preference_type,target_kind:row.target_kind,target_ref:row.target_ref,target_item_kind:row.target_item_kind??null,lifecycle:row.lifecycle};}
function loadActivePreferenceSet({ownerActorId,viewerContext={},db}){
  assertPreferenceReadAuthorized(ownerActorId,viewerContext);
  return activeRows(db,ownerActorId).map(normalizePreferenceRow);
}
function currentBookmark(row,{ownerActorId,eventStore,db,disclosurePolicy}){
  const events=eventStore.readStream('publication',row.target_ref);if(!events.length)return null;
  const publication=foldPublication(events);if(publication.lifecycle!=='active')return null;
  const membershipResolver=createMembershipResolver(db);
  if(!canViewPublication(publication,{viewer_actor_id:ownerActorId},disclosurePolicy,membershipResolver))return null;
  return{preference_id:row.preference_id,publication_id:row.target_ref,detail_ref:`/publications/${encodeURIComponent(row.target_ref)}`};
}
function loadPreferenceSurface({ownerActorId,viewerContext={},db,eventStore,disclosurePolicy}){
  const preferences=loadActivePreferenceSet({ownerActorId,viewerContext,db});
  const bookmarks=[];
  for(const row of preferences){if(row.preference_type!=='bookmark_publication')continue;const value=currentBookmark(row,{ownerActorId,eventStore,db,disclosurePolicy});if(value)bookmarks.push(value);}
  return{owner_actor_id:ownerActorId,preferences,bookmarks,viewer_scope:'owner',projection_version:PROJECTION_VERSION};
}
module.exports={PROJECTION_VERSION,assertPreferenceReadAuthorized,loadActivePreferenceSet,loadPreferenceSurface,normalizePreferenceRow};
