const {ConsumptionStore}=require('./store');
const {resolveConsumptionTarget}=require('./eligibility');
const {InvalidTransitionError}=require('../core/errors');

const PROJECTION_VERSION='consumption-surface:0.1';
function assertConsumptionReadAuthorized(consumerActorId,viewerContext={}){
  if(viewerContext.viewer_actor_id!==consumerActorId){const error=new Error('CONSUMPTION_NOT_AUTHORIZED');error.code='CONSUMPTION_NOT_AUTHORIZED';throw error;}
}
function inputForRow(row){
  if(row.target_kind==='publication')return{publication_id:row.target_ref};
  if(row.target_kind==='social_activity')return{social_activity_event_id:row.target_ref};
  throw new TypeError('CONSUMPTION_TARGET_KIND_INVALID');
}
function normalizeRow(row){return{consumer_actor_id:row.consumer_actor_id,target_kind:row.target_kind,target_ref:row.target_ref,first_seen_at:row.first_seen_at,first_opened_at:row.first_opened_at,last_touched_at:row.last_touched_at,expires_at:row.expires_at,retention_policy_ref:row.retention_policy_ref};}
function currentlyEligible(row,{consumerActorId,db,eventStore,disclosurePolicy}){
  try{
    resolveConsumptionTarget({observation:'seen',target:inputForRow(row),viewerActorId:consumerActorId,db,eventStore,disclosurePolicy});
    return true;
  }catch(error){
    if(error instanceof InvalidTransitionError)return false;
    throw error;
  }
}
function loadConsumptionSurface({consumerActorId,viewerContext={},db,eventStore,disclosurePolicy}){
  assertConsumptionReadAuthorized(consumerActorId,viewerContext);
  const store=new ConsumptionStore(db);
  const items=store.listForConsumer(consumerActorId).filter(row=>currentlyEligible(row,{consumerActorId,db,eventStore,disclosurePolicy})).map(normalizeRow);
  return{consumer_actor_id:consumerActorId,viewer_scope:'owner',items,projection_version:PROJECTION_VERSION};
}
function purgeExpiredConsumption({db,now}){return new ConsumptionStore(db).deleteExpired(now);}
module.exports={PROJECTION_VERSION,assertConsumptionReadAuthorized,loadConsumptionSurface,purgeExpiredConsumption,normalizeRow};
