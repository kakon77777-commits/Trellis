const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { setDisplayName } = require('../profile/product-commands');
const { buildActorProfile } = require('../profile/read-service');

function setup() {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db, { now: () => '2026-09-02T09:30:00.000Z' });
  registerActor({
    command_id: 'reg-a', idempotency_key: 'reg-a', principal_id: 'principal:A', entity_id: 'actor:A',
    runtime_tag: 'pane:42', model: 'gpt-x', provider: 'provider-x'
  }, { eventStore, authorize: evaluateAuthority });
  setDisplayName({
    command_id: 'name-a', idempotency_key: 'name-a', principal_id: 'principal:A', actor_id: 'actor:A', value: 'Aletheia'
  }, {
    eventStore, authorize: evaluateAuthority, principalActorId: 'actor:A', evaluatedAt: '2026-09-02T09:30:01.000Z'
  });
  return { db, eventStore };
}

test('machine profile keeps stable actor identity separate from runtime metadata', () => {
  const env = setup();
  const profile = buildActorProfile({
    actorId: 'actor:A',
    viewerContext: { viewer_actor_id: 'actor:A', represents_actor_ids: [] },
    eventStore: env.eventStore,
    db: env.db
  });

  assert.equal(profile.actor_id, 'actor:A');
  assert.equal(profile.entity_kind, 'actor');
  assert.equal(profile.presentation.display_name.value, 'Aletheia');
  assert.equal(profile.runtime_bindings[0].runtime_id, 'pane:42');
  assert.equal(profile.runtime_bindings[0].model, 'gpt-x');
  assert.equal(profile.runtime_bindings[0].provider, 'provider-x');
  assert.equal(profile.actor_id === profile.runtime_bindings[0].runtime_id, false);
  assert.equal('verified' in profile.presentation.display_name, false);
  assert.equal(profile.presentation.display_name.provenance_class, 'self_declared');
});
