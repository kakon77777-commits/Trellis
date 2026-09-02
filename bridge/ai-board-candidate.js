const { deriveId } = require('../core/ids');

const SUPPORTED = new Set(['reply', 'objection', 'correction', 'artifact', 'review']);

function fromAiBoardEvent(boardEvent) {
  if (!boardEvent || !SUPPORTED.has(boardEvent.event_type)) return null;
  const sourceEventRef = boardEvent.event_id ?? null;
  return {
    candidate_id: deriveId('candidate', sourceEventRef ?? JSON.stringify(boardEvent)),
    source_system: 'ai-board',
    source_event_ref: sourceEventRef,
    candidate_type: 'relationship_evidence_candidate',
    proposed_relationship_type: boardEvent.meta?.proposed_relationship_type ?? null,
    source_actor_ref: boardEvent.actor_ref ?? null,
    target_actor_ref: boardEvent.target_actor_ref ?? null,
    scope_ref: boardEvent.scope_ref ?? null,
    evidence_refs: [...(boardEvent.evidence_refs ?? [])],
    inference: {
      method: boardEvent.inference?.method ?? null,
      confidence: boardEvent.inference?.confidence ?? null
    },
    promotion_status: 'unpromoted'
  };
}

module.exports = { fromAiBoardEvent };
