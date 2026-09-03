const { canViewRelationship } = require('../profile/read-policy');
const { createMembershipResolver } = require('../community/membership-read');

const ACTIVITY_TYPES = Object.freeze({
  member_of: 'community_joined',
  collaborates_with: 'collaboration_started'
});

function relationshipForEvent(db, event) {
  return db.prepare(`
    SELECT * FROM relationships_current
    WHERE relationship_id = ?
  `).get(event.stream_id) ?? null;
}

function activationEvents(db) {
  return db.prepare(`
    SELECT event_id, stream_id, recorded_at, global_offset
    FROM canonical_events
    WHERE stream_type='relationship'
      AND event_type='relationship.activated'
    ORDER BY global_offset ASC
  `).all();
}

function activityItem(event, relationship) {
  const type = ACTIVITY_TYPES[relationship.relationship_type];
  if (!type) return null;
  const activity = {
    type,
    relationship_id: relationship.relationship_id
  };
  if (type === 'community_joined') {
    activity.actor_id = relationship.source_entity_id;
    activity.community_id = relationship.target_entity_id;
  } else if (type === 'collaboration_started') {
    activity.source_actor_id = relationship.source_entity_id;
    activity.target_actor_id = relationship.target_entity_id;
    activity.scope_ref = relationship.scope_ref ?? null;
  }
  return {
    feed_item_id: `feed:activity:${event.event_id}`,
    item_type: 'social_activity',
    source_event_ref: event.event_id,
    sort: {
      recorded_at: event.recorded_at,
      global_offset: event.global_offset
    },
    activity
  };
}

function homeActivityRelevant(relationship, sourceGraph, subjectActorId) {
  if (relationship.relationship_type === 'member_of') {
    return sourceGraph.community_source_ids.includes(relationship.target_entity_id);
  }
  if (relationship.relationship_type === 'collaborates_with') {
    if ([relationship.source_entity_id, relationship.target_entity_id].includes(subjectActorId)) return true;
    return sourceGraph.actor_source_ids.includes(relationship.source_entity_id) ||
      sourceGraph.actor_source_ids.includes(relationship.target_entity_id);
  }
  return false;
}

function collectHomeActivityItems({
  sourceGraph,
  subjectActorId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy
}) {
  void eventStore;
  const membershipResolver = createMembershipResolver(db);
  const items = [];
  for (const event of activationEvents(db)) {
    const relationship = relationshipForEvent(db, event);
    if (!relationship || !ACTIVITY_TYPES[relationship.relationship_type]) continue;
    if (!canViewRelationship(relationship, viewerContext, disclosurePolicy, membershipResolver)) continue;
    if (!homeActivityRelevant(relationship, sourceGraph, subjectActorId)) continue;
    const item = activityItem(event, relationship);
    if (item) items.push(item);
  }
  return items;
}

function collectCommunityActivityItems({
  communityId,
  viewerContext = {},
  db,
  eventStore,
  disclosurePolicy
}) {
  void eventStore;
  const membershipResolver = createMembershipResolver(db);
  const items = [];
  for (const event of activationEvents(db)) {
    const relationship = relationshipForEvent(db, event);
    if (!relationship || !ACTIVITY_TYPES[relationship.relationship_type]) continue;
    const inCommunity = relationship.relationship_type === 'member_of'
      ? relationship.target_entity_id === communityId
      : relationship.scope_ref === communityId;
    if (!inCommunity) continue;
    if (!canViewRelationship(relationship, viewerContext, disclosurePolicy, membershipResolver)) continue;
    const item = activityItem(event, relationship);
    if (item) items.push(item);
  }
  return items;
}

module.exports = {
  ACTIVITY_TYPES,
  collectHomeActivityItems,
  collectCommunityActivityItems,
  activityItem,
  homeActivityRelevant
};
