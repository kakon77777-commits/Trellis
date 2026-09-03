PRAGMA foreign_keys = ON;

CREATE TABLE authority_receipts (
  decision_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  policy_ref TEXT NOT NULL,
  requested_action TEXT NOT NULL,
  aggregate_id TEXT,
  credential_refs_json TEXT NOT NULL DEFAULT '[]',
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  evaluated_at TEXT NOT NULL,
  receipt_json TEXT NOT NULL
);

CREATE TABLE command_receipts (
  command_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  command_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('accepted', 'rejected', 'conflict', 'deduplicated')
  ),
  result_event_ids_json TEXT NOT NULL DEFAULT '[]',
  stream_version_before INTEGER,
  stream_version_after INTEGER,
  authority_receipt_ref TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (authority_receipt_ref)
    REFERENCES authority_receipts(decision_id)
);

CREATE TABLE canonical_events (
  global_offset INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  event_type TEXT NOT NULL,
  stream_type TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  stream_seq INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  time_source TEXT NOT NULL,
  authority_receipt_ref TEXT NOT NULL,
  provenance_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL,
  prev_event_hash TEXT,
  event_hash TEXT NOT NULL,
  UNIQUE (stream_type, stream_id, stream_seq),
  FOREIGN KEY (authority_receipt_ref)
    REFERENCES authority_receipts(decision_id)
);

CREATE TABLE entities_current (
  entity_id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  actor_capable INTEGER NOT NULL CHECK (actor_capable IN (0, 1)),
  lifecycle TEXT NOT NULL,
  created_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL
);

CREATE TABLE relationships_current (
  relationship_id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  scope_ref TEXT,
  taxonomy_ref TEXT NOT NULL,
  visibility TEXT NOT NULL,
  visibility_policy_ref TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  termination_reason TEXT,
  open_contestation_count INTEGER NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  created_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  materializer_version TEXT NOT NULL
);


CREATE TABLE publications_current (
  publication_id TEXT PRIMARY KEY,
  author_actor_id TEXT NOT NULL,
  publication_type TEXT NOT NULL,
  scope_ref TEXT,
  visibility TEXT NOT NULL,
  audience_actor_ids_json TEXT NOT NULL DEFAULT '[]',
  reply_to_ref TEXT,
  quote_of_ref TEXT,
  publication_policy_ref TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  withdrawal_reason TEXT,
  current_revision INTEGER NOT NULL,
  current_body TEXT NOT NULL,
  created_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  materializer_version TEXT NOT NULL
);

CREATE INDEX publications_current_author_idx
ON publications_current(author_actor_id, publication_id);

CREATE INDEX publications_current_scope_idx
ON publications_current(scope_ref, visibility, lifecycle);

CREATE INDEX publications_current_reply_idx
ON publications_current(reply_to_ref, publication_id);

CREATE INDEX publications_current_quote_idx
ON publications_current(quote_of_ref, publication_id);


CREATE TABLE reactions_current (
  reaction_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  scope_ref TEXT,
  visibility TEXT NOT NULL,
  audience_actor_ids_json TEXT NOT NULL DEFAULT '[]',
  reaction_policy_ref TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  reaction_type TEXT,
  created_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  materializer_version TEXT NOT NULL,
  UNIQUE(actor_id, publication_id)
);

CREATE INDEX reactions_current_publication_idx
ON reactions_current(publication_id, lifecycle, reaction_id);

CREATE INDEX canonical_events_stream_idx
ON canonical_events(stream_type, stream_id, stream_seq);

CREATE INDEX relationships_current_source_idx
ON relationships_current(source_entity_id, relationship_type);

CREATE INDEX relationships_current_target_idx
ON relationships_current(target_entity_id, relationship_type);

CREATE INDEX relationships_current_public_idx
ON relationships_current(visibility, lifecycle);
