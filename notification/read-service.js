const {resolveCurrentNotificationContext}=require('./read-policy');
const {applyOwnerNotificationPreferences}=require('../preference/notification-policy');

const PROJECTION_VERSION='trellis-notification-inbox:0.1';
function authorizedRecipientViewer(recipientActorId,viewerContext={}){
  if(viewerContext.viewer_actor_id===recipientActorId) return true;
  return (viewerContext.represents_actor_ids ?? []).includes(recipientActorId);
}
function assertInboxReadAuthorized(recipientActorId,viewerContext){
  if(!authorizedRecipientViewer(recipientActorId,viewerContext)) throw new Error('NOTIFICATION_NOT_AUTHORIZED');
}
function normalizeRow(row){if(!row)return null;return{...row,acknowledged:Boolean(row.acknowledged)};}
function loadCurrentNotificationItem({row,viewerContext={},db,eventStore,disclosurePolicy}){
  const normalized=normalizeRow(row); if(!normalized) return null;
  // Source eligibility is evaluated in the recipient's world, never widened by representative identity.
  const source=resolveCurrentNotificationContext(normalized,{db,eventStore,disclosurePolicy});
  if(!source) return null;
  return {
    notification_id:normalized.notification_id,
    recipient_actor_id:normalized.recipient_actor_id,
    notification_type:normalized.notification_type,
    source_actor_id:normalized.source_actor_id,
    source,
    acknowledged:normalized.acknowledged,
    rule_ref:normalized.rule_ref,
    issued_event_id:normalized.issued_event_id,
    issued_recorded_at:normalized.issued_recorded_at,
    issued_global_offset:normalized.issued_global_offset,
    execution_authority:{implied_by_notification_read:false}
  };
}
function compareDesc(a,b){
  if(a.issued_recorded_at!==b.issued_recorded_at) return a.issued_recorded_at>b.issued_recorded_at?-1:1;
  if(a.issued_global_offset!==b.issued_global_offset) return b.issued_global_offset-a.issued_global_offset;
  return b.notification_id.localeCompare(a.notification_id);
}
function buildNotificationInbox({recipientActorId,viewerContext={},db,eventStore,disclosurePolicy}){
  assertInboxReadAuthorized(recipientActorId,viewerContext);
  const rows=db.prepare(`SELECT * FROM notifications_current WHERE recipient_actor_id=? ORDER BY issued_global_offset DESC, notification_id DESC`).all(recipientActorId);
  const items=[];
  for(const row of rows){
    const item=loadCurrentNotificationItem({row,viewerContext,db,eventStore,disclosurePolicy});
    if(item) items.push(item);
  }
  const preferredItems=applyOwnerNotificationPreferences({ownerActorId:recipientActorId,viewerContext,items,db});
  preferredItems.sort(compareDesc);
  return {recipient_actor_id:recipientActorId,items:preferredItems,unread_count:preferredItems.filter(item=>!item.acknowledged).length,projection_version:PROJECTION_VERSION};
}

function loadNotificationInboxSurface({recipientActorId,viewerContext={},db,eventStore,disclosurePolicy,limit=20,cursor=null}){
  const {computeNotificationSnapshotRef,NOTIFICATION_ALGORITHM_REF}=require('./snapshot');
  const {paginateNotifications}=require('./cursor');
  const {availableNotificationActions}=require('./action-hints');
  const base=buildNotificationInbox({recipientActorId,viewerContext,db,eventStore,disclosurePolicy});
  const withSnapshot={...base,algorithm_ref:NOTIFICATION_ALGORITHM_REF,snapshot_ref:computeNotificationSnapshotRef(base)};
  const page=paginateNotifications({inbox:withSnapshot,limit,cursor});
  const items=page.items.map(item=>({...item,available_actions:availableNotificationActions(item),execution_authority:{implied_by_notification_read:false}}));
  return {...withSnapshot,items,next_cursor:page.next_cursor};
}

module.exports={PROJECTION_VERSION,buildNotificationInbox,loadNotificationInboxSurface,loadCurrentNotificationItem,assertInboxReadAuthorized,authorizedRecipientViewer};
