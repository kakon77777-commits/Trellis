const {foldPublication}=require('../publication/fold');
const {foldReaction}=require('../reaction/fold');
const {canViewPublication}=require('../publication/read-policy');
const {createMembershipResolver}=require('../community/membership-read');
const {REPLY_RULE_REF,REACTION_RULE_REF}=require('./types');

function loadPublication(eventStore,id){const events=eventStore.readStream('publication',id);return events.length?foldPublication(events):null;}
function readableActivePublication(publication,recipientActorId,context){
  if(!publication||publication.lifecycle!=='active') return false;
  return canViewPublication(publication,{viewer_actor_id:recipientActorId},context.disclosurePolicy,createMembershipResolver(context.db));
}
function replyCandidate(event,context){
  if(event.event_type!=='publication.created'||!event.payload?.reply_to_ref) return null;
  const child=loadPublication(context.eventStore,event.stream_id);
  const parent=loadPublication(context.eventStore,event.payload.reply_to_ref);
  if(!child||!parent) return {reason:'SOURCE_NOT_ELIGIBLE'};
  const recipient=parent.author_actor_id;
  const sourceActor=child.author_actor_id;
  if(sourceActor===recipient) return {reason:'SELF_NOTIFICATION_SUPPRESSED'};
  if(!readableActivePublication(child,recipient,context)) return {reason:'SOURCE_NOT_ELIGIBLE'};
  return {candidate:{notification_type:'reply_to_your_publication',rule_ref:REPLY_RULE_REF,recipient_actor_id:recipient,source_actor_id:sourceActor,source_object_ref:child.publication_id}};
}
function reactionCandidate(event,context){
  if(!['reaction.created','reaction.restored'].includes(event.event_type)) return null;
  const reactionEvents=context.eventStore.readStream('reaction',event.stream_id);
  if(!reactionEvents.length) return {reason:'SOURCE_NOT_ELIGIBLE'};
  const reaction=foldReaction(reactionEvents);
  const target=loadPublication(context.eventStore,reaction.publication_id);
  if(!target) return {reason:'SOURCE_NOT_ELIGIBLE'};
  const recipient=target.author_actor_id;
  if(reaction.actor_id===recipient) return {reason:'SELF_NOTIFICATION_SUPPRESSED'};
  if(reaction.lifecycle!=='active'||!readableActivePublication(target,recipient,context)) return {reason:'SOURCE_NOT_ELIGIBLE'};
  return {candidate:{notification_type:'reaction_to_your_publication',rule_ref:REACTION_RULE_REF,recipient_actor_id:recipient,source_actor_id:reaction.actor_id,source_object_ref:reaction.reaction_id}};
}
function deriveNotificationCandidate(event,context){
  if(!event) return {candidate:null,reason:'SOURCE_EVENT_NOT_FOUND'};
  if(event.event_type==='publication.created'){
    const result=replyCandidate(event,context); return result ?? {candidate:null,reason:'NO_NOTIFICATION_RULE'};
  }
  if(event.event_type.startsWith('reaction.')){
    const result=reactionCandidate(event,context); return result ?? {candidate:null,reason:'NO_NOTIFICATION_RULE'};
  }
  return {candidate:null,reason:'NO_NOTIFICATION_RULE'};
}
module.exports={deriveNotificationCandidate,readableActivePublication};
