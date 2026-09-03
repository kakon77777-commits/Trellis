const {canonicalStringify}=require('../core/canonical-json');
function validate(value){
  if(!value||typeof value!=='object') throw new TypeError('INVALID_NOTIFICATION_CURSOR');
  for(const f of ['algorithm_ref','snapshot_ref','last_issued_recorded_at','last_notification_id']) if(typeof value[f]!=='string'||!value[f]) throw new TypeError('INVALID_NOTIFICATION_CURSOR');
  if(!Number.isInteger(value.last_issued_global_offset)||value.last_issued_global_offset<0) throw new TypeError('INVALID_NOTIFICATION_CURSOR');
  return value;
}
function encodeNotificationCursor(value){return Buffer.from(canonicalStringify(validate(value)),'utf8').toString('base64url');}
function decodeNotificationCursor(encoded){try{return validate(JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')));}catch(error){if(error instanceof TypeError&&error.message==='INVALID_NOTIFICATION_CURSOR')throw error;throw new TypeError('INVALID_NOTIFICATION_CURSOR');}}
function cursorFor(inbox,item){return{algorithm_ref:inbox.algorithm_ref,snapshot_ref:inbox.snapshot_ref,last_issued_recorded_at:item.issued_recorded_at,last_issued_global_offset:item.issued_global_offset,last_notification_id:item.notification_id};}
function matches(item,cursor){return item.notification_id===cursor.last_notification_id&&item.issued_recorded_at===cursor.last_issued_recorded_at&&item.issued_global_offset===cursor.last_issued_global_offset;}
function paginateNotifications({inbox,limit=20,cursor=null}){
  if(!inbox||!Array.isArray(inbox.items)) throw new TypeError('INVALID_NOTIFICATION_INBOX');
  if(!Number.isInteger(limit)||limit<1) throw new TypeError('INVALID_NOTIFICATION_LIMIT');
  let start=0;
  if(cursor){const decoded=decodeNotificationCursor(cursor);if(decoded.algorithm_ref!==inbox.algorithm_ref||decoded.snapshot_ref!==inbox.snapshot_ref) throw new Error('NOTIFICATION_SNAPSHOT_CHANGED');const idx=inbox.items.findIndex(item=>matches(item,decoded));if(idx<0) throw new Error('INVALID_NOTIFICATION_CURSOR');start=idx+1;}
  const items=inbox.items.slice(start,start+limit);const hasMore=start+items.length<inbox.items.length;const nextCursor=hasMore&&items.length?encodeNotificationCursor(cursorFor(inbox,items[items.length-1])):null;return{items,next_cursor:nextCursor};
}
module.exports={encodeNotificationCursor,decodeNotificationCursor,paginateNotifications};
