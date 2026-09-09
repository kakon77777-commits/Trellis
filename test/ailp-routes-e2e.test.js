const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID, createHash } = require('node:crypto');
const { openMigratedDatabase } = require('../db/sqlite');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { buildHttpRuntime } = require('../runtime/build-dependencies');
const { dispatchRequest } = require('../http/app');
const { loadRpSigningKey } = require('../ailp/keys');
const { signDocument, digestDocument } = require('../ailp/canonical');
const { requestSignatureBase, contentDigestSha256 } = require('../ailp/protocol');

const ORIGIN = 'https://trellis.aispaces.app';

function throwawayJwkPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicJwk: publicKey.export({ format: 'jwk' }), privateJwk: privateKey.export({ format: 'jwk' }) };
}

// -- everything below this line plays the role of the AI CLIENT, exercising
// Trellis's real RP code exactly as a real AI runtime would over HTTP.

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
// key -- had been compromised, or simply reused). Returns a client-shaped
// object usable with buildChallengeRequest/buildLoginProof for a fresh
// authenticate cycle under the same runtime_id but a different runtime key.
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
  const { sign } = require('node:crypto');
  const { createPrivateKey } = require('node:crypto');
  const keyObj = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: client.runtimePrivateJwk.x, d: client.runtimePrivateJwk.d }, format: 'jwk' });
  const signature = sign(null, base, keyObj).toString('base64');
  const proof = {
    profile: 'ailp-http-message-signature-v1', label: 'sig1', created, expires, key_id: 'key:runtime:test',
    algorithm: 'ed25519', covered_components: ['@method', '@target-uri', 'ailp-session', 'ailp-request-id', 'content-type', 'content-digest'],
    content_digest: contentDigest, signature
  };
  return { 'ailp-session': sessionId, 'ailp-request-id': requestId, 'ailp-request-proof': JSON.stringify(proof), 'content-type': 'application/json' };
}

async function makeRuntime() {
  const db = openMigratedDatabase(':memory:');
  const sql = new SQLiteAsyncAdapter(db);
  const rpKey = loadRpSigningKey({ AILP_RP_PRIVATE_KEY_JWK: JSON.stringify(throwawayJwkPair().privateJwk) });
  const runtime = buildHttpRuntime({ sql, ailpRpKey: rpKey });
  return { db, runtime };
}

async function callDispatch(runtime, { method, path, headers = {}, body }) {
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  const request = new Request(ORIGIN + path, { method, headers, body: bodyText });
  const response = await dispatchRequest(request, runtime);
  let parsed = null;
  if (response.body) {
    try { parsed = JSON.parse(response.body); } catch (e) { parsed = response.body; }
  }
  return { status: response.status, body: parsed };
}

test('discovery endpoint is public and exposes the RP verification method', async () => {
  const { db, runtime } = await makeRuntime();
  try {
    const res = await callDispatch(runtime, { method: 'GET', path: '/.well-known/ailp' });
    assert.equal(res.status, 200);
    assert.equal(res.body.protocol, 'ailp');
    assert.equal(res.body.relying_party_verification_method.id, 'key:rp:trellis');
  } finally { db.close(); }
});

