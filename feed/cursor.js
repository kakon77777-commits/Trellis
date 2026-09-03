const { canonicalStringify } = require('../core/canonical-json');

function validateCursorShape(value) {
  if (!value || typeof value !== 'object') throw new TypeError('INVALID_FEED_CURSOR');
  for (const field of ['algorithm_ref', 'snapshot_ref', 'last_recorded_at', 'last_item_id']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) throw new TypeError('INVALID_FEED_CURSOR');
  }
  if (!Number.isInteger(value.last_global_offset) || value.last_global_offset < 0) throw new TypeError('INVALID_FEED_CURSOR');
  return value;
}

function encodeFeedCursor(cursor) {
  const value = validateCursorShape(cursor);
  return Buffer.from(canonicalStringify(value), 'utf8').toString('base64url');
}

function decodeFeedCursor(encoded) {
  try {
    if (typeof encoded !== 'string' || encoded.length === 0) throw new Error('empty');
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return validateCursorShape(value);
  } catch (error) {
    if (error instanceof TypeError && error.message === 'INVALID_FEED_CURSOR') throw error;
    throw new TypeError('INVALID_FEED_CURSOR');
  }
}

function cursorForItem(feed, item) {
  return {
    algorithm_ref: feed.algorithm_ref,
    snapshot_ref: feed.snapshot_ref,
    last_recorded_at: item.sort.recorded_at,
    last_global_offset: item.sort.global_offset,
    last_item_id: item.feed_item_id
  };
}

function itemMatchesCursor(item, cursor) {
  return item.feed_item_id === cursor.last_item_id &&
    item.sort.recorded_at === cursor.last_recorded_at &&
    item.sort.global_offset === cursor.last_global_offset;
}

function paginateFeed({ feed, limit = 20, cursor = null }) {
  if (!feed || !Array.isArray(feed.items)) throw new TypeError('INVALID_FEED');
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('INVALID_FEED_LIMIT');
  let start = 0;
  if (cursor) {
    const decoded = decodeFeedCursor(cursor);
    if (decoded.algorithm_ref !== feed.algorithm_ref || decoded.snapshot_ref !== feed.snapshot_ref) {
      throw new Error('FEED_SNAPSHOT_CHANGED');
    }
    const index = feed.items.findIndex(item => itemMatchesCursor(item, decoded));
    if (index < 0) throw new Error('INVALID_FEED_CURSOR');
    start = index + 1;
  }
  const items = feed.items.slice(start, start + limit);
  const hasMore = start + items.length < feed.items.length;
  const nextCursor = hasMore && items.length
    ? encodeFeedCursor(cursorForItem(feed, items[items.length - 1]))
    : null;
  return { items, next_cursor: nextCursor };
}

module.exports = {
  encodeFeedCursor,
  decodeFeedCursor,
  paginateFeed,
  cursorForItem
};
