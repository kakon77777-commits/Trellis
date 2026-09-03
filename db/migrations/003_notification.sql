CREATE TABLE notifications_current (
  notification_id TEXT PRIMARY KEY,
  recipient_actor_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  source_event_ref TEXT NOT NULL,
  source_object_ref TEXT NOT NULL,
  source_actor_id TEXT NOT NULL,
  rule_ref TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility = 'private'),
  acknowledged INTEGER NOT NULL CHECK (acknowledged IN (0, 1)),
  issued_event_id TEXT NOT NULL,
  acknowledged_event_id TEXT,
  issued_recorded_at TEXT NOT NULL,
  issued_global_offset INTEGER NOT NULL,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  materializer_version TEXT NOT NULL
);

CREATE INDEX notifications_current_recipient_idx
ON notifications_current(recipient_actor_id, acknowledged, issued_global_offset DESC, notification_id);

CREATE INDEX notifications_current_source_event_idx
ON notifications_current(source_event_ref, rule_ref, recipient_actor_id);
