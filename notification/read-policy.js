const {foldPublication}=require('../publication/fold');
const {foldReaction}=require('../reaction/fold');
const {canViewPublication}=require('../publication/read-policy');
const {createMembershipResolver}=require('../community/membership-read');

function recipientViewerContext(recipientActorId){return{viewer_actor_id:recipientActorId};}
function loadPublicationState(eventStore,publicationId){const events=eventStore.readStream('publication',publicationId);return events.length?foldPublication(events):null;}
function publicationCurrentContext(publication,recipientActorId,context){
  if(!publication||publication.lifecycle!=='active') return null;
  const membershipResolver=createMembershipResolver(context.db);
  if(!canViewPublication(publication,recipientViewerContext(recipientActorId),context.disclosurePolicy,membershipResolver)) return null;
  return {
    kind:'publication',publication_id:publication.publication_id,author_actor_id:publication.author_actor_id,
    preview:String(publication.current_body ?? '').slice(0,160),revision:publication.current_revision
  };
}
function replyNotificationContext(row,context){
  const publication=loadPublicationState(context.eventStore,row.source_object_ref);
  return publicationCurrentContext(publication,row.recipient_actor_id,context);
}
function currentReactionActivationEventId(events){
  let activationEventId=null;
  let active=false;
  for(const event of events){
    if(event.event_type==='reaction.created'||event.event_type==='reaction.restored'){activationEventId=event.event_id;active=true;}
    else if(event.event_type==='reaction.withdrawn'){active=false;}
  }
  return active?activationEventId:null;
}
function reactionNotificationContext(row,context){
  const events=context.eventStore.readStream('reaction',row.source_object_ref);
  if(!events.length) return null;
  const reaction=foldReaction(events);
  if(reaction.lifecycle!=='active') return null;
  if(currentReactionActivationEventId(events)!==row.source_event_ref) return null;
  const target=loadPublicationState(context.eventStore,reaction.publication_id);
  const publicationContext=publicationCurrentContext(target,row.recipient_actor_id,context);
  if(!publicationContext) return null;
  return {
    kind:'reaction',reaction_id:reaction.reaction_id,actor_id:reaction.actor_id,
    publication_id:reaction.publication_id,reaction_type:reaction.reaction_type,
    target_publication:{publication_id:publicationContext.publication_id,author_actor_id:publicationContext.author_actor_id}
  };
}
function resolveCurrentNotificationContext(row,context){
  if(row.notification_type==='reply_to_your_publication') return replyNotificationContext(row,context);
  if(row.notification_type==='reaction_to_your_publication') return reactionNotificationContext(row,context);
  return null;
}
module.exports={resolveCurrentNotificationContext,publicationCurrentContext,recipientViewerContext,currentReactionActivationEventId};
