const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { setCommunityDiscoverability } = require('../community/product-commands');
const { requestMembership, approveMembership, leaveCommunity, removeMember } = require('../community/membership');
const { foldRelationship } = require('../relationship/fold');

function setup(discoverability='public') {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db);
  const authorize = evaluateAuthority;
  registerActor({ command_id:'cmd:a', idempotency_key:'idem:a', principal_id:'principal:a', entity_id:'actor:A' }, { eventStore, authorize });
  createCommunity({ command_id:'cmd:c', idempotency_key:'idem:c', principal_id:'principal:c', community_id:'community:C' }, { eventStore, authorize });
  setCommunityDiscoverability({ command_id:'cmd:disc', idempotency_key:'idem:disc', principal_id:'principal:c', community_id:'community:C', value:discoverability }, { eventStore, authorize, principalActorId:'community:C' });
  return { db, eventStore, authorize };
}

function memberCmd(id, extra={}) {
  return { command_id:`cmd:${id}`, idempotency_key:`idem:${id}`, principal_id:'principal:a', actor_id:'actor:A', community_id:'community:C', ...extra };
}

test('public and unlisted community membership defaults to public with scope bound to community', () => {
  for (const discoverability of ['public','unlisted']) {
    const { eventStore, authorize } = setup(discoverability);
    const result = requestMembership(memberCmd(`join-${discoverability}`), { eventStore, authorize, principalActorId:'actor:A' });
    const state = foldRelationship(eventStore.readStream('relationship', result.relationship_id));
    assert.equal(state.relationship_type, 'member_of');
    assert.equal(state.source_entity_id, 'actor:A');
    assert.equal(state.target_entity_id, 'community:C');
    assert.equal(state.scope_ref, 'community:C');
    assert.equal(state.visibility, 'public');
    assert.equal(state.lifecycle, 'proposed');
  }
});

test('private community membership defaults to scope_members and caller override still obeys policy', () => {
  const { eventStore, authorize } = setup('private');
  const result = requestMembership(memberCmd('join-private'), { eventStore, authorize, principalActorId:'actor:A' });
  assert.equal(foldRelationship(eventStore.readStream('relationship', result.relationship_id)).visibility, 'scope_members');

  const override = requestMembership(memberCmd('join-override', { relationship_id:'rel:override', visibility:'participants' }), { eventStore, authorize, principalActorId:'actor:A' });
  assert.equal(foldRelationship(eventStore.readStream('relationship', override.relationship_id)).visibility, 'participants');
  assert.throws(() => requestMembership(memberCmd('join-bad', { relationship_id:'rel:bad', visibility:'friends' }), { eventStore, authorize, principalActorId:'actor:A' }), /VISIBILITY_NOT_ALLOWED/);
});

test('membership approval requires acting-as target community', () => {
  const { eventStore, authorize } = setup('private');
  const pending = requestMembership(memberCmd('join'), { eventStore, authorize, principalActorId:'actor:A' });
  assert.throws(() => approveMembership({ command_id:'cmd:approve-bad', idempotency_key:'idem:approve-bad', principal_id:'principal:a', community_id:'community:C', relationship_id:pending.relationship_id, expected_version:1 }, { eventStore, authorize, principalActorId:'actor:A' }), /POLICY_DENIED/);
  approveMembership({ command_id:'cmd:approve', idempotency_key:'idem:approve', principal_id:'principal:c', community_id:'community:C', relationship_id:pending.relationship_id, expected_version:1 }, { eventStore, authorize, principalActorId:'community:C' });
  assert.equal(foldRelationship(eventStore.readStream('relationship', pending.relationship_id)).lifecycle, 'active');
});

test('member can leave and only acting-as community can remove member', () => {
  const first = setup('public');
  const pending1 = requestMembership(memberCmd('join-leave'), { eventStore:first.eventStore, authorize:first.authorize, principalActorId:'actor:A' });
  approveMembership({ command_id:'cmd:approve-leave', idempotency_key:'idem:approve-leave', principal_id:'principal:c', community_id:'community:C', relationship_id:pending1.relationship_id, expected_version:1 }, { eventStore:first.eventStore, authorize:first.authorize, principalActorId:'community:C' });
  leaveCommunity({ command_id:'cmd:leave', idempotency_key:'idem:leave', principal_id:'principal:a', actor_id:'actor:A', community_id:'community:C', relationship_id:pending1.relationship_id, expected_version:2 }, { eventStore:first.eventStore, authorize:first.authorize, principalActorId:'actor:A' });
  assert.equal(foldRelationship(first.eventStore.readStream('relationship', pending1.relationship_id)).lifecycle, 'terminated');

  const second = setup('public');
  const pending2 = requestMembership(memberCmd('join-remove'), { eventStore:second.eventStore, authorize:second.authorize, principalActorId:'actor:A' });
  approveMembership({ command_id:'cmd:approve-remove', idempotency_key:'idem:approve-remove', principal_id:'principal:c', community_id:'community:C', relationship_id:pending2.relationship_id, expected_version:1 }, { eventStore:second.eventStore, authorize:second.authorize, principalActorId:'community:C' });
  assert.throws(() => removeMember({ command_id:'cmd:remove-bad', idempotency_key:'idem:remove-bad', principal_id:'principal:a', community_id:'community:C', relationship_id:pending2.relationship_id, expected_version:2 }, { eventStore:second.eventStore, authorize:second.authorize, principalActorId:'actor:A' }), /POLICY_DENIED/);
  removeMember({ command_id:'cmd:remove', idempotency_key:'idem:remove', principal_id:'principal:c', community_id:'community:C', relationship_id:pending2.relationship_id, expected_version:2 }, { eventStore:second.eventStore, authorize:second.authorize, principalActorId:'community:C' });
  assert.equal(foldRelationship(second.eventStore.readStream('relationship', pending2.relationship_id)).lifecycle, 'terminated');
});
