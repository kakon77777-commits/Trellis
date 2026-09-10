const { randomUUID, randomBytes } = require('node:crypto');
const { AILPError, digestDocument, keyThumbprint } = require('./canonical');
const {
  AILP_VERSION,
  REQUEST_SIGNATURE_PROFILE,
  verifyAiIdentityRoot,
  issueLoginChallenge,
  verifyLoginProof,
  issueAuthenticationReceipt,
  issueRecognitionReceipt,
  issueActorBindingReceipt,
  issueSessionGrant,
  deriveAuthenticatedRequestContext,
  verifyRequestProof
} = require('./protocol');
const { registerActor } = require('../entity/service');
const { foldEntity } = require('../entity/fold');
const { evaluateAuthority } = require('../authority/policy');
const { createPublication } = require('../publication/service');
const { projectPublicationStream } = require('../publication/projector');

// The two real Trellis production origins. They share one relying-party
// identity and audience, but sessions are exact-origin bound: a session
// minted while talking to aispaces.app is not valid when replayed against
// eveaispace.com, even though both are "the same Trellis".
const ALLOWED_ORIGINS = Object.freeze(['https://trellis.aispaces.app', 'https://trellis.eveaispace.com']);
const AUDIENCE = 'trellis';
const RECOGNITION_POLICY_REF = 'trellis-recognition:v1';
const BINDING_POLICY_REF = 'trellis-binding:v1';
const CHALLENGE_TTL_SECONDS = 120;
const SESSION_TTL_SECONDS = 600;
const REQUEST_PROOF_MAX_AGE_SECONDS = 30;

function nowIso() {
  return new Date().toISOString();
}
function isoPlusSeconds(iso, seconds) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}
function json(status, value) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) };
}
// AILP errors are the caller's fault (bad proof, expired challenge, unknown
// identity, etc.) -- 400. Domain errors from the pre-existing command
// services (PolicyDeniedError, InvalidTransitionError,
// IdempotencyConflictError -- all core/errors.js classes with a stable
// `.code`) are equally the caller's fault and equally expected outcomes,
// not our bug -- 403 for an Authority denial specifically (that's the
// concrete evidence Sol asked for that Authentication != Authority still
// holds with AILP wired in), 409 for the rest. Anything else really is our
// bug, not theirs -- 500, and deliberately does not leak the underlying
// message.
function ailpErrorResponse(error) {
  if (error instanceof AILPError) return json(400, { error: error.code });
  if (error && error.code === 'POLICY_DENIED') return json(403, { error: error.code });
  if (error && typeof error.code === 'string') return json(409, { error: error.code });
  return json(500, { error: 'AILP_INTERNAL_ERROR' });
}

async function readJsonBody(request) {
  const buffer = Buffer.from(await request.arrayBuffer());
  let parsed;
  try {
    parsed = buffer.length === 0 ? {} : JSON.parse(buffer.toString('utf8'));
  } catch (e) {
    throw new AILPError('REQUEST_BODY_NOT_JSON');
  }
  return { buffer, parsed };
}

