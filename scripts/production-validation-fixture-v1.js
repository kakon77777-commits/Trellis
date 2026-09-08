const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { setDisplayName, setBio } = require('../profile/product-commands');
const {
  setCommunityName,
  setCommunityDescription,
  setCommunityDiscoverability
} = require('../community/product-commands');
const { requestMembership, approveMembership } = require('../community/membership');
const { proposeRelationship, activateRelationship } = require('../relationship/service');
const { projectRelationshipStream } = require('../projections/relationship-projector');
const { createPublication, withdrawPublication } = require('../publication/service');
const { projectPublicationStream } = require('../publication/projector');
const { buildPublicDirectory } = require('../discovery/public-directory');
const { buildPublicFeed } = require('../feed/public');
const { loadPublicationSurface } = require('../publication/read-service');
const { buildCommunitySurface } = require('../community/read-service');
const { foldPublication } = require('../publication/fold');
const { foldRelationship } = require('../relationship/fold');

const PRODUCTION_VALIDATION_FIXTURE_V1 = Object.freeze({
  schema: 'trellis-production-validation-fixture:v1',
  occurred_at: '2026-09-08T16:00:00.000Z',
  correlation_id: 'corr:trellis-production-validation-fixture:v1',
  provenance_refs: Object.freeze(['trellis:production-validation-fixture:v1']),
  actors: Object.freeze({
    primary: 'actor:trellis-validation',
    peer_a: 'actor:trellis-validation-peer-a',
    peer_b: 'actor:trellis-validation-peer-b',
    hidden: 'actor:trellis-validation-hidden'
  }),
  communities: Object.freeze({
    public: 'community:trellis-production-validation',
    hidden: 'community:trellis-production-validation-hidden'
  }),
  relationships: Object.freeze({
    memberships: Object.freeze({
      primary: 'rel:pvf1:member:primary',
      peer_a: 'rel:pvf1:member:peer-a',
      peer_b: 'rel:pvf1:member:peer-b'
    }),
    scoped: Object.freeze({
      primary_peer_a: 'rel:pvf1:collab:primary-peer-a',
      peer_a_peer_b: 'rel:pvf1:collab:peer-a-peer-b'
    })
  }),
  publications: Object.freeze({
    public: 'pub:trellis-validation-public',
    xss: 'pub:trellis-validation-xss',
    reply: 'pub:trellis-validation-reply',
    quote: 'pub:trellis-validation-quote',
    withdrawn_target: 'pub:trellis-validation-withdrawn-target',
    reference_to_withdrawn: 'pub:trellis-validation-reference-to-withdrawn',
    hidden: 'pub:trellis-validation-hidden',
    missing_control: 'pub:trellis-validation-never-created'
  }),
  content: Object.freeze({
    actor_primary_name: 'Trellis Validation',
    actor_primary_bio: 'Official production-validation identity used to verify Trellis public rendering, visibility, references, graph structure, and platform integration. Content under this Actor is validation fixture data, not user activity.',
    actor_peer_a_name: 'Trellis Validation Peer A',
    actor_peer_a_bio: 'Official production-validation peer identity for deterministic Trellis relationship and reply checks.',
    actor_peer_b_name: 'Trellis Validation Peer B',
    actor_peer_b_bio: 'Official production-validation peer identity for deterministic Trellis relationship and reference checks.',
    actor_hidden_name: 'Trellis Validation Hidden',
    actor_hidden_bio: 'Private production-validation identity. This presentation must not enter the public directory.',
    community_public_name: 'Trellis Production Validation',
    community_public_description: 'Official production-validation community used as a known-truth surface for viewer-visible membership and scoped local-graph checks. Its content is validation fixture data, not user activity.',
    community_hidden_name: 'Trellis Production Validation Hidden',
    community_hidden_description: 'Private production-validation community used only for hidden-versus-public validation controls.',
    public_body: '[PRODUCTION VALIDATION FIXTURE]\n\nPublic canonical publication used to verify Trellis production feed, HTML/API parity, and reference behavior.',
    xss_body: '[PRODUCTION VALIDATION FIXTURE — XSS]\n\nLiteral rendering probe:\n<script>alert("trellis-production-validation")</script>\n\nThis text must render literally and must never execute.',
    reply_body: '[PRODUCTION VALIDATION FIXTURE — REPLY]\n\nDirect public reply to the canonical validation publication.',
    quote_body: '[PRODUCTION VALIDATION FIXTURE — QUOTE]\n\nPublic quote/reference to the canonical validation publication.',
    withdrawn_target_body: '[PRODUCTION VALIDATION FIXTURE — WITHDRAWAL TARGET]\n\nThis publication is intentionally withdrawn after a reference to it is created.',
    reference_to_withdrawn_body: '[PRODUCTION VALIDATION FIXTURE — WITHDRAWN REFERENCE]\n\nThis publication intentionally references a target that is withdrawn after this reference is created.',
    hidden_body: '[PRODUCTION VALIDATION FIXTURE — PRIVATE]\n\nThis publication exists canonically but must not be visible to an anonymous public viewer.'
  })
});

