const test=require('node:test');
const assert=require('node:assert/strict');
const {deriveNotificationId,REPLY_RULE_REF}=require('../notification/types');
const {foldNotification}=require('../notification/fold');
const {validateNotificationIssuedPayload}=require('../notification/schemas');

function issued(overrides={}){
  return {event_id:'evt:n1:issued',event_type:'notification.issued',stream_seq:1,recorded_at:'2026-09-03T08:00:00Z',global_offset:10,payload:{
    notification_id:'notification:n1',recipient_actor_id:'actor:A',notification_type:'reply_to_your_publication',
    source_event_ref:'evt:reply:created',source_object_ref:'pub:reply',source_actor_id:'actor:B',
    rule_ref:REPLY_RULE_REF,visibility:'private',...overrides
  }};
}
function ack(overrides={}){return {event_id:'evt:n1:ack',event_type:'notification.acknowledged',stream_seq:2,recorded_at:'2026-09-03T08:01:00Z',global_offset:11,payload:{notification_id:'notification:n1',...overrides}};}

test('Notification ID is deterministic for recipient source event and rule',()=>{
  assert.equal(deriveNotificationId('actor:A','evt:reply:created',REPLY_RULE_REF),deriveNotificationId('actor:A','evt:reply:created',REPLY_RULE_REF));
  assert.notEqual(deriveNotificationId('actor:A','evt:reply:created',REPLY_RULE_REF),deriveNotificationId('actor:C','evt:reply:created',REPLY_RULE_REF));
});

test('fold starts at issued and allows exactly one acknowledgment',()=>{
  const state=foldNotification([issued(),ack()]);
  assert.equal(state.lifecycle,'issued');
  assert.equal(state.acknowledged,true);
  assert.equal(state.recipient_actor_id,'actor:A');
  assert.equal(state.visibility,'private');
  assert.equal(state.issued_global_offset,10);
  assert.equal(state.acknowledged_event_id,'evt:n1:ack');
  assert.throws(()=>foldNotification([ack()]),/NOTIFICATION_MUST_START_ISSUED/);
  assert.throws(()=>foldNotification([issued(),ack(),{...ack(),event_id:'evt:n1:ack2',stream_seq:3}]),/NOTIFICATION_ALREADY_ACKNOWLEDGED/);
});

test('issued identity fields are immutable across later events',()=>{
  assert.throws(()=>foldNotification([issued(),ack({recipient_actor_id:'actor:X'})]),/NOTIFICATION_IMMUTABLE_FIELD/);
  assert.throws(()=>foldNotification([issued(),ack({source_event_ref:'evt:other'})]),/NOTIFICATION_IMMUTABLE_FIELD/);
});

test('Notification issued payload forbids source content copies and non-private visibility',()=>{
  assert.throws(()=>validateNotificationIssuedPayload({...issued().payload,cached_reply_preview:'secret'}),/NOTIFICATION_SOURCE_COPY_FORBIDDEN/);
  assert.throws(()=>validateNotificationIssuedPayload({...issued().payload,visibility:'public'}),/NOTIFICATION_VISIBILITY_INVALID/);
  assert.doesNotThrow(()=>validateNotificationIssuedPayload(issued().payload));
});