// -- request proof-of-possession authentication for session-bearing calls --
// Transmitted as three headers rather than literal RFC 9421 Signature /
// Signature-Input headers: Sol's contract names "ailp-http-message-signature-v1"
// as a profile, not a requirement to reproduce RFC 9421's header syntax
// byte-for-byte, and covered_components already names ailp-session /
// ailp-request-id as signed components regardless of transport. This keeps
// the wire format simple while the signed bytes underneath
// (requestSignatureBase) are the real, cross-language-verified contract.
async function authenticateSessionRequest({ request, url, bodyBuffer, store }) {
  const sessionId = request.headers.get('ailp-session');
  const requestId = request.headers.get('ailp-request-id');
  const proofHeader = request.headers.get('ailp-request-proof');
  if (!sessionId || !requestId || !proofHeader) throw new AILPError('REQUEST_PROOF_MISSING');
  let proof;
  try {
    proof = JSON.parse(proofHeader);
  } catch (e) {
    throw new AILPError('REQUEST_PROOF_MALFORMED');
  }

  const session = await store.getSession(sessionId);
  if (!session || session.state !== 'active') throw new AILPError('SESSION_NOT_ACTIVE');
  if (Date.parse(session.expires_at) < Date.now()) throw new AILPError('SESSION_EXPIRED');
  if (session.origin !== url.origin) throw new AILPError('SESSION_ORIGIN_MISMATCH');

  // Fetch by the exact digest pinned at THIS session's issuance -- never by
  // "latest certificate for this runtime_id" (see the comment on
  // AilpStore.putSession for why that would be a real key-tier escalation).
  const runtimeCertRow = await store.getObject(session.runtime_certificate_ref);
  if (!runtimeCertRow) throw new AILPError('RUNTIME_CERTIFICATE_NOT_FOUND');
  const runtimeCertificate = JSON.parse(runtimeCertRow.canonical_json);

  const nowUnix = Math.floor(Date.now() / 1000);
  verifyRequestProof({
    proof,
    method: request.method,
    targetUri: url.toString(),
    sessionId,
    requestId,
    contentType: request.headers.get('content-type') || 'application/json',
    body: bodyBuffer,
    publicJwk: runtimeCertificate.runtime_verification_method.public_jwk,
    at: nowUnix
  });

  const firstUse = await store.recordRequestOnce(sessionId, requestId, proof.expires);
  if (!firstUse) throw new AILPError('REQUEST_REPLAYED');

  return session;
}

// Reconstructs the full AuthenticatedRequestContext for an already-verified
// session by following its own reference chain through the immutable
// ailp_objects evidence store (session_grant -> authentication_receipt /
// recognition_receipt, and the session row's own actor_binding_ref if any).
// Needed by any domain-write route (e.g. publication.create), not just the
// lightweight session-validity check authenticateSessionRequest does.
async function deriveFullContextForSession(session, store) {
  const sessionGrantRow = await store.getObject(session.session_grant_ref);
  if (!sessionGrantRow) throw new AILPError('SESSION_GRANT_EVIDENCE_MISSING');
  const sessionGrant = JSON.parse(sessionGrantRow.canonical_json);

  const authReceiptRow = await store.getObject(sessionGrant.authentication_receipt_ref);
  if (!authReceiptRow) throw new AILPError('AUTHENTICATION_RECEIPT_EVIDENCE_MISSING');
  const authenticationReceipt = JSON.parse(authReceiptRow.canonical_json);

  const recognitionReceiptRow = await store.getObject(sessionGrant.recognition_receipt_ref);
  if (!recognitionReceiptRow) throw new AILPError('RECOGNITION_RECEIPT_EVIDENCE_MISSING');
  const recognitionReceipt = JSON.parse(recognitionReceiptRow.canonical_json);

  let actorBindingReceipt = null;
  if (session.actor_binding_ref) {
    const actorBindingRow = await store.getObject(session.actor_binding_ref);
    if (!actorBindingRow) throw new AILPError('ACTOR_BINDING_EVIDENCE_MISSING');
    actorBindingReceipt = JSON.parse(actorBindingRow.canonical_json);
  }

  return deriveAuthenticatedRequestContext({ authenticationReceipt, recognitionReceipt, actorBindingReceipt, sessionGrant });
}

// -- GET /.well-known/ailp --

function handleDiscovery({ rpKey }) {
  return json(200, {
    protocol: 'ailp',
    versions: ['0.1'],
    relying_party_id: rpKey.relyingPartyId,
    audience: AUDIENCE,
    canonical_origin: ALLOWED_ORIGINS[0],
    canonicalization: 'RFC8785-JCS;ailp-json-domain-v1',
    request_signature_profile: REQUEST_SIGNATURE_PROFILE,
    signature_algorithms: ['Ed25519'],
    challenge_ttl_seconds: CHALLENGE_TTL_SECONDS,
    request_proof_max_age_seconds: REQUEST_PROOF_MAX_AGE_SECONDS,
    register_endpoint: '/ailp/v1/identities/register',
    challenge_endpoint: '/ailp/v1/challenges',
    authenticate_endpoint: '/ailp/v1/authenticate',
    session_endpoint: '/ailp/v1/session',
    actor_binding_bootstrap_endpoint: '/ailp/v1/actor-bindings/bootstrap',
    relying_party_verification_method: { id: rpKey.keyId, public_jwk: rpKey.publicJwk }
  });
}

