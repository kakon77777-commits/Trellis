const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const {
  proposeRelationship,
  activateRelationship,
  addEvidence,
  openContestation,
  resolveContestation,
  addAnnotation
} = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');

function contextFor(eventStore, principalActorId, credentialRefs = []) {
  return {
    eventStore,
    principalActorId,
    credentialRefs,
    evaluatedAt: '2026-09-02T08:10:00.000Z'
  };
}

function buildHistoryFixture({ visibility = 'participants' } = {}) {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db, { now: () => '2026-09-02T08:59:00.000Z' });
  const proposed = proposeRelationship({
    command_id: `cmd:hist:propose:${visibility}`,
    idempotency_key: `idem:hist:propose:${visibility}`,
    principal_id: 'principal:A',
    source_entity_id: 'actor:A',
    target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with',
    visibility,
    occurred_at: '2026-09-02T08:10:00.000Z'
  }, contextFor(store, 'actor:A', ['credential:secret-A']));
  const id = proposed.relationship_id;
  activateRelationship({
    command_id: `cmd:hist:activate:${visibility}`,
    idempotency_key: `idem:hist:activate:${visibility}`,
    principal_id: 'principal:B', relationship_id: id, expected_version: 1,
    occurred_at: '2026-09-02T08:11:00.000Z'
  }, contextFor(store, 'actor:B', ['credential:secret-B']));
  addEvidence({
    command_id: `cmd:hist:evidence:${visibility}`,
    idempotency_key: `idem:hist:evidence:${visibility}`,
    principal_id: 'principal:A', relationship_id: id, expected_version: 2,
    evidence_ref: 'artifact:X', occurred_at: '2026-09-02T08:12:00.000Z'
  }, contextFor(store, 'actor:A'));
  openContestation({
    command_id: `cmd:hist:contest-open:${visibility}`,
    idempotency_key: `idem:hist:contest-open:${visibility}`,
    principal_id: 'principal:B', relationship_id: id, expected_version: 3,
    contestation_id: 'contest:C1', claim: 'scope disputed', evidence_refs: ['artifact:Y'],
    occurred_at: '2026-09-02T08:13:00.000Z'
  }, contextFor(store, 'actor:B'));
  resolveContestation({
    command_id: `cmd:hist:contest-resolve:${visibility}`,
    idempotency_key: `idem:hist:contest-resolve:${visibility}`,
    principal_id: 'principal:A', relationship_id: id, expected_version: 4,
    contestation_id: 'contest:C1', resolution: 'dismissed', evidence_refs: ['artifact:Z'],
    occurred_at: '2026-09-02T08:14:00.000Z'
  }, contextFor(store, 'actor:A'));
  addAnnotation({
    command_id: `cmd:hist:annotation:${visibility}`,
    idempotency_key: `idem:hist:annotation:${visibility}`,
    principal_id: 'principal:B', relationship_id: id, expected_version: 5,
    note: 'historical note', occurred_at: '2026-09-02T08:15:00.000Z'
  }, contextFor(store, 'actor:B'));
  rebuildRelationshipProjection(db, store);
  return { db, store, relationshipId: id };
}

test('visible detail safely projects evidence contestation annotation and authority summaries', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = buildHistoryFixture();
  const detail = loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:A' },
    eventStore: fx.store,
    db: fx.db
  });

  assert.equal(detail.history.length, 6);
  assert.deepEqual(detail.evidence.map(x => x.evidence_ref), ['artifact:X']);
  assert.equal(detail.contestations.length, 1);
  assert.equal(detail.contestations[0].status, 'resolved');
  assert.equal(detail.contestations[0].resolution, 'dismissed');
  assert.deepEqual(detail.contestations[0].open_evidence_refs, ['artifact:Y']);
  assert.deepEqual(detail.contestations[0].resolution_evidence_refs, ['artifact:Z']);
  assert.deepEqual(detail.annotations.map(x => x.note), ['historical note']);

  const proposal = detail.history[0];
  assert.equal(proposal.event_id.startsWith('evt:'), true);
  assert.equal(proposal.occurred_at, '2026-09-02T08:10:00.000Z');
  assert.equal(proposal.recorded_at, '2026-09-02T08:59:00.000Z');
  assert.equal(proposal.authority.decision, 'allow');
  assert.equal(typeof proposal.authority.policy_ref, 'string');

  const serialized = JSON.stringify(detail);
  assert.equal(serialized.includes('credential:secret-A'), false);
  assert.equal(serialized.includes('credential:secret-B'), false);
  assert.equal(serialized.includes('credential_refs'), false);
  assert.equal(serialized.includes('receipt_json'), false);
});

test('contestation history is orthogonal to relationship lifecycle', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = buildHistoryFixture();
  const detail = loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:B' },
    eventStore: fx.store,
    db: fx.db
  });
  assert.equal(detail.lifecycle, 'active');
  assert.equal(detail.contestations[0].status, 'resolved');
});

test('unreadable relationship short-circuits before canonical stream read', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const fx = buildHistoryFixture();
  let reads = 0;
  const countingStore = {
    readStream(...args) {
      reads += 1;
      return fx.store.readStream(...args);
    }
  };
  const detail = loadRelationshipDetail({
    relationshipId: fx.relationshipId,
    viewerContext: { viewer_actor_id: 'actor:C' },
    eventStore: countingStore,
    db: fx.db
  });
  assert.equal(detail, null);
  assert.equal(reads, 0);
});
