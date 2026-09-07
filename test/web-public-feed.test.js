const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { createPublication, withdrawPublication } = require('../publication/service');
const { rebuildPublicationProjection, projectPublicationStream } = require('../publication/projector');
const { buildPublicFeed } = require('../feed/public');
const { compareFeedItemsDesc } = require('../feed/chronological');

function ctx(db, store, actorId) {
  return { db, eventStore: store, authorize: evaluateAuthority, principalActorId: actorId, capabilityGrants: [], evaluatedAt: '2026-09-07T16:00:00Z' };
}
function reg(store, id) {
  registerActor({ command_id:`reg:${id}`, idempotency_key:`reg:${id}`, principal_id:`principal:${id}`, entity_id:id }, { eventStore:store, authorize:evaluateAuthority });
}
function pub(db, store, id, author, extra={}) {
  return createPublication({
    command_id:`pub:${id}`, idempotency_key:`pub:${id}`, principal_id:`principal:${author}`,
    publication_id:`pub:${id}`, author_actor_id:author, publication_type:'post', body:`body:${id}`,
    visibility:'public', ...extra
  }, ctx(db,store,author)).publication_id;
}
function collaborate(db, store, source, target, suffix, visibility='public') {
  const proposed = proposeRelationship({
    command_id:`collab:${suffix}`, idempotency_key:`collab:${suffix}`, principal_id:`principal:${source}`,
    source_entity_id:source, target_entity_id:target, relationship_type:'collaborates_with', visibility
  }, ctx(db,store,source));
  activateRelationship({
    command_id:`activate:${suffix}`, idempotency_key:`activate:${suffix}`, principal_id:`principal:${target}`,
    relationship_id:proposed.relationship_id, expected_version:1
  }, ctx(db,store,target));
  return proposed.relationship_id;
}

function setup() {
  const db=createTestDatabase();
  let tick=0;
  const store=new SQLiteEventStore(db,{now:()=>`2026-09-07T16:00:${String(tick++).padStart(2,'0')}Z`});
  for (const id of ['actor:A','actor:B','actor:C']) reg(store,id);
  createCommunity({command_id:'create:C',idempotency_key:'create:C',principal_id:'principal:community:C',community_id:'community:C'}, {eventStore:store,authorize:evaluateAuthority});
  collaborate(db,store,'actor:A','actor:B','public','public');
  rebuildRelationshipProjection(db,store);
  pub(db,store,'p1','actor:A');
  pub(db,store,'p2','actor:B');
  pub(db,store,'reply','actor:B',{reply_to_ref:'pub:p1'});
  pub(db,store,'private','actor:C',{visibility:'private'});
  pub(db,store,'gone','actor:B');
  withdrawPublication({command_id:'wd:gone',idempotency_key:'wd:gone',principal_id:'principal:actor:B',publication_id:'pub:gone',expected_version:1},ctx(db,store,'actor:B'));
  rebuildPublicationProjection(db,store);
  return {db,store};
}

test('public chronological feed contains only anonymous-readable roots and allowlisted public activity', () => {
  const {db,store}=setup();
  const feed=buildPublicFeed({db,eventStore:store});
  const publicationIds=feed.items.filter(x=>x.item_type==='publication').map(x=>x.source_ref).sort();
  assert.deepEqual(publicationIds,['pub:p1','pub:p2']);
  assert.equal(feed.items.some(x=>x.source_ref==='pub:reply'),false);
  assert.equal(feed.items.some(x=>x.source_ref==='pub:private'),false);
  assert.equal(feed.items.some(x=>x.source_ref==='pub:gone'),false);
  assert.equal(feed.items.filter(x=>x.item_type==='social_activity').length,1);
  assert.equal(feed.algorithm_ref,'trellis-feed:public-chronological:v1');
  assert.deepEqual(feed.items,[...feed.items].sort(compareFeedItemsDesc));
});

test('hidden-only facts do not change public feed items ordering or snapshot', () => {
  const {db,store}=setup();
  const before=buildPublicFeed({db,eventStore:store});
  pub(db,store,'hidden-later','actor:C',{visibility:'private'});
  projectPublicationStream(db,store,'pub:hidden-later');
  const hiddenRel=collaborate(db,store,'actor:B','actor:C','hidden','participants');
  rebuildRelationshipProjection(db,store);
  const after=buildPublicFeed({db,eventStore:store});
  assert.deepEqual(after,before);
});
