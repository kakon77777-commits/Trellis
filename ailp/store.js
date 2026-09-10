// Exclusive owner of the ailp_* bounded-context tables (db/migrations/007_ailp.sql).
// No other module may reference these tables directly -- Sol's implementation
// contract requires publication/relationship services to reach AILP state only
// through the authenticated adapter (ailp/context.js), never raw SQL.
const { AILPError } = require('./canonical');

function rowOrNull(row) {
  return row || null;
}

// SQLite's constraint-violation error text is stable across both drivers
// this store runs on (node:sqlite locally, D1 in production -- D1 is
// SQLite at the edge and surfaces the same underlying engine text). Only
// THIS specific failure means "the row already exists" / "the constraint
// caught a real duplicate" -- a connection failure, a schema error, or any
// other persistence fault must never be silently reinterpreted as that.
function isUniqueConstraintError(error) {
  return Boolean(error && typeof error.message === 'string' && error.message.includes('UNIQUE constraint failed'));
}

class AilpStore {
  constructor(sql) {
    this.sql = sql;
  }

  // -- ailp_objects: immutable evidence store (identity roots, receipts, etc.) --
  async putObject({ digest, objectType, issuerRef = null, subjectRef = null, canonicalJson, createdAt }) {
    await this.sql.run(
      `INSERT INTO ailp_objects(object_digest,object_type,issuer_ref,subject_ref,canonical_json,created_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(object_digest) DO NOTHING`,
      [digest, objectType, issuerRef, subjectRef, canonicalJson, createdAt]
    );
    return this.getObject(digest);
  }

  async getObject(digest) {
    return rowOrNull(await this.sql.first(`SELECT * FROM ailp_objects WHERE object_digest=?`, [digest]));
  }

  async getLatestObjectByTypeAndSubject(objectType, subjectRef) {
    return rowOrNull(await this.sql.first(
      `SELECT * FROM ailp_objects WHERE object_type=? AND subject_ref=? ORDER BY created_at DESC LIMIT 1`,
      [objectType, subjectRef]
    ));
  }

  // -- ailp_challenges: single-use, idempotent-on-same-proof --
  async putChallenge({ challengeId, requestDigest, challengeJson, issuedAt, expiresAt }) {
    await this.sql.run(
      `INSERT INTO ailp_challenges(challenge_id,request_digest,challenge_json,issued_at,expires_at)
       VALUES (?,?,?,?,?)`,
      [challengeId, requestDigest, challengeJson, issuedAt, expiresAt]
    );
    return this.getChallenge(challengeId);
  }

  async getChallenge(challengeId) {
    return rowOrNull(await this.sql.first(`SELECT * FROM ailp_challenges WHERE challenge_id=?`, [challengeId]));
  }

