const { EventStore } = require('./event-store');
const { computeEventHash } = require('../core/hash-chain');
const {
  VersionConflictError,
  IdempotencyConflictError
} = require('../core/errors');

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  return JSON.parse(value);
}

function receiptFromRow(row) {
  if (!row) return null;
  return {
    command_id: row.command_id,
    idempotency_key: row.idempotency_key,
    command_digest: row.command_digest,
    status: row.status,
    result_event_ids: parseJson(row.result_event_ids_json, []),
    stream_version_before: row.stream_version_before,
    stream_version_after: row.stream_version_after,
    authority_receipt_ref: row.authority_receipt_ref,
    created_at: row.created_at
  };
}

function eventFromRow(row) {
  return {
    global_offset: row.global_offset,
    event_id: row.event_id,
    schema_version: row.schema_version,
    event_type: row.event_type,
    stream_type: row.stream_type,
    stream_id: row.stream_id,
    stream_seq: row.stream_seq,
    actor_id: row.actor_id,
    principal_id: row.principal_id,
    causation_id: row.causation_id,
    correlation_id: row.correlation_id,
    occurred_at: row.occurred_at,
    recorded_at: row.recorded_at,
    time_source: row.time_source,
    authority_receipt_ref: row.authority_receipt_ref,
    provenance_refs: parseJson(row.provenance_refs_json, []),
    payload: parseJson(row.payload_json, {}),
    prev_event_hash: row.prev_event_hash,
    event_hash: row.event_hash
  };
}

class SQLiteEventStore extends EventStore {
  constructor(db, { now = () => new Date().toISOString() } = {}) {
    super();
    this.db = db;
    this.now = now;
  }

  lookupIdempotency(idempotencyKey) {
    const row = this.db.prepare(`
      SELECT * FROM command_receipts
      WHERE idempotency_key = ?
    `).get(idempotencyKey);
    return receiptFromRow(row);
  }

  readStream(streamType, streamId) {
    return this.db.prepare(`
      SELECT * FROM canonical_events
      WHERE stream_type = ? AND stream_id = ?
      ORDER BY stream_seq ASC
    `).all(streamType, streamId).map(eventFromRow);
  }

  readEvent(eventId) {
    const row = this.db.prepare(`
      SELECT * FROM canonical_events
      WHERE event_id = ?
    `).get(eventId);
    return eventFromRow(row);
  }

  verifyHashChain(streamType, streamId) {
    const events = this.readStream(streamType, streamId);
    let expectedPrevHash = null;

    for (const event of events) {
      if (event.prev_event_hash !== expectedPrevHash) {
        return { ok: false, failureAt: event.stream_seq };
      }

      const { global_offset, event_hash, ...eventWithoutHash } = event;
      const expectedHash = computeEventHash(eventWithoutHash, expectedPrevHash);
      if (expectedHash !== event_hash) {
        return { ok: false, failureAt: event.stream_seq };
      }
      expectedPrevHash = event_hash;
    }

    return { ok: true, failureAt: null };
  }

