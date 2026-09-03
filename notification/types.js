const { deriveId } = require('../core/ids');

const REPLY_RULE_REF='trellis-notification:reply:v1';
const REACTION_RULE_REF='trellis-notification:reaction:v1';
const NOTIFICATION_TYPES=Object.freeze(['reply_to_your_publication','reaction_to_your_publication']);

function deriveNotificationId(recipientActorId,sourceEventRef,ruleRef){
  return deriveId('notification',`${recipientActorId}|${sourceEventRef}|${ruleRef}`);
}
function isNotificationType(value){return NOTIFICATION_TYPES.includes(value);}

module.exports={REPLY_RULE_REF,REACTION_RULE_REF,NOTIFICATION_TYPES,deriveNotificationId,isNotificationType};
