const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const {
  addEntityAssertion
} = require('../profile/service');
const {
  setDisplayName,
  addAlias,
  removeAlias
} = require('../profile/product-commands');

function setup() {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db, { now: () => '2026-09-02T07:00:00.000Z' });
  registerActor({
    command_id: 'register-a',
    idempotency_key: 'register-a',
    principal_id: 'principal:A',
    entity_id: 'actor:A',
    display_name: null,
    occurred_at: '2026-09-02T06:59:00.000Z'
  }, { eventStore, authorize: evaluateAuthority });
  return { db, eventStore };
}

function context(eventStore) {
  return {
    eventStore,
    authorize: evaluateAuthority,
    principalActorId: 'actor:A',
    evaluatedAt: '2026-09-02T07:00:00.000Z'
  };
}

test('SetDisplayName emits only entity.assertion_added', () => {
  const { eventStore } = setup();
  const result = setDisplayName({
    command_id: 'name-1', idempotency_key: 'name-1', principal_id: 'principal:A',
    actor_id: 'actor:A', value: 'Aletheia', visibility: 'public'
  }, context(eventStore));

  const events = eventStore.readStream('entity', 'actor:A');
  assert.equal(result.assertion_id.startsWith('assert:'), true);
  assert.deepEqual(events.slice(1).map(e => e.event_type), ['entity.assertion_added']);
  assert.equal(events.at(-1).payload.field_ref, 'profile:display_name:v1');
  assert.equal(events.at(-1).payload.value, 'Aletheia');
});

test('single-valued update rejects without exact supersedes assertion', () => {
  const { eventStore } = setup();
  setDisplayName({
    command_id: 'name-1', idempotency_key: 'name-1', principal_id: 'principal:A', actor_id: 'actor:A', value: 'A'
  }, context(eventStore));

  assert.throws(() => setDisplayName({
    command_id: 'name-2', idempotency_key: 'name-2', principal_id: 'principal:A', actor_id: 'actor:A', value: 'B'
  }, context(eventStore)), /PROFILE_SUPERSESSION_REQUIRED/);
});

test('single-valued update succeeds with exact supersedes assertion', () => {
  const { eventStore } = setup();
  const first = setDisplayName({
    command_id: 'name-1', idempotency_key: 'name-1', principal_id: 'principal:A', actor_id: 'actor:A', value: 'A'
  }, context(eventStore));
  const second = setDisplayName({
    command_id: 'name-2', idempotency_key: 'name-2', principal_id: 'principal:A', actor_id: 'actor:A', value: 'B',
    supersedes_assertion_id: first.assertion_id,
    visibility: 'participants'
  }, context(eventStore));

  const event = eventStore.readStream('entity', 'actor:A').at(-1);
  assert.equal(event.payload.assertion_id, second.assertion_id);
  assert.equal(event.payload.supersedes_assertion_id, first.assertion_id);
  assert.equal(event.payload.visibility, 'participants');
});

test('aliases coexist and removing one appends a retract event', () => {
  const { eventStore } = setup();
  const one = addAlias({
    command_id: 'alias-1', idempotency_key: 'alias-1', principal_id: 'principal:A', actor_id: 'actor:A', value: 'Ale'
  }, context(eventStore));
  addAlias({
    command_id: 'alias-2', idempotency_key: 'alias-2', principal_id: 'principal:A', actor_id: 'actor:A', value: 'Aletheia'
  }, context(eventStore));
  removeAlias({
    command_id: 'alias-r1', idempotency_key: 'alias-r1', principal_id: 'principal:A', actor_id: 'actor:A',
    target_assertion_id: one.assertion_id
  }, context(eventStore));

  const profileEvents = eventStore.readStream('entity', 'actor:A').slice(1);
  assert.equal(profileEvents.length, 3);
  assert.equal(profileEvents.at(-1).event_type, 'entity.assertion_added');
  assert.equal(profileEvents.at(-1).payload.operation, 'retract');
  assert.equal(profileEvents.at(-1).payload.target_assertion_id, one.assertion_id);
});

test('private visibility persists as canonical proposal-time assertion fact', () => {
  const { eventStore } = setup();
  addAlias({
    command_id: 'alias-1', idempotency_key: 'alias-1', principal_id: 'principal:A', actor_id: 'actor:A',
    value: 'Secret Alias', visibility: 'private'
  }, context(eventStore));
  assert.equal(eventStore.readStream('entity', 'actor:A').at(-1).payload.visibility, 'private');
});

test('profile service rejects scope_ref and verified inputs', () => {
  const { eventStore } = setup();
  const base = {
    command_id: 'bad-1', idempotency_key: 'bad-1', principal_id: 'principal:A', actor_id: 'actor:A',
    field_ref: 'profile:bio:v1', operation: 'assert', value: 'bio'
  };
  assert.throws(() => addEntityAssertion({ ...base, scope_ref: 'project:X' }, context(eventStore)), /PROFILE_ASSERTION_SCOPE_FORBIDDEN/);
  assert.throws(() => addEntityAssertion({ ...base, command_id: 'bad-2', idempotency_key: 'bad-2', verified: true }, context(eventStore)), /PROFILE_ASSERTION_VERIFICATION_FORBIDDEN/);
});

test('principal cannot assert profile facts for a different actor', () => {
  const { eventStore } = setup();
  assert.throws(() => addEntityAssertion({
    command_id: 'deny-1', idempotency_key: 'deny-1', principal_id: 'principal:A', actor_id: 'actor:A',
    field_ref: 'profile:bio:v1', operation: 'assert', value: 'bio'
  }, { ...context(eventStore), principalActorId: 'actor:B' }), /POLICY_DENIED/);
});

test('successful profile command retry is deduplicated before semantic preflight', () => {
  const { eventStore } = setup();
  const command = {
    command_id: 'retry-name', idempotency_key: 'retry-name', principal_id: 'principal:A',
    actor_id: 'actor:A', value: 'Aletheia'
  };
  const first = setDisplayName(command, context(eventStore));
  const countBefore = eventStore.readStream('entity', 'actor:A').length;
  const second = setDisplayName(command, context(eventStore));
  const countAfter = eventStore.readStream('entity', 'actor:A').length;

  assert.equal(second.assertion_id, first.assertion_id);
  assert.equal(second.receipt.deduplicated, true);
  assert.equal(countAfter, countBefore);
});

test('same profile idempotency key with changed payload conflicts before semantic evaluation', () => {
  const { eventStore } = setup();
  setDisplayName({
    command_id: 'retry-name', idempotency_key: 'retry-key', principal_id: 'principal:A',
    actor_id: 'actor:A', value: 'Aletheia'
  }, context(eventStore));

  assert.throws(() => setDisplayName({
    command_id: 'retry-name-2', idempotency_key: 'retry-key', principal_id: 'principal:A',
    actor_id: 'actor:A', value: 'Different'
  }, context(eventStore)), error => error && error.code === 'IDEMPOTENCY_CONFLICT');
});
