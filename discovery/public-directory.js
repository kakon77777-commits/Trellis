const { createHash } = require('node:crypto');
const { canonicalStringify } = require('../core/canonical-json');
const { buildActorProfile } = require('../profile/read-service');
const { buildCommunitySurface } = require('../community/read-service');

const PUBLIC_DIRECTORY_ALGORITHM_REF = 'trellis-directory:public:v1';
const PUBLIC_DIRECTORY_PROJECTION_VERSION = 'trellis-directory:0.1';

function registeredEntityIds(db) {
  return db.prepare(`
    SELECT DISTINCT stream_id
    FROM canonical_events
    WHERE stream_type='entity'
      AND event_type='entity.registered'
    ORDER BY stream_id
  `).all().map(row => row.stream_id);
}

function hasPublicPresentation(profile) {
  const p = profile?.presentation ?? {};
  return Boolean(
    p.display_name || p.bio || p.avatar_url || p.website ||
    (p.aliases?.length ?? 0) > 0 || (p.external_links?.length ?? 0) > 0
  );
}

function actorPreview(profile) {
  return {
    actor_id: profile.actor_id,
    presentation: profile.presentation,
    viewer_scope: profile.viewer_scope,
    projection_version: profile.projection_version,
    detail_ref: `/actors/${encodeURIComponent(profile.actor_id)}`
  };
}

function communityPreview(surface) {
  return {
    community_id: surface.community_id,
    presentation: surface.presentation,
    discoverability: surface.discoverability,
    membership: surface.membership,
    viewer_scope: surface.viewer_scope,
    projection_version: surface.projection_version,
    detail_ref: `/communities/${encodeURIComponent(surface.community_id)}`
  };
}

function displayNameOfActor(item) {
  return item.presentation?.display_name?.value ?? item.actor_id;
}
function nameOfCommunity(item) {
  return item.presentation?.name?.value ?? item.community_id;
}

function computeDirectorySnapshotRef({ actors, communities }) {
  return createHash('sha256').update(canonicalStringify({
    algorithm_ref: PUBLIC_DIRECTORY_ALGORITHM_REF,
    projection_version: PUBLIC_DIRECTORY_PROJECTION_VERSION,
    actors,
    communities
  }), 'utf8').digest('hex');
}

function buildPublicDirectory({ db, eventStore, disclosurePolicy }) {
  const actors = [];
  const communities = [];
  for (const entityId of registeredEntityIds(db)) {
    if (entityId.startsWith('actor:')) {
      const profile = buildActorProfile({
        actorId: entityId,
        viewerContext: {},
        eventStore,
        db,
        disclosurePolicy
      });
      if (profile && hasPublicPresentation(profile)) actors.push(actorPreview(profile));
      continue;
    }
    if (entityId.startsWith('community:')) {
      const surface = buildCommunitySurface({
        communityId: entityId,
        viewerContext: {},
        db,
        eventStore,
        disclosurePolicy
      });
      if (surface && surface.discoverability === 'public') communities.push(communityPreview(surface));
    }
  }
  actors.sort((a,b) => displayNameOfActor(a).localeCompare(displayNameOfActor(b)) || a.actor_id.localeCompare(b.actor_id));
  communities.sort((a,b) => nameOfCommunity(a).localeCompare(nameOfCommunity(b)) || a.community_id.localeCompare(b.community_id));
  return {
    directory_type: 'public',
    algorithm_ref: PUBLIC_DIRECTORY_ALGORITHM_REF,
    projection_version: PUBLIC_DIRECTORY_PROJECTION_VERSION,
    snapshot_ref: computeDirectorySnapshotRef({actors,communities}),
    actors,
    communities
  };
}

module.exports = {
  PUBLIC_DIRECTORY_ALGORITHM_REF,
  PUBLIC_DIRECTORY_PROJECTION_VERSION,
  registeredEntityIds,
  hasPublicPresentation,
  buildPublicDirectory,
  computeDirectorySnapshotRef
};
