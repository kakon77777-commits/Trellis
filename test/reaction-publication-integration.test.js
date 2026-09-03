const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication,withdrawPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {loadPublicationSurface}=require('../publication/read-service');
const {createReaction,withdrawReaction}=require('../reaction/service');

function ctx(db,store,a){return{db,eventStore:store,principalActorId:a,evaluatedAt:'2026-09-03T04:00:00Z',capabilityGrants:[]};}
function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function setup(){
 const db=createTestDatabase(),store=new SQLiteEventStore(db,{now:()=> '2026-09-03T04:00:01Z'});
 for(const a of ['actor:A','actor:B','actor:C'])reg(store,a);
 createPublication({command_id:'pub:p',idempotency_key:'pub:p',principal_id:'principal:actor:A',publication_id:'pub:p',author_actor_id:'actor:A',publication_type:'post',body:'body',visibility:'public',audience_actor_ids:[]},ctx(db,store,'actor:A'));
 projectPublicationStream(db,store,'pub:p');
 return{db,store};
}
function rx(id,a,type='like',extra={}){return{command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:`principal:${a}`,actor_id:a,publication_id:'pub:p',reaction_type:type,...extra};}

test('active readable Publication surface includes Reaction summary viewer state and advisory actions',()=>{
 const {db,store}=setup();
 createReaction(rx('b','actor:B','like'),ctx(db,store,'actor:B'));
 createReaction(rx('c','actor:C','insightful'),ctx(db,store,'actor:C'));
 const b=loadPublicationSurface({publicationId:'pub:p',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store});
 assert.deepEqual(b.reaction_summary,{insightful:1,like:1});
 assert.equal(b.viewer_reaction.reaction_type,'like');
 assert.deepEqual(b.reaction_actions.map(x=>x.action),['change_reaction','withdraw_reaction']);
 assert.ok(b.reaction_actions.every(x=>x.implied_execution_authority===false));
 const a=loadPublicationSurface({publicationId:'pub:p',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});
 assert.equal(a.viewer_reaction,null);
 assert.deepEqual(a.reaction_actions.map(x=>x.action),['react']);
});

test('withdrawn viewer Reaction yields restore hint while remaining absent from summary',()=>{
 const {db,store}=setup();
 createReaction(rx('b2','actor:B','like'),ctx(db,store,'actor:B'));
 withdrawReaction(rx('wd2','actor:B','like',{expected_version:1}),ctx(db,store,'actor:B'));
 const s=loadPublicationSurface({publicationId:'pub:p',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store});
 assert.deepEqual(s.reaction_summary,{});
 assert.equal(s.viewer_reaction.lifecycle,'withdrawn');
 assert.deepEqual(s.reaction_actions.map(x=>x.action),['restore_reaction']);
});

test('withdrawn or unreadable Publication has no Reaction decoration',()=>{
 const {db,store}=setup();
 createReaction(rx('b3','actor:B'),ctx(db,store,'actor:B'));
 const hidden=loadPublicationSurface({publicationId:'pub:p',viewerContext:{viewer_actor_id:'actor:C'},db,eventStore:store,disclosurePolicy:()=> 'deny'});
 assert.equal(hidden,null);
 withdrawPublication({command_id:'wd:p',idempotency_key:'wd:p',principal_id:'principal:actor:A',publication_id:'pub:p',expected_version:1},ctx(db,store,'actor:A'));
 projectPublicationStream(db,store,'pub:p');
 const withdrawn=loadPublicationSurface({publicationId:'pub:p',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store});
 assert.equal(Object.hasOwn(withdrawn,'reaction_summary'),false);
 assert.equal(Object.hasOwn(withdrawn,'viewer_reaction'),false);
 assert.equal(Object.hasOwn(withdrawn,'reaction_actions'),false);
});

test('Publication renderers remain storage-free after Reaction integration',()=>{
 for(const file of ['render-html.js','render-json.js']){
  const source=fs.readFileSync(path.join(__dirname,'..','publication',file),'utf8');
  assert.equal(source.includes('sqlite'),false);
  assert.equal(source.includes('EventStore'),false);
  assert.equal(source.includes('../reaction/service'),false);
 }
});
