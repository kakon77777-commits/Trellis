const test=require('node:test');
const assert=require('node:assert/strict');
const packageJson=require('../package.json');
const {INHERITORS}=require('../foundation/cross-domain-contract');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createCommunity}=require('../community/service');
const {setCommunityDiscoverability}=require('../community/product-commands');
const {requestMembership,approveMembership,leaveCommunity}=require('../community/membership');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {createPublication,withdrawPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {createReaction,changeReaction,withdrawReaction,restoreReaction}=require('../reaction/service');
const {processSourceEvent,acknowledgeNotification}=require('../notification/service');
const {buildNotificationInbox}=require('../notification/read-service');
const {rebuildNotificationProjection}=require('../notification/projector');

function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function ctx(db,store,a,extra={}){return{db,eventStore:store,authorize:evaluateAuthority,principalActorId:a,evaluatedAt:'2026-09-03T14:00:00Z',capabilityGrants:[],...extra};}
function pctx(db,store,extra={}){return{db,eventStore:store,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T14:01:00Z',...extra};}
function pub(db,store,id,a,extra={},extraCtx={}){const r=createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${a}`,publication_id:`pub:${id}`,author_actor_id:a,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...extra},ctx(db,store,a,extraCtx));projectPublicationStream(db,store,`pub:${id}`);return{id:`pub:${id}`,eventId:r.receipt.result_event_ids[0]};}
function issue(db,store,eventId,id,extra={}){return processSourceEvent({eventId,commandId:`notify:${id}`,idempotencyKey:`notify:${id}`},pctx(db,store,extra));}
function inbox(db,store,extra={}){return buildNotificationInbox({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,...extra});}
function snapshotRows(db){return db.prepare('SELECT * FROM notifications_current ORDER BY notification_id').all();}

test('Notification inherits X1-X3 and release syntax scans notification modules',()=>{
 assert.deepEqual(INHERITORS.notification,['X1','X2','X3']);
 assert.match(packageJson.scripts.check,/notification\/\*\.js/);
});

test('N1-N13 vertical slice keeps receipt operational, explicit ack, current context, and restore as a new notification epoch',()=>{
 const db=createTestDatabase();let tick=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T14:00:${String(tick++).padStart(2,'0')}Z`});for(const a of ['actor:A','actor:B','actor:C'])reg(store,a);
 const p1=pub(db,store,'P1','actor:A');const p2=pub(db,store,'P2','actor:B',{reply_to_ref:p1.id});const n1=issue(db,store,p2.eventId,'reply');
 const rxCreate=createReaction({command_id:'rx:create',idempotency_key:'rx:create',principal_id:'principal:actor:C',actor_id:'actor:C',publication_id:p1.id,reaction_type:'insightful'},ctx(db,store,'actor:C'));const n2=issue(db,store,rxCreate.receipt.result_event_ids[0],'rx-create');
 let value=inbox(db,store);assert.equal(value.items.length,2);assert.equal(value.unread_count,2);const eventCount=db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;inbox(db,store);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n,eventCount);
 acknowledgeNotification({command_id:'ack:n1',idempotency_key:'ack:n1',principal_id:'principal:actor:A',notification_id:n1.notification_id,expected_version:1},ctx(db,store,'actor:A'));assert.equal(inbox(db,store).unread_count,1);
 const changed=changeReaction({command_id:'rx:change',idempotency_key:'rx:change',principal_id:'principal:actor:C',actor_id:'actor:C',publication_id:p1.id,reaction_type:'love',expected_version:1},ctx(db,store,'actor:C'));assert.deepEqual(processSourceEvent({eventId:changed.receipt.result_event_ids[0],commandId:'notify:change',idempotencyKey:'notify:change'},pctx(db,store)),{issued:false,reason:'NO_NOTIFICATION_RULE'});
 value=inbox(db,store);const n2Before=value.items.find(i=>i.notification_id===n2.notification_id);assert.equal(n2Before.source.reaction_type,'love');const n2Offset=n2Before.issued_global_offset;
 withdrawReaction({command_id:'rx:withdraw',idempotency_key:'rx:withdraw',principal_id:'principal:actor:C',actor_id:'actor:C',publication_id:p1.id,expected_version:2},ctx(db,store,'actor:C'));assert.equal(inbox(db,store).items.some(i=>i.notification_id===n2.notification_id),false);assert.equal(store.readStream('notification',n2.notification_id)[0].event_type,'notification.issued');
 const restored=restoreReaction({command_id:'rx:restore',idempotency_key:'rx:restore',principal_id:'principal:actor:C',actor_id:'actor:C',publication_id:p1.id,reaction_type:'love',expected_version:3},ctx(db,store,'actor:C'));const n3=issue(db,store,restored.receipt.result_event_ids[0],'rx-restore');
 value=inbox(db,store);assert.equal(value.items.some(i=>i.notification_id===n3.notification_id),true);assert.equal(value.items.some(i=>i.notification_id===n2.notification_id),false,'old reaction-created receipt must not reappear after restore');
 assert.equal(store.readStream('notification',n2.notification_id)[0].global_offset,n2Offset);
 for(const id of [n1.notification_id,n2.notification_id,n3.notification_id]) assert.deepEqual(store.verifyHashChain('notification',id),{ok:true,failureAt:null});
 const issuedPayload=store.readStream('notification',n1.notification_id)[0].payload;for(const f of ['body','preview','cached_reply_preview','cached_reaction_text'])assert.equal(Object.hasOwn(issuedPayload,f),false);
});

