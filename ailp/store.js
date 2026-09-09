// Exclusive owner of the ailp_* bounded-context tables (db/migrations/007_ailp.sql).
// No other module may reference these tables directly -- Sol's implementation
// contract requires publication/relationship services to reach AILP state only
// through the authenticated adapter (ailp/context.js), never raw SQL.
const { AILPError } = require('./canonical');

function rowOrNull(row) {
  return row || null;
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

  // Returns { firstConsumption: true, resultRef } on first consumption,
  // { firstConsumption: false, resultRef } if replayed with the SAME proof digest
  // (idempotent retry), or throws AILP_CHALLENGE_PROOF_MISMATCH if replayed with
  // a DIFFERENT proof digest (someone trying to reuse the challenge slot).
  async consumeChallenge(challengeId, { proofDigest, resultRef }) {
    const existing = await this.getChallenge(challengeId);
    if (!existing) throw new AILPError('AILP_CHALLENGE_NOT_FOUND');
    if (existing.consumed_proof_digest != null) {
      if (existing.consumed_proof_digest !== proofDigest) throw new AILPError('AILP_CHALLENGE_PROOF_MISMATCH');
      return { firstConsumption: false, resultRef: existing.result_ref };
    }
    const result = await this.sql.run(
      `UPDATE ailp_challenges SET consumed_proof_digest=?, result_ref=?
       WHERE challenge_id=? AND consumed_proof_digest IS NULL`,
      [proofDigest, resultRef, challengeId]
    );
    if (Number(result.changes) === 0) {
      // Lost a race with a concurrent consumer; re-read and treat like a replay.
      const raced = await this.getChallenge(challengeId);
      if (raced && raced.consumed_proof_digest === proofDigest) return { firstConsumption: false, resultRef: raced.result_ref };
      throw new AILPError('AILP_CHALLENGE_PROOF_MISMATCH');
    }
    return { firstConsumption: true, resultRef };
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
      return false;
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

module.exports = { AilpStore };
