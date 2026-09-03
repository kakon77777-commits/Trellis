const test=require('node:test');
const assert=require('node:assert/strict');
const {INHERITORS}=require('../foundation/cross-domain-contract');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {proposeRelationship}=require('../relationship/service');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {buildHomeFeed}=require('../feed/home');
const {buildDiscoverySurface}=require('../discovery/read-service');
const {processSourceEvent,acknowledgeNotification}=require('../notification/service');

function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function ctx(db,store,a){return{db,eventStore:store,principalActorId:a,evaluatedAt:'2026-09-03T13:00:00Z',capabilityGrants:[]};}
function pctx(db,store){return{db,eventStore:store,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T13:01:00Z'};}
function pub(db,store,id,a,extra={}){const r=createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${a}`,publication_id:`pub:${id}`,author_actor_id:a,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...extra},ctx(db,store,a));projectPublicationStream(db,store,`pub:${id}`);return{id:`pub:${id}`,eventId:r.receipt.result_event_ids[0]};}

test('Notification declares Foundation X1 X2 X3 inheritance',()=>{
 assert.deepEqual(INHERITORS.notification,['X1','X2','X3']);
});

test('Notification issue and ack do not change Feed or Discovery when social source state is unchanged',()=>{
 const db=createTestDatabase();let tick=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T13:00:${String(tick++).padStart(2,'0')}Z`});reg(store,'actor:A');reg(store,'actor:B');
 proposeRelationship({command_id:'follow:A:B',idempotency_key:'follow:A:B',principal_id:'principal:actor:A',source_entity_id:'actor:A',target_entity_id:'actor:B',relationship_type:'follows'},ctx(db,store,'actor:A'));rebuildRelationshipProjection(db,store);
 const parent=pub(db,store,'parent','actor:A');const reply=pub(db,store,'reply','actor:B',{reply_to_ref:parent.id});
 const feedArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store};
 const discoveryArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store};
 const feedBefore=buildHomeFeed(feedArgs);const discoveryBefore=buildDiscoverySurface(discoveryArgs);
 const n=processSourceEvent({eventId:reply.eventId,commandId:'notify:reply',idempotencyKey:'notify:reply'},pctx(db,store));
 const feedIssued=buildHomeFeed(feedArgs);const discoveryIssued=buildDiscoverySurface(discoveryArgs);
 assert.deepEqual(feedIssued,feedBefore);assert.deepEqual(discoveryIssued,discoveryBefore);
 acknowledgeNotification({command_id:'ack:n',idempotency_key:'ack:n',principal_id:'principal:actor:A',notification_id:n.notification_id,expected_version:1},ctx(db,store,'actor:A'));
 assert.deepEqual(buildHomeFeed(feedArgs),feedBefore);assert.deepEqual(buildDiscoverySurface(discoveryArgs),discoveryBefore);
});
