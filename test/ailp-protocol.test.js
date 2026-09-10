const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { AILPError } = require('../ailp/canonical');
const {
  verifyRuntimeCertificate,
  verifyLoginProof,
  issueAuthenticationReceipt,
  issueRecognitionReceipt,
  issueActorBindingReceipt,
  issueSessionGrant,
  deriveAuthenticatedRequestContext,
  verifyRequestProof
} = require('../ailp/protocol');

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'ailp_reference_scenario.json'), 'utf8')
);
const AT = fixture.validation_time; // 2026-09-09T09:01:00Z, inside every window in the fixture

test('verifyRuntimeCertificate accepts the fixture certificate at a valid instant', () => {
  const result = verifyRuntimeCertificate(fixture.runtime_certificate, fixture.identity_root.operational_verification_methods[0].public_jwk, { at: AT });
  assert.equal(result.valid, true);
  assert.equal(result.runtimeId, 'runtime:reference:1');
});

test('verifyRuntimeCertificate rejects an expired certificate', () => {
  assert.throws(
    () => verifyRuntimeCertificate(fixture.runtime_certificate, fixture.identity_root.operational_verification_methods[0].public_jwk, { at: '2026-09-09T10:00:00Z' }),
    (e) => e instanceof AILPError && e.code === 'RUNTIME_CERTIFICATE_EXPIRED'
  );
});

test('verifyLoginProof accepts the full fixture chain end to end', () => {
  const result = verifyLoginProof({
    challenge: fixture.challenge,
    challengeRequest: fixture.challenge_request,
    proof: fixture.login_proof,
    runtimeCertificate: fixture.runtime_certificate,
    operationalPublicJwk: fixture.identity_root.operational_verification_methods[0].public_jwk,
    at: AT,
    expectedOrigin: 'https://trellis.aispaces.app',
    expectedAudience: 'trellis'
  });
  assert.equal(result.valid, true);
  assert.equal(result.aiIdentityId, 'ai:reference');
  assert.equal(result.requestedActorId, 'actor:reference');
});

test('AILP-H2: verifyLoginProof rejects a proof claiming to have been created long before the challenge was even issued', () => {
  const tamperedProof = { ...fixture.login_proof, created_at: '2026-09-09T08:00:00Z' };
  assert.throws(
    () => verifyLoginProof({
      challenge: fixture.challenge, challengeRequest: fixture.challenge_request, proof: tamperedProof,
      runtimeCertificate: fixture.runtime_certificate,
      operationalPublicJwk: fixture.identity_root.operational_verification_methods[0].public_jwk,
      at: AT, expectedOrigin: 'https://trellis.aispaces.app', expectedAudience: 'trellis'
    }),
    (e) => e instanceof AILPError && e.code === 'LOGIN_PROOF_CREATED_AT_BEFORE_CHALLENGE_ISSUED'
  );
});

test('AILP-H2: verifyLoginProof rejects a proof claiming to have been created in the future (a valid runtime key must not be able to make the signed audit time lie)', () => {
  const tamperedProof = { ...fixture.login_proof, created_at: '2026-09-09T10:00:00Z' };
  assert.throws(
    () => verifyLoginProof({
      challenge: fixture.challenge, challengeRequest: fixture.challenge_request, proof: tamperedProof,
      runtimeCertificate: fixture.runtime_certificate,
      operationalPublicJwk: fixture.identity_root.operational_verification_methods[0].public_jwk,
      at: AT, expectedOrigin: 'https://trellis.aispaces.app', expectedAudience: 'trellis'
    }),
    (e) => e instanceof AILPError && e.code === 'LOGIN_PROOF_CREATED_AT_IN_FUTURE'
  );
});

test('verifyLoginProof rejects a wrong origin (cross-origin session binding, Sol requirement)', () => {
  assert.throws(
    () => verifyLoginProof({
      challenge: fixture.challenge,
      challengeRequest: fixture.challenge_request,
      proof: fixture.login_proof,
      runtimeCertificate: fixture.runtime_certificate,
      operationalPublicJwk: fixture.identity_root.operational_verification_methods[0].public_jwk,
      at: AT,
      expectedOrigin: 'https://trellis.eveaispace.com',
      expectedAudience: 'trellis'
    }),
    (e) => e instanceof AILPError && e.code === 'CHALLENGE_ORIGIN_MISMATCH'
  );
});

