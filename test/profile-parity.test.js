const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { setDisplayName, setBio } = require('../profile/product-commands');
const { proposeRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { buildActorProfile } = require('../profile/read-service');
const { serializeProfileJson } = require('../profile/render-json');
const { renderProfileHtml } = require('../profile/render-html');

function context(eventStore, actorId) {
  return {
    eventStore,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    evaluatedAt: '2026-09-02T10:00:00.000Z'
  };
}

function setup() {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db, { now: () => '2026-09-02T10:00:01.000Z' });
  for (const actorId of ['actor:A', 'actor:B', 'actor:C']) {
    registerActor({
      command_id: `reg-${actorId}`, idempotency_key: `reg-${actorId}`,
      principal_id: `principal:${actorId}`, entity_id: actorId
    }, { eventStore, authorize: evaluateAuthority });
  }
  setDisplayName({
    command_id: 'name-a', idempotency_key: 'name-a', principal_id: 'principal:actor:A', actor_id: 'actor:A',
    value: '<Aletheia & Co>', visibility: 'public'
  }, context(eventStore, 'actor:A'));
  setBio({
    command_id: 'bio-a', idempotency_key: 'bio-a', principal_id: 'principal:actor:A', actor_id: 'actor:A',
    value: 'PRIVATE-BIO-SENTINEL', visibility: 'private'
  }, context(eventStore, 'actor:A'));
  proposeRelationship({
    command_id: 'follow-ab', idempotency_key: 'follow-ab', principal_id: 'principal:actor:A',
    source_entity_id: 'actor:A', target_entity_id: 'actor:B', relationship_type: 'follows', visibility: 'public'
  }, context(eventStore, 'actor:A'));
  proposeRelationship({
    command_id: 'follow-ac', idempotency_key: 'follow-ac', principal_id: 'principal:actor:A',
    source_entity_id: 'actor:A', target_entity_id: 'actor:C', relationship_type: 'follows', visibility: 'private'
  }, context(eventStore, 'actor:A'));
  rebuildRelationshipProjection(db, eventStore);
  return { db, eventStore };
}

test('HTML and JSON render the same already-filtered public facts without hidden data', () => {
  const env = setup();
  const profile = buildActorProfile({
    actorId: 'actor:A', viewerContext: { viewer_actor_id: null, represents_actor_ids: [] },
    eventStore: env.eventStore, db: env.db
  });

  const json = serializeProfileJson(profile);
  const html = renderProfileHtml(profile);

  assert.equal(json.actor_id, 'actor:A');
  assert.equal(json.presentation.display_name.value, '<Aletheia & Co>');
  assert.equal(json.presentation.bio, undefined);
  assert.deepEqual(json.social.visible_relationships.map(r => r.target_entity_id), ['actor:B']);
  assert.equal(JSON.stringify(json).includes('PRIVATE-BIO-SENTINEL'), false);
  assert.equal(JSON.stringify(json).includes('actor:C'), false);

  assert.match(html, /actor:A/);
  assert.match(html, /&lt;Aletheia &amp; Co&gt;/);
  assert.match(html, /actor:B/);
  assert.equal(html.includes('<Aletheia & Co>'), false);
  assert.equal(html.includes('PRIVATE-BIO-SENTINEL'), false);
  assert.equal(html.includes('actor:C'), false);
  assert.equal(html.includes('2 relationships'), false);
});
