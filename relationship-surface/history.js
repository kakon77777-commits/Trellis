function loadSafeAuthoritySummary(db, ref) {
  if (!ref) return null;
  const row = db.prepare(`
    SELECT decision_id, decision, policy_ref
    FROM authority_receipts
    WHERE decision_id = ?
  `).get(ref);
  if (!row) return null;
  return {
    decision_ref: row.decision_id,
    decision: row.decision,
    policy_ref: row.policy_ref
  };
}

function safeHistoryItem(event, db) {
  return {
    event_id: event.event_id,
    type: event.event_type,
    stream_seq: event.stream_seq,
    actor_id: event.actor_id,
    occurred_at: event.occurred_at,
    recorded_at: event.recorded_at,
    payload: event.payload ?? {},
    provenance_refs: event.provenance_refs ?? [],
    authority: loadSafeAuthoritySummary(db, event.authority_receipt_ref)
  };
}

function projectRelationshipHistory({ events, db }) {
  const history = events.map(event => safeHistoryItem(event, db));
  const evidence = [];
  const annotations = [];
  const contestations = new Map();

  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.event_type === 'relationship.evidence_added') {
      evidence.push({
        event_id: event.event_id,
        evidence_ref: payload.evidence_ref,
        actor_id: event.actor_id,
        occurred_at: event.occurred_at
      });
    } else if (event.event_type === 'relationship.annotation_added') {
      annotations.push({
        event_id: event.event_id,
        note: payload.note,
        actor_id: event.actor_id,
        occurred_at: event.occurred_at
      });
    } else if (event.event_type === 'relationship.contestation_opened') {
      contestations.set(payload.contestation_id, {
        contestation_id: payload.contestation_id,
        status: 'open',
        claim: payload.claim ?? null,
        open_event_id: event.event_id,
        opened_by: event.actor_id,
        opened_at: event.occurred_at,
        open_evidence_refs: payload.evidence_refs ?? [],
        resolution: null,
        resolution_event_id: null,
        resolved_by: null,
        resolved_at: null,
        resolution_evidence_refs: []
      });
    } else if (event.event_type === 'relationship.contestation_resolved') {
      const existing = contestations.get(payload.contestation_id);
      if (existing) {
        existing.status = 'resolved';
        existing.resolution = payload.resolution;
        existing.resolution_event_id = event.event_id;
        existing.resolved_by = event.actor_id;
        existing.resolved_at = event.occurred_at;
        existing.resolution_evidence_refs = payload.evidence_refs ?? [];
      }
    }
  }

  return {
    history,
    evidence,
    contestations: [...contestations.values()],
    annotations
  };
}

module.exports = { projectRelationshipHistory, loadSafeAuthoritySummary };