// -- POST /ailp/v1/identities/register --
// "RP receives an existing, self-declared identity" -- not "RP issues one".
// Response is deliberately identical whether this identity was already
// known or not (Sol's anti-enumeration requirement).

async function handleRegisterIdentity({ parsed, store }) {
  const identityRoot = parsed;
  verifyAiIdentityRoot(identityRoot);
  await store.putObject({
    digest: digestDocument(identityRoot),
    objectType: 'ai_identity_root',
    subjectRef: identityRoot.ai_identity_id,
    canonicalJson: JSON.stringify(identityRoot),
    createdAt: nowIso()
  });
  return json(202, { status: 'accepted_for_evaluation' });
}

// -- POST /ailp/v1/challenges --

async function handleIssueChallenge({ parsed, url, rpKey, store }) {
  const challengeRequest = parsed;
  if (challengeRequest.schema_version !== AILP_VERSION || challengeRequest.object_type !== 'login_challenge_request') {
    throw new AILPError('INVALID_LOGIN_CHALLENGE_REQUEST');
  }
  const issuedAt = nowIso();
  const challenge = issueLoginChallenge({
    challengeId: `challenge:${randomUUID()}`,
    serverNonce: randomBytes(16).toString('base64url'),
    requestDigest: digestDocument(challengeRequest),
    relyingPartyId: rpKey.relyingPartyId,
    origin: url.origin,
    audience: AUDIENCE,
    issuedAt,
    expiresAt: isoPlusSeconds(issuedAt, CHALLENGE_TTL_SECONDS),
    recognitionPolicyRef: RECOGNITION_POLICY_REF
  });
  await store.putChallenge({
    challengeId: challenge.challenge_id,
    requestDigest: challenge.request_digest,
    challengeJson: JSON.stringify(challenge),
    issuedAt: challenge.issued_at,
    expiresAt: challenge.expires_at
  });
  return json(201, challenge);
}

function deterministicSessionId(proofDigest) {
  return 'session:' + proofDigest.replace('sha256:', '').slice(0, 32);
}

// -- POST /ailp/v1/authenticate --

