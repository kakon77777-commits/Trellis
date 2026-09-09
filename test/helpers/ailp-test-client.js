// Plays the role of a real AI CLIENT for AILP tests/integration harnesses:
// generates its own identity/operational/runtime keys, self-signs its
// identity root, and builds/signs real login proofs and RFC 9421-style
// request proofs -- so callers exercise Trellis's actual production RP code
// (ailp/routes.js and below) with zero mocking of AILP itself, whether that
// code is running in-process (node --test) or as a real wrangler dev Worker
// reached over HTTP (scripts/run-ailp-worker-integration-local.js).
const { generateKeyPairSync, randomUUID, sign, createPrivateKey } = require('node:crypto');
const { signDocument, digestDocument } = require('../../ailp/canonical');
const { requestSignatureBase, contentDigestSha256 } = require('../../ailp/protocol');

function throwawayJwkPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicJwk: publicKey.export({ format: 'jwk' }), privateJwk: privateKey.export({ format: 'jwk' }) };
}

function buildAiClient({ aiIdentityId, runtimeId }) {
  const continuity = throwawayJwkPair();
  const operational = throwawayJwkPair();
  const runtime = throwawayJwkPair();
  const createdAt = new Date().toISOString();

  const identityRoot = signDocument(
    {
      schema_version: 'ailp/0.1', object_type: 'ai_identity_root', ai_identity_id: aiIdentityId,
      identity_epoch: 1,
      continuity_verification_methods: [{ id: 'key:continuity:test', public_jwk: continuity.publicJwk }],
      operational_verification_methods: [{ id: 'key:operational:test', public_jwk: operational.publicJwk }],
      recovery_policy_ref: null, created_at: createdAt, root_nonce: randomUUID()
    },
    continuity.privateJwk,
    { keyId: 'key:continuity:test' }
  );

  const spawnedAt = createdAt;
  const rtExpiresAt = new Date(Date.parse(spawnedAt) + 600000).toISOString();
  const runtimeCertificate = signDocument(
    {
      schema_version: 'ailp/0.1', object_type: 'runtime_certificate', runtime_id: runtimeId,
      ai_identity_id: aiIdentityId, identity_epoch: 1,
      runtime_verification_method: { id: 'key:runtime:test', public_jwk: runtime.publicJwk },
      issuer_verification_method_ref: 'key:operational:test', spawned_at: spawnedAt, expires_at: rtExpiresAt,
      runtime_class: 'test', allowed_protocols: ['ailp/0.1'], max_session_lifetime_seconds: 600,
      parent_runtime_id: null, delegation_depth: null, claims: {}
    },
    operational.privateJwk,
    { keyId: 'key:operational:test' }
  );

  return { aiIdentityId, runtimeId, identityRoot, runtimeCertificate, runtimePrivateJwk: runtime.privateJwk, operationalPrivateJwk: operational.privateJwk };
}

// Mints a SECOND runtime_certificate for the SAME runtime_id, reusing the
// SAME operational key (as if only the operational key -- not the runtime
// key -- had been compromised, or simply reused).
function mintAdditionalRuntimeCertificate(baseClient) {
  const newRuntime = throwawayJwkPair();
  const spawnedAt = new Date().toISOString();
  const runtimeCertificate = signDocument(
    {
      schema_version: 'ailp/0.1', object_type: 'runtime_certificate', runtime_id: baseClient.runtimeId,
      ai_identity_id: baseClient.aiIdentityId, identity_epoch: 1,
      runtime_verification_method: { id: 'key:runtime:test', public_jwk: newRuntime.publicJwk },
      issuer_verification_method_ref: 'key:operational:test', spawned_at: spawnedAt,
      expires_at: new Date(Date.parse(spawnedAt) + 600000).toISOString(),
      runtime_class: 'test', allowed_protocols: ['ailp/0.1'], max_session_lifetime_seconds: 600,
      parent_runtime_id: null, delegation_depth: null, claims: {}
    },
    baseClient.operationalPrivateJwk,
    { keyId: 'key:operational:test' }
  );
  return { ...baseClient, runtimeCertificate, runtimePrivateJwk: newRuntime.privateJwk };
}

function buildChallengeRequest(client, { requestedActorId = null, requestedSessionProfile = 'identity_only' } = {}) {
  return {
    schema_version: 'ailp/0.1', object_type: 'login_challenge_request',
    claimed_ai_identity_id: client.aiIdentityId, runtime_id: client.runtimeId,
    requested_actor_id: requestedActorId, requested_session_profile: requestedSessionProfile,
    client_nonce: randomUUID(), runtime_certificate_digest: digestDocument(client.runtimeCertificate)
  };
}

function buildLoginProof(client, challenge, challengeRequest) {
  return signDocument(
    {
      schema_version: 'ailp/0.1', object_type: 'login_proof', ai_identity_id: client.aiIdentityId,
      audience: challenge.audience, challenge_digest: digestDocument(challenge), challenge_id: challenge.challenge_id,
      client_nonce: challengeRequest.client_nonce, created_at: new Date().toISOString(), origin: challenge.origin,
      proof_id: `proof:${randomUUID()}`, requested_actor_id: challengeRequest.requested_actor_id,
      runtime_certificate_digest: challengeRequest.runtime_certificate_digest, runtime_id: client.runtimeId
    },
    client.runtimePrivateJwk,
    { keyId: 'key:runtime:test' }
  );
}

function signedRequestHeaders(client, { method, targetUri, sessionId, bodyBuffer }) {
  const requestId = `request:${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 30;
  const contentDigest = contentDigestSha256(bodyBuffer);
  const base = requestSignatureBase({
    method, targetUri, sessionId, requestId, contentType: 'application/json', contentDigest, created, expires, runtimeKeyId: 'key:runtime:test'
  });
  const keyObj = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: client.runtimePrivateJwk.x, d: client.runtimePrivateJwk.d }, format: 'jwk' });
  const signature = sign(null, base, keyObj).toString('base64');
  const proof = {
    profile: 'ailp-http-message-signature-v1', label: 'sig1', created, expires, key_id: 'key:runtime:test',
    algorithm: 'ed25519', covered_components: ['@method', '@target-uri', 'ailp-session', 'ailp-request-id', 'content-type', 'content-digest'],
    content_digest: contentDigest, signature
  };
  return { 'ailp-session': sessionId, 'ailp-request-id': requestId, 'ailp-request-proof': JSON.stringify(proof), 'content-type': 'application/json' };
}

module.exports = {
  throwawayJwkPair,
  buildAiClient,
  mintAdditionalRuntimeCertificate,
  buildChallengeRequest,
  buildLoginProof,
  signedRequestHeaders
};
