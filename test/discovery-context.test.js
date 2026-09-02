const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeDiscoverySubject, viewerIdentityKey } = require('../discovery/context');

test('subject can request own discovery', () => {
  assert.deepEqual(
    authorizeDiscoverySubject('actor:A', { viewer_actor_id: 'actor:A' }),
    { viewer_scope: 'self' }
  );
});

test('representative can read subject discovery without becoming subject', () => {
  assert.deepEqual(
    authorizeDiscoverySubject('actor:A', {
      viewer_actor_id: 'actor:R',
      represents_actor_ids: ['actor:A']
    }),
    { viewer_scope: 'representative' }
  );
});

test('unrelated viewer cannot request personalized discovery for public actor', () => {
  assert.throws(
    () => authorizeDiscoverySubject('actor:A', { viewer_actor_id: 'actor:Z' }),
    /DISCOVERY_NOT_AUTHORIZED/
  );
});

test('viewer identity key is stable and order-insensitive for represented actors', () => {
  const a = viewerIdentityKey({ viewer_actor_id: 'actor:R', represents_actor_ids: ['actor:B', 'actor:A'] });
  const b = viewerIdentityKey({ viewer_actor_id: 'actor:R', represents_actor_ids: ['actor:A', 'actor:B'] });
  assert.equal(a, b);
});
