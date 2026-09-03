const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {rebuildNotificationProjection,projectNotificationStream}=require('../notification/projector');
const {REPLY_RULE_REF}=require('../notification/types');

function auth(id,action='notification.issue'){return{decision_id:`auth:${id}`,principal_id:'principal:notification-processor',actor_id:'actor:B',policy_ref:'policy:notification-processor:v1',requested_action:action,aggregate_id:'notification:n1',credential_refs:[],decision:'allow',evaluated_at:'2026-09-03T08:10:00Z'};}
function ev(id,type,payload){return{event_id:`evt:${id}`,schema_version:'0.1',event_type:type,actor_id:'actor:B',principal_id:type==='notification.issued'?'principal:notification-processor':'principal:actor:A',causation_id:id,correlation_id:id,occurred_at:'2026-09-03T08:10:00Z',recorded_at:'2026-09-03T08:10:00Z',time_source:'system',provenance_refs:[],payload};}
function receipt(id,digest='d'){return{command_id:id,idempotency_key:id,command_digest:`${digest}:${id}`,status:'accepted',created_at:'2026-09-03T08:10:00Z'};}

test('notifications_current is disposable and exactly rebuildable from H_notification',()=>{
 const db=createTestDatabase(); let tick=0; const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T08:10:0${tick++}Z`});
 const issued={notification_id:'notification:n1',recipient_actor_id:'actor:A',notification_type:'reply_to_your_publication',source_event_ref:'evt:reply:created',source_object_ref:'pub:reply',source_actor_id:'actor:B',rule_ref:REPLY_RULE_REF,visibility:'private'};
 store.append({streamType:'notification',streamId:'notification:n1',expectedVersion:0,events:[ev('issue','notification.issued',issued)],authorityReceipt:auth('issue'),commandReceipt:receipt('issue')});
 projectNotificationStream(db,store,'notification:n1');
 store.append({streamType:'notification',streamId:'notification:n1',expectedVersion:1,events:[ev('ack','notification.acknowledged',{notification_id:'notification:n1'})],authorityReceipt:{...auth('ack','notification.ack'),decision_id:'auth:ack',principal_id:'principal:actor:A',actor_id:'actor:A'},commandReceipt:receipt('ack')});
 projectNotificationStream(db,store,'notification:n1');
 const before=db.prepare('SELECT * FROM notifications_current ORDER BY notification_id').all();
 assert.equal(before.length,1); assert.equal(before[0].acknowledged,1); assert.ok(before[0].issued_global_offset>0);
 db.exec('DELETE FROM notifications_current');
 assert.deepEqual(db.prepare('SELECT * FROM notifications_current').all(),[]);
 rebuildNotificationProjection(db,store);
 assert.deepEqual(db.prepare('SELECT * FROM notifications_current ORDER BY notification_id').all(),before);
});
