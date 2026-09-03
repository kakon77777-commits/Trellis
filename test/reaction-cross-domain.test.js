const test=require('node:test');
const assert=require('node:assert/strict');
const {INHERITORS}=require('../foundation/cross-domain-contract');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {createReaction,changeReaction}=require('../reaction/service');
const {loadReactionSummary}=require('../reaction/read-service');

function ctx(db,store,a){return{db,eventStore:store,principalActorId:a,evaluatedAt:'2026-09-03T06:00:00Z',capabilityGrants:[]};}
function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function pub(db,store,id){createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:'principal:actor:A',publication_id:`pub:${id}`,author_actor_id:'actor:A',publication_type:'post',body:id,visibility:'public',audience_actor_ids:[]},ctx(db,store,'actor:A'));projectPublicationStream(db,store,`pub:${id}`);}
function rx(id,a,p,type='like',extra={}){return{command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:`principal:${a}`,actor_id:a,publication_id:p,reaction_type:type,...extra};}
function setup(){const db=createTestDatabase(),store=new SQLiteEventStore(db);for(const a of ['actor:A','actor:B','actor:C','actor:X'])reg(store,a);pub(db,store,'p1');pub(db,store,'p2');return{db,store};}

test('Reaction declares Foundation X1 X2 X3 inheritance',()=>{
 assert.deepEqual(INHERITORS.reaction,['X1','X2','X3']);
});

test('X1 Reaction audience cannot be caller widened or overridden',()=>{
 const {db,store}=setup();
 assert.throws(()=>createReaction({...rx('x1','actor:B','pub:p1'),visibility:'private'},ctx(db,store,'actor:B')),/REACTION_AUDIENCE_OVERRIDE_FORBIDDEN/);
});

test('X2 descriptive readability does not let another principal mutate B Reaction',()=>{
 const {db,store}=setup();
 createReaction(rx('x2-create','actor:B','pub:p1'),ctx(db,store,'actor:B'));
 assert.throws(()=>changeReaction({...rx('x2-change','actor:B','pub:p1','love',{expected_version:1}),principal_id:'principal:actor:X'},ctx(db,store,'actor:X')),e=>e&&e.code==='POLICY_DENIED');
});

test('X3 hidden unrelated Reaction facts do not alter visible Reaction summary',()=>{
 const {db,store}=setup();
 createReaction(rx('x3-b','actor:B','pub:p1','like'),ctx(db,store,'actor:B'));
 const disclosure=p=>p.publication_id==='pub:p2'?'deny':'allow';
 const input={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store,disclosurePolicy:disclosure};
 const before=loadReactionSummary(input);
 createReaction(rx('x3-c','actor:C','pub:p2','insightful'),ctx(db,store,'actor:C'));
 const after=loadReactionSummary(input);
 assert.deepEqual(after,before);
});