test('verifyLoginProof rejects a wrong audience (a proof scoped to a different relying party is not valid here)', () => {
  assert.throws(
    () => verifyLoginProof({
      challenge: fixture.challenge,
      challengeRequest: fixture.challenge_request,
      proof: fixture.login_proof,
      runtimeCertificate: fixture.runtime_certificate,
      operationalPublicJwk: fixture.identity_root.operational_verification_methods[0].public_jwk,
      at: AT,
      expectedOrigin: 'https://trellis.aispaces.app',
      expectedAudience: 'some-other-relying-party'
    }),
    (e) => e instanceof AILPError && e.code === 'CHALLENGE_AUDIENCE_MISMATCH'
  );
});

test('verifyLoginProof rejects a challenge-request Actor substitution', () => {
  const tamperedRequest = { ...fixture.challenge_request, requested_actor_id: 'actor:attacker' };
  assert.throws(
    () => verifyLoginProof({
      challenge: fixture.challenge,
      challengeRequest: tamperedRequest,
      proof: fixture.login_proof,
      runtimeCertificate: fixture.runtime_certificate,
      operationalPublicJwk: fixture.identity_root.operational_verification_methods[0].public_jwk,
      at: AT,
      expectedOrigin: 'https://trellis.aispaces.app',
      expectedAudience: 'trellis'
    }),
    (e) => e instanceof AILPError && e.code === 'CHALLENGE_REQUEST_DIGEST_MISMATCH'
  );
});

test('issueAuthenticationReceipt / issueRecognitionReceipt / issueActorBindingReceipt / issueSessionGrant accept the fixture\'s own field shapes', () => {
  const auth = issueAuthenticationReceipt({ ...fixture.authentication_receipt, signature: undefined });
  assert.equal(auth.object_type, 'authentication_receipt');
  const recognition = issueRecognitionReceipt({ ...fixture.recognition_receipt, signature: undefined });
  assert.equal(recognition.object_type, 'recognition_receipt');
  const binding = issueActorBindingReceipt({ ...fixture.actor_binding_receipt, signature: undefined });
  assert.equal(binding.object_type, 'actor_binding_receipt');
  const session = issueSessionGrant({ ...fixture.session_grant, signature: undefined });
  assert.equal(session.object_type, 'session_grant');
});

test('deriveAuthenticatedRequestContext produces the exact shape from the implementation contract for an actor-bound session', () => {
  const ctx = deriveAuthenticatedRequestContext({
    authenticationReceipt: fixture.authentication_receipt,
    recognitionReceipt: fixture.recognition_receipt,
    actorBindingReceipt: fixture.actor_binding_receipt,
    sessionGrant: fixture.session_grant
  });
  assert.equal(ctx.principal.principal_id, 'principal:ailp-session:session:reference:1');
  assert.equal(ctx.principal.principal_actor_id, 'actor:reference');
  assert.deepEqual(ctx.viewerContext, { viewer_actor_id: 'actor:reference', represents_actor_ids: [] });
  assert.equal(ctx.credentialRefs.length, 4);
});

test('deriveAuthenticatedRequestContext for an identity_only session never carries an actor identity (principal_actor_id stays null, viewerContext stays {})', () => {
  const identityOnlySessionGrant = { ...fixture.session_grant, session_class: 'identity_only', actor_id: null, actor_binding_receipt_ref: null };
  const ctx = deriveAuthenticatedRequestContext({
    authenticationReceipt: fixture.authentication_receipt,
    recognitionReceipt: fixture.recognition_receipt,
    actorBindingReceipt: null,
    sessionGrant: identityOnlySessionGrant
  });
  assert.equal(ctx.principal.principal_actor_id, null);
  assert.deepEqual(ctx.viewerContext, {});
  assert.equal(ctx.actorBinding, null);
  // Authority's own principal_actor_id === author_actor_id check (unmodified
  // by AILP) therefore denies ANY actor-owned write for this context: null
  // can never equal a real actor id.
});

