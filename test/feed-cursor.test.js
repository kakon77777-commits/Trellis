const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeFeedCursor, decodeFeedCursor, paginateFeed } = require('../feed/cursor');

function item(id, second, offset) {
  return {
    feed_item_id: id,
    item_type: 'publication',
    source_ref: id,
    sort: {
      recorded_at: `2026-09-03T03:00:0${second}Z`,
      global_offset: offset
    }
  };
}

function feed(snapshot = 'snap:A') {
  return {
    feed_type: 'home',
    subject_actor_id: 'actor:A',
    algorithm_ref: 'trellis-feed:chronological:v1',
    snapshot_ref: snapshot,
    items: [item('feed:3', 3, 3), item('feed:2', 2, 2), item('feed:1', 1, 1)]
  };
}

test('Feed cursor encodes only algorithm snapshot and last chronological key deterministically', () => {
  const value = {
    algorithm_ref: 'trellis-feed:chronological:v1',
    snapshot_ref: 'snap:A',
    last_recorded_at: '2026-09-03T03:00:02Z',
    last_global_offset: 2,
    last_item_id: 'feed:2'
  };
  const a = encodeFeedCursor(value);
  const b = encodeFeedCursor({ ...value });
  assert.equal(a, b);
  assert.deepEqual(decodeFeedCursor(a), value);
  const decodedText = Buffer.from(a, 'base64url').toString('utf8');
  assert.equal(decodedText.includes('created_at'), false);
  assert.equal(decodedText.includes('hidden'), false);
});

test('unchanged Feed snapshot paginates stably and yields stable cursor', () => {
  const f = feed();
  const page1 = paginateFeed({ feed: f, limit: 2 });
  assert.deepEqual(page1.items.map(x => x.feed_item_id), ['feed:3', 'feed:2']);
  assert.ok(page1.next_cursor);
  assert.equal(page1.next_cursor, paginateFeed({ feed: f, limit: 2 }).next_cursor);
  const page2 = paginateFeed({ feed: f, limit: 2, cursor: page1.next_cursor });
  assert.deepEqual(page2.items.map(x => x.feed_item_id), ['feed:1']);
  assert.equal(page2.next_cursor, null);
});

test('visible snapshot change invalidates old Feed cursor', () => {
  const page1 = paginateFeed({ feed: feed('snap:A'), limit: 1 });
  assert.throws(
    () => paginateFeed({ feed: feed('snap:B'), limit: 1, cursor: page1.next_cursor }),
    /FEED_SNAPSHOT_CHANGED/
  );
});

test('hidden-only state not represented in Feed snapshot cannot invalidate cursor', () => {
  const before = feed('snap:A');
  const page1 = paginateFeed({ feed: before, limit: 1 });
  const after = { ...feed('snap:A'), internal_hidden_debug_state: { rows: 999 } };
  const page2 = paginateFeed({ feed: after, limit: 1, cursor: page1.next_cursor });
  assert.deepEqual(page2.items.map(x => x.feed_item_id), ['feed:2']);
});
