const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  canonicalJson,
  verifyDocumentSignature,
  digestDocument,
  AILPError
} = require('../ailp/canonical');

// Cross-language conformance gate (mssp-tdd-apr Structural closure requirement
// for AILP v0.1 Trellis integration): this fixture is CTCL-ITR's own signed
// examples/ailp_reference_scenario.json (v0.2.17, commit da9fa19), produced and
// signed entirely by the Python reference implementation. Every check below
// re-derives canonical bytes / digests / Ed25519 verification independently in
// this JS implementation. A pass here proves Python AILP semantics == Trellis
// JS semantics for the vertical-slice subset, not merely "looks similar".
const fixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'ailp_reference_scenario.json'), 'utf8')
);

test('identity_root verifies against its own continuity key', () => {
  verifyDocumentSignature(fixture.identity_root, fixture.identity_root.continuity_verification_methods[0].public_jwk);
});

test('runtime_certificate verifies against the identity operational key', () => {
  verifyDocumentSignature(fixture.runtime_certificate, fixture.identity_root.operational_verification_methods[0].public_jwk);
});

test('login_proof verifies against the runtime key', () => {
  verifyDocumentSignature(fixture.login_proof, fixture.runtime_certificate.runtime_verification_method.public_jwk);
});

for (const name of ['authentication_receipt', 'recognition_receipt', 'actor_binding_receipt', 'session_grant']) {
  test(`${name} verifies against the relying-party key`, () => {
    verifyDocumentSignature(fixture[name], fixture.relying_party_verification_method.public_jwk);
  });
}

test('digest cross-references inside the fixture are self-consistent (no Python needed at test time)', () => {
  const authDigest = digestDocument(fixture.authentication_receipt);
  assert.equal(fixture.actor_binding_receipt.authentication_receipt_ref, authDigest);
  assert.equal(fixture.recognition_receipt.authentication_receipt_ref, authDigest);
  assert.equal(fixture.session_grant.authentication_receipt_ref, authDigest);

  const recognitionDigest = digestDocument(fixture.recognition_receipt);
  assert.equal(fixture.actor_binding_receipt.recognition_receipt_ref, recognitionDigest);
  assert.equal(fixture.session_grant.recognition_receipt_ref, recognitionDigest);

  const runtimeCertDigest = digestDocument(fixture.runtime_certificate);
  assert.equal(fixture.authentication_receipt.runtime_certificate_digest, runtimeCertDigest);
  assert.equal(fixture.challenge_request.runtime_certificate_digest, runtimeCertDigest);
});

test('tampered field is rejected: SIGNATURE_INVALID, not silently accepted', () => {
  const tampered = JSON.parse(JSON.stringify(fixture.authentication_receipt));
  tampered.audience = 'not-trellis';
  assert.throws(
    () => verifyDocumentSignature(tampered, fixture.relying_party_verification_method.public_jwk),
    (err) => err instanceof AILPError && err.code === 'SIGNATURE_INVALID'
  );
});

test('wrong verification method is rejected: SIGNATURE_INVALID, not a crash', () => {
  assert.throws(
    () => verifyDocumentSignature(fixture.authentication_receipt, fixture.runtime_certificate.runtime_verification_method.public_jwk),
    (err) => err instanceof AILPError && err.code === 'SIGNATURE_INVALID'
  );
});

test('missing signature is rejected: SIGNATURE_MISSING', () => {
  const unsigned = { ...fixture.authentication_receipt };
  delete unsigned.signature;
  assert.throws(
    () => verifyDocumentSignature(unsigned, fixture.relying_party_verification_method.public_jwk),
    (err) => err instanceof AILPError && err.code === 'SIGNATURE_MISSING'
  );
});

test('canonical_json rejects a float (AILP domain is integers only, matching the Python reference)', () => {
  assert.throws(() => canonicalJson({ n: 1.5 }), (err) => err instanceof AILPError && err.code === 'UNSUPPORTED_CANONICAL_JSON');
});

test('canonical_json rejects a non-ASCII key', () => {
  assert.throws(() => canonicalJson({ 版本: 1 }), (err) => err instanceof AILPError && err.code === 'UNSUPPORTED_CANONICAL_JSON');
});

test('canonical_json sorts keys and uses compact separators', () => {
  const bytes = canonicalJson({ b: 1, a: 2, c: { z: 1, y: 2 } });
  assert.equal(bytes.toString('utf8'), '{"a":2,"b":1,"c":{"y":2,"z":1}}');
});

test('canonical_json preserves non-ASCII string values verbatim (only keys are ASCII-constrained)', () => {
  const bytes = canonicalJson({ a: 'Trellis 中文' });
  assert.equal(bytes.toString('utf8'), '{"a":"Trellis 中文"}');
});