test('deriveAuthenticatedRequestContext throws ACTOR_BINDING_NOT_ACTIVE for an actor_bound session with no active binding (never silently downgrades to anonymous)', () => {
  assert.throws(
    () => deriveAuthenticatedRequestContext({
      authenticationReceipt: fixture.authentication_receipt,
      recognitionReceipt: fixture.recognition_receipt,
      actorBindingReceipt: null,
      sessionGrant: fixture.session_grant
    }),
    (e) => e instanceof AILPError && e.code === 'ACTOR_BINDING_NOT_ACTIVE'
  );
});

test('deriveAuthenticatedRequestContext throws ACTOR_BINDING_CONTEXT_MISMATCH when session actor and binding actor disagree (session A cannot ride binding for actor B)', () => {
  const wrongBinding = { ...fixture.actor_binding_receipt, actor_id: 'actor:someone-else' };
  assert.throws(
    () => deriveAuthenticatedRequestContext({
      authenticationReceipt: fixture.authentication_receipt,
      recognitionReceipt: fixture.recognition_receipt,
      actorBindingReceipt: wrongBinding,
      sessionGrant: fixture.session_grant
    }),
    (e) => e instanceof AILPError && e.code === 'ACTOR_BINDING_CONTEXT_MISMATCH'
  );
});

test('deriveAuthenticatedRequestContext throws SESSION_NOT_ACTIVE for a revoked session (revocation actually stops derivation)', () => {
  const revoked = { ...fixture.session_grant, state: 'revoked' };
  assert.throws(
    () => deriveAuthenticatedRequestContext({
      authenticationReceipt: fixture.authentication_receipt,
      recognitionReceipt: fixture.recognition_receipt,
      actorBindingReceipt: fixture.actor_binding_receipt,
      sessionGrant: revoked
    }),
    (e) => e instanceof AILPError && e.code === 'SESSION_NOT_ACTIVE'
  );
});

test('verifyRequestProof accepts the fixture request proof end to end (RFC 9421-style PoP, byte-identical signature base with Python)', () => {
  const result = verifyRequestProof({
    proof: fixture.request_proof,
    method: fixture.request.method,
    targetUri: fixture.request.target_uri,
    sessionId: fixture.session_grant.session_id,
    requestId: fixture.request.request_id,
    contentType: fixture.request.content_type,
    body: Buffer.from(fixture.request.body_utf8, 'utf8'),
    publicJwk: fixture.runtime_certificate.runtime_verification_method.public_jwk,
    at: fixture.request.verified_at_unix
  });
  assert.equal(result.valid, true);
});

test('AILP-H3: verifyRequestProof rejects a time-reversed window (expires <= created)', () => {
  const tamperedProof = { ...fixture.request_proof, expires: fixture.request_proof.created - 5 };
  assert.throws(
    () => verifyRequestProof({
      proof: tamperedProof, method: fixture.request.method, targetUri: fixture.request.target_uri,
      sessionId: fixture.session_grant.session_id, requestId: fixture.request.request_id,
      contentType: fixture.request.content_type, body: Buffer.from(fixture.request.body_utf8, 'utf8'),
      publicJwk: fixture.runtime_certificate.runtime_verification_method.public_jwk, at: fixture.request.verified_at_unix
    }),
    (e) => e instanceof AILPError && e.code === 'INVALID_REQUEST_PROOF_WINDOW'
  );
});

