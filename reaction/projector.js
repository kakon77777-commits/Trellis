const { foldReaction } = require('./fold');

const MATERIALIZER_VERSION = 'reaction-materializer:0.1';

function upsertReactionState(db, state) {
  db.prepare(`
    INSERT INTO reactions_current (
      reaction_id, actor_id, publication_id, scope_ref, visibility,
      audience_actor_ids_json, reaction_policy_ref, lifecycle, reaction_type,
      created_event_id, last_event_id, stream_version, materializer_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reaction_id) DO UPDATE SET
      actor_id=excluded.actor_id,
      publication_id=excluded.publication_id,
      scope_ref=excluded.scope_ref,
      visibility=excluded.visibility,
      audience_actor_ids_json=excluded.audience_actor_ids_json,
      reaction_policy_ref=excluded.reaction_policy_ref,
      lifecycle=excluded.lifecycle,
      reaction_type=excluded.reaction_type,
      created_event_id=excluded.created_event_id,
      last_event_id=excluded.last_event_id,
      stream_version=excluded.stream_version,
      materializer_version=excluded.materializer_version
  `).run(
    state.reaction_id,
    state.actor_id,
    state.publication_id,
    state.scope_ref ?? null,
    state.visibility,
    JSON.stringify(state.audience_actor_ids ?? []),
    state.reaction_policy_ref,
    state.lifecycle,
    state.reaction_type ?? null,
    state.created_event_id,
    state.last_event_id,
    state.stream_version,
    MATERIALIZER_VERSION
  );
}

function projectReactionStream(db, eventStore, reactionId) {
  const events = eventStore.readStream('reaction', reactionId);
  if (events.length === 0) return null;
  const state = foldReaction(events);
  upsertReactionState(db, state);
  return state;
}

function rebuildReactionProjection(db, eventStore) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM reactions_current');
    const rows = db.prepare(`
      SELECT DISTINCT stream_id
      FROM canonical_events
      WHERE stream_type='reaction'
      ORDER BY stream_id
    `).all();
    for (const row of rows) projectReactionStream(db, eventStore, row.stream_id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { MATERIALIZER_VERSION, projectReactionStream, rebuildReactionProjection };
