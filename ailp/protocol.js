const { createHash, verify: cryptoVerify } = require('node:crypto');
const {
  AILPError,
  digestDocument,
  keyThumbprint,
  publicKeyFromJwk,
  verifyDocumentSignature
} = require('./canonical');

const AILP_VERSION = 'ailp/0.1';
const REQUEST_SIGNATURE_PROFILE = 'ailp-http-message-signature-v1';
const REQUEST_CLOCK_SKEW_SECONDS = 60;

function parseTime(value) {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new AILPError('INVALID_DATETIME', value);
  return ms;
}

function requireString(value, code) {
  if (typeof value !== 'string' || value === '') throw new AILPError(code);
  return value;
}

// -- runtime certificate --

function verifyRuntimeCertificate(certificate, operationalPublicJwk, { at }) {
  if (certificate.schema_version !== AILP_VERSION || certificate.object_type !== 'runtime_certificate') {
    throw new AILPError('INVALID_RUNTIME_CERTIFICATE');
  }
  const now = parseTime(at);
  if (now < parseTime(certificate.spawned_at)) throw new AILPError('RUNTIME_CERTIFICATE_NOT_YET_VALID');
  if (now > parseTime(certificate.expires_at)) throw new AILPError('RUNTIME_CERTIFICATE_EXPIRED');
  if (!Array.isArray(certificate.allowed_protocols) || !certificate.allowed_protocols.includes(AILP_VERSION)) {
    throw new AILPError('AILP_PROTOCOL_NOT_ALLOWED');
  }
  verifyDocumentSignature(certificate, operationalPublicJwk, { expectedKeyId: certificate.issuer_verification_method_ref });
  return {
    valid: true,
    runtimeId: certificate.runtime_id,
    aiIdentityId: certificate.ai_identity_id,
    identityEpoch: certificate.identity_epoch,
    runtimeKeyThumbprint: keyThumbprint(certificate.runtime_verification_method.public_jwk)
  };
}

// -- login challenge (RP-issued) --

function issueLoginChallenge({
  challengeId, serverNonce, requestDigest, relyingPartyId, origin, audience,
  issuedAt, expiresAt, recognitionPolicyRef
}) {
  if (parseTime(expiresAt) <= parseTime(issuedAt)) throw new AILPError('INVALID_CHALLENGE_WINDOW');
  return {
    schema_version: AILP_VERSION,
    object_type: 'login_challenge',
    challenge_id: requireString(challengeId, 'INVALID_CHALLENGE_ID'),
    server_nonce: requireString(serverNonce, 'INVALID_SERVER_NONCE'),
    request_digest: requireString(requestDigest, 'INVALID_REQUEST_DIGEST'),
    relying_party_id: requireString(relyingPartyId, 'INVALID_RELYING_PARTY_ID'),
    origin: requireString(origin, 'INVALID_ORIGIN'),
    audience: requireString(audience, 'INVALID_AUDIENCE'),
    protocol: AILP_VERSION,
    canonicalization: 'RFC8785-JCS;ailp-json-domain-v1',
    request_signature_profile: REQUEST_SIGNATURE_PROFILE,
    signature_algorithm: 'Ed25519',
    issued_at: issuedAt,
    expires_at: expiresAt,
    recognition_policy_ref: requireString(recognitionPolicyRef, 'INVALID_RECOGNITION_POLICY')
  };
}

// -- login proof verification (mirrors CTCL-ITR verify_login_proof exactly) --

