CREATE TABLE ailp_objects (
  object_digest TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  issuer_ref TEXT,
  subject_ref TEXT,
  canonical_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE ailp_challenges (
  challenge_id TEXT PRIMARY KEY,
  request_digest TEXT NOT NULL,
  challenge_json TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_proof_digest TEXT,
  result_ref TEXT,
  CHECK ((consumed_proof_digest IS NULL AND result_ref IS NULL) OR
         (consumed_proof_digest IS NOT NULL AND result_ref IS NOT NULL))
);

CREATE TABLE ailp_recognition_current (
  ai_identity_id TEXT PRIMARY KEY,
  recognition_receipt_ref TEXT NOT NULL,
  recognition_status TEXT NOT NULL,
  assurance_profile_json TEXT NOT NULL,
  recognized_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (recognition_status IN ('recognized','provisional','pending_review','not_recognized'))
);

CREATE TABLE ailp_actor_bindings_current (
  actor_binding_receipt_ref TEXT PRIMARY KEY,
  ai_identity_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  binding_kind TEXT NOT NULL,
  state TEXT NOT NULL,
  identity_epoch INTEGER NOT NULL,
  bound_at TEXT NOT NULL,
  expires_at TEXT,
  CHECK (identity_epoch >= 1),
  CHECK (binding_kind IN ('self_representation','delegated_representation','service_operator','co_actor')),
  CHECK (state IN ('active','revoked','expired','requires_revalidation'))
);

CREATE UNIQUE INDEX uq_ailp_active_self_binding_identity
ON ailp_actor_bindings_current(ai_identity_id)
WHERE binding_kind='self_representation' AND state='active';

CREATE UNIQUE INDEX uq_ailp_active_self_binding_actor
ON ailp_actor_bindings_current(actor_id)
WHERE binding_kind='self_representation' AND state='active';

CREATE TABLE ailp_sessions (
  session_id TEXT PRIMARY KEY,
  session_grant_ref TEXT NOT NULL,
  ai_identity_id TEXT NOT NULL,
  identity_epoch INTEGER NOT NULL,
  runtime_id TEXT NOT NULL,
  runtime_key_thumbprint TEXT NOT NULL,
  actor_binding_ref TEXT,
  actor_id TEXT,
  session_class TEXT NOT NULL,
  origin TEXT NOT NULL,
  state TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  idle_expires_at TEXT,
  revocation_reason TEXT,
  CHECK (identity_epoch >= 1),
  CHECK (session_class IN ('identity_only','actor_bound','recovery_only')),
  CHECK (state IN ('active','revoked','expired','terminated')),
  CHECK ((session_class='actor_bound' AND actor_binding_ref IS NOT NULL AND actor_id IS NOT NULL) OR
         (session_class<>'actor_bound' AND actor_binding_ref IS NULL AND actor_id IS NULL))
);

CREATE INDEX idx_ailp_sessions_identity_state
ON ailp_sessions(ai_identity_id, identity_epoch, state, expires_at);

CREATE TABLE ailp_request_replay_guards (
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, request_id),
  FOREIGN KEY (session_id) REFERENCES ailp_sessions(session_id)
);

CREATE TABLE ailp_revocations (
  revocation_id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  reason TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL
);

CREATE INDEX idx_ailp_revocations_subject
ON ailp_revocations(subject_type, subject_ref, revoked_at);

CREATE TABLE ailp_security_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  object_ref TEXT,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL
);

CREATE TRIGGER ailp_objects_no_update
BEFORE UPDATE ON ailp_objects
BEGIN
  SELECT RAISE(ABORT, 'AILP object store is immutable');
END;

CREATE TRIGGER ailp_objects_no_delete
BEFORE DELETE ON ailp_objects
BEGIN
  SELECT RAISE(ABORT, 'AILP object store is immutable');
END;

CREATE TRIGGER ailp_security_events_no_update
BEFORE UPDATE ON ailp_security_events
BEGIN
  SELECT RAISE(ABORT, 'AILP security event journal is append-only');
END;

CREATE TRIGGER ailp_security_events_no_delete
BEFORE DELETE ON ailp_security_events
BEGIN
  SELECT RAISE(ABORT, 'AILP security event journal is append-only');
END;
