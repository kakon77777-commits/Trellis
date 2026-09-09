const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { loadRpSigningKey, RP_KEY_ID, RELYING_PARTY_ID } = require('../ailp/keys');
const { verifyDocumentSignature, AILPError } = require('../ailp/canonical');

function throwawayPrivateJwk() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return JSON.stringify(privateKey.export({ format: 'jwk' }));
}

test('loadRpSigningKey throws a clear error when the secret is absent (never falls back to a default key)', () => {
  assert.throws(() => loadRpSigningKey({}), /AILP_RP_PRIVATE_KEY_JWK_MISSING/);
  assert.throws(() => loadRpSigningKey(undefined), /AILP_RP_PRIVATE_KEY_JWK_MISSING/);
});

test('loadRpSigningKey derives a public JWK with no private "d" leaked into it', () => {
  const key = loadRpSigningKey({ AILP_RP_PRIVATE_KEY_JWK: throwawayPrivateJwk() });
  assert.equal(key.publicJwk.kty, 'OKP');
  assert.equal(key.publicJwk.crv, 'Ed25519');
  assert.equal(typeof key.publicJwk.x, 'string');
  assert.equal(key.publicJwk.d, undefined);
  assert.equal(key.keyId, RP_KEY_ID);
  assert.equal(key.relyingPartyId, RELYING_PARTY_ID);
});

test('key.sign() produces a document that verifies against key.publicJwk (round trip through this module only)', () => {
  const key = loadRpSigningKey({ AILP_RP_PRIVATE_KEY_JWK: throwawayPrivateJwk() });
  const signed = key.sign({ schema_version: 'ailp/0.1', object_type: 'session_grant', session_id: 'session:test:1' });
  verifyDocumentSignature(signed, key.publicJwk, { expectedKeyId: RP_KEY_ID });
});

test('a document signed by one RP key does not verify against a different RP key (sanity: this is not a no-op)', () => {
  const keyA = loadRpSigningKey({ AILP_RP_PRIVATE_KEY_JWK: throwawayPrivateJwk() });
  const keyB = loadRpSigningKey({ AILP_RP_PRIVATE_KEY_JWK: throwawayPrivateJwk() });
  const signed = keyA.sign({ schema_version: 'ailp/0.1', object_type: 'session_grant', session_id: 'session:test:2' });
  assert.throws(
    () => verifyDocumentSignature(signed, keyB.publicJwk, { expectedKeyId: RP_KEY_ID }),
    (e) => e instanceof AILPError && e.code === 'SIGNATURE_INVALID'
  );
});
