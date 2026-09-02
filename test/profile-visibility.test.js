const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { setDisplayName, setBio, addAlias } = require('../profile/product-commands');
const { proposeRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { buildActorProfile } = require('../profile/read-service');

function actorContext(eventStore, actorId) {
  return {
    eventStore,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    evaluatedAt: '2026-09-02T09:00:00.000Z'
  };
}

function register(eventStore, id, runtimeTag = null) {
  return registerActor({
    command_id: `reg-${id}`,
    idempotency_key: `reg-${id}`,
    principal_id: `principal:${id}`,
    entity_id: id,
    runtime_tag: runtimeTag,
    model: runtimeTag ? 'gpt-x' : null,
    provider: runtimeTag ? 'provider-x' : null
  }, { eventStore, authorize: evaluateAuthority });
}

function setup() {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db, { now: () => '2026-09-02T09:00:01.000Z' });
  register(eventStore, 'actor:A', 'runtime:A:1');
  register(eventStore, 'actor:B');
  register(eventStore, 'actor:C');
  register(eventStore, 'actor:D');

  setDisplayName({
    command_id: 'name-a', idempotency_key: 'name-a', principal_id: 'principal:actor:A', actor_id: 'actor:A',
    value: 'Aletheia', visibility: 'public'
  }, actorContext(eventStore, 'actor:A'));
  addAlias({
    command_id: 'alias-a', idempotency_key: 'alias-a', principal_id: 'principal:actor:A', actor_id: 'actor:A',
    value: 'Participant Alias', visibility: 'participants'
  }, actorContext(eventStore, 'actor:A'));
  setBio({
    command_id: 'bio-a', idempotency_key: 'bio-a', principal_id: 'principal:actor:A', actor_id: 'actor:A',
    value: 'Private biography', visibility: 'private'
  }, actorContext(eventStore, 'actor:A'));

  proposeRelationship({
    command_id: 'follow-ab', idempotency_key: 'follow-ab', principal_id: 'principal:actor:A',
    source_entity_id: 'actor:A', target_entity_id: 'actor:B', relationship_type: 'follows', visibility: 'public'
  }, actorContext(eventStore, 'actor:A'));
  proposeRelationship({
    command_id: 'follow-ac', idempotency_key: 'follow-ac', principal_id: 'principal:actor:A',
    source_entity_id: 'actor:A', target_entity_id: 'actor:C', relationship_type: 'follows', visibility: 'private'
  }, actorContext(eventStore, 'actor:A'));

  rebuildRelationshipProjection(db, eventStore);
  return { db, eventStore };
}

function build(env, viewerContext, overrides = {}) {
  return buildActorProfile({
    actorId: 'actor:A',
    viewerContext,
    eventStore: env.eventStore,
    db: env.db,
    disclosurePolicy: overrides.disclosurePolicy,
    runtimeDisclosurePolicy: overrides.runtimeDisclosurePolicy
  });
}

test('anonymous viewer sees only public assertions and public relationships', () => {
  const env = setup();
  const profile = build(env, { viewer_actor_id: null, represents_actor_ids: [] });

  assert.equal(profile.presentation.display_name.value, 'Aletheia');
  assert.equal(profile.presentation.bio, undefined);
  assert.deepEqual(profile.presentation.aliases, []);
  assert.equal(profile.social.visible_relationship_count, 1);
  assert.deepEqual(profile.social.visible_relationships.map(r => r.target_entity_id), ['actor:B']);
  assert.deepEqual(profile.runtime_bindings, []);
});

test('self or authorized representative sees private and participant assertions', () => {
  const env = setup();
  const self = build(env, { viewer_actor_id: 'actor:A', represents_actor_ids: [] });
  assert.equal(self.presentation.bio.value, 'Private biography');
  assert.deepEqual(self.presentation.aliases.map(v => v.value), ['Participant Alias']);
  assert.equal(self.runtime_bindings.length, 1);

  const rep = build(env, { viewer_actor_id: 'actor:REP', represents_actor_ids: ['actor:A'] });
  assert.equal(rep.presentation.bio.value, 'Private biography');
  assert.deepEqual(rep.presentation.aliases.map(v => v.value), ['Participant Alias']);
});

test('direct readable relationship participant sees participants but not private', () => {
  const env = setup();
  const profile = build(env, { viewer_actor_id: 'actor:B', represents_actor_ids: [] });
  assert.deepEqual(profile.presentation.aliases.map(v => v.value), ['Participant Alias']);
  assert.equal(profile.presentation.bio, undefined);
});

test('unrelated authenticated actor does not see participants assertions', () => {
  const env = setup();
  const profile = build(env, { viewer_actor_id: 'actor:D', represents_actor_ids: [] });
  assert.deepEqual(profile.presentation.aliases, []);
  assert.equal(profile.presentation.bio, undefined);
});

test('current disclosure policy may narrow public exposure but cannot widen private exposure', () => {
  const env = setup();
  const hideName = build(env, { viewer_actor_id: null, represents_actor_ids: [] }, {
    disclosurePolicy: assertion => assertion.field_ref === 'profile:display_name:v1' ? 'deny' : 'allow'
  });
  assert.equal(hideName.presentation.display_name, undefined);

  const attemptWiden = build(env, { viewer_actor_id: null, represents_actor_ids: [] }, {
    disclosurePolicy: () => 'allow'
  });
  assert.equal(attemptWiden.presentation.bio, undefined);
});

test('visible aggregate is computed only after filtering hidden relationships', () => {
  const env = setup();
  const anonymous = build(env, { viewer_actor_id: null, represents_actor_ids: [] });
  assert.equal(anonymous.social.visible_relationship_count, 1);
  assert.equal(JSON.stringify(anonymous).includes('actor:C'), false);
});
