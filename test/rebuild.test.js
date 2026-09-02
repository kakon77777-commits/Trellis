const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { proposeRelationship, activateRelationship } = require('../relationship/service');

function contextFor(eventStore, actor) {
  return { eventStore, principalActorId: actor, evaluatedAt: '2026-09-02T08:00:00.000Z' };
}

test('relationship projection can be destroyed and rebuilt exactly from canonical history', () => {
  const { rebuildRelationshipProjection, MATERIALIZER_VERSION } = require('../projections/relationship-projector');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);

  const proposed = proposeRelationship({
    command_id: 'cmd:rebuild-propose',
    idempotency_key: 'idem:rebuild-propose',
    principal_id: 'principal:A',
    source_entity_id: 'actor:A',
    target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with',
    scope_ref: 'project:X',
    visibility: 'public',
    occurred_at: '2026-09-02T08:00:00.000Z'
  }, contextFor(store, 'actor:A'));

  activateRelationship({
    command_id: 'cmd:rebuild-activate',
    idempotency_key: 'idem:rebuild-activate',
    principal_id: 'principal:B',
    relationship_id: proposed.relationship_id,
    expected_version: 1,
    occurred_at: '2026-09-02T08:01:00.000Z'
  }, contextFor(store, 'actor:B'));

  rebuildRelationshipProjection(db, store);
  const before = db.prepare('SELECT * FROM relationships_current ORDER BY relationship_id').all();
  assert.equal(before.length, 1);
  assert.equal(before[0].materializer_version, MATERIALIZER_VERSION);

  db.exec('DELETE FROM relationships_current');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM relationships_current').get().n, 0);

  rebuildRelationshipProjection(db, store);
  const after = db.prepare('SELECT * FROM relationships_current ORDER BY relationship_id').all();
  assert.deepEqual(after, before);
});
