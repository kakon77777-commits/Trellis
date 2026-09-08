const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../package.json');
const { CONTRACT_REGISTRY, effectiveContracts } = require('../foundation/cross-domain-contract');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { rebuildActorProfileProjection } = require('../profile/projector');
const { createPublication, revisePublication, withdrawPublication } = require('../publication/service');
const { rebuildPublicationProjection, projectPublicationStream } = require('../publication/projector');
const { buildHomeFeed } = require('../feed/home');

function ctx(db,store,actor,extra={}){return {db,sql:db,eventStore:store,authorize:evaluateAuthority,principalActorId:actor,capabilityGrants:[],evaluatedAt:'2026-09-03T04:00:00Z',...extra};}
async function reg(store,id){(await registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore:store,authorize:evaluateAuthority}));}
async function community(store,id){(await createCommunity({command_id:`create:${id}`,idempotency_key:`create:${id}`,principal_id:`principal:${id}`,community_id:id},{eventStore:store,authorize:evaluateAuthority}));}
async function join(db,store,a,c,s){const r=(await requestMembership({command_id:`join:${s}`,idempotency_key:`join:${s}`,principal_id:`principal:${a}`,actor_id:a,community_id:c},ctx(db,store,a)));(await approveMembership({command_id:`approve:${s}`,idempotency_key:`approve:${s}`,principal_id:`principal:${c}`,community_id:c,relationship_id:r.relationship_id,expected_version:1},ctx(db,store,c)));return r.relationship_id;}
async function follow(db,store,a,b,s){return (await proposeRelationship({command_id:`follow:${s}`,idempotency_key:`follow:${s}`,principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'follows'},ctx(db,store,a))).relationship_id;}
async function collab(db,store,a,b,s){const r=(await proposeRelationship({command_id:`collab:${s}`,idempotency_key:`collab:${s}`,principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'collaborates_with',visibility:'public'},ctx(db,store,a)));(await activateRelationship({command_id:`activate:${s}`,idempotency_key:`activate:${s}`,principal_id:`principal:${b}`,relationship_id:r.relationship_id,expected_version:1},ctx(db,store,b)));return r.relationship_id;}
function grant(a,scope){return {active:true,principal_id:`principal:${a}`,capability:'publication:create',scope_ref:scope};}
async function pub(db,store,id,a,overrides={},extra={}){return (await createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${a}`,publication_id:`pub:${id}`,author_actor_id:a,publication_type:'post',body:`body:${id}`,visibility:'public',...overrides},ctx(db,store,a,extra))).publication_id;}

async function setup(){
  const db=createTestDatabase(); let tick=0;
  const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T04:01:${String(tick++).padStart(2,'0')}Z`});
  for(const id of ['actor:A','actor:B','actor:X','actor:Y']) (await reg(store,id));
  (await community(store,'community:C'));
  (await join(db,store,'actor:A','community:C','a-c'));
  (await join(db,store,'actor:B','community:C','b-c'));
  const followB=(await follow(db,store,'actor:A','actor:B','a-b'));
  const followX=(await follow(db,store,'actor:A','actor:X','a-x'));
  (await rebuildRelationshipProjection(db,store));
  (await pub(db,store,'p1','actor:B'));
  (await pub(db,store,'p2','actor:X'));
  (await pub(db,store,'p3','actor:A'));
  (await pub(db,store,'p4','actor:B',{reply_to_ref:'pub:p1'}));
  (await pub(db,store,'p5','actor:B',{scope_ref:'community:C',visibility:'scope_members'},{capabilityGrants:[grant('actor:B','community:C')]}));
  (await rebuildPublicationProjection(db,store));
  return {db,store,followB,followX};
}

function roots(feed){return feed.items.filter(i=>i.item_type==='publication').map(i=>i.source_ref).sort();}

function hiddenPolicy(hidden){return value=>value.relationship_id&&hidden.has(value.relationship_id)?'deny':'allow';}

