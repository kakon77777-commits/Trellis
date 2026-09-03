const {createHash}=require('node:crypto');
const {canonicalStringify}=require('../core/canonical-json');
const {MATERIALIZER_VERSION}=require('./projector');
const {PROJECTION_VERSION}=require('./read-service');
const NOTIFICATION_ALGORITHM_REF='trellis-notification-inbox:v1';
function computeNotificationSnapshotRef(inbox){
  const material={recipient_actor_id:inbox.recipient_actor_id,algorithm_ref:NOTIFICATION_ALGORITHM_REF,projection_versions:{inbox:PROJECTION_VERSION,notification:MATERIALIZER_VERSION},unread_count:inbox.unread_count,items:inbox.items};
  return createHash('sha256').update(canonicalStringify(material),'utf8').digest('hex');
}
module.exports={NOTIFICATION_ALGORITHM_REF,computeNotificationSnapshotRef};
