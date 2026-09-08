const { randomUUID } = require('node:crypto');
const { EventStore } = require('./event-store');
const { computeEventHash } = require('../core/hash-chain');
const {
  VersionConflictError,
  IdempotencyConflictError,
  StorageInvariantError
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
  if (!row) return null;
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

function authorityInsert(authorityReceipt) {
  return {
    sql: `
      INSERT INTO authority_receipts (
        decision_id, principal_id, actor_id, policy_ref,
        requested_action, aggregate_id, credential_refs_json,
        decision, evaluated_at, receipt_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
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
    ]
  };
}

function eventInsert(event, eventHash) {
  return {
    sql: `
      INSERT INTO canonical_events (
        event_id, schema_version, event_type,
        stream_type, stream_id, stream_seq,
        actor_id, principal_id, causation_id, correlation_id,
        occurred_at, recorded_at, time_source,
        authority_receipt_ref, provenance_refs_json, payload_json,
        prev_event_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      event.event_id,
      event.schema_version,
      event.event_type,
      event.stream_type,
      event.stream_id,
      event.stream_seq,
      event.actor_id,
      event.principal_id,
      event.causation_id,
      event.correlation_id,
      event.occurred_at,
      event.recorded_at,
      event.time_source,
      event.authority_receipt_ref,
      JSON.stringify(event.provenance_refs),
      JSON.stringify(event.payload),
      event.prev_event_hash,
      eventHash
    ]
  };
}

class AsyncSqlEventStore extends EventStore {
  constructor(sql, {
    now = () => new Date().toISOString(),
    token = () => randomUUID()
  } = {}) {
    super();
    this.sql = sql;
    this.now = now;
    this.token = token;
  }

  async lookupIdempotency(idempotencyKey, sql = this.sql) {
    const row = await sql.first(`
      SELECT * FROM command_receipts
      WHERE idempotency_key = ?
    `, [idempotencyKey]);
    return receiptFromRow(row);
  }

  async readStream(streamType, streamId) {
    const rows = await this.sql.all(`
      SELECT * FROM canonical_events
      WHERE stream_type = ? AND stream_id = ?
      ORDER BY stream_seq ASC
    `, [streamType, streamId]);
    return rows.map(eventFromRow);
  }

  async readEvent(eventId) {
    return eventFromRow(await this.sql.first(`
      SELECT * FROM canonical_events
      WHERE event_id = ?
    `, [eventId]));
  }

  async verifyHashChain(streamType, streamId) {
    const events = await this.readStream(streamType, streamId);
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

  async append({
    streamType,
    streamId,
    expectedVersion,
    events,
    authorityReceipt,
    commandReceipt
  }) {
    const session = this.sql.session({ consistency: 'primary' });
    const prior = await this.lookupIdempotency(commandReceipt.idempotency_key, session);
    if (prior) {
      if (prior.command_digest !== commandReceipt.command_digest) {
        throw new IdempotencyConflictError();
      }
      return { ...prior, deduplicated: true };
    }

    const head = await session.first(`
      SELECT version, event_hash, last_event_id
      FROM stream_heads
      WHERE stream_type = ? AND stream_id = ?
    `, [streamType, streamId]);
    const current = head?.version ?? 0;
    if (current !== expectedVersion) {
      throw new VersionConflictError();
    }

    let seq = current;
    let prevEventHash = head?.event_hash ?? null;
    const storedEvents = [];
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
      storedEvents.push({ event: eventWithoutHash, hash: eventHash });
      prevEventHash = eventHash;
    }

    const appendToken = this.token();
    const resultEventIds = storedEvents.map(entry => entry.event.event_id);
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

    const batch = [
      {
        sql: `
          INSERT INTO stream_heads (
            stream_type, stream_id, version, event_hash, last_event_id, append_token
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(stream_type, stream_id) DO UPDATE SET
            version = excluded.version,
            event_hash = excluded.event_hash,
            last_event_id = excluded.last_event_id,
            append_token = excluded.append_token
          WHERE stream_heads.version = ?
        `,
        params: [
          streamType,
          streamId,
          seq,
          prevEventHash,
          storedEvents.at(-1)?.event.event_id ?? head?.last_event_id ?? null,
          appendToken,
          expectedVersion
        ]
      },
      {
        sql: `
          INSERT INTO append_batch_guards (append_token, acquired)
          VALUES (
            ?,
            CASE WHEN EXISTS (
              SELECT 1 FROM stream_heads
              WHERE stream_type = ?
                AND stream_id = ?
                AND append_token = ?
            ) THEN 1 ELSE 0 END
          )
        `,
        params: [appendToken, streamType, streamId, appendToken]
      },
      authorityInsert(authorityReceipt),
      ...storedEvents.map(entry => eventInsert(entry.event, entry.hash)),
      {
        sql: `
          INSERT INTO command_receipts (
            command_id, idempotency_key, command_digest, status,
            result_event_ids_json, stream_version_before,
            stream_version_after, authority_receipt_ref, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        params: [
          storedReceipt.command_id,
          storedReceipt.idempotency_key,
          storedReceipt.command_digest,
          storedReceipt.status,
          JSON.stringify(storedReceipt.result_event_ids),
          storedReceipt.stream_version_before,
          storedReceipt.stream_version_after,
          storedReceipt.authority_receipt_ref,
          storedReceipt.created_at
        ]
      },
      {
        sql: 'DELETE FROM append_batch_guards WHERE append_token = ?',
        params: [appendToken]
      }
    ];

    try {
      await session.batch(batch);
      return storedReceipt;
    } catch (error) {
      const afterReceipt = await this.lookupIdempotency(commandReceipt.idempotency_key, session);
      if (afterReceipt) {
        if (afterReceipt.command_digest === commandReceipt.command_digest) {
          return { ...afterReceipt, deduplicated: true };
        }
        throw new IdempotencyConflictError();
      }
      const afterHead = await session.first(`
        SELECT version FROM stream_heads
        WHERE stream_type = ? AND stream_id = ?
      `, [streamType, streamId]);
      if ((afterHead?.version ?? 0) !== expectedVersion) {
        throw new VersionConflictError();
      }
      throw new StorageInvariantError('STORAGE_INVARIANT', { cause: error });
    }
  }
}

module.exports = { AsyncSqlEventStore, receiptFromRow, eventFromRow };