function verifyLoginProof({
  challenge, challengeRequest, proof, runtimeCertificate, operationalPublicJwk,
  at, expectedOrigin, expectedAudience
}) {
  const now = parseTime(at);
  if (challenge.origin !== expectedOrigin) throw new AILPError('CHALLENGE_ORIGIN_MISMATCH');
  if (challenge.audience !== expectedAudience) throw new AILPError('CHALLENGE_AUDIENCE_MISMATCH');
  if (now > parseTime(challenge.expires_at)) throw new AILPError('CHALLENGE_EXPIRED');
  if (now < parseTime(challenge.issued_at)) throw new AILPError('CHALLENGE_NOT_YET_VALID');
  if (challenge.request_digest !== digestDocument(challengeRequest)) throw new AILPError('CHALLENGE_REQUEST_DIGEST_MISMATCH');

  verifyRuntimeCertificate(runtimeCertificate, operationalPublicJwk, { at });
  const requestExpected = {
    claimed_ai_identity_id: runtimeCertificate.ai_identity_id,
    runtime_id: runtimeCertificate.runtime_id,
    runtime_certificate_digest: digestDocument(runtimeCertificate)
  };
  for (const [key, value] of Object.entries(requestExpected)) {
    if (challengeRequest[key] !== value) throw new AILPError(`CHALLENGE_REQUEST_${key.toUpperCase()}_MISMATCH`);
  }

  const expected = {
    challenge_id: challenge.challenge_id,
    challenge_digest: digestDocument(challenge),
    ai_identity_id: challengeRequest.claimed_ai_identity_id,
    runtime_id: challengeRequest.runtime_id,
    runtime_certificate_digest: challengeRequest.runtime_certificate_digest,
    origin: challenge.origin,
    audience: challenge.audience,
    requested_actor_id: challengeRequest.requested_actor_id ?? null,
    client_nonce: challengeRequest.client_nonce
  };
  for (const [key, value] of Object.entries(expected)) {
    const actual = proof[key] ?? null;
    if (actual !== value) throw new AILPError(`LOGIN_PROOF_${key.toUpperCase()}_MISMATCH`);
  }
  if (proof.schema_version !== AILP_VERSION || proof.object_type !== 'login_proof') throw new AILPError('INVALID_LOGIN_PROOF');

  const runtimeMethod = runtimeCertificate.runtime_verification_method;
  verifyDocumentSignature(proof, runtimeMethod.public_jwk, { expectedKeyId: runtimeMethod.id });

  return {
    valid: true,
    proofDigest: digestDocument(proof),
    aiIdentityId: proof.ai_identity_id,
    runtimeId: proof.runtime_id,
    requestedActorId: proof.requested_actor_id ?? null,
    requestedSessionProfile: challengeRequest.requested_session_profile
  };
}

// -- RP-issued receipts (validating constructors, mirroring issue_* in ailp.py) --

function baseObject(objectType, fields) {
  return { schema_version: AILP_VERSION, object_type: objectType, ...fields };
}

function issueAuthenticationReceipt(fields) {
  if (!['verified', 'failed'].includes(fields.verification_result)) throw new AILPError('INVALID_AUTHENTICATION_RESULT');
  requireString(fields.runtime_certificate_digest, 'RUNTIME_CERTIFICATE_DIGEST_REQUIRED');
  parseTime(fields.verified_at);
  parseTime(fields.expires_at);
  return baseObject('authentication_receipt', fields);
}

function issueRecognitionReceipt(fields) {
  if (!['recognized', 'provisional', 'pending_review', 'not_recognized'].includes(fields.recognition_status)) {
    throw new AILPError('INVALID_RECOGNITION_STATUS');
  }
  parseTime(fields.recognized_at);
  parseTime(fields.expires_at);
  if (typeof fields.assurance_profile !== 'object' || fields.assurance_profile === null) throw new AILPError('INVALID_ASSURANCE_PROFILE');
  return baseObject('recognition_receipt', fields);
}

function issueActorBindingReceipt(fields) {
  if (!['self_representation', 'delegated_representation', 'service_operator', 'co_actor'].includes(fields.binding_kind)) {
    throw new AILPError('INVALID_BINDING_KIND');
  }
  if (!['active', 'revoked', 'expired', 'requires_revalidation'].includes(fields.state)) throw new AILPError('INVALID_BINDING_STATE');
  if (!Number.isInteger(fields.identity_epoch) || fields.identity_epoch < 1) throw new AILPError('INVALID_IDENTITY_EPOCH');
  parseTime(fields.bound_at);
  if (fields.expires_at != null) parseTime(fields.expires_at);
  return baseObject('actor_binding_receipt', fields);
}

