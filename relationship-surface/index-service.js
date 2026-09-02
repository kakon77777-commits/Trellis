const { canViewRelationship } = require('../profile/read-policy');

function relationshipIndexItem(row) {
  return {
    relationship_id: row.relationship_id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    relationship_type: row.relationship_type,
    scope_ref: row.scope_ref ?? null,
    visibility: row.visibility,
    lifecycle: row.lifecycle,
    termination_reason: row.termination_reason ?? null,
    detail_ref: `/relationships/${encodeURIComponent(row.relationship_id)}`
  };
}

function buildRelationshipIndex({ actorId, viewerContext = {}, db, disclosurePolicy, membershipResolver }) {
  const candidates = db.prepare(`
    SELECT * FROM relationships_current
    WHERE source_entity_id = ? OR target_entity_id = ?
    ORDER BY relationship_id
  `).all(actorId, actorId);

  const visible = candidates.filter(row => canViewRelationship(row, viewerContext, disclosurePolicy, membershipResolver));
  const result = {
    actor_id: actorId,
    active: [],
    pending_incoming: [],
    pending_outgoing: [],
    historical_terminated: [],
    counts: {
      active: 0,
      pending_incoming: 0,
      pending_outgoing: 0,
      historical_terminated: 0
    },
    projection_version: 'relationship-index:0.1'
  };

  for (const row of visible) {
    const item = relationshipIndexItem(row);
    if (row.lifecycle === 'active') result.active.push(item);
    else if (row.lifecycle === 'proposed') {
      if (row.source_entity_id === actorId) result.pending_outgoing.push(item);
      else result.pending_incoming.push(item);
    } else if (row.lifecycle === 'terminated') {
      result.historical_terminated.push(item);
    }
  }

  result.counts.active = result.active.length;
  result.counts.pending_incoming = result.pending_incoming.length;
  result.counts.pending_outgoing = result.pending_outgoing.length;
  result.counts.historical_terminated = result.historical_terminated.length;
  return result;
}

module.exports = { buildRelationshipIndex, relationshipIndexItem };
