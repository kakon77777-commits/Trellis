const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { AsyncSqlEventStore } = require('../events/async-sql-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { projectRelationshipStream, rebuildRelationshipProjection } = require('../projections/relationship-projector');

function setup() {
  const db = createTestDatabase();
  const sql = new SQLiteAsyncAdapter(db);
  let tick = 0;
  const eventStore = new AsyncSqlEventStore(sql, {
    now: () => `2026-09-08T00:00:${String(tick++).padStart(2, '0')}.000Z`,
    token: () => `task1-token-${tick}`
  });
  return { db, sql, eventStore };
}

function context(system, actorId) {
  return {
    db: system.db,
    sql: system.sql,
    eventStore: system.eventStore,
    authorize: evaluateAuthority,
    principalActorId: actorId,
    capabilityGrants: [],
    evaluatedAt: '2026-09-08T00:00:00.000Z'
  };
}

async function reg(system, actorId) {
  const result = registerActor({
    command_id: `reg:${actorId}`,
    idempotency_key: `reg:${actorId}`,
    principal_id: `principal:${actorId}`,
    entity_id: actorId
  }, { eventStore: system.eventStore, authorize: evaluateAuthority });
  assert.equal(typeof result?.then, 'function', 'persistence-dependent command must be Promise-only');
  return result;
}

test('entity and relationship write vertical is Promise-only over AsyncSqlEventStore', async () => {
  const system = setup();
  await reg(system, 'actor:A');
  await reg(system, 'actor:B');

  const proposedPromise = proposeRelationship({
    command_id: 'rel:propose',
    idempotency_key: 'rel:propose',
    principal_id: 'principal:actor:A',
    source_entity_id: 'actor:A',
    target_entity_id: 'actor:B',
    relationship_type: 'collaborates_with',
    visibility: 'public'
  }, context(system, 'actor:A'));
  assert.equal(typeof proposedPromise?.then, 'function');
  const proposed = await proposedPromise;

  const activated = await activateRelationship({
    command_id: 'rel:activate',
    idempotency_key: 'rel:activate',
    principal_id: 'principal:actor:B',
    relationship_id: proposed.relationship_id,
    expected_version: 1
  }, context(system, 'actor:B'));
  assert.equal(activated.receipt.stream_version_after, 2);

  const state = await projectRelationshipStream(system.sql, system.eventStore, proposed.relationship_id);
  assert.equal(state.lifecycle, 'active');
  assert.equal((await system.sql.first('SELECT lifecycle FROM relationships_current WHERE relationship_id=?', [proposed.relationship_id])).lifecycle, 'active');
});

test('relationship rebuild uses async storage and recreates projection deterministically', async () => {
  const system = setup();
  await reg(system, 'actor:A');
  await reg(system, 'actor:B');
  const proposed = await proposeRelationship({
    command_id: 'rel:follow', idempotency_key: 'rel:follow', principal_id: 'principal:actor:A',
    source_entity_id: 'actor:A', target_entity_id: 'actor:B', relationship_type: 'follows', visibility: 'public'
  }, context(system, 'actor:A'));
  await projectRelationshipStream(system.sql, system.eventStore, proposed.relationship_id);
  await system.sql.run('DELETE FROM relationships_current');
  await rebuildRelationshipProjection(system.sql, system.eventStore);
  const row = await system.sql.first('SELECT lifecycle,stream_version FROM relationships_current WHERE relationship_id=?', [proposed.relationship_id]);
  assert.deepEqual(row, { lifecycle: 'active', stream_version: 2 });
});

const { setDisplayName } = require('../profile/product-commands');
const { projectActorProfile } = require('../profile/projector');
const { createCommunity } = require('../community/service');
const { setCommunityName } = require('../community/product-commands');
const { requestMembership, approveMembership } = require('../community/membership');

test('profile and community entity-stream writes remain Promise-only and profile projection is async', async () => {
  const system = setup();
  await reg(system, 'actor:A');
  const displayPromise = setDisplayName({
    command_id: 'profile:name:A', idempotency_key: 'profile:name:A', principal_id: 'principal:actor:A',
    actor_id: 'actor:A', value: 'Alpha', visibility: 'public'
  }, context(system, 'actor:A'));
  assert.equal(typeof displayPromise?.then, 'function');
  await displayPromise;
  assert.equal(await projectActorProfile(system.sql, system.eventStore, 'actor:A'), true);
  const profileRow = await system.sql.first('SELECT actor_id,stream_version FROM actor_profile_current WHERE actor_id=?', ['actor:A']);
  assert.equal(profileRow.actor_id, 'actor:A');
  assert.equal(profileRow.stream_version, 2);

  const communityPromise = createCommunity({
    command_id: 'community:create:C', idempotency_key: 'community:create:C', principal_id: 'principal:community:C', community_id: 'community:C'
  }, { eventStore: system.eventStore, authorize: evaluateAuthority });
  assert.equal(typeof communityPromise?.then, 'function');
  await communityPromise;
  await setCommunityName({
    command_id: 'community:name:C', idempotency_key: 'community:name:C', principal_id: 'principal:community:C',
    community_id: 'community:C', value: 'Commons'
  }, context(system, 'community:C'));

  const requested = await requestMembership({
    command_id: 'membership:request', idempotency_key: 'membership:request', principal_id: 'principal:actor:A',
    actor_id: 'actor:A', community_id: 'community:C'
  }, context(system, 'actor:A'));
  await approveMembership({
    command_id: 'membership:approve', idempotency_key: 'membership:approve', principal_id: 'principal:community:C',
    community_id: 'community:C', relationship_id: requested.relationship_id, expected_version: 1
  }, context(system, 'community:C'));
  const membership = await system.eventStore.readStream('relationship', requested.relationship_id);
  assert.equal(membership.length, 2);
});

const { createPublication } = require('../publication/service');
const { projectPublicationStream } = require('../publication/projector');
const { createReaction } = require('../reaction/service');
const { createPreference } = require('../preference/service');

test('publication reaction and preference write chain is async without changing domain semantics', async () => {
  const system = setup();
  await reg(system, 'actor:A');
  await reg(system, 'actor:B');

  const publicationPromise = createPublication({
    command_id: 'pub:create', idempotency_key: 'pub:create', principal_id: 'principal:actor:A',
    publication_id: 'pub:one', author_actor_id: 'actor:A', publication_type: 'post', body: 'hello', visibility: 'public'
  }, context(system, 'actor:A'));
  assert.equal(typeof publicationPromise?.then, 'function');
  const publication = await publicationPromise;
  assert.equal(publication.publication_id, 'pub:one');
  const publicationState = await projectPublicationStream(system.sql, system.eventStore, 'pub:one');
  assert.equal(publicationState.lifecycle, 'active');

  const reactionPromise = createReaction({
    command_id: 'reaction:create', idempotency_key: 'reaction:create', principal_id: 'principal:actor:B',
    actor_id: 'actor:B', publication_id: 'pub:one', reaction_type: 'like'
  }, context(system, 'actor:B'));
  assert.equal(typeof reactionPromise?.then, 'function');
  const reaction = await reactionPromise;
  assert.equal((await system.sql.first('SELECT lifecycle FROM reactions_current WHERE reaction_id=?', [reaction.reaction_id])).lifecycle, 'active');

  const preferencePromise = createPreference({
    command_id: 'pref:create', idempotency_key: 'pref:create', principal_id: 'principal:actor:B',
    owner_actor_id: 'actor:B', preference_type: 'bookmark_publication', target: { publication_id: 'pub:one' }
  }, context(system, 'actor:B'));
  assert.equal(typeof preferencePromise?.then, 'function');
  const preference = await preferencePromise;
  assert.equal((await system.sql.first('SELECT lifecycle FROM preferences_current WHERE preference_id=?', [preference.preference_id])).lifecycle, 'active');
});

const { processSourceEvent, acknowledgeNotification } = require('../notification/service');
const { recordSeen } = require('../consumption/service');
const { ConsumptionStore } = require('../consumption/store');

test('notification issue and acknowledge write path is async and projects atomically', async () => {
  const system = setup();
  await reg(system, 'actor:A');
  await reg(system, 'actor:B');
  await createPublication({
    command_id:'pub:root',idempotency_key:'pub:root',principal_id:'principal:actor:A',
    publication_id:'pub:root',author_actor_id:'actor:A',publication_type:'post',body:'root',visibility:'public'
  },context(system,'actor:A'));
  const reply = await createPublication({
    command_id:'pub:reply',idempotency_key:'pub:reply',principal_id:'principal:actor:B',
    publication_id:'pub:reply',author_actor_id:'actor:B',publication_type:'post',body:'reply',visibility:'public',reply_to_ref:'pub:root'
  },context(system,'actor:B'));
  const sourceEventId = reply.receipt.result_event_ids[0];
  const issuedPromise = processSourceEvent({eventId:sourceEventId,commandId:'notify:issue',idempotencyKey:'notify:issue'}, {
    ...context(system,'actor:B'), principalId:'principal:notification-processor', capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}]
  });
  assert.equal(typeof issuedPromise?.then,'function');
  const issued = await issuedPromise;
  assert.equal(issued.issued,true);
  assert.equal((await system.sql.first('SELECT acknowledged FROM notifications_current WHERE notification_id=?',[issued.notification_id])).acknowledged,0);

  const ackPromise = acknowledgeNotification({
    command_id:'notify:ack',idempotency_key:'notify:ack',principal_id:'principal:actor:A',
    notification_id:issued.notification_id,expected_version:1
  },context(system,'actor:A'));
  assert.equal(typeof ackPromise?.then,'function');
  await ackPromise;
  assert.equal((await system.sql.first('SELECT acknowledged FROM notifications_current WHERE notification_id=?',[issued.notification_id])).acknowledged,1);
});

