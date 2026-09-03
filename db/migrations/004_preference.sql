CREATE TABLE preferences_current (
  preference_id TEXT PRIMARY KEY,
  owner_actor_id TEXT NOT NULL,
  preference_type TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  target_item_kind TEXT,
  lifecycle TEXT NOT NULL,
  created_event_id TEXT NOT NULL,
  restored_event_id TEXT,
  withdrawn_event_id TEXT,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  materializer_version TEXT NOT NULL
);
CREATE INDEX preferences_current_owner_idx
ON preferences_current(owner_actor_id, lifecycle, preference_type, target_kind, target_ref, preference_id);
