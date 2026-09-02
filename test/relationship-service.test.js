const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { foldRelationship } = require('../relationship/fold');

function contextFor(eventStore, principalActorId) {
  return {
    eventStore,
    principalActorId,
    evaluatedAt: '2026-09-02T07:30:00.000Z'
  };
}

function proposalCommand(overrides = {}) {
  return {
    command_id: 'cmd:rel-propose',
    idempotency_key: 'idem:rel-propose',
    principal_id: 'principal:A',
    source_entity_id: 'actor:A',
    target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with',
    scope_ref: 'project:X',
    occurred_at: '2026-09-02T07:30:00.000Z',
    ...overrides
  };
}

test('unilateral follows proposal atomically becomes active', () => {
  const { proposeRelationship } = require('../relationship/service');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);

  const result = proposeRelationship(proposalCommand({
    command_id: 'cmd:follow',
    idempotency_key: 'idem:follow',
    relationship_type: 'follows',
    scope_ref: null
  }), contextFor(store, 'actor:A'));

  const events = store.readStream('relationship', result.relationship_id);
  assert.deepEqual(events.map(x => x.event_type), [
    'relationship.proposed',
    'relationship.activated'
  ]);
  assert.equal(foldRelationship(events).lifecycle, 'active');
});

test('bilateral collaboration remains proposed until target-authorized activation', () => {
  const { proposeRelationship, activateRelationship } = require('../relationship/service');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);

  const proposed = proposeRelationship(proposalCommand(), contextFor(store, 'actor:A'));
  let state = foldRelationship(store.readStream('relationship', proposed.relationship_id));
  assert.equal(state.lifecycle, 'proposed');
  assert.equal(state.visibility, 'participants');
  assert.equal(state.scope_ref, 'project:X');

  assert.throws(() => activateRelationship({
    command_id: 'cmd:activate-wrong',
    idempotency_key: 'idem:activate-wrong',
    principal_id: 'principal:A',
    relationship_id: proposed.relationship_id,
    expected_version: 1,
    occurred_at: '2026-09-02T07:31:00.000Z'
  }, contextFor(store, 'actor:A')), error => error && error.code === 'POLICY_DENIED');

  activateRelationship({
    command_id: 'cmd:activate-right',
    idempotency_key: 'idem:activate-right',
    principal_id: 'principal:B',
    relationship_id: proposed.relationship_id,
    expected_version: 1,
    occurred_at: '2026-09-02T07:32:00.000Z'
  }, contextFor(store, 'actor:B'));

  state = foldRelationship(store.readStream('relationship', proposed.relationship_id));
  assert.equal(state.lifecycle, 'active');
  assert.equal(state.visibility, 'participants');
});

test('proposal visibility override is resolved once and persisted', () => {
  const { proposeRelationship } = require('../relationship/service');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);

  const result = proposeRelationship(proposalCommand({ visibility: 'private' }), contextFor(store, 'actor:A'));
  const state = foldRelationship(store.readStream('relationship', result.relationship_id));
  assert.equal(state.visibility, 'private');
});

