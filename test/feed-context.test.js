const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeFeedSubject } = require('../feed/context');

test('subject can read own personalized Feed', () => {
  assert.deepEqual(
    authorizeFeedSubject('actor:A', { viewer_actor_id: 'actor:A' }),
    { viewer_scope: 'self' }
  );
});

test('representative may read subject Feed without becoming subject', () => {
  assert.deepEqual(
    authorizeFeedSubject('actor:A', {
      viewer_actor_id: 'actor:R',
      represents_actor_ids: ['actor:A']
    }),
    { viewer_scope: 'representative' }
  );
});

test('unrelated viewer cannot read another Actor personalized Feed', () => {
  assert.throws(
    () => authorizeFeedSubject('actor:A', { viewer_actor_id: 'actor:Z' }),
    /FEED_NOT_AUTHORIZED/
  );
});
