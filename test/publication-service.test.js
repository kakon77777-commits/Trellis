const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');

function ctx(db, eventStore, actor, principal = `principal:${actor}`, extra = {}) {
  return { db, eventStore, principalActorId: actor, evaluatedAt: '2026-09-02T10:00:00Z', capabilityGrants: [], ...extra, authorize: evaluateAuthority };
}

function actorCommand(id, actor) {
  return { command_id: `cmd:${id}`, idempotency_key: `idem:${id}`, principal_id: `principal:${actor}`, entity_id: actor };
}

async function setupActor(db, eventStore, actor) {
  (await registerActor(actorCommand(`register-${actor}`, actor), { eventStore, authorize: evaluateAuthority }));
}

async function setupCommunityMember(db, eventStore, actor, community) {
  (await setupActor(db, eventStore, actor));
  (await createCommunity({ command_id:`cmd:create-${community}`, idempotency_key:`idem:create-${community}`, principal_id:`principal:${community}`, community_id:community }, { eventStore, authorize:evaluateAuthority }));
  const requested = (await requestMembership({
    command_id:`cmd:join-${actor}-${community}`, idempotency_key:`idem:join-${actor}-${community}`,
    principal_id:`principal:${actor}`, actor_id:actor, community_id:community
  }, ctx(db,eventStore,actor)));
  (await approveMembership({
    command_id:`cmd:approve-${actor}-${community}`, idempotency_key:`idem:approve-${actor}-${community}`,
    principal_id:`principal:${community}`, relationship_id:requested.relationship_id,
    community_id:community, expected_version:1
  }, ctx(db,eventStore,community,`principal:${community}`)));
  (await rebuildRelationshipProjection(db,eventStore));
}

function createCommand(id, author, overrides = {}) {
  return {
    command_id:`cmd:${id}`, idempotency_key:`idem:${id}`, principal_id:`principal:${author}`,
    publication_id:`pub:${id}`, author_actor_id:author, publication_type:'post', body:'hello',
    visibility:'public', audience_actor_ids:[], ...overrides
  };
}

test('global author can create publication and another actor cannot author as them', async () => {
  const { createPublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db,{now:()=> '2026-09-02T10:00:01Z'});
  (await setupActor(db,store,'actor:A')); (await setupActor(db,store,'actor:B'));
  const ok=(await createPublication(createCommand('p1','actor:A'),ctx(db,store,'actor:A')));
  assert.equal(ok.publication_id,'pub:p1');
  assert.equal(store.readStream('publication','pub:p1')[0].event_type,'publication.created');
  await assert.rejects(async () => (await createPublication(createCommand('p2','actor:A',{publication_id:'pub:p2',principal_id:'principal:actor:B'}),ctx(db,store,'actor:B','principal:actor:B'))), error => error && error.code==='POLICY_DENIED');
});

test('community membership alone cannot authorize publication but scoped capability plus membership can', async () => {
  const { createPublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  (await setupCommunityMember(db,store,'actor:A','community:C'));
  const command=createCommand('community-post','actor:A',{scope_ref:'community:C',visibility:'scope_members'});
  await assert.rejects(async () => (await createPublication(command,ctx(db,store,'actor:A'))), error => error && error.code==='POLICY_DENIED');
  const grant={ active:true, principal_id:'principal:actor:A', capability:'publication:create', scope_ref:'community:C' };
  const result=(await createPublication(command,ctx(db,store,'actor:A','principal:actor:A',{capabilityGrants:[grant]})));
  assert.equal(result.publication_id,'pub:community-post');
});

test('revise and withdraw require acting as immutable author', async () => {
  const { createPublication, revisePublication, withdrawPublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  (await setupActor(db,store,'actor:A')); (await setupActor(db,store,'actor:B'));
  (await createPublication(createCommand('p3','actor:A'),ctx(db,store,'actor:A')));
  await assert.rejects(async () => (await revisePublication({command_id:'cmd:bad-revise',idempotency_key:'idem:bad-revise',principal_id:'principal:actor:B',publication_id:'pub:p3',expected_version:1,body:'bad'},ctx(db,store,'actor:B','principal:actor:B'))), error=>error&&error.code==='POLICY_DENIED');
  (await revisePublication({command_id:'cmd:revise',idempotency_key:'idem:revise',principal_id:'principal:actor:A',publication_id:'pub:p3',expected_version:1,body:'v2'},ctx(db,store,'actor:A')));
  await assert.rejects(async () => (await withdrawPublication({command_id:'cmd:bad-withdraw',idempotency_key:'idem:bad-withdraw',principal_id:'principal:actor:B',publication_id:'pub:p3',expected_version:2},ctx(db,store,'actor:B','principal:actor:B'))), error=>error&&error.code==='POLICY_DENIED');
  (await withdrawPublication({command_id:'cmd:withdraw',idempotency_key:'idem:withdraw',principal_id:'principal:actor:A',publication_id:'pub:p3',expected_version:2},ctx(db,store,'actor:A')));
  assert.equal(require('../publication/fold').foldPublication(store.readStream('publication','pub:p3')).lifecycle,'withdrawn');
});

test('successful retry deduplicates before lifecycle preflight and stale version rejects', async () => {
  const { createPublication, revisePublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  (await setupActor(db,store,'actor:A'));
  (await createPublication(createCommand('p4','actor:A'),ctx(db,store,'actor:A')));
  const revise={command_id:'cmd:p4-r',idempotency_key:'idem:p4-r',principal_id:'principal:actor:A',publication_id:'pub:p4',expected_version:1,body:'v2'};
  const first=(await revisePublication(revise,ctx(db,store,'actor:A')));
  const second=(await revisePublication(revise,ctx(db,store,'actor:A')));
  assert.equal(second.receipt.deduplicated,true);
  assert.equal(store.readStream('publication','pub:p4').length,2);
  await assert.rejects(async () => (await revisePublication({command_id:'cmd:p4-stale',idempotency_key:'idem:p4-stale',principal_id:'principal:actor:A',publication_id:'pub:p4',expected_version:1,body:'v3'},ctx(db,store,'actor:A'))), error=>error&&error.code==='VERSION_CONFLICT');
  assert.equal(first.receipt.status,'accepted');
});