function issueSessionGrant(fields) {
  if (!['identity_only', 'actor_bound', 'recovery_only'].includes(fields.session_class)) throw new AILPError('INVALID_SESSION_CLASS');
  if (!['active', 'revoked', 'expired', 'terminated'].includes(fields.state)) throw new AILPError('INVALID_SESSION_STATE');
  parseTime(fields.issued_at);
  parseTime(fields.expires_at);
  const actorId = fields.actor_id ?? null;
  const bindingRef = fields.actor_binding_receipt_ref ?? null;
  if (fields.session_class === 'actor_bound') {
    if (!actorId || !bindingRef) throw new AILPError('ACTOR_BOUND_SESSION_REQUIRES_BINDING');
  } else if (actorId !== null || bindingRef !== null) {
    throw new AILPError('IDENTITY_SESSION_MUST_NOT_BIND_ACTOR');
  }
  if (!Number.isInteger(fields.identity_epoch) || fields.identity_epoch < 1) throw new AILPError('INVALID_IDENTITY_EPOCH');
  return baseObject('session_grant', fields);
}

// -- authenticated request context (the adapter Sol's contract requires) --

function deriveAuthenticatedRequestContext({ authenticationReceipt, recognitionReceipt, actorBindingReceipt, sessionGrant }) {
  if (authenticationReceipt.verification_result !== 'verified') throw new AILPError('AUTHENTICATION_NOT_VERIFIED');
  const identityId = sessionGrant.ai_identity_id;
  if (identityId !== authenticationReceipt.claimed_ai_identity_id || identityId !== recognitionReceipt.ai_identity_id) {
    throw new AILPError('IDENTITY_CONTEXT_MISMATCH');
  }
  if (sessionGrant.state !== 'active') throw new AILPError('SESSION_NOT_ACTIVE');

  let actorId = null;
  let bindingRef = null;
  if (sessionGrant.session_class === 'actor_bound') {
    if (!actorBindingReceipt || actorBindingReceipt.state !== 'active') throw new AILPError('ACTOR_BINDING_NOT_ACTIVE');
    if (actorBindingReceipt.ai_identity_id !== identityId || actorBindingReceipt.actor_id !== sessionGrant.actor_id) {
      throw new AILPError('ACTOR_BINDING_CONTEXT_MISMATCH');
    }
    bindingRef = digestDocument(actorBindingReceipt);
    if (sessionGrant.actor_binding_receipt_ref !== bindingRef) throw new AILPError('ACTOR_BINDING_REFERENCE_MISMATCH');
    actorId = actorBindingReceipt.actor_id;
  }

  const credentialRefs = [digestDocument(authenticationReceipt), digestDocument(recognitionReceipt), digestDocument(sessionGrant)];
  if (bindingRef) credentialRefs.splice(2, 0, bindingRef);

  return {
    authentication: {
      authentication_receipt_ref: digestDocument(authenticationReceipt),
      ai_identity_id: identityId,
      runtime_id: sessionGrant.runtime_id,
      runtime_key_thumbprint: sessionGrant.runtime_key_thumbprint,
      session_id: sessionGrant.session_id
    },
    recognition: {
      recognition_receipt_ref: digestDocument(recognitionReceipt),
      status: recognitionReceipt.recognition_status
    },
    actorBinding: actorId === null ? null : { actor_binding_receipt_ref: bindingRef, actor_id: actorId },
    principal: {
      principal_id: `principal:ailp-session:${sessionGrant.session_id}`,
      principal_actor_id: actorId
    },
    viewerContext: actorId === null ? {} : { viewer_actor_id: actorId, represents_actor_ids: [] },
    credentialRefs
  };
}

// -- request proof-of-possession (RFC 9421-style; Trellis only ever verifies) --

function contentDigestSha256(bodyBuffer) {
  const digest = createHash('sha256').update(bodyBuffer).digest();
  return 'sha-256=:' + digest.toString('base64') + ':';
}

