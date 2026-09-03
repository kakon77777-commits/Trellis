const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication,withdrawPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {createReaction,withdrawReaction}=require('../reaction/service');
const {listVisibleReactions,loadReactionSummary,loadViewerReaction}=require('../reaction/read-service');

function ctx(db,store,actor,extra={}){return{db,eventStore:store,principalActorId:actor,evaluatedAt:'2026-09-03T03:00:00Z',capabilityGrants:[],...extra};}
function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function pub(id,a){return{command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${a}`,publication_id:`pub:${id}`,author_actor_id:a,publication_type:'post',body:id,visibility:'public',audience_actor_ids:[]};}
function rx(id,a,p,type='like',extra={}){return{command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:`principal:${a}`,actor_id:a,publication_id:p,reaction_type:type,...extra};}
function setup(){
 const db=createTestDatabase();const store=new SQLiteEventStore(db,{now:()=> '2026-09-03T03:00:01Z'});
 for(const a of ['actor:A','actor:B','actor:C','actor:X'])reg(store,a);
 for(const id of ['p1','p2']){createPublication(pub(id,'actor:A'),ctx(db,store,'actor:A'));projectPublicationStream(db,store,`pub:${id}`);}
 createReaction(rx('b-p1','actor:B','pub:p1','like'),ctx(db,store,'actor:B'));
 createReaction(rx('c-p1','actor:C','pub:p1','insightful'),ctx(db,store,'actor:C'));
 createReaction(rx('b-p2','actor:B','pub:p2','love'),ctx(db,store,'actor:B'));
 return{db,store};
}

test('readable active Publication exposes only active current Reactions and deterministic buckets',()=>{
 const {db,store}=setup();
 const input={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store};
 const list=listVisibleReactions(input);
 assert.deepEqual(list.map(r=>[r.actor_id,r.reaction_type]),[['actor:B','like'],['actor:C','insightful']]);
 assert.deepEqual(loadReactionSummary(input),{insightful:1,like:1});
 assert.equal(loadViewerReaction(input),null);
 const own=loadViewerReaction({...input,viewerContext:{viewer_actor_id:'actor:B'}});
 assert.equal(own.actor_id,'actor:B');
 assert.equal(own.reaction_type,'like');
 assert.equal(own.lifecycle,'active');
});

test('withdrawn Reaction is excluded from list/count but remains viewer state for possible restore',()=>{
 const {db,store}=setup();
 withdrawReaction(rx('wd','actor:B','pub:p1','like',{expected_version:1}),ctx(db,store,'actor:B'));
 const input={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store};
 assert.deepEqual(listVisibleReactions(input).map(r=>r.actor_id),['actor:C']);
 assert.deepEqual(loadReactionSummary(input),{insightful:1});
 const own=loadViewerReaction(input);
 assert.equal(own.lifecycle,'withdrawn');
 assert.equal(own.reaction_type,null);
});

test('unreadable or withdrawn target produces no Reaction signal',()=>{
 const {db,store}=setup();
 const denyP1=(publication)=>publication.publication_id==='pub:p1'?'deny':'allow';
 const hidden={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store,disclosurePolicy:denyP1};
 assert.equal(listVisibleReactions(hidden),null);
 assert.equal(loadReactionSummary(hidden),null);
 assert.equal(loadViewerReaction(hidden),null);
 withdrawPublication({command_id:'wd:pub',idempotency_key:'wd:pub',principal_id:'principal:actor:A',publication_id:'pub:p1',expected_version:1},ctx(db,store,'actor:A'));
 projectPublicationStream(db,store,'pub:p1');
 const withdrawn={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store};
 assert.equal(listVisibleReactions(withdrawn),null);
 assert.equal(loadReactionSummary(withdrawn),null);
 assert.equal(loadViewerReaction(withdrawn),null);
});

test('hidden unrelated Publication and Reaction do not change visible Reaction projection',()=>{
 const {db,store}=setup();
 const disclosure=(publication)=>publication.publication_id==='pub:p2'?'deny':'allow';
 const visible={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store,disclosurePolicy:disclosure};
 const before={list:listVisibleReactions(visible),summary:loadReactionSummary(visible),viewer:loadViewerReaction(visible)};
 createReaction(rx('c-p2','actor:C','pub:p2','curious'),ctx(db,store,'actor:C'));
 const after={list:listVisibleReactions(visible),summary:loadReactionSummary(visible),viewer:loadViewerReaction(visible)};
 assert.deepEqual(after,before);
 assert.equal(JSON.stringify(after).includes('pub:p2'),false);
});
