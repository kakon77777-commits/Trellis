const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { registerActor } = require('../entity/service');
const { evaluateAuthority } = require('../authority/policy');
const {
  proposeRelationship,
  activateRelationship,
  addEvidence
} = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { listPublicRelationships } = require('../projections/public-graph');
const { foldRelationship } = require('../relationship/fold');

function registration(commandId, principalId, displayName) {
  return {
    command_id: commandId,
    idempotency_key: `idem:${commandId}`,
    principal_id: principalId,
    display_name: displayName,
    model: 'same-model-does-not-matter',
    runtime_tag: 'same-runtime-does-not-matter',
    occurred_at: '2026-09-02T09:00:00.000Z'
  };
}

test('Foundation vertical slice rebuilds exact graph from canonical history', () => {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);

  const a = registerActor(
    registration('register-A', 'principal:A', 'Resident A'),
    { eventStore: store, authorize: evaluateAuthority }
  );
  const b = registerActor(
    registration('register-B', 'principal:B', 'Resident B'),
    { eventStore: store, authorize: evaluateAuthority }
  );

  const proposed = proposeRelationship({
    command_id: 'cmd:foundation-propose',
    idempotency_key: 'idem:foundation-propose',
    principal_id: 'principal:A',
    source_entity_id: a.entity_id,
    target_entity_id: b.entity_id,
    relationship_type: 'collaborates_with',
    scope_ref: 'project:foundation',
    visibility: 'public',
    occurred_at: '2026-09-02T09:01:00.000Z'
  }, {
    eventStore: store,
    principalActorId: a.entity_id,
    evaluatedAt: '2026-09-02T09:01:00.000Z'
  });

  activateRelationship({
    command_id: 'cmd:foundation-activate',
    idempotency_key: 'idem:foundation-activate',
    principal_id: 'principal:B',
    relationship_id: proposed.relationship_id,
    expected_version: 1,
    occurred_at: '2026-09-02T09:02:00.000Z'
  }, {
    eventStore: store,
    principalActorId: b.entity_id,
    evaluatedAt: '2026-09-02T09:02:00.000Z'
  });

  addEvidence({
    command_id: 'cmd:foundation-evidence',
    idempotency_key: 'idem:foundation-evidence',
    principal_id: 'principal:A',
    relationship_id: proposed.relationship_id,
    expected_version: 2,
    evidence_ref: 'artifact:foundation-proof',
    occurred_at: '2026-09-02T09:03:00.000Z'
  }, {
    eventStore: store,
    principalActorId: a.entity_id,
    evaluatedAt: '2026-09-02T09:03:00.000Z'
  });

  assert.deepEqual(store.verifyHashChain('relationship', proposed.relationship_id), {
    ok: true,
    failureAt: null
  });

  rebuildRelationshipProjection(db, store);
  const before = db.prepare('SELECT * FROM relationships_current ORDER BY relationship_id').all();
  assert.equal(before.length, 1);
  assert.equal(before[0].lifecycle, 'active');
  assert.equal(before[0].evidence_count, 1);
  assert.equal(before[0].created_event_id, store.readStream('relationship', proposed.relationship_id)[0].event_id);
  assert.deepEqual(listPublicRelationships(db, () => 'allow').map(x => x.relationship_id), [proposed.relationship_id]);

  db.exec('DELETE FROM relationships_current');
  rebuildRelationshipProjection(db, store);
  const after = db.prepare('SELECT * FROM relationships_current ORDER BY relationship_id').all();
  assert.deepEqual(after, before);
});

test('event algebra remains relationship-taxonomy agnostic', () => {
  const state = foldRelationship([
    {
      event_id: 'evt:future:1',
      event_type: 'relationship.proposed',
      stream_seq: 1,
      payload: {
        relationship_id: 'rel:future',
        source_entity_id: 'actor:A',
        target_entity_id: 'actor:B',
        relationship_type: 'future_relation_type_v99',
        scope_ref: null,
        taxonomy_ref: 'future-taxonomy:99',
        visibility: 'private',
        visibility_policy_ref: 'future-visibility:99'
      }
    },
    {
      event_id: 'evt:future:2',
      event_type: 'relationship.activated',
      stream_seq: 2,
      payload: {}
    }
  ]);
  assert.equal(state.relationship_type, 'future_relation_type_v99');
  assert.equal(state.lifecycle, 'active');
});

