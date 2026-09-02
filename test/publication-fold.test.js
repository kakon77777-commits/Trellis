const test = require('node:test');
const assert = require('node:assert/strict');

function created(overrides = {}) {
  return {
    event_id: 'evt:pub-created',
    event_type: 'publication.created',
    stream_seq: 1,
    payload: {
      publication_id: 'pub:1',
      author_actor_id: 'actor:A',
      publication_type: 'post',
      scope_ref: null,
      visibility: 'public',
      audience_actor_ids: [],
      reply_to_ref: null,
      quote_of_ref: null,
      publication_policy_ref: 'trellis-publication-policy:0.1',
      revision_number: 1,
      body: 'hello',
      ...overrides
    }
  };
}

function event(type, seq, payload = {}) {
  return { event_id: `evt:${seq}`, event_type: type, stream_seq: seq, payload };
}

test('fold reconstructs create, revise, withdraw lifecycle', () => {
  const { foldPublication } = require('../publication/fold');
  const state = foldPublication([
    created(),
    event('publication.revision_added', 2, { revision_number: 2, supersedes_revision: 1, body: 'hello v2' }),
    event('publication.withdrawn', 3, { reason: 'author_withdrawn' })
  ]);
  assert.equal(state.lifecycle, 'withdrawn');
  assert.equal(state.current_revision, 2);
  assert.equal(state.current_body, 'hello v2');
  assert.equal(state.stream_version, 3);
  assert.equal(state.author_actor_id, 'actor:A');
});

test('author type scope visibility audience and refs are immutable', () => {
  const { foldPublication } = require('../publication/fold');
  for (const payload of [
    { author_actor_id: 'actor:B' },
    { publication_type: 'note' },
    { scope_ref: 'community:C' },
    { visibility: 'private' },
    { audience_actor_ids: ['actor:B'] },
    { reply_to_ref: 'pub:X' },
    { quote_of_ref: 'pub:Y' }
  ]) {
    assert.throws(() => foldPublication([
      created(),
      event('publication.revision_added', 2, { revision_number: 2, supersedes_revision: 1, body: 'x', ...payload })
    ]), error => error && error.code === 'INVALID_TRANSITION');
  }
});

test('withdrawn publication cannot be revised again', () => {
  const { foldPublication } = require('../publication/fold');
  assert.throws(() => foldPublication([
    created(),
    event('publication.withdrawn', 2),
    event('publication.revision_added', 3, { revision_number: 2, supersedes_revision: 1, body: 'late' })
  ]), error => error && error.code === 'INVALID_TRANSITION');
});

test('second creation on same aggregate is rejected', () => {
  const { foldPublication } = require('../publication/fold');
  assert.throws(() => foldPublication([
    created(),
    { ...created(), event_id: 'evt:pub-created-2', stream_seq: 2 }
  ]), error => error && error.code === 'INVALID_TRANSITION');
});

test('revision sequence must be contiguous and supersede current revision', () => {
  const { foldPublication } = require('../publication/fold');
  assert.throws(() => foldPublication([
    created(),
    event('publication.revision_added', 2, { revision_number: 3, supersedes_revision: 1, body: 'skip' })
  ]), error => error && error.code === 'INVALID_TRANSITION');
  assert.throws(() => foldPublication([
    created(),
    event('publication.revision_added', 2, { revision_number: 2, supersedes_revision: 0, body: 'wrong parent' })
  ]), error => error && error.code === 'INVALID_TRANSITION');
});

test('creation validation forbids reply and quote together', () => {
  const { validatePublicationCreationPayload } = require('../publication/schemas');
  assert.throws(() => validatePublicationCreationPayload(created({
    reply_to_ref: 'pub:P',
    quote_of_ref: 'pub:Q'
  }).payload), /PUBLICATION_REFERENCE_CONFLICT/);
});

test('participants requires sorted unique audience and scope_members requires scope', () => {
  const { validatePublicationCreationPayload } = require('../publication/schemas');
  assert.throws(() => validatePublicationCreationPayload(created({ visibility: 'participants', audience_actor_ids: [] }).payload), /PUBLICATION_PARTICIPANTS_REQUIRED/);
  assert.throws(() => validatePublicationCreationPayload(created({ visibility: 'participants', audience_actor_ids: ['actor:B', 'actor:A'] }).payload), /PUBLICATION_AUDIENCE_NOT_CANONICAL/);
  assert.throws(() => validatePublicationCreationPayload(created({ visibility: 'scope_members', scope_ref: null }).payload), /PUBLICATION_SCOPE_REQUIRED/);
});
