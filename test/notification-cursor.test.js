const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication,revisePublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {processSourceEvent,acknowledgeNotification}=require('../notification/service');
const {buildNotificationInbox,loadNotificationInboxSurface}=require('../notification/read-service');
const {computeNotificationSnapshotRef}=require('../notification/snapshot');
const {paginateNotifications}=require('../notification/cursor');

function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function ctx(db,store,a){return{db,eventStore:store,principalActorId:a,evaluatedAt:'2026-09-03T12:00:00Z',capabilityGrants:[]};}
function pctx(db,store){return{db,eventStore:store,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T12:01:00Z'};}
function pub(db,store,id,a,extra={}){const r=createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${a}`,publication_id:`pub:${id}`,author_actor_id:a,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...extra},ctx(db,store,a));projectPublicationStream(db,store,`pub:${id}`);return{id:`pub:${id}`,eventId:r.receipt.result_event_ids[0]};}
function setup(){const db=createTestDatabase();let t=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T12:00:${String(t++).padStart(2,'0')}Z`});for(const a of ['actor:A','actor:B','actor:C'])reg(store,a);const parent=pub(db,store,'parent','actor:A');const r1=pub(db,store,'r1','actor:B',{reply_to_ref:parent.id});const r2=pub(db,store,'r2','actor:C',{reply_to_ref:parent.id});const n1=processSourceEvent({eventId:r1.eventId,commandId:'n:r1',idempotencyKey:'n:r1'},pctx(db,store));const n2=processSourceEvent({eventId:r2.eventId,commandId:'n:r2',idempotencyKey:'n:r2'},pctx(db,store));return{db,store,parent,r1,r2,n1,n2};}
function inbox(db,store){return buildNotificationInbox({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});}

test('cursor paginates stable current-visible inbox and visible snapshot change invalidates it',()=>{
 const {db,store,n1}=setup();const base=inbox(db,store);const withSnapshot={...base,algorithm_ref:'trellis-notification-inbox:v1',snapshot_ref:computeNotificationSnapshotRef(base)};
 const page1=paginateNotifications({inbox:withSnapshot,limit:1});assert.equal(page1.items.length,1);assert.ok(page1.next_cursor);
 const page2=paginateNotifications({inbox:withSnapshot,limit:1,cursor:page1.next_cursor});assert.equal(page2.items.length,1);
 acknowledgeNotification({command_id:'ack:n1',idempotency_key:'ack:n1',principal_id:'principal:actor:A',notification_id:n1.notification_id,expected_version:1},ctx(db,store,'actor:A'));
 const changed=inbox(db,store);const changedSnapshot={...changed,algorithm_ref:'trellis-notification-inbox:v1',snapshot_ref:computeNotificationSnapshotRef(changed)};
 assert.throws(()=>paginateNotifications({inbox:changedSnapshot,limit:1,cursor:page1.next_cursor}),/NOTIFICATION_SNAPSHOT_CHANGED/);
});

test('hidden-only unrelated source facts do not change current inbox snapshot',()=>{
 const {db,store}=setup();const before=inbox(db,store);const ref=computeNotificationSnapshotRef(before);
 pub(db,store,'private-unrelated','actor:B',{visibility:'private'});
 const after=inbox(db,store);assert.deepEqual(after,before);assert.equal(computeNotificationSnapshotRef(after),ref);
});

test('visible source revision updates safe context and snapshot without changing issuance order',()=>{
 const {db,store,r1}=setup();const before=inbox(db,store);const itemBefore=before.items.find(i=>i.source.publication_id===r1.id);const offset=itemBefore.issued_global_offset;const ref=computeNotificationSnapshotRef(before);
 revisePublication({command_id:'rev:r1',idempotency_key:'rev:r1',principal_id:'principal:actor:B',publication_id:r1.id,body:'revised body',revision_number:2,supersedes_revision:1,expected_version:1},ctx(db,store,'actor:B'));projectPublicationStream(db,store,r1.id);
 const after=inbox(db,store);const itemAfter=after.items.find(i=>i.source.publication_id===r1.id);assert.equal(itemAfter.source.preview,'revised body');assert.equal(itemAfter.issued_global_offset,offset);assert.notEqual(computeNotificationSnapshotRef(after),ref);
});

test('loadNotificationInboxSurface uses the same snapshot-bound pagination',()=>{
 const {db,store}=setup();const surface=loadNotificationInboxSurface({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,limit:1});assert.equal(surface.items.length,1);assert.ok(surface.snapshot_ref);assert.equal(surface.algorithm_ref,'trellis-notification-inbox:v1');assert.ok(surface.next_cursor);
});