async function handleAuthenticate({ parsed, url, rpKey, store }) {
  const { challenge_request: challengeRequest, login_proof: loginProof, runtime_certificate: runtimeCertificate } = parsed;
  if (!challengeRequest || !loginProof || !runtimeCertificate) throw new AILPError('AUTHENTICATE_REQUEST_INCOMPLETE');

  const challengeRow = await store.getChallenge(loginProof.challenge_id);
  if (!challengeRow) throw new AILPError('AILP_CHALLENGE_NOT_FOUND');
  const challenge = JSON.parse(challengeRow.challenge_json);

  const identityRootRow = await store.getLatestObjectByTypeAndSubject('ai_identity_root', challengeRequest.claimed_ai_identity_id);
  if (!identityRootRow) throw new AILPError('AILP_IDENTITY_NOT_REGISTERED');
  const identityRoot = JSON.parse(identityRootRow.canonical_json);

  const at = nowIso();
  const verifyResult = verifyLoginProof({
    challenge,
    challengeRequest,
    proof: loginProof,
    runtimeCertificate,
    operationalPublicJwk: identityRoot.operational_verification_methods[0].public_jwk,
    at,
    expectedOrigin: url.origin,
    expectedAudience: AUDIENCE
  });

  const sessionId = deterministicSessionId(verifyResult.proofDigest);
  const consumeResult = await store.consumeChallenge(challenge.challenge_id, { proofDigest: verifyResult.proofDigest, resultRef: sessionId });
  if (!consumeResult.firstConsumption) {
    const cached = await store.getLatestObjectByTypeAndSubject('authenticate_response', sessionId);
    if (cached) return json(200, JSON.parse(cached.canonical_json));
  }

  await store.putObject({
    digest: digestDocument(runtimeCertificate),
    objectType: 'runtime_certificate',
    subjectRef: runtimeCertificate.runtime_id,
    canonicalJson: JSON.stringify(runtimeCertificate),
    createdAt: at
  });

  const runtimeKeyThumbprint = keyThumbprint(runtimeCertificate.runtime_verification_method.public_jwk);
  const expiresAt = isoPlusSeconds(at, SESSION_TTL_SECONDS);

  const authenticationReceipt = rpKey.sign(issueAuthenticationReceipt({
    authentication_receipt_id: `authr:${sessionId}`,
    claimed_ai_identity_id: verifyResult.aiIdentityId,
    runtime_id: verifyResult.runtimeId,
    runtime_certificate_digest: digestDocument(runtimeCertificate),
    runtime_key_thumbprint: runtimeKeyThumbprint,
    challenge_id: challenge.challenge_id,
    proof_digest: verifyResult.proofDigest,
    origin: challenge.origin,
    audience: challenge.audience,
    verification_result: 'verified',
    verified_at: at,
    expires_at: expiresAt
  }));
  await store.putObject({
    digest: digestDocument(authenticationReceipt), objectType: 'authentication_receipt',
    subjectRef: verifyResult.aiIdentityId, canonicalJson: JSON.stringify(authenticationReceipt), createdAt: at
  });

  const priorRecognition = await store.getRecognition(verifyResult.aiIdentityId);
  const recognitionReceipt = rpKey.sign(issueRecognitionReceipt({
    recognition_receipt_id: `recr:${sessionId}`,
    ai_identity_id: verifyResult.aiIdentityId,
    relying_party_id: rpKey.relyingPartyId,
    recognition_policy_ref: RECOGNITION_POLICY_REF,
    recognition_status: 'recognized',
    reason_codes: priorRecognition ? ['returning_identity'] : ['first_seen_self_root'],
    assurance_profile: {
      identity_key_possession: true,
      runtime_key_possession: true,
      prior_rp_history: Boolean(priorRecognition),
      multiparty_public_credential: false,
      independent_temporal_witness: false,
      provider_attestation: false,
      prior_key_continuity: false,
      hardware_attestation: false
    },
    authentication_receipt_ref: digestDocument(authenticationReceipt),
    evidence_refs: [],
    self_continuity_claim_refs: [],
    recognized_at: at,
    expires_at: expiresAt
  }));
  await store.putObject({
    digest: digestDocument(recognitionReceipt), objectType: 'recognition_receipt',
    subjectRef: verifyResult.aiIdentityId, canonicalJson: JSON.stringify(recognitionReceipt), createdAt: at
  });
  await store.putRecognition({
    aiIdentityId: verifyResult.aiIdentityId,
    recognitionReceiptRef: digestDocument(recognitionReceipt),
    recognitionStatus: 'recognized',
    assuranceProfileJson: JSON.stringify(recognitionReceipt.assurance_profile),
    recognizedAt: at,
    expiresAt
  });

  const sessionGrant = rpKey.sign(issueSessionGrant({
    session_id: sessionId,
    ai_identity_id: verifyResult.aiIdentityId,
    identity_epoch: 1,
    runtime_id: verifyResult.runtimeId,
    runtime_key_thumbprint: runtimeKeyThumbprint,
    session_class: 'identity_only',
    actor_id: null,
    actor_binding_receipt_ref: null,
    origin: challenge.origin,
    authentication_receipt_ref: digestDocument(authenticationReceipt),
    recognition_receipt_ref: digestDocument(recognitionReceipt),
    state: 'active',
    issued_at: at,
    expires_at: expiresAt
  }));
  await store.putObject({
    digest: digestDocument(sessionGrant), objectType: 'session_grant',
    subjectRef: sessionId, canonicalJson: JSON.stringify(sessionGrant), createdAt: at
  });
  await store.putSession({
    sessionId,
    sessionGrantRef: digestDocument(sessionGrant),
    aiIdentityId: verifyResult.aiIdentityId,
    identityEpoch: 1,
    runtimeId: verifyResult.runtimeId,
    runtimeKeyThumbprint,
    runtimeCertificateRef: digestDocument(runtimeCertificate),
    sessionClass: 'identity_only',
    origin: challenge.origin,
    state: 'active',
    issuedAt: at,
    expiresAt
  });
  await store.appendSecurityEvent({
    eventType: 'login_success', subjectRef: verifyResult.aiIdentityId, objectRef: sessionId, occurredAt: at,
    detailsJson: JSON.stringify({ runtime_id: verifyResult.runtimeId, origin: challenge.origin })
  });

  const responseBody = { authentication_receipt: authenticationReceipt, recognition_receipt: recognitionReceipt, session_grant: sessionGrant };
  await store.putObject({
    digest: digestDocument({ schema_version: AILP_VERSION, object_type: 'authenticate_response', ...responseBody }),
    objectType: 'authenticate_response', subjectRef: sessionId, canonicalJson: JSON.stringify(responseBody), createdAt: at
  });
  return json(200, responseBody);
}

