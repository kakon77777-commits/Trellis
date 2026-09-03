function compareFeedItemsDesc(a, b) {
  const time = String(b.sort.recorded_at).localeCompare(String(a.sort.recorded_at));
  if (time !== 0) return time;
  const offset = Number(b.sort.global_offset) - Number(a.sort.global_offset);
  if (offset !== 0) return offset;
  return String(b.feed_item_id).localeCompare(String(a.feed_item_id));
}

function sortFeedItems(items) {
  return [...items].sort(compareFeedItemsDesc);
}

module.exports = { sortFeedItems, compareFeedItemsDesc };
