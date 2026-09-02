const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { foldEntity } = require('../entity/fold');
const { buildActorProfile } = require('../profile/read-service');
const { canViewRelationship } = require('../profile/read-policy');
const { buildCommunitySurface } = require('../community/read-service');
const { createMembershipResolver } = require('../community/membership-read');
const { authorizeDiscoverySubject, viewerIdentityKey } = require('./context');

function relationshipView(row) {
  return {
    relationship_id: row.relationship_id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    relationship_type: row.relationship_type,
    scope_ref: row.scope_ref ?? null,
    visibility: row.visibility,
    lifecycle: row.lifecycle
  };
}

function actorPreview(profile) {
  const presentation = {};
  if (profile?.presentation?.display_name) presentation.display_name = profile.presentation.display_name;
  if (profile?.presentation?.avatar_url) presentation.avatar_url = profile.presentation.avatar_url;
  return {
    actor_id: profile.actor_id,
    profile_ref: `/actors/${encodeURIComponent(profile.actor_id)}`,
    presentation
  };
}

function communityPreview(surface) {
  const presentation = {};
  if (surface?.presentation?.name) presentation.name = surface.presentation.name;
  if (surface?.presentation?.avatar_url) presentation.avatar_url = surface.presentation.avatar_url;
  return {
    community_id: surface.community_id,
    community_ref: `/communities/${encodeURIComponent(surface.community_id)}`,
    discoverability: surface.discoverability,
    presentation,
    visible_member_count: surface.membership?.visible_member_count ?? 0
  };
}

function entityKind(eventStore, entityId, cache) {
  if (cache.has(entityId)) return cache.get(entityId);
  const events = eventStore.readStream('entity', entityId);
  if (events.length === 0) {
    cache.set(entityId, null);
    return null;
  }
  const state = foldEntity(events);
  cache.set(entityId, state.entity_kind ?? null);
  return cache.get(entityId);
}

function buildDiscoverySnapshot({
  subjectActorId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy
}) {
  const { viewer_scope } = authorizeDiscoverySubject(subjectActorId, viewerContext);
  const membershipResolver = createMembershipResolver(db);

  const rows = db.prepare(`
    SELECT * FROM relationships_current
    WHERE lifecycle IN ('active', 'proposed')
    ORDER BY relationship_id
  `).all();

  const relationships = rows
    .filter(row => canViewRelationship(row, viewerContext, disclosurePolicy, membershipResolver))
    .map(relationshipView);

  const referencedIds = new Set([subjectActorId]);
  for (const relationship of relationships) {
    referencedIds.add(relationship.source_entity_id);
    referencedIds.add(relationship.target_entity_id);
  }

  const kindCache = new Map();
  const actorIds = [];
  const communityIds = [];
  for (const entityId of [...referencedIds].sort()) {
    const kind = entityKind(eventStore, entityId, kindCache);
    if (kind === 'actor') actorIds.push(entityId);
    else if (kind === 'community') communityIds.push(entityId);
  }

  const actors = {};
  for (const actorId of actorIds) {
    const profile = buildActorProfile({
      actorId,
      viewerContext,
      eventStore,
      db,
      disclosurePolicy,
      membershipResolver
    });
    if (profile) actors[actorId] = { actor_id: actorId, profile: actorPreview(profile) };
  }

  const communities = {};
  for (const communityId of communityIds) {
    const surface = buildCommunitySurface({
      communityId,
      viewerContext,
      db,
      eventStore,
      disclosurePolicy
    });
    if (surface) communities[communityId] = communityPreview(surface);
  }

  const material = {
    subject_actor_id: subjectActorId,
    viewer_scope,
    viewer_key: viewerIdentityKey(viewerContext),
    actors,
    communities,
    relationships
  };
  const snapshot_ref = createHash('sha256')
    .update(canonicalStringify(material), 'utf8')
    .digest('hex');

  return { ...material, snapshot_ref };
}

module.exports = {
  buildDiscoverySnapshot,
  relationshipView,
  actorPreview,
  communityPreview
};