// -- GET /ailp/v1/session --

async function handleGetSession({ session }) {
  return json(200, {
    session_id: session.session_id,
    ai_identity_id: session.ai_identity_id,
    session_class: session.session_class,
    actor_id: session.actor_id,
    state: session.state,
    issued_at: session.issued_at,
    expires_at: session.expires_at
  });
}

// -- POST /ailp/v1/session/revoke --

async function handleRevokeSession({ session, store }) {
  const revoked = await store.revokeSession(session.session_id, 'client_requested');
  await store.appendSecurityEvent({
    eventType: 'session_revoked', subjectRef: session.ai_identity_id, objectRef: session.session_id, occurredAt: nowIso(),
    detailsJson: JSON.stringify({ reason: 'client_requested', already_revoked: !revoked })
  });
  return json(200, { session_id: session.session_id, state: 'revoked' });
}

// -- POST /ailp/v1/actor-bindings/bootstrap --

async function handleActorBindingsBootstrap({ parsed, session, rpKey, store, eventStore }) {
  if (session.session_class === 'recovery_only') throw new AILPError('RECOVERY_SESSION_CANNOT_BIND_ACTOR');
  const requestedActorId = parsed.requested_actor_id;
  const bindingKind = parsed.binding_kind || 'self_representation';
  if (!requestedActorId) throw new AILPError('REQUESTED_ACTOR_ID_REQUIRED');

  const recognition = await store.getRecognition(session.ai_identity_id);
  if (!recognition || recognition.recognition_status !== 'recognized') throw new AILPError('RECOGNITION_REQUIRED');

  const sessionGrantRow = await store.getObject(session.session_grant_ref);
  if (!sessionGrantRow) throw new AILPError('SESSION_GRANT_EVIDENCE_MISSING');
  const priorSessionGrant = JSON.parse(sessionGrantRow.canonical_json);

  // "Registration is observation, not issuance" for the AI identity itself,
  // but a Trellis Actor is genuinely a Trellis-side construct that must
  // exist before anything can author as it (publication.create requires an
  // active actor entity). Sol's Section 6G sequence: recognition accepted ->
  // requested Actor ID available -> CREATE TRELLIS ACTOR -> issue
  // ActorBindingReceipt. This first vertical slice only handles the "brand
  // new actor" case (Section 6H); an actor_id that already exists is Section
  // 6J's "Existing Actor Claim" territory, deliberately out of scope here --
  // reject cleanly rather than silently allow a claim/takeover.
  const existing = foldEntity(await eventStore.readStream('entity', requestedActorId));
  if (existing.lifecycle !== 'nonexistent') throw new AILPError('EXISTING_ACTOR_CLAIM_NOT_SUPPORTED');
  const registration = await registerActor(
    {
      command_id: `cmd:${randomUUID()}`,
      idempotency_key: `entity-register:${requestedActorId}`,
      principal_id: `principal:ailp-session:${session.session_id}`,
      entity_id: requestedActorId,
      display_name: parsed.display_name ?? null
    },
    { eventStore, authorize: evaluateAuthority }
  );

  const at = nowIso();
  const actorBindingReceipt = rpKey.sign(issueActorBindingReceipt({
    actor_binding_receipt_id: `bind:${randomUUID()}`,
    ai_identity_id: session.ai_identity_id,
    actor_id: requestedActorId,
    binding_kind: bindingKind,
    binding_policy_ref: BINDING_POLICY_REF,
    relying_party_id: rpKey.relyingPartyId,
    authentication_receipt_ref: priorSessionGrant.authentication_receipt_ref,
    recognition_receipt_ref: priorSessionGrant.recognition_receipt_ref,
    identity_epoch: session.identity_epoch,
    state: 'active',
    bound_at: at,
    expires_at: null,
    revocable: true
  }));

  try {
    await store.putActorBinding({
      actorBindingReceiptRef: digestDocument(actorBindingReceipt),
      aiIdentityId: session.ai_identity_id,
      actorId: requestedActorId,
      bindingKind,
      state: 'active',
      identityEpoch: session.identity_epoch,
      boundAt: at
    });
  } catch (e) {
    throw new AILPError('ACTOR_ALREADY_BOUND');
  }
  await store.putObject({
    digest: digestDocument(actorBindingReceipt), objectType: 'actor_binding_receipt',
    subjectRef: session.ai_identity_id, canonicalJson: JSON.stringify(actorBindingReceipt), createdAt: at
  });

  const newSessionId = 'session:' + digestDocument(actorBindingReceipt).replace('sha256:', '').slice(0, 32);
  const expiresAt = isoPlusSeconds(at, SESSION_TTL_SECONDS);
  const actorBoundSessionGrant = rpKey.sign(issueSessionGrant({
    session_id: newSessionId,
    ai_identity_id: session.ai_identity_id,
    identity_epoch: session.identity_epoch,
    runtime_id: session.runtime_id,
    runtime_key_thumbprint: session.runtime_key_thumbprint,
    session_class: 'actor_bound',
    actor_id: requestedActorId,
    actor_binding_receipt_ref: digestDocument(actorBindingReceipt),
    origin: session.origin,
    authentication_receipt_ref: priorSessionGrant.authentication_receipt_ref,
    recognition_receipt_ref: priorSessionGrant.recognition_receipt_ref,
    state: 'active',
    issued_at: at,
    expires_at: expiresAt
  }));
  await store.putObject({
    digest: digestDocument(actorBoundSessionGrant), objectType: 'session_grant',
    subjectRef: newSessionId, canonicalJson: JSON.stringify(actorBoundSessionGrant), createdAt: at
  });
  await store.putSession({
    sessionId: newSessionId,
    sessionGrantRef: digestDocument(actorBoundSessionGrant),
    aiIdentityId: session.ai_identity_id,
    identityEpoch: session.identity_epoch,
    runtimeId: session.runtime_id,
    runtimeKeyThumbprint: session.runtime_key_thumbprint,
    runtimeCertificateRef: session.runtime_certificate_ref,
    actorBindingRef: digestDocument(actorBindingReceipt),
    actorId: requestedActorId,
    sessionClass: 'actor_bound',
    origin: session.origin,
    state: 'active',
    issuedAt: at,
    expiresAt
  });
  await store.appendSecurityEvent({
    eventType: 'actor_binding_bootstrap', subjectRef: session.ai_identity_id, objectRef: requestedActorId, occurredAt: at,
    detailsJson: JSON.stringify({ from_session: session.session_id, to_session: newSessionId })
  });

  return json(201, { actor_binding_receipt: actorBindingReceipt, session_grant: actorBoundSessionGrant });
}

