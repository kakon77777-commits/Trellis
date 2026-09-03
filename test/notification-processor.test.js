const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {createReaction,changeReaction,withdrawReaction,restoreReaction}=require('../reaction/service');
const {processSourceEvent}=require('../notification/service');
const {deriveNotificationId,REPLY_RULE_REF,REACTION_RULE_REF}=require('../notification/types');

function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function actorCtx(db,store,a,extra={}){return{db,eventStore:store,principalActorId:a,evaluatedAt:'2026-09-03T09:00:00Z',capabilityGrants:[],...extra};}
function processorCtx(db,store,extra={}){return{db,eventStore:store,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T09:01:00Z',...extra};}
function pub(db,store,id,author,extra={}){const r=createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...extra},actorCtx(db,store,author));projectPublicationStream(db,store,`pub:${id}`);return {id:`pub:${id}`,eventId:r.receipt.result_event_ids[0]};}
function rx(id,a,p,type='like',extra={}){return{command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:`principal:${a}`,actor_id:a,publication_id:p,reaction_type:type,...extra};}
function countIssued(db){return db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='notification' AND event_type='notification.issued'").get().n;}
function setup(){const db=createTestDatabase();let tick=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T09:00:${String(tick++).padStart(2,'0')}Z`});for(const a of ['actor:A','actor:B','actor:C'])reg(store,a);const p1=pub(db,store,'p1','actor:A');return{db,store,p1};}

test('reply source event issues exactly one deterministic receipt to parent author and retries deduplicate',()=>{
 const {db,store,p1}=setup();
 const reply=pub(db,store,'reply','actor:B',{reply_to_ref:p1.id});
 const input={eventId:reply.eventId,commandId:'notify:reply',idempotencyKey:'notify:reply'};
 const first=processSourceEvent(input,processorCtx(db,store));
 assert.equal(first.issued,true);
 assert.equal(first.notification_id,deriveNotificationId('actor:A',reply.eventId,REPLY_RULE_REF));
 assert.equal(countIssued(db),1);
 const retry=processSourceEvent({...input,commandId:'notify:reply:retry',idempotencyKey:'notify:reply:retry'},processorCtx(db,store));
 assert.equal(retry.notification_id,first.notification_id);
 assert.equal(retry.deduplicated,true);
 assert.equal(countIssued(db),1);
});

test('reaction created and restored issue while changed and withdrawn do not',()=>{
 const {db,store,p1}=setup();
 const created=createReaction(rx('create','actor:C',p1.id,'insightful'),actorCtx(db,store,'actor:C'));
 const createdEvent=created.receipt.result_event_ids[0];
 assert.equal(processSourceEvent({eventId:createdEvent,commandId:'notify:rx:create',idempotencyKey:'notify:rx:create'},processorCtx(db,store)).notification_id,deriveNotificationId('actor:A',createdEvent,REACTION_RULE_REF));
 const changed=changeReaction(rx('change','actor:C',p1.id,'love',{expected_version:1}),actorCtx(db,store,'actor:C'));
 assert.deepEqual(processSourceEvent({eventId:changed.receipt.result_event_ids[0],commandId:'notify:rx:change',idempotencyKey:'notify:rx:change'},processorCtx(db,store)),{issued:false,reason:'NO_NOTIFICATION_RULE'});
 const withdrawn=withdrawReaction(rx('withdraw','actor:C',p1.id,'love',{expected_version:2}),actorCtx(db,store,'actor:C'));
 assert.deepEqual(processSourceEvent({eventId:withdrawn.receipt.result_event_ids[0],commandId:'notify:rx:withdraw',idempotencyKey:'notify:rx:withdraw'},processorCtx(db,store)),{issued:false,reason:'NO_NOTIFICATION_RULE'});
 const restored=restoreReaction(rx('restore','actor:C',p1.id,'love',{expected_version:3}),actorCtx(db,store,'actor:C'));
 const restoredEvent=restored.receipt.result_event_ids[0];
 const result=processSourceEvent({eventId:restoredEvent,commandId:'notify:rx:restore',idempotencyKey:'notify:rx:restore'},processorCtx(db,store));
 assert.equal(result.notification_id,deriveNotificationId('actor:A',restoredEvent,REACTION_RULE_REF));
 assert.equal(countIssued(db),2);
});

test('self reply and self reaction are suppressed',()=>{
 const {db,store,p1}=setup();
 const selfReply=pub(db,store,'self-reply','actor:A',{reply_to_ref:p1.id});
 assert.deepEqual(processSourceEvent({eventId:selfReply.eventId,commandId:'notify:self-reply',idempotencyKey:'notify:self-reply'},processorCtx(db,store)),{issued:false,reason:'SELF_NOTIFICATION_SUPPRESSED'});
 const selfReaction=createReaction(rx('self-rx','actor:A',p1.id,'like'),actorCtx(db,store,'actor:A'));
 assert.deepEqual(processSourceEvent({eventId:selfReaction.receipt.result_event_ids[0],commandId:'notify:self-rx',idempotencyKey:'notify:self-rx'},processorCtx(db,store)),{issued:false,reason:'SELF_NOTIFICATION_SUPPRESSED'});
 assert.equal(countIssued(db),0);
});

test('N4 denies canonical receipt when proposed recipient cannot currently read source',()=>{
 const {db,store,p1}=setup();
 const reply=pub(db,store,'hidden-at-process','actor:B',{reply_to_ref:p1.id});
 const disclosurePolicy=(publication,viewer)=>publication.publication_id==='pub:hidden-at-process'&&viewer.viewer_actor_id==='actor:A'?'deny':'allow';
 const result=processSourceEvent({eventId:reply.eventId,commandId:'notify:hidden',idempotencyKey:'notify:hidden'},processorCtx(db,store,{disclosurePolicy}));
 assert.deepEqual(result,{issued:false,reason:'SOURCE_NOT_ELIGIBLE'});
 assert.equal(countIssued(db),0);
});

test('processor requires explicit notification issue capability',()=>{
 const {db,store,p1}=setup(); const reply=pub(db,store,'no-cap','actor:B',{reply_to_ref:p1.id});
 assert.throws(()=>processSourceEvent({eventId:reply.eventId,commandId:'notify:no-cap',idempotencyKey:'notify:no-cap'},processorCtx(db,store,{capabilityGrants:[]})),error=>error&&error.code==='POLICY_DENIED');
});

test('processor reports NOTIFICATION_SOURCE_EVENT_NOT_FOUND for a missing source event',()=>{
 const {db,store}=setup();
 assert.throws(
   ()=>processSourceEvent(
     {eventId:'evt:missing',commandId:'notify:missing',idempotencyKey:'notify:missing'},
     processorCtx(db,store)
   ),
   error=>error&&error.code==='INVALID_TRANSITION'&&error.message==='NOTIFICATION_SOURCE_EVENT_NOT_FOUND'
 );
});
