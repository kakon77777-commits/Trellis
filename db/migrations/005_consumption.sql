CREATE TABLE consumption_state (
  consumer_actor_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  first_seen_at TEXT,
  first_opened_at TEXT,
  last_touched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  retention_policy_ref TEXT NOT NULL,
  PRIMARY KEY (consumer_actor_id, target_kind, target_ref)
);

CREATE INDEX consumption_state_expiry_idx
ON consumption_state(expires_at);

CREATE INDEX consumption_state_consumer_idx
ON consumption_state(consumer_actor_id, last_touched_at, target_kind, target_ref);
