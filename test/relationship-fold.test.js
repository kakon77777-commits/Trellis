const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/relationship-lifecycle.json');

function proposal(overrides = {}) {
  return {
    event_id: 'evt:p',
    event_type: 'relationship.proposed',
    stream_seq: 1,
    payload: {
      relationship_id: 'rel:1',
      source_entity_id: 'actor:A',
      target_entity_id: 'actor:B',
      relationship_type: 'collaborates_with',
      scope_ref: 'project:X',
      taxonomy_ref: 'ai-fb-relations:0.1',
      visibility: 'participants',
      visibility_policy_ref: 'visibility-policy:0.1',
      ...overrides
    }
  };
}

function event(type, seq, payload = {}) {
  return { event_id: `evt:${seq}`, event_type: type, stream_seq: seq, payload };
}

test('fold reconstructs the canonical lifecycle vector', () => {
  const { foldRelationship } = require('../relationship/fold');
  const state = foldRelationship(fixture.events);
  for (const [key, expected] of Object.entries(fixture.expected)) {
    assert.deepEqual(state[key], expected);
  }
  assert.equal(state.relationship_type, 'collaborates_with');
  assert.equal(state.scope_ref, 'project:X');
  assert.equal(state.visibility, 'participants');
});

test('terminated relationship cannot reactivate', () => {
  const { foldRelationship } = require('../relationship/fold');
  assert.throws(() => foldRelationship([
    proposal(),
    event('relationship.activated', 2),
    event('relationship.terminated', 3, { reason: 'revoked' }),
    event('relationship.activated', 4)
  ]), error => error && error.code === 'INVALID_TRANSITION');
});

test('second proposal on one aggregate is rejected', () => {
  const { foldRelationship } = require('../relationship/fold');
  assert.throws(() => foldRelationship([
    proposal(),
    { ...proposal(), event_id: 'evt:p2', stream_seq: 2 }
  ]), error => error && error.code === 'INVALID_TRANSITION');
});

test('evidence and contestation are orthogonal to lifecycle', () => {
  const { foldRelationship } = require('../relationship/fold');
  const state = foldRelationship([
    proposal(),
    event('relationship.activated', 2),
    event('relationship.evidence_added', 3, { evidence_ref: 'artifact:1' }),
    event('relationship.contestation_opened', 4, { contestation_id: 'contest:1' })
  ]);
  assert.equal(state.lifecycle, 'active');
  assert.equal(state.evidence_count, 1);
  assert.equal(state.open_contestation_count, 1);
});

test('relationship type is immutable after proposal', () => {
  const { foldRelationship } = require('../relationship/fold');
  assert.throws(() => foldRelationship([
    proposal(),
    event('relationship.activated', 2, { relationship_type: 'mentors' })
  ]), error => error && error.code === 'INVALID_TRANSITION');
});

test('scope_ref is immutable after proposal', () => {
  const { foldRelationship } = require('../relationship/fold');
  assert.throws(() => foldRelationship([
    proposal(),
    event('relationship.activated', 2, { scope_ref: 'project:Y' })
  ]), error => error && error.code === 'INVALID_TRANSITION');
});

test('visibility is immutable after proposal', () => {
  const { foldRelationship } = require('../relationship/fold');
  assert.throws(() => foldRelationship([
    proposal(),
    event('relationship.activated', 2, { visibility: 'public' })
  ]), error => error && error.code === 'INVALID_TRANSITION');
});
