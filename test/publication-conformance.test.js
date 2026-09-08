const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');

function ctx(db,store,actor,extra={}){return {db,sql:db,eventStore:store,principalActorId:actor,capabilityGrants:[],evaluatedAt:'2026-09-02T15:00:00Z',...extra};}
async function reg(store,a){(await registerActor({command_id:`cmd:reg-${a}`,idempotency_key:`idem:reg-${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority}));}
function pub(id,a,o={}){return {command_id:`cmd:${id}`,idempotency_key:`idem:${id}`,principal_id:`principal:${a}`,publication_id:`pub:${id}`,author_actor_id:a,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...o};}
function grant(a,c){return {active:true,principal_id:`principal:${a}`,capability:'publication:create',scope_ref:c};}
async function addMember(db,store,a,c,createFirst=false){
  if(!db.prepare("SELECT 1 AS ok FROM canonical_events WHERE stream_type='entity' AND stream_id=? LIMIT 1").get(a)) (await reg(store,a));
  if(createFirst) (await createCommunity({command_id:`cmd:create-${c}`,idempotency_key:`idem:create-${c}`,principal_id:`principal:${c}`,community_id:c},{eventStore:store,authorize:evaluateAuthority}));
  const r=(await requestMembership({command_id:`cmd:join-${a}-${c}`,idempotency_key:`idem:join-${a}-${c}`,principal_id:`principal:${a}`,actor_id:a,community_id:c},ctx(db,store,a)));
  (await approveMembership({command_id:`cmd:approve-${a}-${c}`,idempotency_key:`idem:approve-${a}-${c}`,principal_id:`principal:${c}`,relationship_id:r.relationship_id,community_id:c,expected_version:1},ctx(db,store,c)));
  (await rebuildRelationshipProjection(db,store));
}

async function buildScenario() {
  const { createPublication, revisePublication, withdrawPublication } = require('../publication/service');
  const { rebuildPublicationProjection } = require('../publication/projector');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db,{now:()=> '2026-09-02T15:00:01Z'});
  for(const a of ['actor:A','actor:B','actor:C','actor:X']) (await reg(store,a));

  (await createPublication((await pub('P1','actor:A',{body:'P1 v1'})),ctx(db,store,'actor:A')));
  (await createPublication((await pub('P2','actor:B',{body:'reply to P1',reply_to_ref:'pub:P1'})),ctx(db,store,'actor:B')));
  (await revisePublication({command_id:'cmd:P1-r2',idempotency_key:'idem:P1-r2',principal_id:'principal:actor:A',publication_id:'pub:P1',expected_version:1,body:'P1 v2'},ctx(db,store,'actor:A')));
  (await createPublication((await pub('P3','actor:A',{body:'private P3',visibility:'private'})),ctx(db,store,'actor:A')));

  (await createCommunity({command_id:'cmd:create-lab',idempotency_key:'idem:create-lab',principal_id:'principal:community:Lab',community_id:'community:Lab'},{eventStore:store,authorize:evaluateAuthority}));
  for(const a of ['actor:A','actor:B']) {
    const r=(await requestMembership({command_id:`cmd:join-${a}-lab`,idempotency_key:`idem:join-${a}-lab`,principal_id:`principal:${a}`,actor_id:a,community_id:'community:Lab'},ctx(db,store,a)));
    (await approveMembership({command_id:`cmd:approve-${a}-lab`,idempotency_key:`idem:approve-${a}-lab`,principal_id:'principal:community:Lab',relationship_id:r.relationship_id,community_id:'community:Lab',expected_version:1},ctx(db,store,'community:Lab')));
  }
  (await rebuildRelationshipProjection(db,store));

  (await createPublication((await pub('P4','actor:A',{body:'community parent',scope_ref:'community:Lab',visibility:'scope_members'})),ctx(db,store,'actor:A',{capabilityGrants:[grant('actor:A','community:Lab')]})));
  (await createPublication((await pub('P5','actor:B',{body:'community reply',scope_ref:'community:Lab',visibility:'scope_members',reply_to_ref:'pub:P4'})),ctx(db,store,'actor:B',{capabilityGrants:[grant('actor:B','community:Lab')]})));
  (await withdrawPublication({command_id:'cmd:P4-wd',idempotency_key:'idem:P4-wd',principal_id:'principal:actor:A',publication_id:'pub:P4',expected_version:1},ctx(db,store,'actor:A')));
  (await rebuildPublicationProjection(db,store));
  return {db,store};
}

test('Publication vertical slice satisfies O1-O15 and viewer-safe withdrawal semantics', async () => {
  const { loadPublicationSurface } = require('../publication/read-service');
  const {db,store}=(await buildScenario());
  const b={viewer_actor_id:'actor:B'}, c={viewer_actor_id:'actor:C'}, x={viewer_actor_id:'actor:X'};

  const p1=(await loadPublicationSurface({publicationId:'pub:P1',viewerContext:b,db,eventStore:store}));
  assert.equal(p1.content.revision,2); assert.equal(p1.content.body,'P1 v2'); assert.equal(p1.visible_reply_count,1);
  assert.equal((await loadPublicationSurface({publicationId:'pub:P3',viewerContext:c,db,eventStore:store})),null);

  const p4=(await loadPublicationSurface({publicationId:'pub:P4',viewerContext:b,db,eventStore:store}));
  assert.equal(p4.lifecycle,'withdrawn'); assert.equal(p4.content,null);
  const p5=(await loadPublicationSurface({publicationId:'pub:P5',viewerContext:b,db,eventStore:store}));
  assert.equal(p5.content.body,'community reply');
  assert.deepEqual(p5.reference_context,{status:'withdrawn',publication_id:'pub:P4'});
  assert.equal(JSON.stringify(p5).includes('community parent'),false);
  assert.equal((await loadPublicationSurface({publicationId:'pub:P4',viewerContext:x,db,eventStore:store})),null);
  assert.equal((await loadPublicationSurface({publicationId:'pub:P5',viewerContext:x,db,eventStore:store})),null);

  for(const id of ['P1','P2','P3','P4','P5']) assert.deepEqual(store.verifyHashChain('publication',`pub:${id}`),{ok:true,failureAt:null});
});

test('Publication projections are disposable: rebuild preserves viewer-relative surfaces exactly', async () => {
  const { loadPublicationSurface } = require('../publication/read-service');
  const { rebuildPublicationProjection } = require('../publication/projector');
  const {db,store}=(await buildScenario());
  const viewer={viewer_actor_id:'actor:B'};
  const ids=['pub:P1','pub:P2','pub:P4','pub:P5'];
  const before=await Promise.all(ids.map(async id=>(await loadPublicationSurface({publicationId:id,viewerContext:viewer,db,eventStore:store}))));
  db.exec('DELETE FROM publications_current');
  (await rebuildPublicationProjection(db,store));
  const after=await Promise.all(ids.map(async id=>(await loadPublicationSurface({publicationId:id,viewerContext:viewer,db,eventStore:store}))));
  assert.deepEqual(after,before);
});

test('Publication public APIs expose no canonical rewrite, author/visibility mutation, AI Board import, or Feed write shortcut', async () => {
  const service=require('../publication/service');
  for(const name of ['updatePublication','deletePublication','changeAuthor','changeVisibility','autoImportAiBoardMessage','writeFeed']) {
    assert.equal(service[name],undefined,name);
  }
  const references=require('../publication/references');
  assert.equal(references.copyReferencePreviewIntoCanonical,undefined);
});

test('release syntax gate includes Publication and Foundation cross-domain modules', async () => {
  assert.match(packageJson.scripts.check,/publication\/\*\.js/);
  assert.match(packageJson.scripts.check,/foundation\/\*\.js/);
});
