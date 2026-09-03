const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveReactionId, REACTION_POLICY_REF } = require('../reaction/types');
const { foldReaction } = require('../reaction/fold');

function event(event_type, stream_seq, payload = {}) {
  return { event_id: `evt:${stream_seq}`, event_type, stream_seq, payload };
}

const created = event('reaction.created', 1, {
  reaction_id: deriveReactionId('actor:B', 'pub:P'),
  actor_id: 'actor:B',
  publication_id: 'pub:P',
  scope_ref: 'community:C',
  visibility: 'participants',
  audience_actor_ids: ['actor:B','actor:C'],
  reaction_policy_ref: REACTION_POLICY_REF,
  reaction_type: 'like'
});

test('reaction ID is deterministic per actor-publication pair', () => {
  assert.equal(deriveReactionId('actor:B', 'pub:P'), deriveReactionId('actor:B', 'pub:P'));
  assert.notEqual(deriveReactionId('actor:B', 'pub:P'), deriveReactionId('actor:C', 'pub:P'));
  assert.notEqual(deriveReactionId('actor:B', 'pub:P'), deriveReactionId('actor:B', 'pub:Q'));
});

test('created reaction becomes active with immutable identity and current type', () => {
  const state = foldReaction([created]);
  assert.equal(state.lifecycle, 'active');
  assert.equal(state.reaction_type, 'like');
  assert.equal(state.actor_id, 'actor:B');
  assert.equal(state.publication_id, 'pub:P');
  assert.equal(state.scope_ref, 'community:C');
  assert.equal(state.visibility, 'participants');
  assert.deepEqual(state.audience_actor_ids, ['actor:B','actor:C']);
  assert.equal(state.stream_version, 1);
});

test('reaction type changes append within same active aggregate', () => {
  const state = foldReaction([created, event('reaction.changed', 2, { reaction_type: 'love' })]);
  assert.equal(state.lifecycle, 'active');
  assert.equal(state.reaction_type, 'love');
  assert.equal(state.reaction_id, created.payload.reaction_id);
});

test('withdraw clears current type and preserves aggregate identity', () => {
  const state = foldReaction([created, event('reaction.withdrawn', 2, { reason: 'actor_withdrawn' })]);
  assert.equal(state.lifecycle, 'withdrawn');
  assert.equal(state.reaction_type, null);
  assert.equal(state.reaction_id, created.payload.reaction_id);
});

test('restore reactivates same aggregate with explicitly supplied type', () => {
  const state = foldReaction([
    created,
    event('reaction.withdrawn', 2, {}),
    event('reaction.restored', 3, { reaction_type: 'insightful' })
  ]);
  assert.equal(state.lifecycle, 'active');
  assert.equal(state.reaction_type, 'insightful');
  assert.equal(state.reaction_id, created.payload.reaction_id);
});

test('invalid lifecycle transitions are rejected', () => {
  assert.throws(() => foldReaction([created, event('reaction.created', 2, created.payload)]), /REACTION_ALREADY_CREATED/);
  assert.throws(() => foldReaction([created, event('reaction.withdrawn', 2), event('reaction.changed', 3, { reaction_type: 'love' })]), /REACTION_CANNOT_CHANGE/);
  assert.throws(() => foldReaction([created, event('reaction.withdrawn', 2), event('reaction.withdrawn', 3)]), /REACTION_CANNOT_WITHDRAW/);
  assert.throws(() => foldReaction([created, event('reaction.restored', 2, { reaction_type: 'love' })]), /REACTION_CANNOT_RESTORE/);
});

test('immutable identity and audience fields cannot change after creation', () => {
  for (const [field, value] of [
    ['actor_id', 'actor:C'], ['publication_id', 'pub:Q'], ['scope_ref', 'community:D'],
    ['visibility', 'public'], ['audience_actor_ids', ['actor:B']], ['reaction_policy_ref', 'other']
  ]) {
    assert.throws(
      () => foldReaction([created, event('reaction.changed', 2, { reaction_type: 'love', [field]: value })]),
      new RegExp(`REACTION_IMMUTABLE_FIELD_CHANGED:${field}`)
    );
  }
});

test('unknown event and invalid reaction type are rejected', () => {
  assert.throws(() => foldReaction([created, event('reaction.unknown', 2)]), /UNKNOWN_REACTION_EVENT/);
  assert.throws(() => foldReaction([event('reaction.created', 1, { ...created.payload, reaction_type: 'bookmark' })]), /REACTION_TYPE_INVALID/);
});
