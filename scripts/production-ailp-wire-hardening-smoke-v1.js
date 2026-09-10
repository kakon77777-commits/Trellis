// Real-production smoke test for the two commits deployed after the
// original AILP_V1_PRODUCTION_FIRST_LOGIN milestone (bb5bc83: v0.2.18
// fixture re-pin + H2 error-code rename; 2dfd7a5: atomic authenticate
// transaction). Unlike that first-login run, this is routine post-deploy
// verification, not a kept milestone -- it uses its own, separate test
// identity and its own evidence file.
//
// What this specifically targets, against the REAL deployed Worker and
// REAL Cloudflare D1 (not local wrangler dev):
// - The H2 clock-skew rejection fires with the renamed canonical error code
//   (LOGIN_PROOF_CREATED_BEFORE_CHALLENGE, not the old
//   LOGIN_PROOF_CREATED_AT_BEFORE_CHALLENGE_ISSUED) -- and does so with zero
//   DB writes, since verifyLoginProof's H2 check runs before any store call.
// - A fresh authenticate commits successfully through the new atomic
//   commitAuthenticateTransaction path.
// - Replaying the exact same login proof against the exact same challenge
//   returns the SAME cached session (the "already consumed, cache hit"
//   branch of the rewritten handleAuthenticate) rather than erroring or
//   minting a second session -- the most heavily rewritten code path.
const fs = require('node:fs');
const path = require('node:path');
const {
  buildAiClient,
  buildChallengeRequest,
  buildLoginProof,
  signedRequestHeaders
} = require('../test/helpers/ailp-test-client');

const ORIGIN = process.env.TRELLIS_PRODUCTION_ORIGIN || 'https://trellis.aispaces.app';
const AI_IDENTITY_ID = 'ai:trellis-wire-hardening-smoke-test-v1';
const RUNTIME_ID = 'runtime:trellis-wire-hardening-smoke-test-v1';

async function callReal({ method, path: routePath, headers = {}, body }) {
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(ORIGIN + routePath, { method, headers, body: bodyText });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
  return { status: response.status, body: parsed };
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION_FAILED: ${message}`);
}

async function main() {
  const evidence = { schema: 'trellis-ailp-v1-production-wire-hardening-smoke', generated_at: new Date().toISOString(), origin: ORIGIN };

  const client = buildAiClient({ aiIdentityId: AI_IDENTITY_ID, runtimeId: RUNTIME_ID });

  const register = await callReal({ method: 'POST', path: '/ailp/v1/identities/register', body: client.identityRoot });
  assert(register.status === 202, `register expected 202, got ${register.status}: ${JSON.stringify(register.body)}`);
  evidence.register_status = register.status;

  const challengeRequest = buildChallengeRequest(client, { requestedSessionProfile: 'identity_only' });
  const challengeRes = await callReal({ method: 'POST', path: '/ailp/v1/challenges', body: challengeRequest });
  assert(challengeRes.status === 201, `challenge expected 201, got ${challengeRes.status}: ${JSON.stringify(challengeRes.body)}`);
  const challenge = challengeRes.body;

  const validProof = buildLoginProof(client, challenge, challengeRequest);

  // -- H2 rename check: a proof claiming to have been created before the
  // challenge was even issued, well beyond clock-skew tolerance. Mutating
  // created_at after signing invalidates the signature, but verifyLoginProof
  // checks the H2 timestamp bound BEFORE ever reaching signature
  // verification (ailp/protocol.js), so this is expected to fail on H2
  // specifically, with zero DB writes -- not on a signature mismatch.
  const tamperedProof = { ...validProof, created_at: '2020-01-01T00:00:00Z' };
  const h2Attempt = await callReal({
    method: 'POST', path: '/ailp/v1/authenticate',
    body: { challenge_request: challengeRequest, login_proof: tamperedProof, runtime_certificate: client.runtimeCertificate }
  });
  assert(h2Attempt.status === 400, `H2 rejection expected 400, got ${h2Attempt.status}: ${JSON.stringify(h2Attempt.body)}`);
  assert(h2Attempt.body.error === 'LOGIN_PROOF_CREATED_BEFORE_CHALLENGE', `expected renamed H2 code LOGIN_PROOF_CREATED_BEFORE_CHALLENGE, got ${JSON.stringify(h2Attempt.body)}`);
  evidence.h2_rejection_status = h2Attempt.status;
  evidence.h2_rejection_error = h2Attempt.body.error;

  // -- fresh authenticate through the new atomic commit path --
  const authBody = { challenge_request: challengeRequest, login_proof: validProof, runtime_certificate: client.runtimeCertificate };
  const first = await callReal({ method: 'POST', path: '/ailp/v1/authenticate', body: authBody });
  assert(first.status === 200, `first authenticate expected 200, got ${first.status}: ${JSON.stringify(first.body)}`);
  assert(first.body.recognition_receipt.reason_codes[0] === 'first_seen_self_root', 'expected first_seen_self_root (this identity must be genuinely new to production)');
  evidence.first_authenticate_status = first.status;
  evidence.session_id = first.body.session_grant.session_id;

  // -- exact replay of the same proof against the same (now-consumed) challenge --
  const replay = await callReal({ method: 'POST', path: '/ailp/v1/authenticate', body: authBody });
  assert(replay.status === 200, `replay authenticate expected 200, got ${replay.status}: ${JSON.stringify(replay.body)}`);
  assert(replay.body.session_grant.session_id === first.body.session_grant.session_id, 'replay must return the SAME cached session, not mint a second one');
  evidence.replay_authenticate_status = replay.status;
  evidence.replay_session_id_matches = true;

  // -- tidy up: revoke, then confirm the revoked session cannot act again --
  const sessionId = first.body.session_grant.session_id;
  const revokeHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: ORIGIN + '/ailp/v1/session/revoke', sessionId, bodyBuffer: Buffer.alloc(0) });
  const revoke = await callReal({ method: 'POST', path: '/ailp/v1/session/revoke', headers: revokeHeaders });
  assert(revoke.status === 200 && revoke.body.state === 'revoked', `revoke expected 200/revoked, got ${revoke.status}: ${JSON.stringify(revoke.body)}`);
  evidence.revoke_status = revoke.status;

  const postRevokeHeaders = signedRequestHeaders(client, { method: 'GET', targetUri: ORIGIN + '/ailp/v1/session', sessionId, bodyBuffer: Buffer.alloc(0) });
  const postRevoke = await callReal({ method: 'GET', path: '/ailp/v1/session', headers: postRevokeHeaders });
  assert(postRevoke.status === 400 && postRevoke.body.error === 'SESSION_NOT_ACTIVE', `post-revoke check expected 400/SESSION_NOT_ACTIVE, got ${postRevoke.status}: ${JSON.stringify(postRevoke.body)}`);
  evidence.post_revoke_status = postRevoke.status;

  evidence.ai_identity_id = AI_IDENTITY_ID;
  evidence.runtime_id = RUNTIME_ID;
  evidence.deployed_commits_verified = ['bb5bc83', '2dfd7a5'];

  const evidencePath = path.join(__dirname, '..', 'validation', 'AILP_V1_PRODUCTION_WIRE_HARDENING_SMOKE.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ status: 'PASS', ...evidence }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