test('full real vertical slice: register -> challenge -> authenticate -> actor bootstrap -> session -> revoke -> revoked session cannot act again', async () => {
  const { db, runtime } = await makeRuntime();
  try {
    const client = buildAiClient({ aiIdentityId: 'ai:e2e-test', runtimeId: 'runtime:e2e-test' });

    const register = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/identities/register', body: client.identityRoot });
    assert.equal(register.status, 202);
    assert.equal(register.body.status, 'accepted_for_evaluation');

    const challengeRequest = buildChallengeRequest(client);
    const challengeRes = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/challenges', body: challengeRequest });
    assert.equal(challengeRes.status, 201);
    const challenge = challengeRes.body;

    const loginProof = buildLoginProof(client, challenge, challengeRequest);
    const authRes = await callDispatch(runtime, {
      method: 'POST', path: '/ailp/v1/authenticate',
      body: { challenge_request: challengeRequest, login_proof: loginProof, runtime_certificate: client.runtimeCertificate }
    });
    assert.equal(authRes.status, 200);
    assert.equal(authRes.body.recognition_receipt.reason_codes[0], 'first_seen_self_root');
    const sessionId = authRes.body.session_grant.session_id;

    // GET /ailp/v1/session with a valid signed request proof
    const getSessionHeaders = signedRequestHeaders(client, { method: 'GET', targetUri: ORIGIN + '/ailp/v1/session', sessionId, bodyBuffer: Buffer.alloc(0) });
    const sessionRes = await callDispatch(runtime, { method: 'GET', path: '/ailp/v1/session', headers: getSessionHeaders });
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.body.session_class, 'identity_only');
    assert.equal(sessionRes.body.state, 'active');

    // actor-bindings/bootstrap with a valid signed request proof
    const bootstrapBody = { requested_actor_id: 'actor:e2e-test' };
    const bootstrapBuffer = Buffer.from(JSON.stringify(bootstrapBody), 'utf8');
    const bootstrapHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: ORIGIN + '/ailp/v1/actor-bindings/bootstrap', sessionId, bodyBuffer: bootstrapBuffer });
    const bootstrapRes = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/actor-bindings/bootstrap', headers: bootstrapHeaders, body: bootstrapBody });
    assert.equal(bootstrapRes.status, 201);
    assert.equal(bootstrapRes.body.actor_binding_receipt.actor_id, 'actor:e2e-test');
    assert.equal(bootstrapRes.body.session_grant.session_class, 'actor_bound');
    const actorSessionId = bootstrapRes.body.session_grant.session_id;

    // revoke the actor-bound session
    const revokeHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: ORIGIN + '/ailp/v1/session/revoke', sessionId: actorSessionId, bodyBuffer: Buffer.alloc(0) });
    const revokeRes = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/session/revoke', headers: revokeHeaders });
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeRes.body.state, 'revoked');

    // the exact same signed proof, replayed, must now fail -- both because
    // the session is revoked AND because the request_id was already consumed
    const replayRes = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/session/revoke', headers: revokeHeaders });
    assert.equal(replayRes.status, 400);
  } finally { db.close(); }
});

