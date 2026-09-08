CREATE TABLE IF NOT EXISTS stream_heads (
  stream_type TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  event_hash TEXT,
  last_event_id TEXT,
  append_token TEXT,
  PRIMARY KEY (stream_type, stream_id)
);

CREATE TABLE IF NOT EXISTS append_batch_guards (
  append_token TEXT PRIMARY KEY,
  acquired INTEGER NOT NULL CHECK (acquired = 1)
);

INSERT OR IGNORE INTO stream_heads (
  stream_type, stream_id, version, event_hash, last_event_id, append_token
)
SELECT
  event.stream_type,
  event.stream_id,
  event.stream_seq,
  event.event_hash,
  event.event_id,
  NULL
FROM canonical_events AS event
WHERE NOT EXISTS (
  SELECT 1
  FROM canonical_events AS newer
  WHERE newer.stream_type = event.stream_type
    AND newer.stream_id = event.stream_id
    AND newer.stream_seq > event.stream_seq
);