test('ConsumptionStore and recordSeen use AsyncSqlPort while remaining non-canonical', async () => {
  const system = setup();
  await reg(system,'actor:A');
  await reg(system,'actor:B');
  await createPublication({
    command_id:'pub:consumption',idempotency_key:'pub:consumption',principal_id:'principal:actor:A',
    publication_id:'pub:consumption',author_actor_id:'actor:A',publication_type:'post',body:'read me',visibility:'public'
  },context(system,'actor:A'));
  const before=(await system.sql.first('SELECT COUNT(*) AS n FROM canonical_events')).n;
  const seenPromise=recordSeen({
    command_id:'consumption:seen',principal_id:'principal:actor:B',requested_consumer_actor_id:'actor:B',
    target:{publication_id:'pub:consumption'}
  },{...context(system,'actor:B'),recognizedViewerActorId:'actor:B',capabilityGrants:[{active:true,principal_id:'principal:actor:B',capability:'consumption:record',scope_ref:null}],now:()=> '2026-09-08T00:30:00.000Z'});
  assert.equal(typeof seenPromise?.then,'function');
  const seen=await seenPromise;
  assert.equal(seen.consumer_actor_id,'actor:B');
  const stored=await new ConsumptionStore(system.sql).get('actor:B','publication','pub:consumption');
  assert.equal(stored.target_ref,'pub:consumption');
  const after=(await system.sql.first('SELECT COUNT(*) AS n FROM canonical_events')).n;
  assert.equal(after,before,'consumption remains operational and creates no canonical event');
});
