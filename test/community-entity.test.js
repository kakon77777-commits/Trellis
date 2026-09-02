const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { foldEntity } = require('../entity/fold');
const { registerActor, registerEntity } = require('../entity/service');
const { createCommunity } = require('../community/service');

function context() {
  const db = createTestDatabase();
  return { db, eventStore: new SQLiteEventStore(db), authorize: evaluateAuthority };
}

test('registerActor remains an actor-capable actor adapter', () => {
  const ctx = context();
  const result = registerActor({
    command_id: 'cmd:actor-a', idempotency_key: 'idem:actor-a', principal_id: 'principal:a', entity_id: 'actor:A'
  }, ctx);
  const state = foldEntity(ctx.eventStore.readStream('entity', result.entity_id));
  assert.equal(state.entity_kind, 'actor');
  assert.equal(state.actor_capable, true);
});

test('createCommunity registers an actor-capable community with stable community identity', () => {
  const ctx = context();
  const result = createCommunity({
    command_id: 'cmd:community-c', idempotency_key: 'idem:community-c', principal_id: 'principal:creator', community_id: 'community:C', name: 'Research Lab'
  }, ctx);
  assert.equal(result.community_id, 'community:C');
  const events = ctx.eventStore.readStream('entity', 'community:C');
  const state = foldEntity(events);
  assert.equal(state.entity_kind, 'community');
  assert.equal(state.actor_capable, true);
  assert.equal(state.entity_id, 'community:C');
  assert.equal(events.filter(e => e.event_type === 'entity.registered').length, 1);
  assert.equal(events.some(e => e.event_type.startsWith('relationship.')), false);
  assert.equal(events.some(e => /role|capability|membership/.test(e.event_type)), false);
});

test('community identity is not derived from display name or runtime', () => {
  const ctx = context();
  const first = createCommunity({
    command_id: 'cmd:c1', idempotency_key: 'idem:c1', principal_id: 'principal:x', community_id: 'community:C1', name: 'Same Name', runtime_tag: 'runtime:same'
  }, ctx);
  const second = createCommunity({
    command_id: 'cmd:c2', idempotency_key: 'idem:c2', principal_id: 'principal:x', community_id: 'community:C2', name: 'Same Name', runtime_tag: 'runtime:same'
  }, ctx);
  assert.notEqual(first.community_id, second.community_id);
});

test('registerEntity exists as generic canonical registration entrypoint', () => {
  assert.equal(typeof registerEntity, 'function');
});