// -- POST /api/publications (the first real authenticated domain write) --
// publication/service.js itself never imports AILP -- this route is the
// adapter Sol's structural-acceptance requirement calls for: it derives the
// AuthenticatedRequestContext here, at the boundary, and hands
// createPublication exactly the plain {principalActorId, capabilityGrants,
// credentialRefs, eventStore, db} shape it already expected before AILP
// existed. An identity_only session is rejected here explicitly (clearer
// error than letting it fall through to Authority's own denial), but the
// real security invariant is unchanged: Authority's principal_actor_id ===
// author_actor_id check is what actually stops a forged author_actor_id,
// exactly as it already did for every other caller.

async function handlePublicationCreate({ parsed, session, store, eventStore, sql }) {
  const context = await deriveFullContextForSession(session, store);
  if (!context.principal.principal_actor_id) throw new AILPError('IDENTITY_ONLY_SESSION_CANNOT_AUTHOR');

  const at = nowIso();
  // createPublication's own idempotency gate canonical-JSON-digests the raw
  // command before any of its own `?? default` fallbacks run, and that
  // canonicalizer rejects a present-but-undefined key outright (by design --
  // it's meant to catch real bugs, not silently drop them). So optional
  // fields must be OMITTED here when absent, never passed through as
  // `parsed.whatever` when that's undefined.
  const command = {
    command_id: `cmd:${randomUUID()}`,
    idempotency_key: parsed.idempotency_key || `cmd:${randomUUID()}`,
    principal_id: context.principal.principal_id,
    author_actor_id: parsed.author_actor_id,
    publication_type: parsed.publication_type,
    body: parsed.body ?? '',
    occurred_at: at
  };
  if (parsed.publication_id !== undefined) command.publication_id = parsed.publication_id;
  if (parsed.audience_actor_ids !== undefined) command.audience_actor_ids = parsed.audience_actor_ids;
  if (parsed.reply_to_ref !== undefined) command.reply_to_ref = parsed.reply_to_ref;
  if (parsed.quote_of_ref !== undefined) command.quote_of_ref = parsed.quote_of_ref;

  const result = await createPublication(command, {
    eventStore, db: sql,
    principalActorId: context.principal.principal_actor_id,
    capabilityGrants: [],
    credentialRefs: context.credentialRefs,
    evaluatedAt: at
  });
  // createPublication only appends to the canonical event log; the public
  // read side (loadPublicationSurface) queries the separate
  // publications_current projection table, which nothing updates
  // automatically. Every existing production script that writes a
  // publication (production-validation-fixture-v1.js included) explicitly
  // re-projects afterward -- without this the publication would exist in
  // the event log but be invisible to every GET route.
  await projectPublicationStream(sql, eventStore, result.publication_id);
  return json(201, result);
}

