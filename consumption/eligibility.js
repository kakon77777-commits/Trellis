const {InvalidTransitionError}=require('../core/errors');
const {foldPublication}=require('../publication/fold');
const {canViewPublication}=require('../publication/read-policy');
const {foldRelationship}=require('../relationship/fold');
const {canViewRelationship}=require('../profile/read-policy');
const {createMembershipResolver}=require('../community/membership-read');
const {ACTIVITY_TYPES}=require('../feed/activity-items');
const {normalizeConsumptionTarget}=require('./types');

async function resolvePublication(targetRef,viewerActorId,{db,eventStore,disclosurePolicy}){
  const events=await eventStore.readStream('publication',targetRef);
  if(!events.length) throw new InvalidTransitionError('CONSUMPTION_TARGET_NOT_FOUND');
  const state=foldPublication(events);
  if(state.lifecycle!=='active') throw new InvalidTransitionError('CONSUMPTION_TARGET_NOT_ACTIVE');
  const membershipResolver=await createMembershipResolver(db);
  if(!canViewPublication(state,{viewer_actor_id:viewerActorId},disclosurePolicy,membershipResolver)) throw new InvalidTransitionError('CONSUMPTION_TARGET_NOT_READABLE');
  return{target_kind:'publication',target_ref:targetRef,source_state:state};
}
async function resolveActivity(targetRef,viewerActorId,{db,eventStore,disclosurePolicy}){
  const sourceEvent=await eventStore.readEvent(targetRef);
  if(!sourceEvent) throw new InvalidTransitionError('CONSUMPTION_TARGET_NOT_FOUND');
  if(sourceEvent.stream_type!=='relationship'||sourceEvent.event_type!=='relationship.activated') throw new InvalidTransitionError('CONSUMPTION_ACTIVITY_INVALID');
  const history=await eventStore.readStream('relationship',sourceEvent.stream_id);
  if(!history.length) throw new InvalidTransitionError('CONSUMPTION_ACTIVITY_INVALID');
  const relationship=foldRelationship(history);
  if(!ACTIVITY_TYPES[relationship.relationship_type]) throw new InvalidTransitionError('CONSUMPTION_ACTIVITY_INVALID');
  const membershipResolver=await createMembershipResolver(db);
  if(!canViewRelationship(relationship,{viewer_actor_id:viewerActorId},disclosurePolicy,membershipResolver)) throw new InvalidTransitionError('CONSUMPTION_TARGET_NOT_READABLE');
  return{target_kind:'social_activity',target_ref:targetRef,source_event:sourceEvent,source_state:relationship};
}
async function resolveConsumptionTarget({observation,target,viewerActorId,db,eventStore,disclosurePolicy}){
  const normalized=normalizeConsumptionTarget(observation,target);
  if(normalized.target_kind==='publication') return await resolvePublication(normalized.target_ref,viewerActorId,{db,eventStore,disclosurePolicy});
  return await resolveActivity(normalized.target_ref,viewerActorId,{db,eventStore,disclosurePolicy});
}
const resolveConsumptionTargetAsync=resolveConsumptionTarget;

module.exports={resolveConsumptionTarget,resolveConsumptionTargetAsync};
