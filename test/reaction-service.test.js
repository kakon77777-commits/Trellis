const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { createPublication, withdrawPublication } = require('../publication/service');
const { projectPublicationStream } = require('../publication/projector');
const { deriveReactionId } = require('../reaction/types');
const { createReaction, changeReaction, withdrawReaction, restoreReaction } = require('../reaction/service');

function ctx(db,store,actor,extra={}) { return {db,eventStore:store,principalActorId:actor,evaluatedAt:'2026-09-03T02:00:00Z',capabilityGrants:[],...extra}; }
function reg(store,actor){ registerActor({command_id:`reg:${actor}`,idempotency_key:`reg:${actor}`,principal_id:`principal:${actor}`,entity_id:actor},{eventStore:store,authorize:evaluateAuthority}); }
function pubCmd(id,author,overrides={}){ return {command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[],...overrides}; }
function reactionCmd(id,actor,pub,type='like',extra={}){ return {command_id:`rx:${id}`,idempotency_key:`rx:${id}`,principal_id:`principal:${actor}`,actor_id:actor,publication_id:pub,reaction_type:type,...extra}; }
function setupPublic(){
  const db=createTestDatabase(); const store=new SQLiteEventStore(db,{now:()=> '2026-09-03T02:00:01Z'});
  for (const a of ['actor:A','actor:B','actor:C']) reg(store,a);
  createPublication(pubCmd('p1','actor:A'),ctx(db,store,'actor:A'));
  projectPublicationStream(db,store,'pub:p1');
  return {db,store};
}
function setupPrivateCommunity(){
  const db=createTestDatabase(); const store=new SQLiteEventStore(db,{now:()=> '2026-09-03T02:00:01Z'});
  reg(store,'actor:A'); reg(store,'actor:B'); reg(store,'actor:X');
  createCommunity({command_id:'community:C',idempotency_key:'community:C',principal_id:'principal:community:C',community_id:'community:C'},{eventStore:store,authorize:evaluateAuthority});
  for (const actor of ['actor:A','actor:B']) {
    const pending=requestMembership({command_id:`join:${actor}`,idempotency_key:`join:${actor}`,principal_id:`principal:${actor}`,actor_id:actor,community_id:'community:C'},{eventStore:store,authorize:evaluateAuthority,principalActorId:actor});
    approveMembership({command_id:`approve:${actor}`,idempotency_key:`approve:${actor}`,principal_id:'principal:community:C',community_id:'community:C',relationship_id:pending.relationship_id,expected_version:1},{eventStore:store,authorize:evaluateAuthority,principalActorId:'community:C'});
  }
  rebuildRelationshipProjection(db,store);
  const grant={active:true,principal_id:'principal:actor:A',capability:'publication:create',scope_ref:'community:C'};
  createPublication(pubCmd('private','actor:A',{scope_ref:'community:C',visibility:'scope_members'}),ctx(db,store,'actor:A',{capabilityGrants:[grant]}));
  projectPublicationStream(db,store,'pub:private');
  return {db,store};
}

test('owner creates, changes, withdraws, and restores same deterministic Reaction aggregate', () => {
  const {db,store}=setupPublic();
  const created=createReaction(reactionCmd('create','actor:B','pub:p1','like'),ctx(db,store,'actor:B'));
  const rid=deriveReactionId('actor:B','pub:p1');
  assert.equal(created.reaction_id,rid);
  assert.equal(store.readStream('reaction',rid).length,1);
  changeReaction(reactionCmd('change','actor:B','pub:p1','love',{expected_version:1}),ctx(db,store,'actor:B'));
  withdrawReaction(reactionCmd('withdraw','actor:B','pub:p1','love',{expected_version:2}),ctx(db,store,'actor:B'));
  restoreReaction(reactionCmd('restore','actor:B','pub:p1','insightful',{expected_version:3}),ctx(db,store,'actor:B'));
  const events=store.readStream('reaction',rid);
  assert.deepEqual(events.map(e=>e.event_type),['reaction.created','reaction.changed','reaction.withdrawn','reaction.restored']);
  assert.equal(events[3].payload.reaction_type,'insightful');
});

test('create/change/restore require active readable target while owner may withdraw after target withdrawal', () => {
  const {db,store}=setupPublic();
  createReaction(reactionCmd('create2','actor:B','pub:p1'),ctx(db,store,'actor:B'));
  withdrawPublication({command_id:'wd:p1',idempotency_key:'wd:p1',principal_id:'principal:actor:A',publication_id:'pub:p1',expected_version:1},ctx(db,store,'actor:A'));
  projectPublicationStream(db,store,'pub:p1');
  assert.throws(()=>changeReaction(reactionCmd('change2','actor:B','pub:p1','love',{expected_version:1}),ctx(db,store,'actor:B')), /REACTION_TARGET_NOT_ACTIVE/);
  withdrawReaction(reactionCmd('withdraw2','actor:B','pub:p1','like',{expected_version:1}),ctx(db,store,'actor:B'));
  assert.throws(()=>restoreReaction(reactionCmd('restore2','actor:B','pub:p1','love',{expected_version:2}),ctx(db,store,'actor:B')), /REACTION_TARGET_NOT_ACTIVE/);
  assert.throws(()=>createReaction(reactionCmd('newC','actor:C','pub:p1'),ctx(db,store,'actor:C')), /REACTION_TARGET_NOT_ACTIVE/);
});

test('private Community membership can make target readable but another principal still cannot mutate member Reaction', () => {
  const {db,store}=setupPrivateCommunity();
  const ok=createReaction(reactionCmd('member','actor:B','pub:private','like'),ctx(db,store,'actor:B'));
  assert.equal(ok.reaction_id,deriveReactionId('actor:B','pub:private'));
  assert.throws(()=>createReaction(reactionCmd('outsider','actor:X','pub:private'),ctx(db,store,'actor:X')), /REACTION_TARGET_NOT_READABLE/);
  assert.throws(()=>changeReaction({...reactionCmd('impersonate','actor:B','pub:private','love',{expected_version:1}),principal_id:'principal:actor:X'},ctx(db,store,'actor:X')), error=>error&&error.code==='POLICY_DENIED');
});

test('caller cannot override target-derived Reaction audience fields', () => {
  const {db,store}=setupPublic();
  for (const extra of [{visibility:'private'},{scope_ref:'community:X'},{audience_actor_ids:['actor:B']}]) {
    assert.throws(()=>createReaction({...reactionCmd(`override-${Object.keys(extra)[0]}`,'actor:B','pub:p1'),...extra},ctx(db,store,'actor:B')), /REACTION_AUDIENCE_OVERRIDE_FORBIDDEN/);
  }
});

test('successful retry deduplicates before lifecycle preflight, idempotency conflicts, and stale version rejects', () => {
  const {db,store}=setupPublic();
  const create=reactionCmd('idem-create','actor:B','pub:p1','like');
  const first=createReaction(create,ctx(db,store,'actor:B'));
  const second=createReaction(create,ctx(db,store,'actor:B'));
  assert.equal(second.receipt.deduplicated,true);
  assert.equal(first.reaction_id,second.reaction_id);
  assert.throws(()=>createReaction({...create,reaction_type:'love'},ctx(db,store,'actor:B')), error=>error&&error.code==='IDEMPOTENCY_CONFLICT');
  assert.throws(()=>changeReaction(reactionCmd('stale','actor:B','pub:p1','love',{expected_version:0}),ctx(db,store,'actor:B')), error=>error&&error.code==='VERSION_CONFLICT');
});