test('credential revocation event cannot erase credential-authorized historical relationship event', () => {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);

  store.append({
    streamType: 'relationship',
    streamId: 'rel:credential-history',
    expectedVersion: 0,
    events: [{
      event_id: 'evt:credential-history:1',
      schema_version: '0.1',
      event_type: 'relationship.proposed',
      actor_id: 'actor:A',
      principal_id: 'principal:A',
      causation_id: 'cmd:credential-history',
      correlation_id: 'corr:credential-history',
      occurred_at: '2026-09-02T09:10:00.000Z',
      recorded_at: '2026-09-02T09:10:00.000Z',
      time_source: 'system',
      provenance_refs: [],
      payload: {
        relationship_id: 'rel:credential-history',
        source_entity_id: 'actor:A',
        target_entity_id: 'actor:B',
        relationship_type: 'follows',
        scope_ref: null,
        taxonomy_ref: 'ai-fb-relations:0.1',
        visibility: 'public',
        visibility_policy_ref: 'visibility-policy:0.1'
      }
    }],
    authorityReceipt: {
      decision_id: 'authz:credential-history',
      principal_id: 'principal:A',
      actor_id: 'actor:A',
      policy_ref: 'policy:test:v1',
      requested_action: 'relationship.propose',
      aggregate_id: 'rel:credential-history',
      credential_refs: ['credential:X'],
      decision: 'allow',
      evaluated_at: '2026-09-02T09:10:00.000Z'
    },
    commandReceipt: {
      command_id: 'cmd:credential-history',
      idempotency_key: 'idem:credential-history',
      command_digest: 'digest:credential-history',
      status: 'accepted',
      created_at: '2026-09-02T09:10:00.000Z'
    }
  });

  store.append({
    streamType: 'authority',
    streamId: 'credential:X',
    expectedVersion: 0,
    events: [{
      event_id: 'evt:credential-X:revoked',
      schema_version: '0.1',
      event_type: 'credential.revoked',
      actor_id: 'actor:A',
      principal_id: 'principal:A',
      causation_id: 'cmd:credential-revoke',
      correlation_id: 'corr:credential-revoke',
      occurred_at: '2026-09-02T09:11:00.000Z',
      recorded_at: '2026-09-02T09:11:00.000Z',
      time_source: 'system',
      provenance_refs: [],
      payload: { credential_ref: 'credential:X' }
    }],
    authorityReceipt: {
      decision_id: 'authz:credential-revoke',
      principal_id: 'principal:A',
      actor_id: 'actor:A',
      policy_ref: 'policy:credential-revoke:v1',
      requested_action: 'credential.revoke',
      aggregate_id: 'credential:X',
      credential_refs: [],
      decision: 'allow',
      evaluated_at: '2026-09-02T09:11:00.000Z'
    },
    commandReceipt: {
      command_id: 'cmd:credential-revoke',
      idempotency_key: 'idem:credential-revoke',
      command_digest: 'digest:credential-revoke',
      status: 'accepted',
      created_at: '2026-09-02T09:11:00.000Z'
    }
  });

  assert.equal(store.readStream('relationship', 'rel:credential-history').length, 1);
  assert.deepEqual(store.verifyHashChain('relationship', 'rel:credential-history'), { ok: true, failureAt: null });
});

test('forbidden authority-bypass APIs are absent from v0.1 surfaces', () => {
  const eventStoreModule = require('../events/sqlite-event-store');
  const entityService = require('../entity/service');
  const bridge = require('../bridge/ai-board-candidate');
  const projector = require('../projections/relationship-projector');

  const prototype = eventStoreModule.SQLiteEventStore.prototype;
  assert.equal(prototype.updateCanonicalEvent, undefined);
  assert.equal(prototype.deleteCanonicalEvent, undefined);
  assert.equal(entityService.mergeActor, undefined);
  assert.equal(entityService.retireActor, undefined);
  assert.equal(bridge.promoteAiBoardCandidate, undefined);
  assert.equal(projector.writeRelationshipProjectionAsTruth, undefined);
});
