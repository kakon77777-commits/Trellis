const { foldEntity } = require('../entity/fold');
const { foldProfileAssertions } = require('./fold');
const { loadAuthorityReceipt, classifyAssertionProvenance } = require('./provenance');

const MATERIALIZER_VERSION = 'actor-profile-materializer:0.1';

function toProjectionJson(entityState, profileState) {
  const activeSingle = Object.fromEntries(
    Object.entries(profileState.active_single).map(([fieldRef, assertion]) => [fieldRef, assertion.assertion_id])
  );
  const activeMulti = Object.fromEntries(
    Object.entries(profileState.active_multi).map(([fieldRef, assertions]) => [
      fieldRef,
      assertions.map(assertion => assertion.assertion_id)
    ])
  );
  return JSON.stringify({
    actor_id: entityState.entity_id,
    entity_kind: entityState.entity_kind,
    lifecycle: entityState.lifecycle,
    active_single: activeSingle,
    active_multi: activeMulti,
    runtime_binding_count: entityState.runtime_bindings.length
  });
}

function writeActorProjection(db, eventStore, actorId) {
  const events = eventStore.readStream('entity', actorId);
  if (events.length === 0) return false;
  const entityState = foldEntity(events);
  const profileState = foldProfileAssertions(events);

  db.prepare('DELETE FROM actor_profile_assertions_current WHERE actor_id = ?').run(actorId);

  const insertAssertion = db.prepare(`
    INSERT INTO actor_profile_assertions_current (
      assertion_id, actor_id, field_ref, operation, value_json,
      visibility, provenance_class, active,
      supersedes_assertion_id, target_assertion_id,
      created_event_id, stream_version, materializer_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const assertion of profileState.history) {
    insertAssertion.run(
      assertion.assertion_id,
      actorId,
      assertion.field_ref,
      assertion.operation,
      Object.prototype.hasOwnProperty.call(assertion, 'value') ? JSON.stringify(assertion.value) : null,
      assertion.visibility,
      (() => {
        const event = events.find(item => item.event_id === assertion.event_id);
        const receipt = event ? loadAuthorityReceipt(db, event.authority_receipt_ref) : null;
        return event ? classifyAssertionProvenance(event, receipt) : null;
      })(),
      assertion.active ? 1 : 0,
      assertion.supersedes_assertion_id ?? null,
      assertion.target_assertion_id ?? null,
      assertion.event_id,
      assertion.stream_seq,
      MATERIALIZER_VERSION
    );
  }

  db.prepare(`
    INSERT INTO actor_profile_current (
      actor_id, projection_json, last_event_id, stream_version, materializer_version
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(actor_id) DO UPDATE SET
      projection_json = excluded.projection_json,
      last_event_id = excluded.last_event_id,
      stream_version = excluded.stream_version,
      materializer_version = excluded.materializer_version
  `).run(
    actorId,
    toProjectionJson(entityState, profileState),
    entityState.last_event_id,
    entityState.stream_version,
    MATERIALIZER_VERSION
  );
  return true;
}

function projectActorProfile(db, eventStore, actorId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = writeActorProjection(db, eventStore, actorId);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function rebuildActorProfileProjection(db, eventStore) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM actor_profile_assertions_current; DELETE FROM actor_profile_current;');
    const rows = db.prepare(`
      SELECT DISTINCT stream_id
      FROM canonical_events
      WHERE stream_type = 'entity'
      ORDER BY stream_id
    `).all();
    for (const row of rows) {
      writeActorProjection(db, eventStore, row.stream_id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  MATERIALIZER_VERSION,
  projectActorProfile,
  rebuildActorProfileProjection
};
