const test=require('node:test');
const assert=require('node:assert/strict');
const packageJson=require('../package.json');
const {CONTRACT_REGISTRY,effectiveContracts}=require('../foundation/cross-domain-contract');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createCommunity}=require('../community/service');
const {requestMembership,approveMembership}=require('../community/membership');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {createPublication,withdrawPublication}=require('../publication/service');
const {projectPublicationStream,rebuildPublicationProjection}=require('../publication/projector');
const {loadPublicationSurface}=require('../publication/read-service');
const {createReaction,changeReaction,withdrawReaction,restoreReaction}=require('../reaction/service');
const {rebuildReactionProjection}=require('../reaction/projector');
const {loadReactionSummary}=require('../reaction/read-service');
const {deriveReactionId}=require('../reaction/types');

function ctx(db,store,a,extra={}){return{db,sql:db,eventStore:store,principalActorId:a,evaluatedAt:'2026-09-03T07:00:00Z',capabilityGrants:[],...extra};}
async function reg(store,a){(await registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority}));}
async function community(store,id){(await createCommunity({command_id:`community:${id}`,idempotency_key:`community:${id}`,principal_id:`principal:${id}`,community_id:id},{eventStore:store,authorize:evaluateAuthority}));}
async function join(db,store,a,c,s){const r=(await requestMembership({command_id:`join:${s}`,idempotency_key:`join:${s}`,principal_id:`principal:${a}`,actor_id:a,community_id:c},ctx(db,store,a)));(await approveMembership({command_id:`approve:${s}`,idempotency_key:`approve:${s}`,principal_id:`principal:${c}`,community_id:c,relationship_id:r.relationship_id,expected_version:1},ctx(db,store,c)));return r.relationship_id;}
function grant(a,c){return{active:true,principal_id:`principal:${a}`,capability:'publication:create',scope_ref:c};}
async function pub(db,store,id,a,overrides={},extra={}){const pid=`pub:${id}`;(await createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${a}`,publication_id:pid,author_actor_id:a,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...overrides},ctx(db,store,a,extra)));(await projectPublicationStream(db,store,pid));return pid;}
function rx(id,a,p,type='like',extra={}){return{command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:`principal:${a}`,actor_id:a,publication_id:p,reaction_type:type,...extra};}
function snapshot(db){return db.prepare('SELECT * FROM reactions_current ORDER BY reaction_id').all();}

async function setup(){
 const db=createTestDatabase(); let tick=0;
 const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T07:00:${String(tick++).padStart(2,'0')}Z`});
 for(const a of ['actor:A','actor:B','actor:C','actor:X'])(await reg(store,a));
 (await community(store,'community:C'));
 (await join(db,store,'actor:A','community:C','a-c'));
 (await join(db,store,'actor:B','community:C','b-c'));
 (await rebuildRelationshipProjection(db,store));
 const p1=(await pub(db,store,'P1','actor:A'));
 const p2=(await pub(db,store,'P2','actor:A',{scope_ref:'community:C',visibility:'scope_members'},{capabilityGrants:[grant('actor:A','community:C')]}));
 const p3=(await pub(db,store,'P3','actor:A',{visibility:'private'}));
 return{db,store,p1,p2,p3};
}

test('Reaction inherits X1-X3 and release syntax scans reaction modules',async ()=>{
 assert.equal(CONTRACT_REGISTRY.reaction.state_class,'canonical');
  assert.deepEqual(effectiveContracts('reaction'),['X1','X2','X3']);
 assert.match(packageJson.scripts.check,/reaction\/\*\.js/);
});

