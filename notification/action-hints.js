function availableNotificationActions(item){
  if(!item) return [];
  if(item.notification_type==='reply_to_your_publication') return ['open_source','reply','open_actor'];
  if(item.notification_type==='reaction_to_your_publication') return ['open_source','open_actor'];
  return [];
}
module.exports={availableNotificationActions};
