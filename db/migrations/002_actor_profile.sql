CREATE TABLE actor_profile_assertions_current (
  assertion_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  field_ref TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('assert', 'retract')),
  value_json TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'participants', 'private')),
  provenance_class TEXT,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  supersedes_assertion_id TEXT,
  target_assertion_id TEXT,
  created_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  materializer_version TEXT NOT NULL
);

CREATE INDEX actor_profile_assertions_actor_idx
ON actor_profile_assertions_current(actor_id, field_ref, active);

CREATE INDEX actor_profile_assertions_visibility_idx
ON actor_profile_assertions_current(actor_id, visibility, active);

CREATE TABLE actor_profile_current (
  actor_id TEXT PRIMARY KEY,
  projection_json TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  materializer_version TEXT NOT NULL
);
