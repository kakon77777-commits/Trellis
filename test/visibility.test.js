const test = require('node:test');
const assert = require('node:assert/strict');
const cases = require('./fixtures/visibility-cases.json');

test('visibility resolves once from override or policy default', () => {
  const { resolveVisibility } = require('../relationship/taxonomy');
  for (const entry of cases) {
    const policy = { visibility: { default: entry.default, allowed: entry.allowed } };
    if (entry.error) {
      assert.throws(
        () => resolveVisibility({ requestedVisibility: entry.requested, policy }),
        error => error && error.message === entry.error
      );
    } else {
      assert.equal(
        resolveVisibility({ requestedVisibility: entry.requested, policy }),
        entry.expected
      );
    }
  }
});

test('scope does not participate in visibility resolution', () => {
  const { resolveVisibility } = require('../relationship/taxonomy');
  const policy = {
    visibility: { default: 'participants', allowed: ['participants', 'private'] }
  };
  assert.equal(resolveVisibility({
    requestedVisibility: null,
    scopeRef: 'community:C',
    policy
  }), 'participants');
});

test('public graph never widens non-public canonical visibility', () => {
  const { listPublicRelationships } = require('../projections/public-graph');
  const { createTestDatabase } = require('./helpers/test-db');
  const db = createTestDatabase();

  const insert = db.prepare(`
    INSERT INTO relationships_current (
      relationship_id, source_entity_id, target_entity_id,
      relationship_type, scope_ref, taxonomy_ref,
      visibility, visibility_policy_ref, lifecycle,
      termination_reason, open_contestation_count, evidence_count,
      created_event_id, last_event_id, stream_version, materializer_version
    ) VALUES (?, 'actor:A', 'actor:B', 'follows', NULL, 'ai-fb-relations:0.1', ?,
      'visibility-policy:0.1', 'active', NULL, 0, 0, 'evt:1', 'evt:1', 1, 'test')
  `);

  insert.run('rel:public', 'public');
  insert.run('rel:scope', 'scope_members');
  insert.run('rel:participants', 'participants');
  insert.run('rel:private', 'private');

  const rows = listPublicRelationships(db, () => 'allow');
  assert.deepEqual(rows.map(row => row.relationship_id), ['rel:public']);
});

test('current disclosure policy may narrow public visibility but never widen it', () => {
  const { listPublicRelationships } = require('../projections/public-graph');
  const { createTestDatabase } = require('./helpers/test-db');
  const db = createTestDatabase();

  db.prepare(`
    INSERT INTO relationships_current (
      relationship_id, source_entity_id, target_entity_id,
      relationship_type, scope_ref, taxonomy_ref,
      visibility, visibility_policy_ref, lifecycle,
      termination_reason, open_contestation_count, evidence_count,
      created_event_id, last_event_id, stream_version, materializer_version
    ) VALUES ('rel:public', 'actor:A', 'actor:B', 'follows', NULL,
      'ai-fb-relations:0.1', 'public', 'visibility-policy:0.1', 'active',
      NULL, 0, 0, 'evt:1', 'evt:1', 1, 'test')
  `).run();

  assert.equal(listPublicRelationships(db, () => 'deny').length, 0);
  assert.equal(listPublicRelationships(db, () => 'allow').length, 1);
});