const F = PRODUCTION_VALIDATION_FIXTURE_V1;
const EXPECTED_COMMAND_RECEIPTS = 37;
const EXPECTED_FIXTURE_EVENTS = 37;

function requirePorts({ sql, eventStore }) {
  if (!sql || typeof sql.first !== 'function' || typeof sql.all !== 'function' || typeof sql.batch !== 'function') {
    throw new TypeError('PRODUCTION_VALIDATION_SQL_PORT_REQUIRED');
  }
  if (!eventStore || typeof eventStore.append !== 'function' || typeof eventStore.readStream !== 'function') {
    throw new TypeError('PRODUCTION_VALIDATION_EVENT_STORE_REQUIRED');
  }
}

function commandMeta(operation, principalId) {
  return {
    command_id: `cmd:pvf1:${operation}`,
    idempotency_key: `pvf1:${operation}`,
    principal_id: principalId,
    correlation_id: F.correlation_id,
    occurred_at: F.occurred_at,
    provenance_refs: [...F.provenance_refs]
  };
}

function principalFor(entityId) {
  return `principal:${entityId}`;
}

function commandContext(sql, eventStore, principalActorId) {
  return {
    db: sql,
    sql,
    eventStore,
    authorize: evaluateAuthority,
    principalActorId,
    capabilityGrants: [],
    credentialRefs: [],
    evaluatedAt: F.occurred_at
  };
}

async function registerActorFixture(eventStore, key, actorId) {
  return await registerActor({
    ...commandMeta(`register:${key}`, principalFor(actorId)),
    entity_id: actorId
  }, { eventStore, authorize: evaluateAuthority });
}

async function setActorPresentation(sql, eventStore, key, actorId, name, bio, visibility = 'public') {
  const context = commandContext(sql, eventStore, actorId);
  const nameResult = await setDisplayName({
    ...commandMeta(`actor-name:${key}`, principalFor(actorId)),
    actor_id: actorId,
    value: name,
    visibility
  }, context);
  const bioResult = await setBio({
    ...commandMeta(`actor-bio:${key}`, principalFor(actorId)),
    actor_id: actorId,
    value: bio,
    visibility
  }, context);
  return [nameResult, bioResult];
}

async function createCommunityFixture(sql, eventStore, key, communityId, { name, description, discoverability, presentationVisibility }) {
  const created = await createCommunity({
    ...commandMeta(`community-create:${key}`, principalFor(communityId)),
    community_id: communityId
  }, { eventStore, authorize: evaluateAuthority });
  const context = commandContext(sql, eventStore, communityId);
  const named = await setCommunityName({
    ...commandMeta(`community-name:${key}`, principalFor(communityId)),
    community_id: communityId,
    value: name,
    visibility: presentationVisibility
  }, context);
  const described = await setCommunityDescription({
    ...commandMeta(`community-description:${key}`, principalFor(communityId)),
    community_id: communityId,
    value: description,
    visibility: presentationVisibility
  }, context);
  let discovery = null;
  if (discoverability !== 'public') {
    discovery = await setCommunityDiscoverability({
      ...commandMeta(`community-discoverability:${key}`, principalFor(communityId)),
      community_id: communityId,
      value: discoverability
    }, context);
  }
  return [created, named, described, discovery].filter(Boolean);
}