test('participant commands append evidence contestation annotation and termination events', () => {
  const {
    proposeRelationship,
    activateRelationship,
    addEvidence,
    openContestation,
    resolveContestation,
    addAnnotation,
    terminateRelationship
  } = require('../relationship/service');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  const proposed = proposeRelationship(proposalCommand(), contextFor(store, 'actor:A'));

  activateRelationship({
    command_id: 'cmd:lifecycle-activate',
    idempotency_key: 'idem:lifecycle-activate',
    principal_id: 'principal:B',
    relationship_id: proposed.relationship_id,
    expected_version: 1,
    occurred_at: '2026-09-02T07:40:00.000Z'
  }, contextFor(store, 'actor:B'));

  addEvidence({
    command_id: 'cmd:lifecycle-evidence',
    idempotency_key: 'idem:lifecycle-evidence',
    principal_id: 'principal:A',
    relationship_id: proposed.relationship_id,
    expected_version: 2,
    evidence_ref: 'artifact:X',
    occurred_at: '2026-09-02T07:41:00.000Z'
  }, contextFor(store, 'actor:A'));

  openContestation({
    command_id: 'cmd:lifecycle-contest-open',
    idempotency_key: 'idem:lifecycle-contest-open',
    principal_id: 'principal:B',
    relationship_id: proposed.relationship_id,
    expected_version: 3,
    contestation_id: 'contest:C1',
    claim: 'scope disputed',
    occurred_at: '2026-09-02T07:42:00.000Z'
  }, contextFor(store, 'actor:B'));

  resolveContestation({
    command_id: 'cmd:lifecycle-contest-resolve',
    idempotency_key: 'idem:lifecycle-contest-resolve',
    principal_id: 'principal:A',
    relationship_id: proposed.relationship_id,
    expected_version: 4,
    contestation_id: 'contest:C1',
    resolution: 'dismissed',
    occurred_at: '2026-09-02T07:43:00.000Z'
  }, contextFor(store, 'actor:A'));

  addAnnotation({
    command_id: 'cmd:lifecycle-annotation',
    idempotency_key: 'idem:lifecycle-annotation',
    principal_id: 'principal:B',
    relationship_id: proposed.relationship_id,
    expected_version: 5,
    note: 'historical note',
    occurred_at: '2026-09-02T07:44:00.000Z'
  }, contextFor(store, 'actor:B'));

  terminateRelationship({
    command_id: 'cmd:lifecycle-terminate',
    idempotency_key: 'idem:lifecycle-terminate',
    principal_id: 'principal:A',
    relationship_id: proposed.relationship_id,
    expected_version: 6,
    reason: 'revoked',
    occurred_at: '2026-09-02T07:45:00.000Z'
  }, contextFor(store, 'actor:A'));

  const state = foldRelationship(store.readStream('relationship', proposed.relationship_id));
  assert.equal(state.lifecycle, 'terminated');
  assert.equal(state.termination_reason, 'revoked');
  assert.equal(state.evidence_count, 1);
  assert.equal(state.annotation_count, 1);
  assert.equal(state.open_contestation_count, 0);
  assert.equal(state.stream_version, 7);
});

test('nonparticipant cannot add relationship evidence', () => {
  const { proposeRelationship, addEvidence } = require('../relationship/service');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  const proposed = proposeRelationship(proposalCommand(), contextFor(store, 'actor:A'));

  assert.throws(() => addEvidence({
    command_id: 'cmd:evidence-denied',
    idempotency_key: 'idem:evidence-denied',
    principal_id: 'principal:C',
    relationship_id: proposed.relationship_id,
    expected_version: 1,
    evidence_ref: 'artifact:bad',
    occurred_at: '2026-09-02T07:46:00.000Z'
  }, contextFor(store, 'actor:C')), error => error && error.code === 'POLICY_DENIED');

  assert.equal(store.readStream('relationship', proposed.relationship_id).length, 1);
});

test('successful relationship activation retry is deduplicated even though lifecycle is already active', () => {
  const { proposeRelationship, activateRelationship } = require('../relationship/service');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  const proposed = proposeRelationship(proposalCommand(), contextFor(store, 'actor:A'));
  const command = {
    command_id: 'cmd:activate-retry',
    idempotency_key: 'idem:activate-retry',
    principal_id: 'principal:B',
    relationship_id: proposed.relationship_id,
    expected_version: 1,
    occurred_at: '2026-09-02T07:50:00.000Z'
  };

  const first = activateRelationship(command, contextFor(store, 'actor:B'));
  const countBefore = store.readStream('relationship', proposed.relationship_id).length;
  const second = activateRelationship(command, contextFor(store, 'actor:B'));
  const countAfter = store.readStream('relationship', proposed.relationship_id).length;

  assert.equal(second.relationship_id, first.relationship_id);
  assert.equal(second.receipt.deduplicated, true);
  assert.equal(countAfter, countBefore);
});
