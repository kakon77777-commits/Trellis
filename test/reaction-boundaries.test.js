const test=require('node:test');
const assert=require('node:assert/strict');
const {setupDiscoverySystem}=require('./helpers/discovery-system');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {createReaction,changeReaction,withdrawReaction,restoreReaction}=require('../reaction/service');
const {buildHomeFeed}=require('../feed/home');
const {buildDiscoverySurface}=require('../discovery/read-service');

function ctx(db,store,actor){return{db,eventStore:store,principalActorId:actor,evaluatedAt:'2026-09-03T05:00:00Z',capabilityGrants:[]};}
function pub(store,db,id,actor){
 createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${actor}`,publication_id:`pub:${id}`,author_actor_id:actor,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[]},ctx(db,store,actor));
 projectPublicationStream(db,store,`pub:${id}`);
}
function rx(id,actor,pubId,type='like',extra={}){return{command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:`principal:${actor}`,actor_id:actor,publication_id:pubId,reaction_type:type,...extra};}
function feedArgs(db,store){return{subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store};}
function discoveryArgs(db,store){return{subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store};}

test('Reaction-only lifecycle changes do not alter Feed v0.1 items or snapshot',()=>{
 const {db,store}=setupDiscoverySystem();
 pub(store,db,'x-post','actor:X');
 const args=feedArgs(db,store);
 const before=buildHomeFeed(args);
 const relationshipCountBefore=store.db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='relationship'").get().n;
 createReaction(rx('create','actor:A','pub:x-post','like'),ctx(db,store,'actor:A'));
 const afterCreate=buildHomeFeed(args);
 changeReaction(rx('change','actor:A','pub:x-post','love',{expected_version:1}),ctx(db,store,'actor:A'));
 const afterChange=buildHomeFeed(args);
 withdrawReaction(rx('withdraw','actor:A','pub:x-post','love',{expected_version:2}),ctx(db,store,'actor:A'));
 const afterWithdraw=buildHomeFeed(args);
 restoreReaction(rx('restore','actor:A','pub:x-post','curious',{expected_version:3}),ctx(db,store,'actor:A'));
 const afterRestore=buildHomeFeed(args);
 for(const state of [afterCreate,afterChange,afterWithdraw,afterRestore]){
  assert.deepEqual(state.items,before.items);
  assert.equal(state.snapshot_ref,before.snapshot_ref);
 }
 assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='relationship'").get().n,relationshipCountBefore);
});

test('Reaction-only lifecycle changes do not alter Discovery v0.1 candidates or snapshot',()=>{
 const {db,store}=setupDiscoverySystem();
 pub(store,db,'x-post-2','actor:X');
 const args=discoveryArgs(db,store);
 const before=buildDiscoverySurface(args);
 createReaction(rx('d-create','actor:A','pub:x-post-2','insightful'),ctx(db,store,'actor:A'));
 changeReaction(rx('d-change','actor:A','pub:x-post-2','love',{expected_version:1}),ctx(db,store,'actor:A'));
 const after=buildDiscoverySurface(args);
 assert.deepEqual(after.actor_discovery,before.actor_discovery);
 assert.deepEqual(after.community_discovery,before.community_discovery);
 assert.equal(after.snapshot_ref,before.snapshot_ref);
 assert.equal(JSON.stringify(after).includes('insightful'),false);
 assert.equal(JSON.stringify(after).includes('love'),false);
});

test('Reaction social labels are not Relationship or verification state',()=>{
 const {db,store}=setupDiscoverySystem();
 pub(store,db,'x-post-3','actor:X');
 createReaction(rx('label','actor:A','pub:x-post-3','insightful'),ctx(db,store,'actor:A'));
 assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='relationship' AND payload_json LIKE '%insightful%'").get().n,0);
 assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE event_type LIKE '%verification%' OR event_type LIKE '%trust%'").get().n,0);
});
