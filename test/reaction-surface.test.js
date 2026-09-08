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

function ctx(db,store,actor,extra={}){return{db,sql:db,eventStore:store,principalActorId:actor,evaluatedAt:'2026-09-03T03:00:00Z',capabilityGrants:[],...extra};}
async function reg(store,a){(await registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority}));}
function pub(id,a){return{command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${a}`,publication_id:`pub:${id}`,author_actor_id:a,publication_type:'post',body:id,visibility:'public',audience_actor_ids:[]};}
function rx(id,a,p,type='like',extra={}){return{command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:`principal:${a}`,actor_id:a,publication_id:p,reaction_type:type,...extra};}
async function setup(){
 const db=createTestDatabase();const store=new SQLiteEventStore(db,{now:()=> '2026-09-03T03:00:01Z'});
 for(const a of ['actor:A','actor:B','actor:C','actor:X'])(await reg(store,a));
 for(const id of ['p1','p2']){(await createPublication((await pub(id,'actor:A')),ctx(db,store,'actor:A')));(await projectPublicationStream(db,store,`pub:${id}`));}
 (await createReaction(rx('b-p1','actor:B','pub:p1','like'),ctx(db,store,'actor:B')));
 (await createReaction(rx('c-p1','actor:C','pub:p1','insightful'),ctx(db,store,'actor:C')));
 (await createReaction(rx('b-p2','actor:B','pub:p2','love'),ctx(db,store,'actor:B')));
 return{db,store};
}

test('readable active Publication exposes only active current Reactions and deterministic buckets',async ()=>{
 const {db,store}=(await setup());
 const input={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store};
 const list=(await listVisibleReactions(input));
 assert.deepEqual(list.map(r=>[r.actor_id,r.reaction_type]),[['actor:B','like'],['actor:C','insightful']]);
 assert.deepEqual((await loadReactionSummary(input)),{insightful:1,like:1});
 assert.equal((await loadViewerReaction(input)),null);
 const own=(await loadViewerReaction({...input,viewerContext:{viewer_actor_id:'actor:B'}}));
 assert.equal(own.actor_id,'actor:B');
 assert.equal(own.reaction_type,'like');
 assert.equal(own.lifecycle,'active');
});

test('withdrawn Reaction is excluded from list/count but remains viewer state for possible restore',async ()=>{
 const {db,store}=(await setup());
 (await withdrawReaction(rx('wd','actor:B','pub:p1','like',{expected_version:1}),ctx(db,store,'actor:B')));
 const input={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store};
 assert.deepEqual((await listVisibleReactions(input)).map(r=>r.actor_id),['actor:C']);
 assert.deepEqual((await loadReactionSummary(input)),{insightful:1});
 const own=(await loadViewerReaction(input));
 assert.equal(own.lifecycle,'withdrawn');
 assert.equal(own.reaction_type,null);
});

test('unreadable or withdrawn target produces no Reaction signal',async ()=>{
 const {db,store}=(await setup());
 const denyP1=(publication)=>publication.publication_id==='pub:p1'?'deny':'allow';
 const hidden={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store,disclosurePolicy:denyP1};
 assert.equal((await listVisibleReactions(hidden)),null);
 assert.equal((await loadReactionSummary(hidden)),null);
 assert.equal((await loadViewerReaction(hidden)),null);
 (await withdrawPublication({command_id:'wd:pub',idempotency_key:'wd:pub',principal_id:'principal:actor:A',publication_id:'pub:p1',expected_version:1},ctx(db,store,'actor:A')));
 (await projectPublicationStream(db,store,'pub:p1'));
 const withdrawn={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store};
 assert.equal((await listVisibleReactions(withdrawn)),null);
 assert.equal((await loadReactionSummary(withdrawn)),null);
 assert.equal((await loadViewerReaction(withdrawn)),null);
});

test('hidden unrelated Publication and Reaction do not change visible Reaction projection',async ()=>{
 const {db,store}=(await setup());
 const disclosure=(publication)=>publication.publication_id==='pub:p2'?'deny':'allow';
 const visible={publicationId:'pub:p1',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store,disclosurePolicy:disclosure};
 const before={list:(await listVisibleReactions(visible)),summary:(await loadReactionSummary(visible)),viewer:(await loadViewerReaction(visible))};
 (await createReaction(rx('c-p2','actor:C','pub:p2','curious'),ctx(db,store,'actor:C')));
 const after={list:(await listVisibleReactions(visible)),summary:(await loadReactionSummary(visible)),viewer:(await loadViewerReaction(visible))};
 assert.deepEqual(after,before);
 assert.equal(JSON.stringify(after).includes('pub:p2'),false);
});