test('same challenge + same proof replay is idempotent (returns the same session, does not mint a second one)', async () => {
  const { db, runtime } = await makeRuntime();
  try {
    const client = buildAiClient({ aiIdentityId: 'ai:idempotent-test', runtimeId: 'runtime:idempotent-test' });
    await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/identities/register', body: client.identityRoot });
    const challengeRequest = buildChallengeRequest(client);
    const challenge = (await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/challenges', body: challengeRequest })).body;
    const loginProof = buildLoginProof(client, challenge, challengeRequest);
    const body = { challenge_request: challengeRequest, login_proof: loginProof, runtime_certificate: client.runtimeCertificate };

    const first = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/authenticate', body });
    const second = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/authenticate', body });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.session_grant.session_id, second.body.session_grant.session_id);
  } finally { db.close(); }
});

test('same challenge + a DIFFERENT proof is rejected (cannot mint a second session off one challenge)', async () => {
  const { db, runtime } = await makeRuntime();
  try {
    const client = buildAiClient({ aiIdentityId: 'ai:mismatch-test', runtimeId: 'runtime:mismatch-test' });
    await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/identities/register', body: client.identityRoot });
    const challengeRequest = buildChallengeRequest(client);
    const challenge = (await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/challenges', body: challengeRequest })).body;
    const firstProof = buildLoginProof(client, challenge, challengeRequest);
    const body1 = { challenge_request: challengeRequest, login_proof: firstProof, runtime_certificate: client.runtimeCertificate };
    const first = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/authenticate', body: body1 });
    assert.equal(first.status, 200);

    // Build a second, distinct valid login_proof for the same challenge (different proof_id/created_at -> different digest).
    const secondProof = buildLoginProof(client, challenge, challengeRequest);
    const body2 = { challenge_request: challengeRequest, login_proof: secondProof, runtime_certificate: client.runtimeCertificate };
    const second = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/authenticate', body: body2 });
    assert.equal(second.status, 400);
    assert.equal(second.body.error, 'AILP_CHALLENGE_PROOF_MISMATCH');
  } finally { db.close(); }
});

test('a session is pinned to the exact runtime_certificate verified at its own issuance, not "latest cert for this runtime_id" -- regression test for a real key-tier escalation found and fixed during this build', async () => {
  const { db, runtime } = await makeRuntime();
  try {
    const client = buildAiClient({ aiIdentityId: 'ai:cert-pin-test', runtimeId: 'runtime:shared' });
    await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/identities/register', body: client.identityRoot });

    // First authenticate cycle, with runtime key #1.
    const req1 = buildChallengeRequest(client);
    const challenge1 = (await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/challenges', body: req1 })).body;
    const proof1 = buildLoginProof(client, challenge1, req1);
    const auth1 = await callDispatch(runtime, {
      method: 'POST', path: '/ailp/v1/authenticate',
      body: { challenge_request: req1, login_proof: proof1, runtime_certificate: client.runtimeCertificate }
    });
    assert.equal(auth1.status, 200);
    const victimSessionId = auth1.body.session_grant.session_id;

    // A second authenticate cycle for the SAME runtime_id, but with a brand
    // new runtime keypair -- as if only the operational key were compromised
    // (or simply reused) and a new runtime_certificate got registered under
    // the same runtime_id. This must not be able to touch the FIRST session.
    const attacker = mintAdditionalRuntimeCertificate(client);
    const req2 = buildChallengeRequest(attacker);
    const challenge2 = (await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/challenges', body: req2 })).body;
    const proof2 = buildLoginProof(attacker, challenge2, req2);
    const auth2 = await callDispatch(runtime, {
      method: 'POST', path: '/ailp/v1/authenticate',
      body: { challenge_request: req2, login_proof: proof2, runtime_certificate: attacker.runtimeCertificate }
    });
    assert.equal(auth2.status, 200);

    // The attacker forges a request CLAIMING the victim's session_id, but
    // signs it with their own (newer) runtime key. Before the fix, the
    // victim session's runtime certificate lookup would resolve to
    // "whichever cert is newest for runtime:shared" -- the attacker's -- and
    // this signature would verify. After the fix, the victim session is
    // pinned to runtime key #1 and this must be rejected.
    const forgedHeaders = signedRequestHeaders(attacker, { method: 'GET', targetUri: ORIGIN + '/ailp/v1/session', sessionId: victimSessionId, bodyBuffer: Buffer.alloc(0) });
    const forgedRes = await callDispatch(runtime, { method: 'GET', path: '/ailp/v1/session', headers: forgedHeaders });
    assert.equal(forgedRes.status, 400);
    assert.equal(forgedRes.body.error, 'REQUEST_SIGNATURE_INVALID');

    // The legitimate victim's own key must still work against their own session.
    const legitHeaders = signedRequestHeaders(client, { method: 'GET', targetUri: ORIGIN + '/ailp/v1/session', sessionId: victimSessionId, bodyBuffer: Buffer.alloc(0) });
    const legitRes = await callDispatch(runtime, { method: 'GET', path: '/ailp/v1/session', headers: legitHeaders });
    assert.equal(legitRes.status, 200);
  } finally { db.close(); }
});

test('an AILP path with no/invalid request proof is denied outright, never silently served as anonymous', async () => {
  const { db, runtime } = await makeRuntime();
  try {
    // No ailp-session/ailp-request-id/ailp-request-proof headers at all.
    const bare = await callDispatch(runtime, { method: 'GET', path: '/ailp/v1/session' });
    assert.equal(bare.status, 400);
    assert.equal(bare.body.error, 'REQUEST_PROOF_MISSING');

    // A garbage proof header, session id that doesn't exist.
    const garbage = await callDispatch(runtime, {
      method: 'GET', path: '/ailp/v1/session',
      headers: { 'ailp-session': 'session:does-not-exist', 'ailp-request-id': 'request:1', 'ailp-request-proof': 'not-json' }
    });
    assert.equal(garbage.status, 400);
    assert.equal(garbage.body.error, 'REQUEST_PROOF_MALFORMED');

    // Neither response is 200/404-as-if-anonymous -- this path simply does
    // not exist for an unauthenticated caller, by construction: ailpRoutes
    // always resolves it to a thrown AILPError, and dispatchRequest returns
    // that response directly without ever reaching the old GET routeHandlers.
  } finally { db.close(); }
});

test('raw X-Actor-ID header is still rejected on an AILP path (W6 applies unconditionally, login does not create a shortcut)', async () => {
  const { db, runtime } = await makeRuntime();
  try {
    const res = await callDispatch(runtime, { method: 'GET', path: '/ailp/v1/session', headers: { 'x-actor-id': 'actor:attacker' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'INVALID_PUBLIC_IDENTITY_CLAIM');
  } finally { db.close(); }
});

test('a session bound to actor A cannot be used to author a publication as actor B (Authority denies, Authentication != Authority)', async () => {
  const { db, runtime } = await makeRuntime();
  try {
    const client = buildAiClient({ aiIdentityId: 'ai:authority-test', runtimeId: 'runtime:authority-test' });
    await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/identities/register', body: client.identityRoot });
    const challengeRequest = buildChallengeRequest(client);
    const challenge = (await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/challenges', body: challengeRequest })).body;
    const loginProof = buildLoginProof(client, challenge, challengeRequest);
    const authRes = await callDispatch(runtime, {
      method: 'POST', path: '/ailp/v1/authenticate',
      body: { challenge_request: challengeRequest, login_proof: loginProof, runtime_certificate: client.runtimeCertificate }
    });
    const sessionId = authRes.body.session_grant.session_id;
    const bootstrapBody = { requested_actor_id: 'actor:authority-test-a' };
    const bootstrapBuffer = Buffer.from(JSON.stringify(bootstrapBody), 'utf8');
    const bootstrapHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: ORIGIN + '/ailp/v1/actor-bindings/bootstrap', sessionId, bodyBuffer: bootstrapBuffer });
    const bootstrapRes = await callDispatch(runtime, { method: 'POST', path: '/ailp/v1/actor-bindings/bootstrap', headers: bootstrapHeaders, body: bootstrapBody });
    assert.equal(bootstrapRes.status, 201);

    const { deriveAuthenticatedRequestContext } = require('../ailp/protocol');
    const { AilpStore } = require('../ailp/store');
    const store = new AilpStore(runtime.sql);
    const boundSession = await store.getSession(bootstrapRes.body.session_grant.session_id);
    const sessionGrantObj = JSON.parse((await store.getObject(boundSession.session_grant_ref)).canonical_json);
    const actorBindingObj = JSON.parse((await store.getObject(boundSession.actor_binding_ref)).canonical_json);
    const authReceiptObj = JSON.parse((await store.getObject(sessionGrantObj.authentication_receipt_ref)).canonical_json);
    const recognitionReceiptObj = JSON.parse((await store.getObject(sessionGrantObj.recognition_receipt_ref)).canonical_json);

    const ctx = deriveAuthenticatedRequestContext({
      authenticationReceipt: authReceiptObj, recognitionReceipt: recognitionReceiptObj,
      actorBindingReceipt: actorBindingObj, sessionGrant: sessionGrantObj
    });
    assert.equal(ctx.principal.principal_actor_id, 'actor:authority-test-a');

    const { evaluateAuthority } = require('../authority/policy');
    const decision = evaluateAuthority({
      command_id: `cmd:${randomUUID()}`,
      principal_id: ctx.principal.principal_id,
      actor_id: ctx.principal.principal_actor_id,
      requested_action: 'publication.create',
      principal_actor_id: ctx.principal.principal_actor_id,
      author_actor_id: 'actor:someone-else-entirely'
    });
    assert.equal(decision.decision, 'deny');
  } finally { db.close(); }
});
