const SOURCE_COMPONENTS = Object.freeze({
  self_publication: { type: 'self_publication', component: 'source', points: 4000 },
  subscribed_actor: { type: 'subscribed_actor', component: 'source', points: 3000 },
  followed_actor: { type: 'followed_actor', component: 'source', points: 2000 },
  community_source: { type: 'community_source', component: 'source', points: 1000 },
  subject_involved_activity: { type: 'subject_involved_activity', component: 'source', points: 2500 },
  subscribed_actor_activity: { type: 'subscribed_actor_activity', component: 'source', points: 2000 },
  followed_actor_activity: { type: 'followed_actor_activity', component: 'source', points: 1500 },
  community_activity: { type: 'community_activity', component: 'source', points: 1000 }
});

function cloneComponent(name) {
  const component = SOURCE_COMPONENTS[name];
  if (!component) throw new Error('FEED_V2_SOURCE_TIER_NOT_FOUND');
  return { ...component };
}

function visibleActorTier(sourceGraph, actorIds) {
  const actorSet = new Set(actorIds.filter(Boolean));
  const relationships = Array.isArray(sourceGraph?.source_relationships) ? sourceGraph.source_relationships : [];
  if (relationships.some(row => row.relationship_type === 'subscribes_to' && actorSet.has(row.target_entity_id))) {
    return 'subscribed';
  }
  if (relationships.some(row => row.relationship_type === 'follows' && actorSet.has(row.target_entity_id))) {
    return 'followed';
  }
  return null;
}

function publicationSourceComponent(item, sourceGraph) {
  const publication = item?.publication;
  if (!publication) throw new TypeError('INVALID_FEED_PUBLICATION_ITEM');
  if (publication.author_actor_id === sourceGraph?.subject_actor_id) return cloneComponent('self_publication');
  if (publication.scope_ref !== null && publication.scope_ref !== undefined) {
    if ((sourceGraph?.community_source_ids ?? []).includes(publication.scope_ref)) return cloneComponent('community_source');
    throw new Error('FEED_V2_SOURCE_TIER_NOT_FOUND');
  }
  const tier = visibleActorTier(sourceGraph, [publication.author_actor_id]);
  if (tier === 'subscribed') return cloneComponent('subscribed_actor');
  if (tier === 'followed') return cloneComponent('followed_actor');
  throw new Error('FEED_V2_SOURCE_TIER_NOT_FOUND');
}

function activityActors(activity) {
  if (activity?.type === 'community_joined') return [activity.actor_id].filter(Boolean);
  if (activity?.type === 'collaboration_started') return [activity.source_actor_id, activity.target_actor_id].filter(Boolean);
  return [];
}

function activityCommunity(activity) {
  if (activity?.type === 'community_joined') return activity.community_id ?? null;
  if (activity?.type === 'collaboration_started') return activity.scope_ref ?? null;
  return null;
}

function activitySourceComponent(item, sourceGraph) {
  const activity = item?.activity;
  if (!activity) throw new TypeError('INVALID_FEED_ACTIVITY_ITEM');
  const actors = activityActors(activity);
  if (actors.includes(sourceGraph?.subject_actor_id)) return cloneComponent('subject_involved_activity');
  const tier = visibleActorTier(sourceGraph, actors);
  if (tier === 'subscribed') return cloneComponent('subscribed_actor_activity');
  if (tier === 'followed') return cloneComponent('followed_actor_activity');
  const communityId = activityCommunity(activity);
  if (communityId && (sourceGraph?.community_source_ids ?? []).includes(communityId)) return cloneComponent('community_activity');
  throw new Error('FEED_V2_SOURCE_TIER_NOT_FOUND');
}

function sourceComponentForItem(item, sourceGraph) {
  if (item?.item_type === 'publication') return publicationSourceComponent(item, sourceGraph);
  if (item?.item_type === 'social_activity') return activitySourceComponent(item, sourceGraph);
  throw new TypeError('INVALID_FEED_ITEM_TYPE');
}

module.exports = {
  SOURCE_COMPONENTS,
  sourceComponentForItem,
  publicationSourceComponent,
  activitySourceComponent
};
