function availableFeedActions(item) {
  if (!item || typeof item !== 'object') return [];
  if (item.item_type === 'publication') {
    return [...new Set(['open_publication', ...(item.publication?.available_actions ?? [])])];
  }
  if (item.item_type === 'social_activity') {
    if (item.activity?.type === 'community_joined') return ['open_community'];
    if (item.activity?.type === 'collaboration_started') return ['open_relationship'];
  }
  return [];
}

function decorateFeedItem(item) {
  return {
    ...item,
    available_actions: availableFeedActions(item),
    execution_authority: { implied_by_feed_read: false }
  };
}

module.exports = { availableFeedActions, decorateFeedItem };