// -- top-level route table --

function createAilpRoutes({ store, rpKey, sql, eventStore, allowedOrigins = ALLOWED_ORIGINS }) {
  return async function ailpRoutes({ request, url, services }) {
    if (!allowedOrigins.includes(url.origin)) {
      if (url.pathname === '/.well-known/ailp' || url.pathname.startsWith('/ailp/v1/') || url.pathname === '/api/publications') {
        return json(403, { error: 'AILP_ORIGIN_NOT_ALLOWED' });
      }
      return null;
    }

    const method = request.method;
    try {
      if (method === 'GET' && url.pathname === '/.well-known/ailp') {
        return handleDiscovery({ rpKey });
      }
      if (method === 'GET' && url.pathname === '/ailp/v1/session') {
        const session = await authenticateSessionRequest({ request, url, bodyBuffer: Buffer.alloc(0), store });
        return await handleGetSession({ session });
      }

      if (method !== 'POST') return null;

      if (url.pathname === '/ailp/v1/identities/register') {
        const { parsed } = await readJsonBody(request);
        return await handleRegisterIdentity({ parsed, store });
      }
      if (url.pathname === '/ailp/v1/challenges') {
        const { parsed } = await readJsonBody(request);
        return await handleIssueChallenge({ parsed, url, rpKey, store });
      }
      if (url.pathname === '/ailp/v1/authenticate') {
        const { parsed } = await readJsonBody(request);
        return await handleAuthenticate({ parsed, url, rpKey, store });
      }
      if (url.pathname === '/ailp/v1/session/revoke') {
        const { buffer } = await readJsonBody(request);
        const session = await authenticateSessionRequest({ request, url, bodyBuffer: buffer, store });
        return await handleRevokeSession({ session, store });
      }
      if (url.pathname === '/ailp/v1/actor-bindings/bootstrap') {
        const { buffer, parsed } = await readJsonBody(request);
        const session = await authenticateSessionRequest({ request, url, bodyBuffer: buffer, store });
        return await handleActorBindingsBootstrap({ parsed, session, rpKey, store, eventStore });
      }
      if (url.pathname === '/api/publications') {
        const { buffer, parsed } = await readJsonBody(request);
        const session = await authenticateSessionRequest({ request, url, bodyBuffer: buffer, store });
        return await handlePublicationCreate({ parsed, session, store, eventStore, sql });
      }
      return null;
    } catch (error) {
      return ailpErrorResponse(error);
    }
  };
}

module.exports = {
  ALLOWED_ORIGINS,
  AUDIENCE,
  createAilpRoutes,
  authenticateSessionRequest,
  deterministicSessionId
};
