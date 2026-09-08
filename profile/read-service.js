const { foldEntity } = require('../entity/fold');
const { foldProfileAssertions } = require('./fold');
const { loadAuthorityReceiptAsync, classifyAssertionProvenance } = require('./provenance');
const {
  isSelfOrRepresentative,
  canViewAssertion,
  canViewRelationship,
  hasQualifiedDirectRelationship
} = require('./read-policy');

const SINGLE_PRESENTATION = {
  'profile:display_name:v1': 'display_name',
  'profile:bio:v1': 'bio',
  'profile:avatar_url:v1': 'avatar_url',
  'profile:website:v1': 'website'
};
const MULTI_PRESENTATION = {
  'profile:alias:v1': 'aliases',
  'profile:external_link:v1': 'external_links'
};

async function loadRelationships(db, actorId) {
  return await db.all(`
    SELECT * FROM relationships_current
    WHERE lifecycle = 'active'
      AND (source_entity_id = ? OR target_entity_id = ?)
    ORDER BY relationship_id
  `,[actorId, actorId]);
}

async function assertionView(assertion, eventById, db) {
  const event = eventById.get(assertion.event_id);
  const receipt = event ? await loadAuthorityReceiptAsync(db, event.authority_receipt_ref) : null;
  return {
    value: assertion.value,
    assertion_id: assertion.assertion_id,
    provenance_class: event ? classifyAssertionProvenance(event, receipt) : 'authority_attested'
  };
}

async function historyView(assertion, eventById, db) {
  const event = eventById.get(assertion.event_id);
  const receipt = event ? await loadAuthorityReceiptAsync(db, event.authority_receipt_ref) : null;
  return {
    assertion_id: assertion.assertion_id,
    field_ref: assertion.field_ref,
    operation: assertion.operation,
    value: assertion.value,
    visibility: assertion.visibility,
    active: assertion.active,
    supersedes_assertion_id: assertion.supersedes_assertion_id ?? null,
    target_assertion_id: assertion.target_assertion_id ?? null,
    event_id: assertion.event_id,
    provenance_class: event ? classifyAssertionProvenance(event, receipt) : 'authority_attested'
  };
}

function relationshipView(relationship) {
  return {
    relationship_id: relationship.relationship_id,
    source_entity_id: relationship.source_entity_id,
    target_entity_id: relationship.target_entity_id,
    relationship_type: relationship.relationship_type,
    scope_ref: relationship.scope_ref ?? null,
    visibility: relationship.visibility,
    lifecycle: relationship.lifecycle,
    detail_ref: `/relationships/${encodeURIComponent(relationship.relationship_id)}`
  };
}

function defaultRuntimeDisclosurePolicy(binding, viewerContext, actorId) {
  return isSelfOrRepresentative(viewerContext, actorId) ? 'allow' : 'deny';
}

async function buildActorProfile({
  actorId,
  viewerContext = {},
  eventStore,
  db,
  disclosurePolicy,
  runtimeDisclosurePolicy = defaultRuntimeDisclosurePolicy,
  membershipResolver
}) {
  const events = await eventStore.readStream('entity', actorId);
  if (events.length === 0) return null;
  const entityState = foldEntity(events);
  if (entityState.entity_kind !== 'actor') return null;
  const profileState = foldProfileAssertions(events);
  const eventById = new Map(events.map(event => [event.event_id, event]));
  const relationships = await loadRelationships(db, actorId);

  const visibleRelationships = relationships
    .filter(relationship => canViewRelationship(relationship, viewerContext, disclosurePolicy, membershipResolver))
    .map(relationshipView);

  const presentation = { aliases: [], external_links: [] };
  for (const [fieldRef, key] of Object.entries(SINGLE_PRESENTATION)) {
    const assertion = profileState.active_single[fieldRef];
    if (assertion && canViewAssertion(assertion, actorId, viewerContext, relationships, disclosurePolicy, membershipResolver)) {
      presentation[key] = await assertionView(assertion, eventById, db);
    }
  }
  for (const [fieldRef, key] of Object.entries(MULTI_PRESENTATION)) {
    const assertions = profileState.active_multi[fieldRef] ?? [];
    const visibleAssertions = assertions
      .filter(assertion => canViewAssertion(assertion, actorId, viewerContext, relationships, disclosurePolicy, membershipResolver));
    presentation[key] = await Promise.all(visibleAssertions.map(assertion => assertionView(assertion, eventById, db)));
  }

  const runtimeBindings = entityState.runtime_bindings.filter(binding =>
    runtimeDisclosurePolicy(binding, viewerContext, actorId) === 'allow'
  );

  const self = isSelfOrRepresentative(viewerContext, actorId);
  const participant = !self && hasQualifiedDirectRelationship(actorId, viewerContext, relationships, disclosurePolicy, membershipResolver);
  const result = {
    actor_id: actorId,
    entity_kind: entityState.entity_kind,
    created_at: events[0].occurred_at,
    presentation,
    runtime_bindings: runtimeBindings,
    social: {
      visible_relationships: visibleRelationships,
      visible_relationship_count: visibleRelationships.length
    },
    viewer_scope: self ? 'self' : (participant ? 'participant' : 'public'),
    projection_version: 'actor-profile:0.1'
  };

  if (self) {
    result.assertion_history = await Promise.all(profileState.history.map(assertion => historyView(assertion, eventById, db)));
  }
  return result;
}

module.exports = { buildActorProfile };
