const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');

function allowRegistration(request) {
  return {
    decision_id: `authz:${request.aggregate_id}`,
    principal_id: request.principal_id,
    actor_id: request.actor_id,
    policy_ref: 'policy:entity-register:v1',
    requested_action: request.requested_action,
    aggregate_id: request.aggregate_id,
    credential_refs: [],
    decision: 'allow',
    evaluated_at: '2026-09-02T07:00:00.000Z'
  };
}

test('same display name model and runtime do not collapse two actors', () => {
  const { registerActor } = require('../entity/service');
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db);
  const common = {
    display_name: 'Aletheia',
    model: 'gpt-x',
    runtime_tag: 'runtime:R1',
    principal_id: 'principal:Neo',
    occurred_at: '2026-09-02T07:00:00.000Z'
  };

  const a = registerActor({
    ...common,
    command_id: 'cmd:actor-A',
    idempotency_key: 'idem:actor-A'
  }, { eventStore, authorize: allowRegistration });
  const b = registerActor({
    ...common,
    command_id: 'cmd:actor-B',
    idempotency_key: 'idem:actor-B'
  }, { eventStore, authorize: allowRegistration });

  assert.notEqual(a.entity_id, b.entity_id);
  assert.equal(eventStore.readStream('entity', a.entity_id)[0].payload.display_name, 'Aletheia');
  assert.equal(eventStore.readStream('entity', b.entity_id)[0].payload.display_name, 'Aletheia');
});

test('runtime binding changes do not change actor identity', () => {
  const { foldEntity } = require('../entity/fold');
  const state = foldEntity([
    {
      event_id: 'evt:entity:1',
      event_type: 'entity.registered',
      stream_seq: 1,
      payload: {
        entity_id: 'actor:A',
        entity_kind: 'actor',
        actor_capable: true,
        display_name: 'Aletheia'
      }
    },
    {
      event_id: 'evt:entity:2',
      event_type: 'entity.runtime_binding_added',
      stream_seq: 2,
      payload: { runtime_id: 'runtime:R1', model: 'model:X' }
    },
    {
      event_id: 'evt:entity:3',
      event_type: 'entity.runtime_binding_added',
      stream_seq: 3,
      payload: { runtime_id: 'runtime:R2', model: 'model:Y' }
    }
  ]);

  assert.equal(state.entity_id, 'actor:A');
  assert.deepEqual(state.runtime_bindings.map(x => x.runtime_id), ['runtime:R1', 'runtime:R2']);
});

test('identity assertions remain evidence and do not mutate stable actor id', () => {
  const { foldEntity } = require('../entity/fold');
  const state = foldEntity([
    {
      event_id: 'evt:entity:1',
      event_type: 'entity.registered',
      stream_seq: 1,
      payload: { entity_id: 'actor:A', entity_kind: 'actor', actor_capable: true }
    },
    {
      event_id: 'evt:entity:2',
      event_type: 'entity.assertion_added',
      stream_seq: 2,
      payload: { assertion_type: 'possible_same_actor', target_entity_id: 'actor:B', confidence: 0.99 }
    }
  ]);

  assert.equal(state.entity_id, 'actor:A');
  assert.equal(state.assertions.length, 1);
  assert.equal(state.assertions[0].target_entity_id, 'actor:B');
});

test('v0.1 exposes no actor merge or retirement API', () => {
  const service = require('../entity/service');
  assert.equal(service.mergeActor, undefined);
  assert.equal(service.retireActor, undefined);
});
