const { canonicalStringify } = require('../core/canonical-json');
const { PERSONALIZED_FEED_ALGORITHM_REF } = require('./personalized-home');

function validateCursorShape(value) {
  if (!value || typeof value !== 'object') throw new TypeError('INVALID_FEED_CURSOR');
  for (const field of ['algorithm_ref','snapshot_ref','ranking_reference_time','last_recorded_at','last_item_id']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) throw new TypeError('INVALID_FEED_CURSOR');
  }
  if (value.algorithm_ref !== PERSONALIZED_FEED_ALGORITHM_REF) throw new TypeError('INVALID_FEED_CURSOR');
  if (!Number.isFinite(Date.parse(value.ranking_reference_time))) throw new TypeError('INVALID_FEED_CURSOR');
  if (!Number.isInteger(value.last_total_points)) throw new TypeError('INVALID_FEED_CURSOR');
  if (!Number.isInteger(value.last_global_offset) || value.last_global_offset < 0) throw new TypeError('INVALID_FEED_CURSOR');
  return value;
}

function encodePersonalizedFeedCursor(cursor) {
  return Buffer.from(canonicalStringify(validateCursorShape(cursor)), 'utf8').toString('base64url');
}

function decodePersonalizedFeedCursor(encoded) {
  try {
    if (typeof encoded !== 'string' || encoded.length === 0) throw new Error('empty');
    return validateCursorShape(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch (error) {
    if (error instanceof TypeError && error.message === 'INVALID_FEED_CURSOR') throw error;
    throw new TypeError('INVALID_FEED_CURSOR');
  }
}

function cursorForPersonalizedItem(feed, item) {
  return {
    algorithm_ref: feed.algorithm_ref,
    snapshot_ref: feed.snapshot_ref,
    ranking_reference_time: feed.ranking_reference_time,
    last_total_points: item.score.total_points,
    last_recorded_at: item.sort.recorded_at,
    last_global_offset: item.sort.global_offset,
    last_item_id: item.feed_item_id
  };
}

function itemMatchesCursor(item, cursor) {
  return item.feed_item_id === cursor.last_item_id &&
    item.score?.total_points === cursor.last_total_points &&
    item.sort.recorded_at === cursor.last_recorded_at &&
    item.sort.global_offset === cursor.last_global_offset;
}

function paginatePersonalizedFeed({ feed, limit = 20, cursor = null }) {
  if (!feed || !Array.isArray(feed.items)) throw new TypeError('INVALID_FEED');
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('INVALID_FEED_LIMIT');
  let start = 0;
  if (cursor) {
    const decoded = decodePersonalizedFeedCursor(cursor);
    if (decoded.algorithm_ref !== feed.algorithm_ref ||
        decoded.snapshot_ref !== feed.snapshot_ref ||
        decoded.ranking_reference_time !== feed.ranking_reference_time) {
      throw new Error('FEED_SNAPSHOT_CHANGED');
    }
    const index = feed.items.findIndex(item => itemMatchesCursor(item, decoded));
    if (index < 0) throw new Error('INVALID_FEED_CURSOR');
    start = index + 1;
  }
  const items = feed.items.slice(start, start + limit);
  const hasMore = start + items.length < feed.items.length;
  const nextCursor = hasMore && items.length
    ? encodePersonalizedFeedCursor(cursorForPersonalizedItem(feed, items[items.length - 1]))
    : null;
  return { items, next_cursor: nextCursor };
}

module.exports = {
  encodePersonalizedFeedCursor,
  decodePersonalizedFeedCursor,
  paginatePersonalizedFeed,
  cursorForPersonalizedItem
};
