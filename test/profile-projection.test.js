const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { setDisplayName, setBio, addAlias } = require('../profile/product-commands');
const {
  projectActorProfile,
  rebuildActorProfileProjection
} = require('../profile/projector');

function context(eventStore) {
  return {
    eventStore,
    authorize: evaluateAuthority,
    principalActorId: 'actor:A',
    evaluatedAt: '2026-09-02T08:00:00.000Z'
  };
}

function setupProfile() {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db, { now: () => '2026-09-02T08:00:01.000Z' });
  registerActor({
    command_id: 'reg-a', idempotency_key: 'reg-a', principal_id: 'principal:A', entity_id: 'actor:A'
  }, { eventStore, authorize: evaluateAuthority });

  const first = setDisplayName({
    command_id: 'name-1', idempotency_key: 'name-1', principal_id: 'principal:A', actor_id: 'actor:A', value: 'Aletheia'
  }, context(eventStore));
  setBio({
    command_id: 'bio-1', idempotency_key: 'bio-1', principal_id: 'principal:A', actor_id: 'actor:A',
    value: 'Private biography', visibility: 'private'
  }, context(eventStore));
  addAlias({
    command_id: 'alias-1', idempotency_key: 'alias-1', principal_id: 'principal:A', actor_id: 'actor:A', value: 'Ale'
  }, context(eventStore));
  setDisplayName({
    command_id: 'name-2', idempotency_key: 'name-2', principal_id: 'principal:A', actor_id: 'actor:A', value: 'Aletheia Prime',
    supersedes_assertion_id: first.assertion_id
  }, context(eventStore));

  return { db, eventStore, firstAssertionId: first.assertion_id };
}

function dumpProjection(db) {
  return {
    current: db.prepare('SELECT * FROM actor_profile_current ORDER BY actor_id').all(),
    assertions: db.prepare('SELECT * FROM actor_profile_assertions_current ORDER BY assertion_id').all()
  };
}

test('profile projection can be destroyed and rebuilt exactly from canonical entity history', () => {
  const { db, eventStore, firstAssertionId } = setupProfile();
  projectActorProfile(db, eventStore, 'actor:A');
  const before = dumpProjection(db);

  assert.equal(before.current.length, 1);
  assert.equal(before.assertions.length, 4);
  assert.equal(before.assertions.find(row => row.assertion_id === firstAssertionId).active, 0);

  db.exec('DELETE FROM actor_profile_assertions_current; DELETE FROM actor_profile_current;');
  assert.deepEqual(dumpProjection(db), { current: [], assertions: [] });

  rebuildActorProfileProjection(db, eventStore);
  const after = dumpProjection(db);
  assert.deepEqual(after, before);
});