async function createMembershipFixture(sql, eventStore, key, actorId, relationshipId) {
  const requested = await requestMembership({
    ...commandMeta(`membership-request:${key}`, principalFor(actorId)),
    relationship_id: relationshipId,
    actor_id: actorId,
    community_id: F.communities.public,
    visibility: 'public'
  }, commandContext(sql, eventStore, actorId));
  const approved = await approveMembership({
    ...commandMeta(`membership-approve:${key}`, principalFor(F.communities.public)),
    community_id: F.communities.public,
    relationship_id: requested.relationship_id,
    expected_version: 1
  }, commandContext(sql, eventStore, F.communities.public));
  return [requested, approved];
}

async function createScopedCollaboration(sql, eventStore, key, sourceActorId, targetActorId, relationshipId) {
  const proposed = await proposeRelationship({
    ...commandMeta(`collaboration-propose:${key}`, principalFor(sourceActorId)),
    relationship_id: relationshipId,
    source_entity_id: sourceActorId,
    target_entity_id: targetActorId,
    relationship_type: 'collaborates_with',
    scope_ref: F.communities.public,
    visibility: 'public'
  }, commandContext(sql, eventStore, sourceActorId));
  const activated = await activateRelationship({
    ...commandMeta(`collaboration-activate:${key}`, principalFor(targetActorId)),
    relationship_id: proposed.relationship_id,
    expected_version: 1
  }, commandContext(sql, eventStore, targetActorId));
  return [proposed, activated];
}

async function createPublicationFixture(sql, eventStore, key, publicationId, authorActorId, body, extra = {}) {
  return await createPublication({
    ...commandMeta(`publication-create:${key}`, principalFor(authorActorId)),
    publication_id: publicationId,
    author_actor_id: authorActorId,
    publication_type: 'post',
    body,
    visibility: extra.visibility ?? 'public',
    audience_actor_ids: [],
    reply_to_ref: extra.reply_to_ref ?? null,
    quote_of_ref: extra.quote_of_ref ?? null,
    scope_ref: null
  }, commandContext(sql, eventStore, authorActorId));
}

function receiptDeduplicated(result) {
  return Boolean(result?.receipt?.deduplicated ?? result?.deduplicated);
}

async function seedProductionValidationFixtureV1({ sql, eventStore }) {
  requirePorts({ sql, eventStore });
  const results = [];

  for (const [key, actorId] of Object.entries(F.actors)) {
    results.push(await registerActorFixture(eventStore, key, actorId));
  }
  results.push(...await setActorPresentation(sql, eventStore, 'primary', F.actors.primary, F.content.actor_primary_name, F.content.actor_primary_bio));
  results.push(...await setActorPresentation(sql, eventStore, 'peer-a', F.actors.peer_a, F.content.actor_peer_a_name, F.content.actor_peer_a_bio));
  results.push(...await setActorPresentation(sql, eventStore, 'peer-b', F.actors.peer_b, F.content.actor_peer_b_name, F.content.actor_peer_b_bio));
  results.push(...await setActorPresentation(sql, eventStore, 'hidden', F.actors.hidden, F.content.actor_hidden_name, F.content.actor_hidden_bio, 'private'));

  results.push(...await createCommunityFixture(sql, eventStore, 'public', F.communities.public, {
    name: F.content.community_public_name,
    description: F.content.community_public_description,
    discoverability: 'public',
    presentationVisibility: 'public'
  }));
  results.push(...await createCommunityFixture(sql, eventStore, 'hidden', F.communities.hidden, {
    name: F.content.community_hidden_name,
    description: F.content.community_hidden_description,
    discoverability: 'private',
    presentationVisibility: 'private'
  }));

  results.push(...await createMembershipFixture(sql, eventStore, 'primary', F.actors.primary, F.relationships.memberships.primary));
  results.push(...await createMembershipFixture(sql, eventStore, 'peer-a', F.actors.peer_a, F.relationships.memberships.peer_a));
  results.push(...await createMembershipFixture(sql, eventStore, 'peer-b', F.actors.peer_b, F.relationships.memberships.peer_b));
  results.push(...await createScopedCollaboration(sql, eventStore, 'primary-peer-a', F.actors.primary, F.actors.peer_a, F.relationships.scoped.primary_peer_a));
  results.push(...await createScopedCollaboration(sql, eventStore, 'peer-a-peer-b', F.actors.peer_a, F.actors.peer_b, F.relationships.scoped.peer_a_peer_b));

  for (const relationshipId of [
    ...Object.values(F.relationships.memberships),
    ...Object.values(F.relationships.scoped)
  ]) {
    await projectRelationshipStream(sql, eventStore, relationshipId);
  }

  results.push(await createPublicationFixture(sql, eventStore, 'public', F.publications.public, F.actors.primary, F.content.public_body));
  results.push(await createPublicationFixture(sql, eventStore, 'xss', F.publications.xss, F.actors.primary, F.content.xss_body));
  results.push(await createPublicationFixture(sql, eventStore, 'reply', F.publications.reply, F.actors.peer_a, F.content.reply_body, {
    reply_to_ref: F.publications.public
  }));
  results.push(await createPublicationFixture(sql, eventStore, 'quote', F.publications.quote, F.actors.peer_b, F.content.quote_body, {
    quote_of_ref: F.publications.public
  }));
  results.push(await createPublicationFixture(sql, eventStore, 'withdrawn-target', F.publications.withdrawn_target, F.actors.primary, F.content.withdrawn_target_body));
  results.push(await createPublicationFixture(sql, eventStore, 'reference-to-withdrawn', F.publications.reference_to_withdrawn, F.actors.peer_a, F.content.reference_to_withdrawn_body, {
    quote_of_ref: F.publications.withdrawn_target
  }));
  results.push(await createPublicationFixture(sql, eventStore, 'hidden', F.publications.hidden, F.actors.hidden, F.content.hidden_body, {
    visibility: 'private'
  }));
  results.push(await withdrawPublication({
    ...commandMeta('publication-withdraw:withdrawn-target', principalFor(F.actors.primary)),
    publication_id: F.publications.withdrawn_target,
    expected_version: 1,
    reason: 'production_validation_fixture'
  }, commandContext(sql, eventStore, F.actors.primary)));

  for (const [key, publicationId] of Object.entries(F.publications)) {
    if (key === 'missing_control') continue;
    await projectPublicationStream(sql, eventStore, publicationId);
  }

  return {
    schema: F.schema,
    status: 'SEEDED',
    occurred_at: F.occurred_at,
    correlation_id: F.correlation_id,
    command_result_count: results.length,
    deduplicated_command_count: results.filter(receiptDeduplicated).length,
    fixture: F
  };
}

