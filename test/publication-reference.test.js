const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');

function ctx(db, eventStore, actor, extra={}) {
  return { db, eventStore, principalActorId: actor, capabilityGrants: [], evaluatedAt:'2026-09-02T11:00:00Z', ...extra };
}
function reg(store, actor) {
  registerActor({command_id:`cmd:reg-${actor}`,idempotency_key:`idem:reg-${actor}`,principal_id:`principal:${actor}`,entity_id:actor},{eventStore:store,authorize:evaluateAuthority});
}
function createCmd(id, author, overrides={}) {
  return {command_id:`cmd:${id}`,idempotency_key:`idem:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...overrides};
}
function setupMember(db,store,actor,community,createCommunityFirst=false) {
  reg(store,actor);
  if (createCommunityFirst) createCommunity({command_id:`cmd:create-${community}`,idempotency_key:`idem:create-${community}`,principal_id:`principal:${community}`,community_id:community},{eventStore:store,authorize:evaluateAuthority});
  const req=requestMembership({command_id:`cmd:join-${actor}-${community}`,idempotency_key:`idem:join-${actor}-${community}`,principal_id:`principal:${actor}`,actor_id:actor,community_id:community},ctx(db,store,actor));
  approveMembership({command_id:`cmd:approve-${actor}-${community}`,idempotency_key:`idem:approve-${actor}-${community}`,principal_id:`principal:${community}`,relationship_id:req.relationship_id,community_id:community,expected_version:1},ctx(db,store,community));
  rebuildRelationshipProjection(db,store);
}
function grant(actor,scope) { return {active:true,principal_id:`principal:${actor}`,capability:'publication:create',scope_ref:scope}; }

test('reply and quote store only reference ids and reject copied platform preview fields', () => {
  const { createPublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  reg(store,'actor:A'); reg(store,'actor:B');
  createPublication(createCmd('parent','actor:A'),ctx(db,store,'actor:A'));
  createPublication(createCmd('reply','actor:B',{reply_to_ref:'pub:parent'}),ctx(db,store,'actor:B'));
  const reply=store.readStream('publication','pub:reply')[0].payload;
  assert.equal(reply.reply_to_ref,'pub:parent'); assert.equal(reply.quote_of_ref,null);
  assert.equal(Object.hasOwn(reply,'reference_preview'),false); assert.equal(Object.hasOwn(reply,'parent_body'),false);
  createPublication(createCmd('quote','actor:B',{quote_of_ref:'pub:parent'}),ctx(db,store,'actor:B'));
  assert.equal(store.readStream('publication','pub:quote')[0].payload.quote_of_ref,'pub:parent');
  assert.throws(() => createPublication(createCmd('leak','actor:B',{reply_to_ref:'pub:parent',reference_preview:'secret'}),ctx(db,store,'actor:B')), /PUBLICATION_REFERENCE_COPY_FORBIDDEN/);
});

test('participants child audience must be a subset of parent participants', () => {
  const { createPublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  for (const a of ['actor:A','actor:B','actor:C','actor:D']) reg(store,a);
  createPublication(createCmd('parent-part','actor:A',{visibility:'participants',audience_actor_ids:['actor:B','actor:C']}),ctx(db,store,'actor:A'));
  createPublication(createCmd('child-part','actor:B',{visibility:'participants',audience_actor_ids:['actor:C'],reply_to_ref:'pub:parent-part'}),ctx(db,store,'actor:B'));
  assert.throws(() => createPublication(createCmd('child-wide','actor:B',{visibility:'participants',audience_actor_ids:['actor:D'],reply_to_ref:'pub:parent-part'}),ctx(db,store,'actor:B')), /PUBLICATION_REFERENCE_AUDIENCE_WIDENED/);
});

test('scope_members reply must keep parent scope and public child is forbidden', () => {
  const { createPublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  setupMember(db,store,'actor:A','community:C',true); setupMember(db,store,'actor:B','community:C',false);
  const grantsA=[grant('actor:A','community:C')], grantsB=[grant('actor:B','community:C')];
  createPublication(createCmd('scoped-parent','actor:A',{scope_ref:'community:C',visibility:'scope_members'}),ctx(db,store,'actor:A',{capabilityGrants:grantsA}));
  createPublication(createCmd('scoped-child','actor:B',{scope_ref:'community:C',visibility:'scope_members',reply_to_ref:'pub:scoped-parent'}),ctx(db,store,'actor:B',{capabilityGrants:grantsB}));
  assert.throws(() => createPublication(createCmd('wrong-scope','actor:B',{scope_ref:'community:D',visibility:'scope_members',reply_to_ref:'pub:scoped-parent'}),ctx(db,store,'actor:B',{capabilityGrants:[grant('actor:B','community:D')]})), /PUBLICATION_REFERENCE_SCOPE_WIDENED/);
  assert.throws(() => createPublication(createCmd('public-child','actor:B',{visibility:'public',reply_to_ref:'pub:scoped-parent'}),ctx(db,store,'actor:B')), /PUBLICATION_REFERENCE_AUDIENCE_WIDENED/);
});

test('private parent cannot produce public child and unreadable author cannot reference parent', () => {
  const { createPublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  reg(store,'actor:A'); reg(store,'actor:B');
  createPublication(createCmd('private-parent','actor:A',{visibility:'private'}),ctx(db,store,'actor:A'));
  assert.throws(() => createPublication(createCmd('private-wide','actor:A',{visibility:'public',reply_to_ref:'pub:private-parent'}),ctx(db,store,'actor:A')), /PUBLICATION_REFERENCE_AUDIENCE_WIDENED/);
  assert.throws(() => createPublication(createCmd('unreadable','actor:B',{visibility:'private',reply_to_ref:'pub:private-parent'}),ctx(db,store,'actor:B')), /PUBLICATION_REFERENCE_NOT_READABLE/);
});

test('new built-in reply or quote cannot target an already withdrawn publication', () => {
  const { createPublication, withdrawPublication } = require('../publication/service');
  const db=createTestDatabase(); const store=new SQLiteEventStore(db);
  reg(store,'actor:A'); reg(store,'actor:B');
  createPublication(createCmd('withdrawn-parent','actor:A'),ctx(db,store,'actor:A'));
  withdrawPublication({command_id:'cmd:wd-parent',idempotency_key:'idem:wd-parent',principal_id:'principal:actor:A',publication_id:'pub:withdrawn-parent',expected_version:1},ctx(db,store,'actor:A'));
  assert.throws(() => createPublication(createCmd('late-reply','actor:B',{reply_to_ref:'pub:withdrawn-parent'}),ctx(db,store,'actor:B')), /PUBLICATION_REFERENCE_TARGET_WITHDRAWN/);
});
