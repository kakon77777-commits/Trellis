const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { requestMembership, approveMembership } = require('../community/membership');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { createPublication } = require('../publication/service');
const { rebuildPublicationProjection, projectPublicationStream } = require('../publication/projector');
const { buildHomeFeed } = require('../feed/home');

function ctx(db, store, actorId, extra = {}) {
  return {
    db,
    eventStore: store,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    capabilityGrants: [],
    evaluatedAt: '2026-09-03T01:30:00Z',
    ...extra
  };
}

function reg(store, id) {
  registerActor({ command_id:`reg:${id}`, idempotency_key:`reg:${id}`, principal_id:`principal:${id}`, entity_id:id }, { eventStore:store, authorize:evaluateAuthority });
}
function community(store, id) {
  createCommunity({ command_id:`create:${id}`, idempotency_key:`create:${id}`, principal_id:`principal:${id}`, community_id:id }, { eventStore:store, authorize:evaluateAuthority });
}
function join(db, store, actorId, communityId, suffix) {
  const r=requestMembership({command_id:`join:${suffix}`,idempotency_key:`join:${suffix}`,principal_id:`principal:${actorId}`,actor_id:actorId,community_id:communityId},ctx(db,store,actorId));
  approveMembership({command_id:`approve:${suffix}`,idempotency_key:`approve:${suffix}`,principal_id:`principal:${communityId}`,community_id:communityId,relationship_id:r.relationship_id,expected_version:1},ctx(db,store,communityId));
  return r.relationship_id;
}
function follow(db, store, source, target, suffix) {
  return proposeRelationship({command_id:`follow:${suffix}`,idempotency_key:`follow:${suffix}`,principal_id:`principal:${source}`,source_entity_id:source,target_entity_id:target,relationship_type:'follows'},ctx(db,store,source)).relationship_id;
}
function collab(db, store, source, target, suffix, visibility='public') {
  const r=proposeRelationship({command_id:`collab:${suffix}`,idempotency_key:`collab:${suffix}`,principal_id:`principal:${source}`,source_entity_id:source,target_entity_id:target,relationship_type:'collaborates_with',visibility},ctx(db,store,source));
  activateRelationship({command_id:`activate:${suffix}`,idempotency_key:`activate:${suffix}`,principal_id:`principal:${target}`,relationship_id:r.relationship_id,expected_version:1},ctx(db,store,target));
  return r.relationship_id;
}
function grant(actorId, scopeRef) { return {active:true,principal_id:`principal:${actorId}`,capability:'publication:create',scope_ref:scopeRef}; }
function pub(db, store, id, author, overrides={}, extra={}) {
  return createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',...overrides},ctx(db,store,author,extra)).publication_id;
}

function setup() {
  const db=createTestDatabase(); let tick=0;
  const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T01:31:${String(tick++).padStart(2,'0')}Z`});
  for(const id of ['actor:A','actor:B','actor:X','actor:Y']) reg(store,id);
  community(store,'community:C');
  join(db,store,'actor:A','community:C','a-c');
  join(db,store,'actor:B','community:C','b-c');
  const followB=follow(db,store,'actor:A','actor:B','a-b');
  const followX=follow(db,store,'actor:A','actor:X','a-x');
  rebuildRelationshipProjection(db,store);
  pub(db,store,'p1','actor:B');
  pub(db,store,'p2','actor:X');
  pub(db,store,'p3','actor:A');
  pub(db,store,'p4','actor:B',{reply_to_ref:'pub:p1'});
  pub(db,store,'p5','actor:B',{scope_ref:'community:C',visibility:'scope_members'},{capabilityGrants:[grant('actor:B','community:C')]});
  rebuildPublicationProjection(db,store);
  return {db,store,followB,followX};
}

function publicationRoots(feed) {
  return feed.items.filter(item=>item.item_type==='publication').map(item=>item.source_ref).sort();
}

test('Home Feed combines only visible explicit-source Publication roots', () => {
  const {db,store,followX}=setup();
  const hidden=new Set([followX]);
  const disclosurePolicy=value=>value.relationship_id&&hidden.has(value.relationship_id)?'deny':'allow';
  const feed=buildHomeFeed({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,disclosurePolicy});
  assert.equal(feed.feed_type,'home');
  assert.equal(feed.subject_actor_id,'actor:A');
  assert.deepEqual(publicationRoots(feed),['pub:p1','pub:p3','pub:p5']);
  assert.equal(feed.items.some(item=>item.item_type==='publication'&&item.source_ref==='pub:p2'),false);
  assert.equal(feed.items.some(item=>item.item_type==='publication'&&item.source_ref==='pub:p4'),false);
});

test('viewer-invisible facts do not change Home Feed items ordering or snapshot', () => {
  const {db,store,followX}=setup();
  const hidden=new Set([followX]);
  const disclosurePolicy=value=>value.relationship_id&&hidden.has(value.relationship_id)?'deny':'allow';
  const args={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,disclosurePolicy};
  const before=buildHomeFeed(args);

  const followY=follow(db,store,'actor:A','actor:Y','a-y-hidden'); hidden.add(followY);
  community(store,'community:C2');
  const memberC2=join(db,store,'actor:A','community:C2','a-c2-hidden'); hidden.add(memberC2);
  const hiddenCollab=collab(db,store,'actor:B','actor:Y','b-y-hidden'); hidden.add(hiddenCollab);
  rebuildRelationshipProjection(db,store);
  pub(db,store,'private-hidden','actor:B',{visibility:'private'});
  projectPublicationStream(db,store,'pub:private-hidden');

  const after=buildHomeFeed(args);
  assert.deepEqual(after,before);
});