test('AILP-H3: verifyRequestProof rejects a window longer than the advertised max age (discovery says 30s; nothing enforced it before)', () => {
  const tamperedProof = { ...fixture.request_proof, expires: fixture.request_proof.created + 3600 };
  assert.throws(
    () => verifyRequestProof({
      proof: tamperedProof, method: fixture.request.method, targetUri: fixture.request.target_uri,
      sessionId: fixture.session_grant.session_id, requestId: fixture.request.request_id,
      contentType: fixture.request.content_type, body: Buffer.from(fixture.request.body_utf8, 'utf8'),
      publicJwk: fixture.runtime_certificate.runtime_verification_method.public_jwk, at: fixture.request.verified_at_unix
    }),
    (e) => e instanceof AILPError && e.code === 'REQUEST_PROOF_WINDOW_TOO_LONG'
  );
});

test('verifyRequestProof rejects a request-body substitution (content digest no longer matches)', () => {
  assert.throws(
    () => verifyRequestProof({
      proof: fixture.request_proof,
      method: fixture.request.method,
      targetUri: fixture.request.target_uri,
      sessionId: fixture.session_grant.session_id,
      requestId: fixture.request.request_id,
      contentType: fixture.request.content_type,
      body: Buffer.from('{"body":"attacker substituted this"}', 'utf8'),
      publicJwk: fixture.runtime_certificate.runtime_verification_method.public_jwk,
      at: fixture.request.verified_at_unix
    }),
    (e) => e instanceof AILPError && e.code === 'CONTENT_DIGEST_MISMATCH'
  );
});

test('verifyRequestProof rejects a request-target substitution (signature base no longer matches)', () => {
  assert.throws(
    () => verifyRequestProof({
      proof: fixture.request_proof,
      method: fixture.request.method,
      targetUri: 'https://trellis.aispaces.app/api/publications/attacker-target',
      sessionId: fixture.session_grant.session_id,
      requestId: fixture.request.request_id,
      contentType: fixture.request.content_type,
      body: Buffer.from(fixture.request.body_utf8, 'utf8'),
      publicJwk: fixture.runtime_certificate.runtime_verification_method.public_jwk,
      at: fixture.request.verified_at_unix
    }),
    (e) => e instanceof AILPError && e.code === 'REQUEST_SIGNATURE_INVALID'
  );
});

test('verifyRequestProof rejects a request-method substitution (a GET-signed proof replayed as POST)', () => {
  assert.throws(
    () => verifyRequestProof({
      proof: fixture.request_proof,
      method: 'GET',
      targetUri: fixture.request.target_uri,
      sessionId: fixture.session_grant.session_id,
      requestId: fixture.request.request_id,
      contentType: fixture.request.content_type,
      body: Buffer.from(fixture.request.body_utf8, 'utf8'),
      publicJwk: fixture.runtime_certificate.runtime_verification_method.public_jwk,
      at: fixture.request.verified_at_unix
    }),
    (e) => e instanceof AILPError && e.code === 'REQUEST_SIGNATURE_INVALID'
  );
});

test('verifyRequestProof rejects a replayed-past-expiry request', () => {
  assert.throws(
    () => verifyRequestProof({
      proof: fixture.request_proof,
      method: fixture.request.method,
      targetUri: fixture.request.target_uri,
      sessionId: fixture.session_grant.session_id,
      requestId: fixture.request.request_id,
      contentType: fixture.request.content_type,
      body: Buffer.from(fixture.request.body_utf8, 'utf8'),
      publicJwk: fixture.runtime_certificate.runtime_verification_method.public_jwk,
      at: fixture.request.verified_at_unix + 10000
    }),
    (e) => e instanceof AILPError && e.code === 'REQUEST_PROOF_EXPIRED'
  );
});

test('verifyRequestProof rejects a stolen session id used with the wrong runtime key', () => {
  assert.throws(
    () => verifyRequestProof({
      proof: fixture.request_proof,
      method: fixture.request.method,
      targetUri: fixture.request.target_uri,
      sessionId: fixture.session_grant.session_id,
      requestId: fixture.request.request_id,
      contentType: fixture.request.content_type,
      body: Buffer.from(fixture.request.body_utf8, 'utf8'),
      publicJwk: fixture.identity_root.operational_verification_methods[0].public_jwk,
      at: fixture.request.verified_at_unix
    }),
    (e) => e instanceof AILPError && e.code === 'REQUEST_SIGNATURE_INVALID'
  );
});