  // Commits an entire successful authenticate as ONE atomic unit: challenge
  // consumption, the runtime-certificate/authentication-receipt/recognition-
  // receipt/session-grant evidence objects, the ailp_recognition_current
  // projection, the ailp_sessions row, the security-journal entry, and the
  // cached authenticate_response used for idempotent replay -- all commit
  // together or none do. Before this, each of these was a separate write;
  // a crash or DB error partway through left the challenge permanently
  // marked consumed with no cached result to replay, which wedged that
  // exact login attempt forever (every retry recomputes the same
  // deterministic session_id and re-derives the same "not first
  // consumption, no cache" dead end). Sol, backtracing the canonical
  // protocol's atomicity requirement, named this as the remaining gap.
  //
  // The challenge-consumption UPDATE is deliberately the first statement:
  // its WHERE consumed_proof_digest IS NULL guard is the exclusivity gate
  // for this challenge. A concurrent duplicate request for the exact same
  // proof digest independently collides on ailp_sessions' session_id
  // PRIMARY KEY (deterministic from the proof digest) and so throws,
  // aborting its whole transaction -- the caller is expected to catch that
  // via isUniqueConstraintError and read back the winner's committed
  // result. A concurrent request for a genuinely DIFFERENT proof digest on
  // the same challenge does not collide on any constraint (different
  // digests, different session id), so this method cannot itself prevent
  // both from committing; the caller inspects this method's first result's
  // `changes` (0 means this call lost that race) and is responsible for
  // flagging it, since neither adapter's batch() can conditionally abort
  // later statements based on an earlier statement's row count.
  async commitAuthenticateTransaction({
    challengeId, proofDigest, resultRef,
    runtimeCertificateDigest, runtimeCertificateJson, runtimeId,
    authenticationReceiptDigest, authenticationReceiptJson,
    recognitionReceiptDigest, recognitionReceiptJson, aiIdentityId, assuranceProfileJson,
    sessionGrantDigest, sessionGrantJson, session,
    securityEventDetailsJson,
    authenticateResponseDigest, authenticateResponseJson,
    at, expiresAt
  }) {
    const putObjectStatement = (digest, objectType, subjectRef, canonicalJson) => ({
      sql: `INSERT INTO ailp_objects(object_digest,object_type,issuer_ref,subject_ref,canonical_json,created_at)
            VALUES (?,?,?,?,?,?) ON CONFLICT(object_digest) DO NOTHING`,
      params: [digest, objectType, null, subjectRef, canonicalJson, at]
    });
    return this.sql.batch([
      {
        sql: `UPDATE ailp_challenges SET consumed_proof_digest=?, result_ref=?
              WHERE challenge_id=? AND consumed_proof_digest IS NULL`,
        params: [proofDigest, resultRef, challengeId]
      },
      putObjectStatement(runtimeCertificateDigest, 'runtime_certificate', runtimeId, runtimeCertificateJson),
      putObjectStatement(authenticationReceiptDigest, 'authentication_receipt', aiIdentityId, authenticationReceiptJson),
      putObjectStatement(recognitionReceiptDigest, 'recognition_receipt', aiIdentityId, recognitionReceiptJson),
      {
        sql: `INSERT INTO ailp_recognition_current(ai_identity_id,recognition_receipt_ref,recognition_status,assurance_profile_json,recognized_at,expires_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(ai_identity_id) DO UPDATE SET
                recognition_receipt_ref=excluded.recognition_receipt_ref,recognition_status=excluded.recognition_status,
                assurance_profile_json=excluded.assurance_profile_json,recognized_at=excluded.recognized_at,expires_at=excluded.expires_at`,
        params: [aiIdentityId, recognitionReceiptDigest, 'recognized', assuranceProfileJson, at, expiresAt]
      },
      putObjectStatement(sessionGrantDigest, 'session_grant', session.sessionId, sessionGrantJson),
      {
        sql: `INSERT INTO ailp_sessions(session_id,session_grant_ref,ai_identity_id,identity_epoch,runtime_id,runtime_key_thumbprint,
                runtime_certificate_ref,actor_binding_ref,actor_id,session_class,origin,state,issued_at,expires_at,idle_expires_at,revocation_reason)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [
          session.sessionId, sessionGrantDigest, aiIdentityId, session.identityEpoch,
          session.runtimeId, session.runtimeKeyThumbprint, session.runtimeCertificateRef,
          null, null, session.sessionClass, session.origin, 'active', at, expiresAt, null, null
        ]
      },
      {
        sql: `INSERT INTO ailp_security_events(event_type,subject_ref,object_ref,occurred_at,details_json)
              VALUES (?,?,?,?,?)`,
        params: ['login_success', aiIdentityId, session.sessionId, at, securityEventDetailsJson]
      },
      putObjectStatement(authenticateResponseDigest, 'authenticate_response', session.sessionId, authenticateResponseJson)
    ]);
  }

  // -- ailp_recognition_current --
  async putRecognition({ aiIdentityId, recognitionReceiptRef, recognitionStatus, assuranceProfileJson, recognizedAt, expiresAt }) {
    await this.sql.run(
      `INSERT INTO ailp_recognition_current(ai_identity_id,recognition_receipt_ref,recognition_status,assurance_profile_json,recognized_at,expires_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(ai_identity_id) DO UPDATE SET
         recognition_receipt_ref=excluded.recognition_receipt_ref,recognition_status=excluded.recognition_status,
         assurance_profile_json=excluded.assurance_profile_json,recognized_at=excluded.recognized_at,expires_at=excluded.expires_at`,
      [aiIdentityId, recognitionReceiptRef, recognitionStatus, assuranceProfileJson, recognizedAt, expiresAt]
    );
    return this.getRecognition(aiIdentityId);
  }

  async getRecognition(aiIdentityId) {
    return rowOrNull(await this.sql.first(`SELECT * FROM ailp_recognition_current WHERE ai_identity_id=?`, [aiIdentityId]));
  }

  // -- ailp_actor_bindings_current --
  async putActorBinding({ actorBindingReceiptRef, aiIdentityId, actorId, bindingKind, state, identityEpoch, boundAt, expiresAt = null }) {
    await this.sql.run(
      `INSERT INTO ailp_actor_bindings_current(actor_binding_receipt_ref,ai_identity_id,actor_id,binding_kind,state,identity_epoch,bound_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [actorBindingReceiptRef, aiIdentityId, actorId, bindingKind, state, identityEpoch, boundAt, expiresAt]
    );
    return rowOrNull(await this.sql.first(`SELECT * FROM ailp_actor_bindings_current WHERE actor_binding_receipt_ref=?`, [actorBindingReceiptRef]));
  }

  async getActiveSelfBindingByIdentity(aiIdentityId) {
    return rowOrNull(await this.sql.first(
      `SELECT * FROM ailp_actor_bindings_current WHERE ai_identity_id=? AND binding_kind='self_representation' AND state='active'`,
      [aiIdentityId]
    ));
  }

  async getActiveSelfBindingByActor(actorId) {
    return rowOrNull(await this.sql.first(
      `SELECT * FROM ailp_actor_bindings_current WHERE actor_id=? AND binding_kind='self_representation' AND state='active'`,
      [actorId]
    ));
  }

  // -- ailp_sessions --
  // runtimeCertificateRef pins the EXACT runtime_certificate digest verified
  // at this session's issuance -- request-proof verification must fetch by
  // this exact digest, never "the latest certificate for this runtime_id",
  // otherwise a party who only compromised the operational key (which should
  // only ever mint NEW runtime certificates for a fresh authenticate attempt)
  // could register a new certificate under the same runtime_id and hijack
  // verification of an already-active session it never actually authenticated.
  async putSession(session) {
    await this.sql.run(
      `INSERT INTO ailp_sessions(session_id,session_grant_ref,ai_identity_id,identity_epoch,runtime_id,runtime_key_thumbprint,
         runtime_certificate_ref,actor_binding_ref,actor_id,session_class,origin,state,issued_at,expires_at,idle_expires_at,revocation_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        session.sessionId, session.sessionGrantRef, session.aiIdentityId, session.identityEpoch,
        session.runtimeId, session.runtimeKeyThumbprint, session.runtimeCertificateRef,
        session.actorBindingRef ?? null, session.actorId ?? null,
        session.sessionClass, session.origin, session.state, session.issuedAt, session.expiresAt,
        session.idleExpiresAt ?? null, session.revocationReason ?? null
      ]
    );
    return this.getSession(session.sessionId);
  }

  async getSession(sessionId) {
    return rowOrNull(await this.sql.first(`SELECT * FROM ailp_sessions WHERE session_id=?`, [sessionId]));
  }

  async revokeSession(sessionId, reason) {
    const result = await this.sql.run(
      `UPDATE ailp_sessions SET state='revoked', revocation_reason=? WHERE session_id=? AND state='active'`,
      [reason, sessionId]
    );
    return Number(result.changes) > 0;
  }

  // -- ailp_request_replay_guards: insert-or-reject, never update --
  // Returns true if this (session_id, request_id) is being seen for the first
  // time (and is now recorded); false if it is a replay.
  async recordRequestOnce(sessionId, requestId, expiresAtUnix) {
    try {
      await this.sql.run(
        `INSERT INTO ailp_request_replay_guards(session_id,request_id,expires_at) VALUES (?,?,?)`,
        [sessionId, requestId, expiresAtUnix]
      );
      return true;
    } catch (e) {
      // Only a genuine (session_id, request_id) collision means "this is a
      // replay". A DB failure, FK problem, or schema error must never be
      // silently reinterpreted as REQUEST_REPLAYED -- that would hide a
      // real persistence fault behind a security-sounding false rejection.
      // Found by Sol backtracing the canonical protocol, not by design review.
      if (isUniqueConstraintError(e)) return false;
      throw e;
    }
  }

  // -- ailp_revocations --
  async putRevocation({ revocationId, subjectType, subjectRef, reason, revokedAt, evidenceRefsJson }) {
    await this.sql.run(
      `INSERT INTO ailp_revocations(revocation_id,subject_type,subject_ref,reason,revoked_at,evidence_refs_json)
       VALUES (?,?,?,?,?,?)`,
      [revocationId, subjectType, subjectRef, reason, revokedAt, evidenceRefsJson]
    );
  }

  // -- ailp_security_events: append-only journal --
  async appendSecurityEvent({ eventType, subjectRef, objectRef = null, occurredAt, detailsJson }) {
    await this.sql.run(
      `INSERT INTO ailp_security_events(event_type,subject_ref,object_ref,occurred_at,details_json)
       VALUES (?,?,?,?,?)`,
      [eventType, subjectRef, objectRef, occurredAt, detailsJson]
    );
  }

  async listSecurityEvents(subjectRef) {
    return await this.sql.all(`SELECT * FROM ailp_security_events WHERE subject_ref=? ORDER BY seq ASC`, [subjectRef]);
  }
}

module.exports = { AilpStore, isUniqueConstraintError };
