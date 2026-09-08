const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');

function ctx(db,store,actor,extra={}) { return {db,sql:db,eventStore:store,principalActorId:actor,capabilityGrants:[],evaluatedAt:'2026-09-02T13:00:00Z',...extra}; }
async function reg(store,actor){ (await registerActor({command_id:`cmd:reg-${actor}`,idempotency_key:`idem:reg-${actor}`,principal_id:`principal:${actor}`,entity_id:actor},{eventStore:store,authorize:evaluateAuthority})); }
function pub(id,author,overrides={}){ return {command_id:`cmd:${id}`,idempotency_key:`idem:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...overrides}; }
function grant(actor,scope){return {active:true,principal_id:`principal:${actor}`,capability:'publication:create',scope_ref:scope};}
async function member(db,store,actor,community,createFirst=false){
  (await reg(store,actor));
  if(createFirst) (await createCommunity({command_id:`cmd:create-${community}`,idempotency_key:`idem:create-${community}`,principal_id:`principal:${community}`,community_id:community},{eventStore:store,authorize:evaluateAuthority}));
  const r=(await requestMembership({command_id:`cmd:join-${actor}-${community}`,idempotency_key:`idem:join-${actor}-${community}`,principal_id:`principal:${actor}`,actor_id:actor,community_id:community},ctx(db,store,actor)));
  (await approveMembership({command_id:`cmd:approve-${actor}-${community}`,idempotency_key:`idem:approve-${actor}-${community}`,principal_id:`principal:${community}`,relationship_id:r.relationship_id,community_id:community,expected_version:1},ctx(db,store,community)));
  (await rebuildRelationshipProjection(db,store));
}

test('viewer policy enforces public scope_members participants and private visibility', async () => {
  const { createPublication } = require('../publication/service');
  const { rebuildPublicationProjection } = require('../publication/projector');
  const { loadPublicationSurface } = require('../publication/read-service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  for(const a of ['actor:A','actor:B','actor:C']) (await reg(store,a));
  (await createPublication((await pub('public','actor:A')),ctx(db,store,'actor:A')));
  (await createPublication((await pub('private','actor:A',{visibility:'private'})),ctx(db,store,'actor:A')));
  (await createPublication((await pub('participants','actor:A',{visibility:'participants',audience_actor_ids:['actor:B']})),ctx(db,store,'actor:A')));
  (await rebuildPublicationProjection(db,store));
  assert.ok((await loadPublicationSurface({publicationId:'pub:public',viewerContext:{viewer_actor_id:'actor:C'},db,eventStore:store})));
  assert.equal((await loadPublicationSurface({publicationId:'pub:private',viewerContext:{viewer_actor_id:'actor:C'},db,eventStore:store})),null);
  assert.ok((await loadPublicationSurface({publicationId:'pub:private',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store})));
  assert.ok((await loadPublicationSurface({publicationId:'pub:participants',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store})));
  assert.equal((await loadPublicationSurface({publicationId:'pub:participants',viewerContext:{viewer_actor_id:'actor:C'},db,eventStore:store})),null);
});

test('scope_members publication is readable by active member but not outsider', async () => {
  const { createPublication } = require('../publication/service');
  const { rebuildPublicationProjection } = require('../publication/projector');
  const { loadPublicationSurface } = require('../publication/read-service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  (await member(db,store,'actor:A','community:C',true)); (await member(db,store,'actor:B','community:C')); (await reg(store,'actor:X'));
  (await createPublication((await pub('scoped','actor:A',{scope_ref:'community:C',visibility:'scope_members'})),ctx(db,store,'actor:A',{capabilityGrants:[grant('actor:A','community:C')]})));
  (await rebuildPublicationProjection(db,store));
  assert.ok((await loadPublicationSurface({publicationId:'pub:scoped',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store})));
  assert.equal((await loadPublicationSurface({publicationId:'pub:scoped',viewerContext:{viewer_actor_id:'actor:X'},db,eventStore:store})),null);
});

test('current disclosure policy may narrow but never widen canonical visibility', async () => {
  const { createPublication } = require('../publication/service');
  const { rebuildPublicationProjection } = require('../publication/projector');
  const { loadPublicationSurface } = require('../publication/read-service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  (await reg(store,'actor:A')); (await reg(store,'actor:B'));
  (await createPublication((await pub('pub','actor:A')),ctx(db,store,'actor:A')));
  (await createPublication((await pub('priv','actor:A',{visibility:'private'})),ctx(db,store,'actor:A')));
  (await rebuildPublicationProjection(db,store));
  const deny=()=> 'deny', allow=()=> 'allow';
  assert.equal((await loadPublicationSurface({publicationId:'pub:pub',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store,disclosurePolicy:deny})),null);
  assert.equal((await loadPublicationSurface({publicationId:'pub:priv',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store,disclosurePolicy:allow})),null);
});

test('hidden reply does not affect visible reply count or parent surface', async () => {
  const { createPublication } = require('../publication/service');
  const { rebuildPublicationProjection, projectPublicationStream } = require('../publication/projector');
  const { loadPublicationSurface } = require('../publication/read-service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  for(const a of ['actor:A','actor:B','actor:C','actor:D']) (await reg(store,a));
  (await createPublication((await pub('parent','actor:A')),ctx(db,store,'actor:A')));
  (await createPublication((await pub('visible-reply','actor:B',{reply_to_ref:'pub:parent'})),ctx(db,store,'actor:B')));
  (await rebuildPublicationProjection(db,store));
  const before=(await loadPublicationSurface({publicationId:'pub:parent',viewerContext:{viewer_actor_id:'actor:D'},db,eventStore:store}));
  assert.equal(before.visible_reply_count,1);
  (await createPublication((await pub('hidden-reply','actor:C',{visibility:'private',reply_to_ref:'pub:parent'})),ctx(db,store,'actor:C')));
  (await projectPublicationStream(db,store,'pub:hidden-reply'));
  const after=(await loadPublicationSurface({publicationId:'pub:parent',viewerContext:{viewer_actor_id:'actor:D'},db,eventStore:store}));
  assert.deepEqual(after,before);
  assert.equal(Object.hasOwn(after,'last_reply_at'),false);
});

test('withdrawn readable parent yields placeholder and unreadable parent yields unavailable without stale content', async () => {
  const { createPublication, withdrawPublication } = require('../publication/service');
  const { rebuildPublicationProjection } = require('../publication/projector');
  const { loadPublicationSurface } = require('../publication/read-service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  (await reg(store,'actor:A')); (await reg(store,'actor:B'));
  (await createPublication((await pub('parent2','actor:A',{body:'top secret original'})),ctx(db,store,'actor:A')));
  (await createPublication((await pub('child2','actor:B',{body:'my own response',reply_to_ref:'pub:parent2'})),ctx(db,store,'actor:B')));
  (await withdrawPublication({command_id:'cmd:wd2',idempotency_key:'idem:wd2',principal_id:'principal:actor:A',publication_id:'pub:parent2',expected_version:1},ctx(db,store,'actor:A')));
  (await rebuildPublicationProjection(db,store));
  const child=(await loadPublicationSurface({publicationId:'pub:child2',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store}));
  assert.deepEqual(child.reference_context,{status:'withdrawn',publication_id:'pub:parent2'});
  assert.equal(child.content.body,'my own response');
  assert.equal(JSON.stringify(child).includes('top secret original'),false);
  const denyParent=(publication)=> publication.publication_id==='pub:parent2' ? 'deny':'allow';
  const unavailable=(await loadPublicationSurface({publicationId:'pub:child2',viewerContext:{viewer_actor_id:'actor:B'},db,eventStore:store,disclosurePolicy:denyParent}));
  assert.deepEqual(unavailable.reference_context,{status:'unavailable'});
  assert.equal(JSON.stringify(unavailable).includes('pub:parent2'),false);
});
