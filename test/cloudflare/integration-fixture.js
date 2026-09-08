const { evaluateAuthority } = require('../../authority/policy');
const { registerActor } = require('../../entity/service');
const { createCommunity } = require('../../community/service');
const { setDisplayName } = require('../../profile/product-commands');
const { setCommunityName, setCommunityDiscoverability } = require('../../community/product-commands');
const { proposeRelationship, activateRelationship } = require('../../relationship/service');
const { rebuildRelationshipProjection } = require('../../projections/relationship-projector');
const { createPublication } = require('../../publication/service');
const { rebuildPublicationProjection } = require('../../publication/projector');

const FIXTURE_TIME = '2026-09-08T01:00:00.000Z';

function commandContext(sql, eventStore, actorId) {
  return {
    db: sql,
    sql,
    eventStore,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    capabilityGrants: [],
    credentialRefs: [],
    evaluatedAt: FIXTURE_TIME
  };
}

async function registerActorFixture(eventStore, actorId) {
  return await registerActor({
    command_id: `reg:${actorId}`,
    idempotency_key: `reg:${actorId}`,
    principal_id: `principal:${actorId}`,
    entity_id: actorId,
    occurred_at: FIXTURE_TIME
  }, { eventStore, authorize: evaluateAuthority });
}

async function setActorName(sql, eventStore, actorId, value, visibility = 'public') {
  return await setDisplayName({
    command_id: `name:${actorId}`,
    idempotency_key: `name:${actorId}`,
    principal_id: `principal:${actorId}`,
    actor_id: actorId,
    value,
    visibility,
    occurred_at: FIXTURE_TIME
  }, commandContext(sql, eventStore, actorId));
}

async function createCommunityFixture(sql, eventStore, communityId, name, discoverability = 'public') {
  await createCommunity({
    command_id: `create:${communityId}`,
    idempotency_key: `create:${communityId}`,
    principal_id: `principal:${communityId}`,
    community_id: communityId,
    occurred_at: FIXTURE_TIME
  }, { eventStore, authorize: evaluateAuthority });

  await setCommunityName({
    command_id: `name:${communityId}`,
    idempotency_key: `name:${communityId}`,
    principal_id: `principal:${communityId}`,
    community_id: communityId,
    value: name,
    occurred_at: FIXTURE_TIME
  }, commandContext(sql, eventStore, communityId));

  if (discoverability !== 'public') {
    await setCommunityDiscoverability({
      command_id: `discoverability:${communityId}`,
      idempotency_key: `discoverability:${communityId}`,
      principal_id: `principal:${communityId}`,
      community_id: communityId,
      value: discoverability,
      occurred_at: FIXTURE_TIME
    }, commandContext(sql, eventStore, communityId));
  }
}

async function createCollaboration(sql, eventStore) {
  const proposed = await proposeRelationship({
    command_id: 'collab:public',
    idempotency_key: 'collab:public',
    principal_id: 'principal:actor:A',
    source_entity_id: 'actor:A',
    target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with',
    visibility: 'public',
    occurred_at: FIXTURE_TIME
  }, commandContext(sql, eventStore, 'actor:A'));

  await activateRelationship({
    command_id: 'collab:public:activate',
    idempotency_key: 'collab:public:activate',
    principal_id: 'principal:actor:B',
    relationship_id: proposed.relationship_id,
    expected_version: 1,
    occurred_at: FIXTURE_TIME
  }, commandContext(sql, eventStore, 'actor:B'));
  return proposed.relationship_id;
}

async function createPublicationFixture(sql, eventStore, id, authorActorId, options = {}) {
  const publicationId = `pub:${id}`;
  const result = await createPublication({
    command_id: publicationId,
    idempotency_key: publicationId,
    principal_id: `principal:${authorActorId}`,
    publication_id: publicationId,
    author_actor_id: authorActorId,
    publication_type: 'post',
    body: options.body ?? `body:${id}`,
    visibility: options.visibility ?? 'public',
    reply_to_ref: options.reply_to_ref ?? null,
    scope_ref: options.scope_ref ?? null,
    audience_actor_ids: options.audience_actor_ids ?? [],
    occurred_at: FIXTURE_TIME
  }, commandContext(sql, eventStore, authorActorId));
  return result.publication_id;
}

async function seedPublicFixture({ sql, eventStore }) {
  await registerActorFixture(eventStore, 'actor:A');
  await registerActorFixture(eventStore, 'actor:B');
  await setActorName(sql, eventStore, 'actor:A', 'Alpha');
  await setActorName(sql, eventStore, 'actor:B', 'Beta');
  await createCommunityFixture(sql, eventStore, 'community:C', 'Commons', 'public');
  const relationshipId = await createCollaboration(sql, eventStore);
  await rebuildRelationshipProjection(sql, eventStore);

  const publicationId = await createPublicationFixture(sql, eventStore, 'p1', 'actor:A', {
    body: 'Hello <script>alert(1)</script>'
  });
  await createPublicationFixture(sql, eventStore, 'p2', 'actor:B');
  await createPublicationFixture(sql, eventStore, 'reply', 'actor:B', { reply_to_ref: publicationId });
  await rebuildPublicationProjection(sql, eventStore);

  return {
    actor_ids: ['actor:A', 'actor:B'],
    community_id: 'community:C',
    relationship_id: relationshipId,
    publication_id: publicationId,
    second_publication_id: 'pub:p2',
    reply_publication_id: 'pub:reply'
  };
}

async function addHiddenFixture({ sql, eventStore }) {
  await registerActorFixture(eventStore, 'actor:H');
  await setActorName(sql, eventStore, 'actor:H', 'Hidden', 'private');
  await createCommunityFixture(sql, eventStore, 'community:Cprivate', 'Secret', 'private');
  const hiddenPublicationId = await createPublicationFixture(sql, eventStore, 'hidden', 'actor:H', {
    visibility: 'private',
    body: 'hidden-only-body'
  });
  await rebuildPublicationProjection(sql, eventStore);
  return {
    actor_id: 'actor:H',
    community_id: 'community:Cprivate',
    publication_id: hiddenPublicationId
  };
}

async function verifyIntegrationFixture({ sql, eventStore }) {
  const hashChain = await eventStore.verifyHashChain('publication', 'pub:p1');
  const commandReceipt = await eventStore.lookupIdempotency('pub:p1');
  const projection = await sql.first(`
    SELECT publication_id, author_actor_id, lifecycle, visibility, current_body, stream_version
    FROM publications_current
    WHERE publication_id = ?
  `, ['pub:p1']);
  const eventCount = await sql.first('SELECT COUNT(*) AS n FROM canonical_events');
  const guardCount = await sql.first('SELECT COUNT(*) AS n FROM append_batch_guards');
  return {
    hash_chain: hashChain,
    command_receipt: commandReceipt,
    projection,
    canonical_event_count: eventCount?.n ?? 0,
    append_batch_guard_count: guardCount?.n ?? 0
  };
}

module.exports = {
  FIXTURE_TIME,
  commandContext,
  seedPublicFixture,
  addHiddenFixture,
  verifyIntegrationFixture
};
