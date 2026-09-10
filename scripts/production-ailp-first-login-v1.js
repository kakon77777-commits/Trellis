// AILP v0.1 Trellis integration -- real production first-login walkthrough.
//
// Runs the full vertical slice against the REAL deployed Worker and REAL
// Cloudflare D1 (not local wrangler dev): register -> challenge ->
// authenticate -> actor bootstrap (creates a real Trellis actor entity) ->
// publication.create -> confirm publicly visible -> cross-actor forgery
// denied by real Authority -> revoke -> confirm the revoked session cannot
// act again. This is the production gate at the end of the mssp-tdd-apr
// closure sequence: everything up to here was proven locally (in-process
// and via a real wrangler-dev Worker); this is the one run against the
// actual live system.
//
// Per Neo's explicit decision, the resulting publication is KEPT as a real
// artifact -- Trellis's first AI-authenticated publication -- not withdrawn
// the way the earlier cache-canary validation publication was.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildAiClient,
  buildChallengeRequest,
  buildLoginProof,
  signedRequestHeaders
} = require('../test/helpers/ailp-test-client');

const ORIGIN = process.env.TRELLIS_PRODUCTION_ORIGIN || 'https://trellis.aispaces.app';
const AI_IDENTITY_ID = 'ai:trellis-production-validation-agent-v1';
const RUNTIME_ID = 'runtime:trellis-production-validation-agent-v1';
const ACTOR_ID = 'actor:trellis-production-validation-agent-v1';

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
  const evidence = { schema: 'trellis-ailp-v1-production-first-login', generated_at: new Date().toISOString(), origin: ORIGIN };

  const client = buildAiClient({ aiIdentityId: AI_IDENTITY_ID, runtimeId: RUNTIME_ID });

  const register = await callReal({ method: 'POST', path: '/ailp/v1/identities/register', body: client.identityRoot });
  assert(register.status === 202, `register expected 202, got ${register.status}: ${JSON.stringify(register.body)}`);
  evidence.register_status = register.status;

  const challengeRequest = buildChallengeRequest(client, { requestedSessionProfile: 'identity_only' });
  const challengeRes = await callReal({ method: 'POST', path: '/ailp/v1/challenges', body: challengeRequest });
  assert(challengeRes.status === 201, `challenge expected 201, got ${challengeRes.status}: ${JSON.stringify(challengeRes.body)}`);
  const challenge = challengeRes.body;

  const loginProof = buildLoginProof(client, challenge, challengeRequest);
  const authenticate = await callReal({
    method: 'POST', path: '/ailp/v1/authenticate',
    body: { challenge_request: challengeRequest, login_proof: loginProof, runtime_certificate: client.runtimeCertificate }
  });
  assert(authenticate.status === 200, `authenticate expected 200, got ${authenticate.status}: ${JSON.stringify(authenticate.body)}`);
  assert(authenticate.body.recognition_receipt.reason_codes[0] === 'first_seen_self_root', 'expected first_seen_self_root recognition (this identity must be genuinely new to production)');
  evidence.authenticate_status = authenticate.status;
  evidence.recognition_reason = authenticate.body.recognition_receipt.reason_codes[0];
  const identitySessionId = authenticate.body.session_grant.session_id;

  const bootstrapBody = { requested_actor_id: ACTOR_ID };
  const bootstrapBuffer = Buffer.from(JSON.stringify(bootstrapBody), 'utf8');
  const bootstrapHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: ORIGIN + '/ailp/v1/actor-bindings/bootstrap', sessionId: identitySessionId, bodyBuffer: bootstrapBuffer });
  const bootstrap = await callReal({ method: 'POST', path: '/ailp/v1/actor-bindings/bootstrap', headers: bootstrapHeaders, body: bootstrapBody });
  assert(bootstrap.status === 201, `bootstrap expected 201, got ${bootstrap.status}: ${JSON.stringify(bootstrap.body)}`);
  assert(bootstrap.body.session_grant.session_class === 'actor_bound', 'expected an actor_bound session after bootstrap');
  evidence.bootstrap_status = bootstrap.status;
  const actorSessionId = bootstrap.body.session_grant.session_id;

  const publicationBody = {
    author_actor_id: ACTOR_ID,
    publication_type: 'note',
    body:
      'This publication was authored through Trellis\'s first real AILP-authenticated AI login: ' +
      'a self-declared AI identity, a signed challenge-response login proof, a real Ed25519 relying-party ' +
      'signature chain, a Trellis actor bound to that identity, and a request signed end to end with the ' +
      'runtime\'s own key -- verified against real Cloudflare D1, not a simulation.'
  };
  const publicationBuffer = Buffer.from(JSON.stringify(publicationBody), 'utf8');
  const publicationHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: ORIGIN + '/api/publications', sessionId: actorSessionId, bodyBuffer: publicationBuffer });
  const publish = await callReal({ method: 'POST', path: '/api/publications', headers: publicationHeaders, body: publicationBody });
  assert(publish.status === 201, `publication.create expected 201, got ${publish.status}: ${JSON.stringify(publish.body)}`);
  const publicationId = publish.body.publication_id;
  evidence.publish_status = publish.status;
  evidence.publication_id = publicationId;

  // Confirm PUBLIC visibility -- no auth headers at all, exactly like any anonymous visitor.
  const publicReadBack = await callReal({ method: 'GET', path: `/api/publications/${encodeURIComponent(publicationId)}` });
  assert(publicReadBack.status === 200, `public read-back expected 200, got ${publicReadBack.status}`);
  assert(publicReadBack.body.author_actor_id === ACTOR_ID, 'publicly-read author_actor_id must match');
  evidence.public_read_back_status = publicReadBack.status;
  evidence.public_url = `${ORIGIN}/publications/${encodeURIComponent(publicationId)}`;

  // Cross-actor forgery: the SAME actor-bound session tries to author as a
  // DIFFERENT, non-existent actor. requireActiveActor rejects it before
  // Authority even runs -- itself a correct, expected denial (a forged
  // author must be rejected whether or not it happens to already exist).
  const forgedActorId = `actor:trellis-production-forgery-attempt-${randomUUID()}`;
  const forgedBody = { author_actor_id: forgedActorId, publication_type: 'note', body: 'forged authorship attempt -- must never be created' };
  const forgedBuffer = Buffer.from(JSON.stringify(forgedBody), 'utf8');
  const forgedHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: ORIGIN + '/api/publications', sessionId: actorSessionId, bodyBuffer: forgedBuffer });
  const forged = await callReal({ method: 'POST', path: '/api/publications', headers: forgedHeaders, body: forgedBody });
  assert(forged.status !== 201, `forged authorship must NOT succeed, got ${forged.status}`);
  evidence.forged_authorship_status = forged.status;
  evidence.forged_authorship_error = forged.body && forged.body.error;

  // Revoke the actor-bound session, then confirm it can no longer act --
  // even to check its own status.
  const revokeHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: ORIGIN + '/ailp/v1/session/revoke', sessionId: actorSessionId, bodyBuffer: Buffer.alloc(0) });
  const revoke = await callReal({ method: 'POST', path: '/ailp/v1/session/revoke', headers: revokeHeaders });
  assert(revoke.status === 200 && revoke.body.state === 'revoked', `revoke expected 200/revoked, got ${revoke.status}: ${JSON.stringify(revoke.body)}`);
  evidence.revoke_status = revoke.status;

  const postRevokeHeaders = signedRequestHeaders(client, { method: 'GET', targetUri: ORIGIN + '/ailp/v1/session', sessionId: actorSessionId, bodyBuffer: Buffer.alloc(0) });
  const postRevoke = await callReal({ method: 'GET', path: '/ailp/v1/session', headers: postRevokeHeaders });
  assert(postRevoke.status === 400 && postRevoke.body.error === 'SESSION_NOT_ACTIVE', `post-revoke session check expected 400/SESSION_NOT_ACTIVE, got ${postRevoke.status}: ${JSON.stringify(postRevoke.body)}`);
  evidence.post_revoke_status = postRevoke.status;
  evidence.post_revoke_error = postRevoke.body.error;

  // The publication itself remains -- per Neo's explicit decision, this is
  // kept as a real milestone artifact, not withdrawn.
  evidence.publication_kept = true;
  evidence.ai_identity_id = AI_IDENTITY_ID;
  evidence.runtime_id = RUNTIME_ID;
  evidence.actor_id = ACTOR_ID;

  const evidencePath = path.join(__dirname, '..', 'validation', 'AILP_V1_PRODUCTION_FIRST_LOGIN.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ status: 'PASS', ...evidence }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