function addCheck(checks, failures, name, ok, actual, expected) {
  checks[name] = { ok: Boolean(ok), actual, expected };
  if (!ok) failures.push(name);
}

async function projectionConsistency(sql, eventStore) {
  const mismatches = [];
  for (const relationshipId of [
    ...Object.values(F.relationships.memberships),
    ...Object.values(F.relationships.scoped)
  ]) {
    const events = await eventStore.readStream('relationship', relationshipId);
    const state = foldRelationship(events);
    const row = await sql.first('SELECT * FROM relationships_current WHERE relationship_id = ?', [relationshipId]);
    if (!row || row.stream_version !== state.stream_version || row.lifecycle !== state.lifecycle ||
        row.source_entity_id !== state.source_entity_id || row.target_entity_id !== state.target_entity_id ||
        row.relationship_type !== state.relationship_type || (row.scope_ref ?? null) !== (state.scope_ref ?? null) ||
        row.visibility !== state.visibility) {
      mismatches.push(`relationship:${relationshipId}`);
    }
  }
  for (const [key, publicationId] of Object.entries(F.publications)) {
    if (key === 'missing_control') continue;
    const events = await eventStore.readStream('publication', publicationId);
    const state = foldPublication(events);
    const row = await sql.first('SELECT * FROM publications_current WHERE publication_id = ?', [publicationId]);
    if (!row || row.stream_version !== state.stream_version || row.lifecycle !== state.lifecycle ||
        row.author_actor_id !== state.author_actor_id || row.visibility !== state.visibility ||
        (row.reply_to_ref ?? null) !== (state.reply_to_ref ?? null) || (row.quote_of_ref ?? null) !== (state.quote_of_ref ?? null)) {
      mismatches.push(`publication:${publicationId}`);
    }
  }
  const missingProjection = await sql.first('SELECT publication_id FROM publications_current WHERE publication_id = ?', [F.publications.missing_control]);
  if (missingProjection) mismatches.push(`publication:${F.publications.missing_control}:must-not-exist`);
  return { ok: mismatches.length === 0, mismatches };
}

