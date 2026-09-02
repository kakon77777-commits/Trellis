const { foldRelationship } = require('../relationship/fold');

const MATERIALIZER_VERSION = 'relationship-materializer:0.1';

function upsertRelationshipState(db, state) {
  db.prepare(`
    INSERT INTO relationships_current (
      relationship_id, source_entity_id, target_entity_id,
      relationship_type, scope_ref, taxonomy_ref,
      visibility, visibility_policy_ref, lifecycle,
      termination_reason, open_contestation_count, evidence_count,
      created_event_id, last_event_id, stream_version, materializer_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(relationship_id) DO UPDATE SET
      source_entity_id = excluded.source_entity_id,
      target_entity_id = excluded.target_entity_id,
      relationship_type = excluded.relationship_type,
      scope_ref = excluded.scope_ref,
      taxonomy_ref = excluded.taxonomy_ref,
      visibility = excluded.visibility,
      visibility_policy_ref = excluded.visibility_policy_ref,
      lifecycle = excluded.lifecycle,
      termination_reason = excluded.termination_reason,
      open_contestation_count = excluded.open_contestation_count,
      evidence_count = excluded.evidence_count,
      created_event_id = excluded.created_event_id,
      last_event_id = excluded.last_event_id,
      stream_version = excluded.stream_version,
      materializer_version = excluded.materializer_version
  `).run(
    state.relationship_id,
    state.source_entity_id,
    state.target_entity_id,
    state.relationship_type,
    state.scope_ref,
    state.taxonomy_ref,
    state.visibility,
    state.visibility_policy_ref,
    state.lifecycle,
    state.termination_reason,
    state.open_contestation_count,
    state.evidence_count,
    state.created_event_id,
    state.last_event_id,
    state.stream_version,
    MATERIALIZER_VERSION
  );
}

function projectRelationshipStream(db, eventStore, streamId) {
  const events = eventStore.readStream('relationship', streamId);
  if (events.length === 0) return null;
  const state = foldRelationship(events);
  upsertRelationshipState(db, state);
  return state;
}

function projectRelationshipEvent(db, eventStore, event) {
  if (event.stream_type !== 'relationship') return null;
  return projectRelationshipStream(db, eventStore, event.stream_id);
}

function rebuildRelationshipProjection(db, eventStore) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM relationships_current');
    const streams = db.prepare(`
      SELECT DISTINCT stream_id
      FROM canonical_events
      WHERE stream_type = 'relationship'
      ORDER BY stream_id
    `).all();
    for (const row of streams) {
      projectRelationshipStream(db, eventStore, row.stream_id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  MATERIALIZER_VERSION,
  projectRelationshipEvent,
  rebuildRelationshipProjection
};