  append({
    streamType,
    streamId,
    expectedVersion,
    events,
    authorityReceipt,
    commandReceipt
  }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.lookupIdempotency(commandReceipt.idempotency_key);
      if (prior) {
        if (prior.command_digest !== commandReceipt.command_digest) {
          throw new IdempotencyConflictError();
        }
        this.db.exec('COMMIT');
        return { ...prior, deduplicated: true };
      }

      const current = this.db.prepare(`
        SELECT COALESCE(MAX(stream_seq), 0) AS version
        FROM canonical_events
        WHERE stream_type = ? AND stream_id = ?
      `).get(streamType, streamId).version;

      if (current !== expectedVersion) {
        throw new VersionConflictError();
      }

      this.db.prepare(`
        INSERT INTO authority_receipts (
          decision_id, principal_id, actor_id, policy_ref,
          requested_action, aggregate_id, credential_refs_json,
          decision, evaluated_at, receipt_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        authorityReceipt.decision_id,
        authorityReceipt.principal_id,
        authorityReceipt.actor_id,
        authorityReceipt.policy_ref,
        authorityReceipt.requested_action,
        authorityReceipt.aggregate_id ?? null,
        JSON.stringify(authorityReceipt.credential_refs ?? []),
        authorityReceipt.decision,
        authorityReceipt.evaluated_at,
        JSON.stringify(authorityReceipt)
      );

      const previous = this.db.prepare(`
        SELECT event_hash FROM canonical_events
        WHERE stream_type = ? AND stream_id = ?
        ORDER BY stream_seq DESC LIMIT 1
      `).get(streamType, streamId);

      let prevEventHash = previous?.event_hash ?? null;
      const resultEventIds = [];
      let seq = current;

      const insertEvent = this.db.prepare(`
        INSERT INTO canonical_events (
          event_id, schema_version, event_type,
          stream_type, stream_id, stream_seq,
          actor_id, principal_id, causation_id, correlation_id,
          occurred_at, recorded_at, time_source,
          authority_receipt_ref, provenance_refs_json, payload_json,
          prev_event_hash, event_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const draft of events) {
        seq += 1;
        const eventWithoutHash = {
          event_id: draft.event_id,
          schema_version: draft.schema_version,
          event_type: draft.event_type,
          stream_type: streamType,
          stream_id: streamId,
          stream_seq: seq,
          actor_id: draft.actor_id,
          principal_id: draft.principal_id,
          causation_id: draft.causation_id,
          correlation_id: draft.correlation_id,
          occurred_at: draft.occurred_at,
          recorded_at: this.now(),
          time_source: draft.time_source,
          authority_receipt_ref: authorityReceipt.decision_id,
          provenance_refs: draft.provenance_refs ?? [],
          payload: draft.payload ?? {},
          prev_event_hash: prevEventHash
        };
        const eventHash = computeEventHash(eventWithoutHash, prevEventHash);
        insertEvent.run(
          eventWithoutHash.event_id,
          eventWithoutHash.schema_version,
          eventWithoutHash.event_type,
          eventWithoutHash.stream_type,
          eventWithoutHash.stream_id,
          eventWithoutHash.stream_seq,
          eventWithoutHash.actor_id,
          eventWithoutHash.principal_id,
          eventWithoutHash.causation_id,
          eventWithoutHash.correlation_id,
          eventWithoutHash.occurred_at,
          eventWithoutHash.recorded_at,
          eventWithoutHash.time_source,
          eventWithoutHash.authority_receipt_ref,
          JSON.stringify(eventWithoutHash.provenance_refs),
          JSON.stringify(eventWithoutHash.payload),
          eventWithoutHash.prev_event_hash,
          eventHash
        );
        prevEventHash = eventHash;
        resultEventIds.push(eventWithoutHash.event_id);
      }

      const storedReceipt = {
        command_id: commandReceipt.command_id,
        idempotency_key: commandReceipt.idempotency_key,
        command_digest: commandReceipt.command_digest,
        status: commandReceipt.status ?? 'accepted',
        result_event_ids: resultEventIds,
        stream_version_before: current,
        stream_version_after: seq,
        authority_receipt_ref: authorityReceipt.decision_id,
        created_at: commandReceipt.created_at
      };

      this.db.prepare(`
        INSERT INTO command_receipts (
          command_id, idempotency_key, command_digest, status,
          result_event_ids_json, stream_version_before,
          stream_version_after, authority_receipt_ref, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        storedReceipt.command_id,
        storedReceipt.idempotency_key,
        storedReceipt.command_digest,
        storedReceipt.status,
        JSON.stringify(storedReceipt.result_event_ids),
        storedReceipt.stream_version_before,
        storedReceipt.stream_version_after,
        storedReceipt.authority_receipt_ref,
        storedReceipt.created_at
      );

      this.db.exec('COMMIT');
      return storedReceipt;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

module.exports = { SQLiteEventStore };
