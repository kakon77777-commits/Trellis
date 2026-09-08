const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { setCommunityDiscoverability } = require('../community/product-commands');
const { requestMembership, approveMembership, leaveCommunity } = require('../community/membership');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { canViewRelationship } = require('../profile/read-policy');
const { isActiveCommunityMember, createMembershipResolver } = require('../community/membership-read');
const { proposeRelationship } = require('../relationship/service');

async function setup() {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db);
  const authorize = evaluateAuthority;
  for (const id of ['A','B','X']) {
    (await registerActor({ command_id:`cmd:${id}`, idempotency_key:`idem:${id}`, principal_id:`principal:${id}`, entity_id:`actor:${id}` }, { eventStore, authorize }));
  }
  (await createCommunity({ command_id:'cmd:C', idempotency_key:'idem:C', principal_id:'principal:C', community_id:'community:C' }, { eventStore, authorize }));
  (await setCommunityDiscoverability({ command_id:'cmd:disc', idempotency_key:'idem:disc', principal_id:'principal:C', community_id:'community:C', value:'private' }, { eventStore, authorize, principalActorId:'community:C' }));
  return { db, eventStore, authorize };
}

async function join(ctx, actor, suffix) {
  const pending = (await requestMembership({ command_id:`cmd:join-${suffix}`, idempotency_key:`idem:join-${suffix}`, principal_id:`principal:${actor}`, actor_id:`actor:${actor}`, community_id:'community:C' }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:`actor:${actor}` }));
  (await approveMembership({ command_id:`cmd:approve-${suffix}`, idempotency_key:`idem:approve-${suffix}`, principal_id:'principal:C', community_id:'community:C', relationship_id:pending.relationship_id, expected_version:1 }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:'community:C' }));
  return pending.relationship_id;
}

test('scope_members is readable by active scope members and the community but not anonymous or nonmembers', async () => {
  const ctx = (await setup());
  const aMembership = (await join(ctx, 'A', 'a'));
  (await join(ctx, 'B', 'b'));
  (await rebuildRelationshipProjection(ctx.db, ctx.eventStore));
  const row = ctx.db.prepare('SELECT * FROM relationships_current WHERE relationship_id=?').get(aMembership);
  const resolver = (await createMembershipResolver(ctx.db));
  assert.equal(row.visibility, 'scope_members');
  assert.equal(canViewRelationship(row, { viewer_actor_id:'actor:B' }, null, resolver), true);
  assert.equal(canViewRelationship(row, { viewer_actor_id:'community:C' }, null, resolver), true);
  assert.equal(canViewRelationship(row, {}, null, resolver), false);
  assert.equal(canViewRelationship(row, { viewer_actor_id:'actor:X' }, null, resolver), false);
  assert.equal((await isActiveCommunityMember(ctx.db, 'community:C', 'actor:B')), true);
});

test('terminated former member loses scope_members readability', async () => {
  const ctx = (await setup());
  const aMembership = (await join(ctx, 'A', 'a2'));
  const bMembership = (await join(ctx, 'B', 'b2'));
  (await leaveCommunity({ command_id:'cmd:leave-b', idempotency_key:'idem:leave-b', principal_id:'principal:B', actor_id:'actor:B', community_id:'community:C', relationship_id:bMembership, expected_version:2 }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:'actor:B' }));
  (await rebuildRelationshipProjection(ctx.db, ctx.eventStore));
  const row = ctx.db.prepare('SELECT * FROM relationships_current WHERE relationship_id=?').get(aMembership);
  assert.equal(canViewRelationship(row, { viewer_actor_id:'actor:B' }, null, (await createMembershipResolver(ctx.db))), false);
});

test('unrelated public relationship does not make scope_members membership readable', async () => {
  const ctx = (await setup());
  const aMembership = (await join(ctx, 'A', 'a3'));
  (await proposeRelationship({ command_id:'cmd:follow', idempotency_key:'idem:follow', principal_id:'principal:X', source_entity_id:'actor:X', target_entity_id:'actor:A', relationship_type:'follows' }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:'actor:X' }));
  (await rebuildRelationshipProjection(ctx.db, ctx.eventStore));
  const row = ctx.db.prepare('SELECT * FROM relationships_current WHERE relationship_id=?').get(aMembership);
  assert.equal(canViewRelationship(row, { viewer_actor_id:'actor:X' }, null, (await createMembershipResolver(ctx.db))), false);
});