test('E1-E12 vertical slice preserves one aggregate lifecycle, audience bounds, viewer filtering, and withdrawal semantics',async ()=>{
 const {db,store,p1,p2,p3}=(await setup());
 const relationshipBefore=db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='relationship'").get().n;
 const b=(await createReaction(rx('b-p1','actor:B',p1,'like'),ctx(db,store,'actor:B')));
 const c=(await createReaction(rx('c-p1','actor:C',p1,'insightful'),ctx(db,store,'actor:C')));
 assert.equal(b.reaction_id,deriveReactionId('actor:B',p1));
 assert.notEqual(b.reaction_id,c.reaction_id);
 let surface=(await loadPublicationSurface({publicationId:p1,viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store}));
 assert.deepEqual(surface.reaction_summary,{insightful:1,like:1});
 (await changeReaction(rx('b-change','actor:B',p1,'love',{expected_version:1}),ctx(db,store,'actor:B')));
 surface=(await loadPublicationSurface({publicationId:p1,viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store}));
 assert.deepEqual(surface.reaction_summary,{insightful:1,love:1});
 (await withdrawReaction(rx('b-withdraw','actor:B',p1,'love',{expected_version:2}),ctx(db,store,'actor:B')));
 surface=(await loadPublicationSurface({publicationId:p1,viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store}));
 assert.deepEqual(surface.reaction_summary,{insightful:1});
 (await restoreReaction(rx('b-restore','actor:B',p1,'love',{expected_version:3}),ctx(db,store,'actor:B')));
 assert.equal(deriveReactionId('actor:B',p1),b.reaction_id);

 (await createReaction(rx('b-p2','actor:B',p2,'curious'),ctx(db,store,'actor:B')));
 assert.equal((await loadPublicationSurface({publicationId:p2,viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store})),null);
 const p2Member=(await loadPublicationSurface({publicationId:p2,viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store}));
 assert.deepEqual(p2Member.reaction_summary,{curious:1});

 (await withdrawPublication({command_id:'wd:P2',idempotency_key:'wd:P2',principal_id:'principal:actor:A',publication_id:p2,expected_version:1},ctx(db,store,'actor:A')));
 (await projectPublicationStream(db,store,p2));
 await assert.rejects(async ()=>(await changeReaction(rx('b-p2-change','actor:B',p2,'love',{expected_version:1}),ctx(db,store,'actor:B'))),/REACTION_TARGET_NOT_ACTIVE/);
 (await withdrawReaction(rx('b-p2-withdraw','actor:B',p2,'curious',{expected_version:1}),ctx(db,store,'actor:B')));
 await assert.rejects(async ()=>(await restoreReaction(rx('b-p2-restore','actor:B',p2,'love',{expected_version:2}),ctx(db,store,'actor:B'))),/REACTION_TARGET_NOT_ACTIVE/);
 await assert.rejects(async ()=>(await createReaction(rx('x-p2','actor:X',p2,'like'),ctx(db,store,'actor:X'))),/REACTION_TARGET_NOT_ACTIVE/);
 const withdrawnSurface=(await loadPublicationSurface({publicationId:p2,viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store}));
 assert.equal(Object.hasOwn(withdrawnSurface,'reaction_summary'),false);

 const beforeHidden=(await loadReactionSummary({publicationId:p1,viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store}));
 (await createReaction(rx('a-private','actor:A',p3,'celebrate'),ctx(db,store,'actor:A')));
 const afterHidden=(await loadReactionSummary({publicationId:p1,viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store}));
 assert.deepEqual(afterHidden,beforeHidden);

 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='relationship'").get().n,relationshipBefore);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='reaction' AND payload_json LIKE '%verification%'").get().n,0);
});

test('Reaction projection is disposable and every Reaction stream hash chain remains valid',async ()=>{
 const {db,store,p1,p2}=(await setup());
 (await createReaction(rx('r1','actor:B',p1,'like'),ctx(db,store,'actor:B')));
 (await changeReaction(rx('r2','actor:B',p1,'love',{expected_version:1}),ctx(db,store,'actor:B')));
 (await createReaction(rx('r3','actor:B',p2,'curious'),ctx(db,store,'actor:B')));
 const before=(await snapshot(db));
 db.exec('DELETE FROM reactions_current');
 assert.deepEqual((await snapshot(db)),[]);
 (await rebuildReactionProjection(db,store));
 assert.deepEqual((await snapshot(db)),before);
 const ids=db.prepare("SELECT DISTINCT stream_id FROM canonical_events WHERE stream_type='reaction' ORDER BY stream_id").all().map(r=>r.stream_id);
 assert.ok(ids.length>=2);
 for(const id of ids) assert.deepEqual(store.verifyHashChain('reaction',id),{ok:true,failureAt:null});
});

test('Reaction service exposes no Preference Feed-ranking Discovery-affinity or Relationship-mutation shortcuts',async ()=>{
 const service=require('../reaction/service');
 for(const name of ['bookmark','save','markSeen','dismiss','notInterested','rankFeed','boostFeed','deriveDiscoveryAffinity','createRelationshipFromReaction','verifyPublication']){
  assert.equal(service[name],undefined,name);
 }
});