function safeComponent(value, code) {
  const s = requireString(value, code);
  if (s.includes('\r') || s.includes('\n')) throw new AILPError(code);
  return s;
}

function requestSignatureBase({ method, targetUri, sessionId, requestId, contentType, contentDigest, created, expires, runtimeKeyId }) {
  const m = safeComponent(String(method).toUpperCase(), 'INVALID_METHOD');
  const uri = safeComponent(targetUri, 'INVALID_TARGET_URI');
  const sid = safeComponent(sessionId, 'INVALID_SESSION_ID');
  const rid = safeComponent(requestId, 'INVALID_REQUEST_ID');
  const ct = safeComponent(contentType, 'INVALID_CONTENT_TYPE');
  const cd = safeComponent(contentDigest, 'INVALID_CONTENT_DIGEST');
  const keyId = safeComponent(runtimeKeyId, 'INVALID_KEY_ID');
  const components = '("@method" "@target-uri" "ailp-session" "ailp-request-id" "content-type" "content-digest")';
  const lines = [
    `"@method": ${m}`,
    `"@target-uri": ${uri}`,
    `"ailp-session": ${sid}`,
    `"ailp-request-id": ${rid}`,
    `"content-type": ${ct}`,
    `"content-digest": ${cd}`,
    `"@signature-params": ${components};created=${Number(created)};expires=${Number(expires)};keyid="${keyId}";alg="ed25519"`
  ];
  return Buffer.from(lines.join('\n'), 'utf8');
}

function verifyRequestProof({ proof, method, targetUri, sessionId, requestId, contentType, body, publicJwk, at }) {
  if (proof.profile !== REQUEST_SIGNATURE_PROFILE || proof.algorithm !== 'ed25519') throw new AILPError('UNSUPPORTED_REQUEST_SIGNATURE_PROFILE');
  const expectedComponents = ['@method', '@target-uri', 'ailp-session', 'ailp-request-id', 'content-type', 'content-digest'];
  if (JSON.stringify(proof.covered_components) !== JSON.stringify(expectedComponents)) throw new AILPError('REQUEST_COVERED_COMPONENTS_MISMATCH');
  const created = Number(proof.created);
  const expires = Number(proof.expires);
  if (Number(at) < created - REQUEST_CLOCK_SKEW_SECONDS) throw new AILPError('REQUEST_PROOF_NOT_YET_VALID');
  if (Number(at) > expires + REQUEST_CLOCK_SKEW_SECONDS) throw new AILPError('REQUEST_PROOF_EXPIRED');
  const actualDigest = contentDigestSha256(body);
  if (proof.content_digest !== actualDigest) throw new AILPError('CONTENT_DIGEST_MISMATCH');
  const base = requestSignatureBase({
    method, targetUri, sessionId, requestId, contentType, contentDigest: actualDigest, created, expires, runtimeKeyId: proof.key_id
  });
  let signatureBuf;
  try {
    signatureBuf = Buffer.from(proof.signature, 'base64');
  } catch (e) {
    throw new AILPError('REQUEST_SIGNATURE_INVALID');
  }
  const key = publicKeyFromJwk(publicJwk);
  let ok = false;
  try {
    ok = cryptoVerify(null, base, key, signatureBuf);
  } catch (e) {
    ok = false;
  }
  if (!ok) throw new AILPError('REQUEST_SIGNATURE_INVALID');
  return { valid: true, profile: REQUEST_SIGNATURE_PROFILE, sessionId, requestId, created, expires };
}

module.exports = {
  AILP_VERSION,
  REQUEST_SIGNATURE_PROFILE,
  verifyRuntimeCertificate,
  issueLoginChallenge,
  verifyLoginProof,
  issueAuthenticationReceipt,
  issueRecognitionReceipt,
  issueActorBindingReceipt,
  issueSessionGrant,
  deriveAuthenticatedRequestContext,
  contentDigestSha256,
  requestSignatureBase,
  verifyRequestProof
};