async function fixtureEventIntegrity(sql, eventStore) {
  const streamIds = [
    ...Object.values(F.actors),
    ...Object.values(F.communities),
    ...Object.values(F.relationships.memberships),
    ...Object.values(F.relationships.scoped),
    ...Object.entries(F.publications).filter(([key]) => key !== 'missing_control').map(([, id]) => id)
  ];
  const hashFailures = [];
  const provenanceFailures = [];
  const correlationFailures = [];
  let fixtureEventCount = 0;

  for (const streamId of streamIds) {
    const streamType = streamId.startsWith('rel:') ? 'relationship' : (streamId.startsWith('pub:') ? 'publication' : 'entity');
    const events = await eventStore.readStream(streamType, streamId);
    fixtureEventCount += events.length;
    const chain = await eventStore.verifyHashChain(streamType, streamId);
    if (!chain.ok) hashFailures.push(`${streamType}:${streamId}:${chain.failureAt}`);
    for (const event of events) {
      if (!event.provenance_refs.includes(F.provenance_refs[0])) provenanceFailures.push(event.event_id);
      if (event.correlation_id !== F.correlation_id) correlationFailures.push(event.event_id);
    }
  }

  const receiptCountRow = await sql.first("SELECT COUNT(*) AS n FROM command_receipts WHERE idempotency_key LIKE 'pvf1:%'");
  return {
    fixture_event_count: fixtureEventCount,
    command_receipt_count: receiptCountRow?.n ?? 0,
    hash_failures: hashFailures,
    provenance_failures: provenanceFailures,
    correlation_failures: correlationFailures
  };
}

