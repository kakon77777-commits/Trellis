const { foldEntity } = require('../entity/fold');
const { foldProfileAssertions } = require('./fold');
const { loadAuthorityReceiptAsync, classifyAssertionProvenance } = require('./provenance');

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

async function actorProjectionStatements(sql, eventStore, actorId) {
  const events = await eventStore.readStream('entity', actorId);
  if (events.length === 0) return { projected: false, statements: [] };
  const entityState = foldEntity(events);
  if (entityState.entity_kind !== 'actor') return { projected: false, statements: [] };
  const profileState = foldProfileAssertions(events);
  const statements = [{ sql: 'DELETE FROM actor_profile_assertions_current WHERE actor_id = ?', params: [actorId] }];

  for (const assertion of profileState.history) {
    const event = events.find(item => item.event_id === assertion.event_id);
    const receipt = event ? await loadAuthorityReceiptAsync(sql, event.authority_receipt_ref) : null;
    statements.push({
      sql: `
        INSERT INTO actor_profile_assertions_current (
          assertion_id, actor_id, field_ref, operation, value_json,
          visibility, provenance_class, active,
          supersedes_assertion_id, target_assertion_id,
          created_event_id, stream_version, materializer_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        assertion.assertion_id,
        actorId,
        assertion.field_ref,
        assertion.operation,
        Object.prototype.hasOwnProperty.call(assertion, 'value') ? JSON.stringify(assertion.value) : null,
        assertion.visibility,
        event ? classifyAssertionProvenance(event, receipt) : null,
        assertion.active ? 1 : 0,
        assertion.supersedes_assertion_id ?? null,
        assertion.target_assertion_id ?? null,
        assertion.event_id,
        assertion.stream_seq,
        MATERIALIZER_VERSION
      ]
    });
  }

  statements.push({
    sql: `
      INSERT INTO actor_profile_current (
        actor_id, projection_json, last_event_id, stream_version, materializer_version
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(actor_id) DO UPDATE SET
        projection_json = excluded.projection_json,
        last_event_id = excluded.last_event_id,
        stream_version = excluded.stream_version,
        materializer_version = excluded.materializer_version
    `,
    params: [
      actorId,
      toProjectionJson(entityState, profileState),
      entityState.last_event_id,
      entityState.stream_version,
      MATERIALIZER_VERSION
    ]
  });
  return { projected: true, statements };
}

async function projectActorProfile(sql, eventStore, actorId) {
  const built = await actorProjectionStatements(sql, eventStore, actorId);
  if (!built.projected) return false;
  await sql.batch(built.statements);
  return true;
}

async function rebuildActorProfileProjection(sql, eventStore) {
  const rows = await sql.all(`
    SELECT DISTINCT stream_id
    FROM canonical_events
    WHERE stream_type = 'entity'
    ORDER BY stream_id
  `);
  const statements = [
    { sql: 'DELETE FROM actor_profile_assertions_current', params: [] },
    { sql: 'DELETE FROM actor_profile_current', params: [] }
  ];
  for (const row of rows) {
    const built = await actorProjectionStatements(sql, eventStore, row.stream_id);
    if (built.projected) statements.push(...built.statements.filter(entry => !entry.sql.startsWith('DELETE FROM actor_profile_assertions_current')));
  }
  await sql.batch(statements);
}

module.exports = {
  MATERIALIZER_VERSION,
  actorProjectionStatements,
  projectActorProfile,
  rebuildActorProfileProjection
};
