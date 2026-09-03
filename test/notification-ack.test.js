const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {processSourceEvent,acknowledgeNotification}=require('../notification/service');
const {buildNotificationInbox}=require('../notification/read-service');

function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function ctx(db,store,a,extra={}){return{db,eventStore:store,principalActorId:a,evaluatedAt:'2026-09-03T11:00:00Z',capabilityGrants:[],...extra};}
function pctx(db,store){return{db,eventStore:store,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T11:01:00Z'};}
function setup(){const db=createTestDatabase();let tick=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T11:00:${String(tick++).padStart(2,'0')}Z`});reg(store,'actor:A');reg(store,'actor:B');
 const parent=createPublication({command_id:'pub:parent',idempotency_key:'pub:parent',principal_id:'principal:actor:A',publication_id:'pub:parent',author_actor_id:'actor:A',publication_type:'post',body:'parent',visibility:'public',audience_actor_ids:[]},ctx(db,store,'actor:A'));projectPublicationStream(db,store,'pub:parent');
 const reply=createPublication({command_id:'pub:reply',idempotency_key:'pub:reply',principal_id:'principal:actor:B',publication_id:'pub:reply',author_actor_id:'actor:B',publication_type:'post',body:'reply',visibility:'public',audience_actor_ids:[],reply_to_ref:'pub:parent'},ctx(db,store,'actor:B'));projectPublicationStream(db,store,'pub:reply');
 const issued=processSourceEvent({eventId:reply.receipt.result_event_ids[0],commandId:'notify:reply',idempotencyKey:'notify:reply'},pctx(db,store));return{db,store,issued};}
function inbox(db,store,extra={}){return buildNotificationInbox({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,...extra});}
function ackCmd(id,extra={}){return{command_id:id,idempotency_key:id,principal_id:'principal:actor:A',notification_id:extra.notification_id,expected_version:1,...extra};}

test('fetch does not acknowledge and explicit recipient ack updates unread state',()=>{
 const {db,store,issued}=setup();const before=db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
 assert.equal(inbox(db,store).unread_count,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n,before);
 acknowledgeNotification(ackCmd('ack:1',{notification_id:issued.notification_id}),ctx(db,store,'actor:A'));
 assert.equal(inbox(db,store).unread_count,0);
 assert.deepEqual(store.readStream('notification',issued.notification_id).map(e=>e.event_type),['notification.issued','notification.acknowledged']);
});

test('same ack command retries idempotently before acknowledged-state preflight',()=>{
 const {db,store,issued}=setup();const command=ackCmd('ack:idem',{notification_id:issued.notification_id});
 acknowledgeNotification(command,ctx(db,store,'actor:A'));
 const retry=acknowledgeNotification(command,ctx(db,store,'actor:A'));
 assert.equal(retry.receipt.deduplicated,true);assert.equal(store.readStream('notification',issued.notification_id).length,2);
});

test('only canonical recipient may acknowledge; representative read does not grant ack authority',()=>{
 const {db,store,issued}=setup();
 const other=ackCmd('ack:other',{notification_id:issued.notification_id,principal_id:'principal:actor:B'});
 assert.throws(()=>acknowledgeNotification(other,ctx(db,store,'actor:B')),error=>error&&error.code==='POLICY_DENIED');
 assert.throws(()=>acknowledgeNotification({...other,command_id:'ack:rep',idempotency_key:'ack:rep'},ctx(db,store,'actor:B',{represents_actor_ids:['actor:A']})),error=>error&&error.code==='POLICY_DENIED');
});

test('public ack path returns NOT_VISIBLE when source is no longer current-inbox-visible',()=>{
 const {db,store,issued}=setup();const disclosurePolicy=(publication,viewer)=>publication.publication_id==='pub:reply'&&viewer.viewer_actor_id==='actor:A'?'deny':'allow';
 assert.equal(inbox(db,store,{disclosurePolicy}).items.length,0);
 assert.throws(()=>acknowledgeNotification(ackCmd('ack:hidden',{notification_id:issued.notification_id}),ctx(db,store,'actor:A',{disclosurePolicy})),/NOTIFICATION_NOT_VISIBLE/);
 assert.equal(store.readStream('notification',issued.notification_id).length,1);
});
