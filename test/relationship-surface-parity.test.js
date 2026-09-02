const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { registerActor } = require('../entity/service');
const { proposeRelationship, addAnnotation } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { buildActorProfile } = require('../profile/read-service');
const { evaluateAuthority } = require('../authority/policy');

function contextFor(store, actorId) {
  return { eventStore: store, principalActorId: actorId, evaluatedAt: '2026-09-02T10:00:00.000Z' };
}

function register(store, actorId, key) {
  return registerActor({
    command_id: `cmd:register:${key}`,
    idempotency_key: `idem:register:${key}`,
    principal_id: `principal:${key}`,
    entity_id: actorId,
    entity_kind: 'ai_actor',
    actor_capable: true,
    occurred_at: '2026-09-02T10:00:00.000Z'
  }, { eventStore: store, authorize: evaluateAuthority });
}

function buildVisibleFixture() {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  register(store, 'actor:<A>', 'A');
  register(store, 'actor:B', 'B');
  const rel = proposeRelationship({
    command_id: 'cmd:surface:follow', idempotency_key: 'idem:surface:follow',
    principal_id: 'principal:A', source_entity_id: 'actor:<A>', target_entity_id: 'actor:B',
    relationship_type: 'follows', visibility: 'public',
    occurred_at: '2026-09-02T10:01:00.000Z'
  }, contextFor(store, 'actor:<A>'));
  addAnnotation({
    command_id: 'cmd:surface:note', idempotency_key: 'idem:surface:note',
    principal_id: 'principal:A', relationship_id: rel.relationship_id,
    expected_version: 2, note: '<script>alert("x")</script>',
    occurred_at: '2026-09-02T10:02:00.000Z'
  }, contextFor(store, 'actor:<A>'));
  rebuildRelationshipProjection(db, store);
  return { db, store, relationshipId: rel.relationship_id };
}

test('HTML and JSON render the same viewer-filtered relationship facts', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const { renderRelationshipJson } = require('../relationship-surface/render-json');
  const { renderRelationshipHtml } = require('../relationship-surface/render-html');
  const fx = buildVisibleFixture();
  const detail = loadRelationshipDetail({ relationshipId: fx.relationshipId, eventStore: fx.store, db: fx.db });
  const json = JSON.parse(renderRelationshipJson(detail));
  const html = renderRelationshipHtml(detail);

  assert.equal(json.relationship_id, fx.relationshipId);
  assert.equal(json.relationship_type, 'follows');
  assert.equal(json.execution_authority.implied_by_relationship, false);
  assert.equal(html.includes(fx.relationshipId), true);
  assert.equal(html.includes('follows'), true);
  assert.equal(html.includes('active'), true);
  assert.equal(html.includes('implied by social relationship: false'), true);
  assert.equal(html.includes('<script>alert("x")</script>'), false);
  assert.equal(html.includes('&lt;script&gt;alert('), true);
  assert.equal(html.includes('&lt;/script&gt;'), true);
  assert.equal(html.includes('actor:<A>'), false);
  assert.equal(html.includes('actor:&lt;A&gt;'), true);
});

test('unreadable private relationship produces no relationship page projection or hidden evidence signal', () => {
  const { loadRelationshipDetail } = require('../relationship-surface/read-service');
  const { renderRelationshipJson } = require('../relationship-surface/render-json');
  const { renderRelationshipHtml } = require('../relationship-surface/render-html');
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db);
  const rel = proposeRelationship({
    command_id: 'cmd:private:proposal', idempotency_key: 'idem:private:proposal',
    principal_id: 'principal:A', source_entity_id: 'actor:A', target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with', visibility: 'private',
    occurred_at: '2026-09-02T10:10:00.000Z'
  }, contextFor(store, 'actor:A'));
  rebuildRelationshipProjection(db, store);
  const detail = loadRelationshipDetail({
    relationshipId: rel.relationship_id,
    viewerContext: { viewer_actor_id: 'actor:C' },
    eventStore: store, db
  });
  assert.equal(detail, null);
  assert.equal(renderRelationshipJson(detail), null);
  const html = renderRelationshipHtml(detail);
  assert.equal(html.includes(rel.relationship_id), false);
  assert.equal(html.includes('event'), false);
  assert.equal(html.includes('evidence'), false);
});

test('actor profile relationship preview links to relationship detail without absorbing history', () => {
  const fx = buildVisibleFixture();
  const profile = buildActorProfile({ actorId: 'actor:<A>', eventStore: fx.store, db: fx.db });
  assert.equal(profile.social.visible_relationships.length, 1);
  const preview = profile.social.visible_relationships[0];
  assert.equal(preview.detail_ref, `/relationships/${encodeURIComponent(fx.relationshipId)}`);
  assert.equal(Object.prototype.hasOwnProperty.call(preview, 'history'), false);
});

test('relationship renderers are pure presentation modules with no database or EventStore import', () => {
  for (const file of ['render-html.js', 'render-json.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'relationship-surface', file), 'utf8');
    assert.equal(source.includes('event-store'), false);
    assert.equal(source.includes('sqlite'), false);
    assert.equal(source.includes("require('../db"), false);
  }
});