test('Foundation cross-domain registry declares Feed inherits X1 X2 X3 and release syntax scans Feed modules',async ()=>{
  assert.equal(CONTRACT_REGISTRY.feed.state_class,'derived_projection');
  assert.deepEqual(effectiveContracts('feed'),['X1','X2','X3']);
  assert.match(packageJson.scripts.check,/feed\/\*\.js/);
});

test('Feed acceptance flow enforces explicit source roots revision ordering and withdrawal',async ()=>{
  const {db,store,followX}=(await setup()); const hidden=new Set([followX]); const disclosurePolicy=hiddenPolicy(hidden);
  const args={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,disclosurePolicy};
  const canonicalBeforeRead=db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
  const before=(await buildHomeFeed(args));
  assert.deepEqual(roots(before),['pub:p1','pub:p3','pub:p5']);
  assert.equal(roots(before).includes('pub:p2'),false);
  assert.equal(roots(before).includes('pub:p4'),false);
  const p1Before=before.items.find(i=>i.source_ref==='pub:p1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n,canonicalBeforeRead);

  (await revisePublication({command_id:'revise:p1',idempotency_key:'revise:p1',principal_id:'principal:actor:B',publication_id:'pub:p1',expected_version:1,body:'body:p1:v2'},ctx(db,store,'actor:B')));
  (await projectPublicationStream(db,store,'pub:p1'));
  const revised=(await buildHomeFeed(args)); const p1Revised=revised.items.find(i=>i.source_ref==='pub:p1');
  assert.equal(p1Revised.publication.content.body,'body:p1:v2');
  assert.deepEqual(p1Revised.sort,p1Before.sort);

  (await withdrawPublication({command_id:'withdraw:p1',idempotency_key:'withdraw:p1',principal_id:'principal:actor:B',publication_id:'pub:p1',expected_version:2},ctx(db,store,'actor:B')));
  (await projectPublicationStream(db,store,'pub:p1'));
  const withdrawn=(await buildHomeFeed(args));
  assert.equal(roots(withdrawn).includes('pub:p1'),false);
  assert.equal(store.readStream('publication','pub:p1').length,3);
});

test('viewer-invisible canonical facts produce zero Feed semantic signal',async ()=>{
  const {db,store,followX}=(await setup()); const hidden=new Set([followX]); const disclosurePolicy=hiddenPolicy(hidden);
  const args={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,disclosurePolicy};
  const before=(await buildHomeFeed(args));

  const followY=(await follow(db,store,'actor:A','actor:Y','a-y-hidden')); hidden.add(followY);
  (await community(store,'community:C2'));
  const m=(await join(db,store,'actor:A','community:C2','a-c2-hidden')); hidden.add(m);
  const c=(await collab(db,store,'actor:B','actor:Y','b-y-hidden')); hidden.add(c);
  (await rebuildRelationshipProjection(db,store));
  (await pub(db,store,'private-hidden','actor:B',{visibility:'private'}));
  (await projectPublicationStream(db,store,'pub:private-hidden'));
  const after=(await buildHomeFeed(args));
  assert.deepEqual(after,before);
});

test('destroying disposable projections and rebuilding preserves Feed output exactly',async ()=>{
  const {db,store,followX}=(await setup()); const hidden=new Set([followX]); const disclosurePolicy=hiddenPolicy(hidden);
  const args={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,disclosurePolicy};
  const before=(await buildHomeFeed(args));
  db.exec('DELETE FROM relationships_current; DELETE FROM actor_profile_assertions_current; DELETE FROM actor_profile_current; DELETE FROM publications_current;');
  (await rebuildRelationshipProjection(db,store));
  (await rebuildActorProfileProjection(db,store));
  (await rebuildPublicationProjection(db,store));
  const after=(await buildHomeFeed(args));
  assert.deepEqual(after,before);
});

test('Feed read modules expose no canonical mutation surface',async ()=>{
  const service=require('../feed/read-service');
  const home=require('../feed/home');
  for(const name of ['appendFeedEvent','createCanonicalFeedItem','markSeenCanonical','mutatePublication','mutateRelationship','autoFollowFromDiscovery']){
    assert.equal(service[name],undefined,name);
    assert.equal(home[name],undefined,name);
  }
});