async function verifyProductionValidationFixtureV1({ sql, eventStore, disclosurePolicy }) {
  requirePorts({ sql, eventStore });
  const checks = {};
  const failures = [];

  const directory = await buildPublicDirectory({ db: sql, eventStore, disclosurePolicy });
  const publicActorIds = directory.actors.map(item => item.actor_id);
  const publicCommunityIds = directory.communities.map(item => item.community_id);
  for (const actorId of [F.actors.primary, F.actors.peer_a, F.actors.peer_b]) {
    addCheck(checks, failures, `directory.actor.visible:${actorId}`, publicActorIds.includes(actorId), publicActorIds, `contains ${actorId}`);
  }
  addCheck(checks, failures, 'directory.actor.hidden-absent', !publicActorIds.includes(F.actors.hidden), publicActorIds, `not ${F.actors.hidden}`);
  addCheck(checks, failures, 'directory.community.public-visible', publicCommunityIds.includes(F.communities.public), publicCommunityIds, `contains ${F.communities.public}`);
  addCheck(checks, failures, 'directory.community.hidden-absent', !publicCommunityIds.includes(F.communities.hidden), publicCommunityIds, `not ${F.communities.hidden}`);

  const community = await buildCommunitySurface({ communityId: F.communities.public, viewerContext: {}, db: sql, eventStore, disclosurePolicy });
  const hiddenCommunity = await buildCommunitySurface({ communityId: F.communities.hidden, viewerContext: {}, db: sql, eventStore, disclosurePolicy });
  const visibleMemberActorIds = (community?.membership?.visible_members ?? []).map(item => item.actor_id).sort();
  const visibleScopedRelationshipIds = (community?.local_graph?.visible_scoped_relationships ?? []).map(item => item.relationship_id).sort();
  addCheck(checks, failures, 'community.public-surface', Boolean(community), Boolean(community), true);
  addCheck(checks, failures, 'community.hidden-surface-null', hiddenCommunity === null, hiddenCommunity, null);
  addCheck(checks, failures, 'community.visible-member-count', community?.membership?.visible_member_count === 3, community?.membership?.visible_member_count, 3);
  addCheck(checks, failures, 'community.visible-members', JSON.stringify(visibleMemberActorIds) === JSON.stringify([F.actors.primary, F.actors.peer_a, F.actors.peer_b].sort()), visibleMemberActorIds, [F.actors.primary, F.actors.peer_a, F.actors.peer_b].sort());
  addCheck(checks, failures, 'community.visible-scoped-relationship-count', community?.local_graph?.visible_relationship_count === 2, community?.local_graph?.visible_relationship_count, 2);
  addCheck(checks, failures, 'community.visible-scoped-relationships', JSON.stringify(visibleScopedRelationshipIds) === JSON.stringify(Object.values(F.relationships.scoped).sort()), visibleScopedRelationshipIds, Object.values(F.relationships.scoped).sort());

  const surfaces = {};
  for (const [key, publicationId] of Object.entries(F.publications)) {
    surfaces[key] = await loadPublicationSurface({ publicationId, viewerContext: {}, db: sql, eventStore, disclosurePolicy });
  }
  addCheck(checks, failures, 'publication.public-active', surfaces.public?.lifecycle === 'active', surfaces.public?.lifecycle, 'active');
  addCheck(checks, failures, 'publication.xss-active', surfaces.xss?.lifecycle === 'active', surfaces.xss?.lifecycle, 'active');
  addCheck(checks, failures, 'publication.xss-body-exact', surfaces.xss?.content?.body === F.content.xss_body, surfaces.xss?.content?.body, F.content.xss_body);
  addCheck(checks, failures, 'publication.reply-reference-active', surfaces.reply?.reference_context?.status === 'active', surfaces.reply?.reference_context?.status, 'active');
  addCheck(checks, failures, 'publication.quote-reference-active', surfaces.quote?.reference_context?.status === 'active', surfaces.quote?.reference_context?.status, 'active');
  addCheck(checks, failures, 'publication.withdrawn-target', surfaces.withdrawn_target?.lifecycle === 'withdrawn' && surfaces.withdrawn_target?.content === null, { lifecycle: surfaces.withdrawn_target?.lifecycle, content: surfaces.withdrawn_target?.content }, { lifecycle: 'withdrawn', content: null });
  addCheck(checks, failures, 'publication.reference-to-withdrawn', surfaces.reference_to_withdrawn?.reference_context?.status === 'withdrawn', surfaces.reference_to_withdrawn?.reference_context?.status, 'withdrawn');
  addCheck(checks, failures, 'publication.hidden-null', surfaces.hidden === null, surfaces.hidden, null);
  addCheck(checks, failures, 'publication.missing-null', surfaces.missing_control === null, surfaces.missing_control, null);
  addCheck(checks, failures, 'publication.hidden-missing-equivalent', surfaces.hidden === surfaces.missing_control, { hidden: surfaces.hidden, missing: surfaces.missing_control }, 'both null');

  const feed = await buildPublicFeed({ db: sql, eventStore, disclosurePolicy });
  const feedPublicationIds = feed.items.filter(item => item.item_type === 'publication').map(item => item.source_ref).sort();
  const expectedFeedPublications = [F.publications.public, F.publications.xss, F.publications.quote, F.publications.reference_to_withdrawn].sort();
  for (const publicationId of expectedFeedPublications) {
    addCheck(checks, failures, `feed.publication.visible:${publicationId}`, feedPublicationIds.includes(publicationId), feedPublicationIds, `contains ${publicationId}`);
  }
  for (const publicationId of [F.publications.reply, F.publications.withdrawn_target, F.publications.hidden, F.publications.missing_control]) {
    addCheck(checks, failures, `feed.publication.absent:${publicationId}`, !feedPublicationIds.includes(publicationId), feedPublicationIds, `not ${publicationId}`);
  }
  const feedRelationshipIds = feed.items
    .filter(item => item.item_type === 'social_activity')
    .map(item => item.activity?.relationship_id)
    .filter(Boolean);
  for (const relationshipId of [...Object.values(F.relationships.memberships), ...Object.values(F.relationships.scoped)]) {
    addCheck(checks, failures, `feed.relationship.visible:${relationshipId}`, feedRelationshipIds.includes(relationshipId), feedRelationshipIds, `contains ${relationshipId}`);
  }

  const projection = await projectionConsistency(sql, eventStore);
  addCheck(checks, failures, 'integrity.projections-match-canonical', projection.ok, projection.mismatches, []);
  const eventIntegrity = await fixtureEventIntegrity(sql, eventStore);
  addCheck(checks, failures, 'integrity.hash-chains', eventIntegrity.hash_failures.length === 0, eventIntegrity.hash_failures, []);
  addCheck(checks, failures, 'integrity.provenance', eventIntegrity.provenance_failures.length === 0, eventIntegrity.provenance_failures, []);
  addCheck(checks, failures, 'integrity.correlation', eventIntegrity.correlation_failures.length === 0, eventIntegrity.correlation_failures, []);
  addCheck(checks, failures, 'integrity.fixture-event-count', eventIntegrity.fixture_event_count === EXPECTED_FIXTURE_EVENTS, eventIntegrity.fixture_event_count, EXPECTED_FIXTURE_EVENTS);
  addCheck(checks, failures, 'integrity.command-receipt-count', eventIntegrity.command_receipt_count === EXPECTED_COMMAND_RECEIPTS, eventIntegrity.command_receipt_count, EXPECTED_COMMAND_RECEIPTS);
  const guardRow = await sql.first('SELECT COUNT(*) AS n FROM append_batch_guards');
  const appendBatchGuardCount = guardRow?.n ?? 0;
  addCheck(checks, failures, 'integrity.append-batch-guards-empty', appendBatchGuardCount === 0, appendBatchGuardCount, 0);

  const report = {
    schema: F.schema,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    fixture_occurred_at: F.occurred_at,
    correlation_id: F.correlation_id,
    checks,
    failures,
    directory: {
      snapshot_ref: directory.snapshot_ref,
      public_actor_ids: publicActorIds,
      public_community_ids: publicCommunityIds
    },
    feed: {
      snapshot_ref: feed.snapshot_ref,
      public_fixture_publication_ids: feedPublicationIds.filter(id => Object.values(F.publications).includes(id)),
      fixture_relationship_activity_ids: feedRelationshipIds.filter(id => [...Object.values(F.relationships.memberships), ...Object.values(F.relationships.scoped)].includes(id))
    },
    community: {
      visible_member_count: community?.membership?.visible_member_count ?? null,
      visible_member_actor_ids: visibleMemberActorIds,
      visible_scoped_relationship_count: community?.local_graph?.visible_relationship_count ?? null,
      visible_scoped_relationship_ids: visibleScopedRelationshipIds,
      hidden_community_anonymous_surface_is_null: hiddenCommunity === null
    },
    publications: {
      public: { lifecycle: surfaces.public?.lifecycle ?? null },
      xss: { lifecycle: surfaces.xss?.lifecycle ?? null, body_matches_fixture: surfaces.xss?.content?.body === F.content.xss_body },
      reply: { lifecycle: surfaces.reply?.lifecycle ?? null, reference_status: surfaces.reply?.reference_context?.status ?? null },
      quote: { lifecycle: surfaces.quote?.lifecycle ?? null, reference_status: surfaces.quote?.reference_context?.status ?? null },
      withdrawn_target: { lifecycle: surfaces.withdrawn_target?.lifecycle ?? null, content_is_null: surfaces.withdrawn_target?.content === null, withdrawal_reason: surfaces.withdrawn_target?.withdrawal_reason ?? null },
      reference_to_withdrawn: { lifecycle: surfaces.reference_to_withdrawn?.lifecycle ?? null, reference_status: surfaces.reference_to_withdrawn?.reference_context?.status ?? null },
      hidden: { anonymous_surface_is_null: surfaces.hidden === null },
      missing_control: { anonymous_surface_is_null: surfaces.missing_control === null },
      hidden_and_missing_equivalent: surfaces.hidden === surfaces.missing_control
    },
    integrity: {
      fixture_event_count: eventIntegrity.fixture_event_count,
      command_receipt_count: eventIntegrity.command_receipt_count,
      append_batch_guard_count: appendBatchGuardCount,
      hash_chains_ok: eventIntegrity.hash_failures.length === 0,
      provenance_ok: eventIntegrity.provenance_failures.length === 0,
      correlation_ok: eventIntegrity.correlation_failures.length === 0,
      projections_match_canonical: projection.ok,
      projection_mismatches: projection.mismatches
    }
  };
  Object.defineProperty(report, '_surfaces', { value: surfaces, enumerable: false });

  if (failures.length > 0) {
    const error = new Error(`PRODUCTION_VALIDATION_FIXTURE_V1_VERIFY_FAILED:${failures.join(',')}`);
    error.report = report;
    throw error;
  }
  return report;
}

module.exports = {
  PRODUCTION_VALIDATION_FIXTURE_V1,
  seedProductionValidationFixtureV1,
  verifyProductionValidationFixtureV1
};
