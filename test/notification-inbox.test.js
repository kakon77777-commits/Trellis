const test=require('node:test');
const assert=require('node:assert/strict');
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
const {createReaction,changeReaction}=require('../reaction/service');
const {processSourceEvent}=require('../notification/service');
const {buildNotificationInbox}=require('../notification/read-service');

async function reg(store,a){(await registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority}));}
function ctx(db,store,a,extra={}){return{db,sql:db,eventStore:store,authorize:evaluateAuthority,principalActorId:a,evaluatedAt:'2026-09-03T10:00:00Z',capabilityGrants:[],...extra};}
function pctx(db,store,extra={}){return{db,sql:db,eventStore:store,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T10:01:00Z',...extra};}
async function pub(db,store,id,a,extra={},extraCtx={}){const r=(await createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${a}`,publication_id:`pub:${id}`,author_actor_id:a,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...extra},ctx(db,store,a,extraCtx)));(await projectPublicationStream(db,store,`pub:${id}`));return{id:`pub:${id}`,eventId:r.receipt.result_event_ids[0]};}
async function issue(db,store,eventId,id,extra={}){return (await processSourceEvent({eventId,commandId:`notify:${id}`,idempotencyKey:`notify:${id}`},pctx(db,store,extra)));}
async function setupReply(){const db=createTestDatabase();let tick=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:00:${String(tick++).padStart(2,'0')}Z`});(await reg(store,'actor:A'));(await reg(store,'actor:B'));const parent=(await pub(db,store,'parent','actor:A'));const reply=(await pub(db,store,'reply','actor:B',{reply_to_ref:parent.id}));const n=(await issue(db,store,reply.eventId,'reply'));return{db,store,parent,reply,n};}
async function inbox(db,store,extra={}){return (await buildNotificationInbox({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,...extra}));}

test('active readable source appears and fetch remains purely derived',async ()=>{
 const {db,store,n}=(await setupReply());const before=db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
 const value=(await inbox(db,store));assert.equal(value.items.length,1);assert.equal(value.items[0].notification_id,n.notification_id);assert.equal(value.unread_count,1);assert.equal(value.items[0].source.kind,'publication');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n,before);
});

test('N6 withdrawn source disappears from current inbox while historical receipt remains',async ()=>{
 const {db,store,reply,n}=(await setupReply());
 (await withdrawPublication({command_id:'wd:reply',idempotency_key:'wd:reply',principal_id:'principal:actor:B',publication_id:reply.id,expected_version:1},ctx(db,store,'actor:B')));(await projectPublicationStream(db,store,reply.id));
 assert.equal((await inbox(db,store)).items.length,0);assert.equal((await inbox(db,store)).unread_count,0);
 assert.equal(store.readStream('notification',n.notification_id)[0].event_type,'notification.issued');
});

test('N5/N6 current-policy-hidden source disappears without erasing receipt',async ()=>{
 const {db,store,reply,n}=(await setupReply());
 const disclosurePolicy=(publication,viewer)=>publication.publication_id===reply.id&&viewer.viewer_actor_id==='actor:A'?'deny':'allow';
 assert.equal((await inbox(db,store,{disclosurePolicy})).items.length,0);
 assert.equal(store.readStream('notification',n.notification_id).length,1);
});

test('N6 membership loss removes private Community reply notification but leaves issuance history',async ()=>{
 const db=createTestDatabase();let tick=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:10:${String(tick++).padStart(2,'0')}Z`});for(const a of ['actor:A','actor:B'])(await reg(store,a));
 (await createCommunity({command_id:'c:create',idempotency_key:'c:create',principal_id:'principal:community:C',community_id:'community:C'},{eventStore:store,authorize:evaluateAuthority}));
 (await setCommunityDiscoverability({command_id:'c:private',idempotency_key:'c:private',principal_id:'principal:community:C',community_id:'community:C',value:'private'},ctx(db,store,'community:C')));
 const rels={};for(const a of ['actor:A','actor:B']){const pending=(await requestMembership({command_id:`join:${a}`,idempotency_key:`join:${a}`,principal_id:`principal:${a}`,actor_id:a,community_id:'community:C'},ctx(db,store,a)));(await approveMembership({command_id:`approve:${a}`,idempotency_key:`approve:${a}`,principal_id:'principal:community:C',community_id:'community:C',relationship_id:pending.relationship_id,expected_version:1},ctx(db,store,'community:C')));rels[a]=pending.relationship_id;}
 (await rebuildRelationshipProjection(db,store));
 const grant=a=>({active:true,principal_id:`principal:${a}`,capability:'publication:create',scope_ref:'community:C'});
 const parent=(await pub(db,store,'c-parent','actor:A',{scope_ref:'community:C',visibility:'scope_members'},{capabilityGrants:[grant('actor:A')]}));
 const reply=(await pub(db,store,'c-reply','actor:B',{scope_ref:'community:C',visibility:'scope_members',reply_to_ref:parent.id},{capabilityGrants:[grant('actor:B')]}));
 const n=(await issue(db,store,reply.eventId,'community-reply'));assert.equal((await inbox(db,store)).items.length,1);
 (await leaveCommunity({command_id:'leave:A',idempotency_key:'leave:A',principal_id:'principal:actor:A',actor_id:'actor:A',community_id:'community:C',relationship_id:rels['actor:A'],expected_version:2},ctx(db,store,'actor:A')));(await rebuildRelationshipProjection(db,store));
 assert.equal((await inbox(db,store)).items.length,0);assert.equal(store.readStream('notification',n.notification_id).length,1);
});

test('reaction notification context tracks current type without changing issuance order',async ()=>{
 const db=createTestDatabase();let tick=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:20:${String(tick++).padStart(2,'0')}Z`});(await reg(store,'actor:A'));(await reg(store,'actor:C'));const parent=(await pub(db,store,'rx-parent','actor:A'));
 const created=(await createReaction({command_id:'rx:create',idempotency_key:'rx:create',principal_id:'principal:actor:C',actor_id:'actor:C',publication_id:parent.id,reaction_type:'insightful'},ctx(db,store,'actor:C')));
 const n=(await issue(db,store,created.receipt.result_event_ids[0],'rx'));let item=(await inbox(db,store)).items[0];const offset=item.issued_global_offset;assert.equal(item.source.reaction_type,'insightful');
 (await changeReaction({command_id:'rx:change',idempotency_key:'rx:change',principal_id:'principal:actor:C',actor_id:'actor:C',publication_id:parent.id,reaction_type:'love',expected_version:1},ctx(db,store,'actor:C')));
 item=(await inbox(db,store)).items[0];assert.equal(item.source.reaction_type,'love');assert.equal(item.issued_global_offset,offset);assert.equal(item.notification_id,n.notification_id);
});

test('unrelated viewer cannot read recipient inbox and representative does not widen recipient source eligibility',async ()=>{
 const {db,store,reply}=(await setupReply());
 await assert.rejects(async()=>(await buildNotificationInbox({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store})),/NOTIFICATION_NOT_AUTHORIZED/);
 const disclosurePolicy=(publication,viewer)=>publication.publication_id===reply.id&&viewer.viewer_actor_id==='actor:A'?'deny':'allow';
 const represented=(await buildNotificationInbox({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:B',represents_actor_ids:['actor:A']},db,eventStore:store,disclosurePolicy}));
 assert.equal(represented.items.length,0);
});