test('N6 separately removes withdrawn, policy-hidden, and membership-lost sources while preserving issued history',()=>{
 // withdrawn
 {const db=createTestDatabase();const store=new SQLiteEventStore(db);reg(store,'actor:A');reg(store,'actor:B');const p=pub(db,store,'w-parent','actor:A');const r=pub(db,store,'w-reply','actor:B',{reply_to_ref:p.id});const n=issue(db,store,r.eventId,'w');withdrawPublication({command_id:'wd:w',idempotency_key:'wd:w',principal_id:'principal:actor:B',publication_id:r.id,expected_version:1},ctx(db,store,'actor:B'));projectPublicationStream(db,store,r.id);assert.equal(inbox(db,store).items.length,0);assert.equal(store.readStream('notification',n.notification_id).length,1);}
 // policy hidden
 {const db=createTestDatabase();const store=new SQLiteEventStore(db);reg(store,'actor:A');reg(store,'actor:B');const p=pub(db,store,'h-parent','actor:A');const r=pub(db,store,'h-reply','actor:B',{reply_to_ref:p.id});const n=issue(db,store,r.eventId,'h');const policy=(publication,viewer)=>publication.publication_id===r.id&&viewer.viewer_actor_id==='actor:A'?'deny':'allow';assert.equal(inbox(db,store,{disclosurePolicy:policy}).items.length,0);assert.equal(store.readStream('notification',n.notification_id).length,1);}
 // membership lost
 {const db=createTestDatabase();const store=new SQLiteEventStore(db);reg(store,'actor:A');reg(store,'actor:B');createCommunity({command_id:'c',idempotency_key:'c',principal_id:'principal:community:C',community_id:'community:C'},{eventStore:store,authorize:evaluateAuthority});setCommunityDiscoverability({command_id:'c:private',idempotency_key:'c:private',principal_id:'principal:community:C',community_id:'community:C',value:'private'},ctx(db,store,'community:C'));const rel={};for(const a of ['actor:A','actor:B']){const pending=requestMembership({command_id:`j:${a}`,idempotency_key:`j:${a}`,principal_id:`principal:${a}`,actor_id:a,community_id:'community:C'},ctx(db,store,a));approveMembership({command_id:`a:${a}`,idempotency_key:`a:${a}`,principal_id:'principal:community:C',community_id:'community:C',relationship_id:pending.relationship_id,expected_version:1},ctx(db,store,'community:C'));rel[a]=pending.relationship_id;}rebuildRelationshipProjection(db,store);const grant=a=>({active:true,principal_id:`principal:${a}`,capability:'publication:create',scope_ref:'community:C'});const p=pub(db,store,'m-parent','actor:A',{scope_ref:'community:C',visibility:'scope_members'},{capabilityGrants:[grant('actor:A')]});const r=pub(db,store,'m-reply','actor:B',{scope_ref:'community:C',visibility:'scope_members',reply_to_ref:p.id},{capabilityGrants:[grant('actor:B')]});const n=issue(db,store,r.eventId,'m');leaveCommunity({command_id:'leave:A',idempotency_key:'leave:A',principal_id:'principal:actor:A',actor_id:'actor:A',community_id:'community:C',relationship_id:rel['actor:A'],expected_version:2},ctx(db,store,'actor:A'));rebuildRelationshipProjection(db,store);assert.equal(inbox(db,store).items.length,0);assert.equal(store.readStream('notification',n.notification_id).length,1);}
});

test('Notification projection rebuilds exactly and service exposes no out-of-scope shortcuts',()=>{
 const db=createTestDatabase();const store=new SQLiteEventStore(db);reg(store,'actor:A');reg(store,'actor:B');const p=pub(db,store,'rebuild-parent','actor:A');const r=pub(db,store,'rebuild-reply','actor:B',{reply_to_ref:p.id});issue(db,store,r.eventId,'rebuild');const before=snapshotRows(db);db.exec('DELETE FROM notifications_current');rebuildNotificationProjection(db,store);assert.deepEqual(snapshotRows(db),before);
 const service=require('../notification/service');for(const name of ['markSeen','markOpened','recordDwell','dismiss','mute','sendEmail','sendPush','sendWebhook','rankFeed','deriveDiscoveryAffinity','autoBackfill','mutatePublication','mutateReaction'])assert.equal(service[name],undefined,name);
});
