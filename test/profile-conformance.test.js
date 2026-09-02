const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../package.json');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const entityService = require('../entity/service');
const profileService = require('../profile/service');
const productCommands = require('../profile/product-commands');
const renderJson = require('../profile/render-json');
const renderHtml = require('../profile/render-html');
const { registerActor } = entityService;
const { setDisplayName, setBio, setAvatarUrl } = productCommands;
const { proposeRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { projectActorProfile, rebuildActorProfileProjection } = require('../profile/projector');
const { buildActorProfile } = require('../profile/read-service');
const { serializeProfileJson } = renderJson;

function context(eventStore, actorId) {
  return {
    eventStore,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    evaluatedAt: '2026-09-02T11:00:00.000Z'
  };
}

test('Actor Profile vertical slice survives destruction and rebuild of all read projections', () => {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db, { now: () => '2026-09-02T11:00:01.000Z' });

  for (const actorId of ['actor:A', 'actor:B']) {
    registerActor({
      command_id: `reg-${actorId}`, idempotency_key: `reg-${actorId}`,
      principal_id: `principal:${actorId}`, entity_id: actorId
    }, { eventStore, authorize: evaluateAuthority });
  }

  setDisplayName({
    command_id: 'name-a', idempotency_key: 'name-a', principal_id: 'principal:actor:A',
    actor_id: 'actor:A', value: 'Aletheia', visibility: 'public'
  }, context(eventStore, 'actor:A'));
  setBio({
    command_id: 'bio-a', idempotency_key: 'bio-a', principal_id: 'principal:actor:A',
    actor_id: 'actor:A', value: 'Private Bio', visibility: 'private'
  }, context(eventStore, 'actor:A'));
  setAvatarUrl({
    command_id: 'avatar-a', idempotency_key: 'avatar-a', principal_id: 'principal:actor:A',
    actor_id: 'actor:A', value: 'https://example.com/avatar.png', visibility: 'public'
  }, context(eventStore, 'actor:A'));

  const relationship = proposeRelationship({
    command_id: 'follow-ab', idempotency_key: 'follow-ab', principal_id: 'principal:actor:A',
    source_entity_id: 'actor:A', target_entity_id: 'actor:B', relationship_type: 'follows', visibility: 'public'
  }, context(eventStore, 'actor:A'));

  rebuildRelationshipProjection(db, eventStore);
  projectActorProfile(db, eventStore, 'actor:A');

  const publicBefore = serializeProfileJson(buildActorProfile({
    actorId: 'actor:A', viewerContext: { viewer_actor_id: null, represents_actor_ids: [] },
    eventStore, db
  }));
  const selfBefore = serializeProfileJson(buildActorProfile({
    actorId: 'actor:A', viewerContext: { viewer_actor_id: 'actor:A', represents_actor_ids: [] },
    eventStore, db
  }));

  assert.equal(publicBefore.presentation.display_name.value, 'Aletheia');
  assert.equal(publicBefore.presentation.bio, undefined);
  assert.equal(publicBefore.presentation.avatar_url.value, 'https://example.com/avatar.png');
  assert.equal(publicBefore.social.visible_relationship_count, 1);
  assert.equal(selfBefore.presentation.bio.value, 'Private Bio');

  db.exec(`
    DELETE FROM actor_profile_assertions_current;
    DELETE FROM actor_profile_current;
    DELETE FROM relationships_current;
  `);

  rebuildRelationshipProjection(db, eventStore);
  rebuildActorProfileProjection(db, eventStore);

  const publicAfter = serializeProfileJson(buildActorProfile({
    actorId: 'actor:A', viewerContext: { viewer_actor_id: null, represents_actor_ids: [] },
    eventStore, db
  }));
  const selfAfter = serializeProfileJson(buildActorProfile({
    actorId: 'actor:A', viewerContext: { viewer_actor_id: 'actor:A', represents_actor_ids: [] },
    eventStore, db
  }));

  assert.deepEqual(publicAfter, publicBefore);
  assert.deepEqual(selfAfter, selfBefore);
  assert.deepEqual(eventStore.verifyHashChain('entity', 'actor:A'), { ok: true, failureAt: null });
  assert.deepEqual(eventStore.verifyHashChain('entity', 'actor:B'), { ok: true, failureAt: null });
  assert.deepEqual(eventStore.verifyHashChain('relationship', relationship.relationship_id), { ok: true, failureAt: null });
});

test('Actor Profile v0.1 production surfaces expose no forbidden authority shortcuts', () => {
  const exported = new Set([
    ...Object.keys(entityService),
    ...Object.keys(profileService),
    ...Object.keys(productCommands),
    ...Object.keys(renderJson),
    ...Object.keys(renderHtml)
  ]);
  for (const forbidden of [
    'updateProfileRow',
    'setVerified',
    'mergeActor',
    'retireActor',
    'autoGenerateBioAndCommit',
    'writeProfileProjectionAsTruth',
    'promoteProfileInference'
  ]) {
    assert.equal(exported.has(forbidden), false, `forbidden API exported: ${forbidden}`);
  }
});

test('syntax release gate includes every profile module', () => {
  assert.match(packageJson.scripts.check, /profile\/\*\.js/);
});
