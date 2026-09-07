const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  recencyComponent,
  noveltyComponent,
  scoreItem,
  comparePersonalizedFeedItemsDesc
} = require('../feed/personalized-score');
const { compareFeedItemsDesc } = require('../feed/chronological');

function publicationItem(id, recordedAt, offset = 1) {
  return {
    feed_item_id: `feed:publication:${id}`,
    item_type: 'publication',
    source_ref: id,
    sort: { recorded_at: recordedAt, global_offset: offset }
  };
}

test('recency uses deterministic integer buckets at one reference time', () => {
  const ref = '2026-09-03T12:00:00.000Z';
  assert.deepEqual(
    recencyComponent(publicationItem('pub:P', '2026-09-03T10:00:00.000Z'), ref),
    { type: 'recent_6h', component: 'recency', points: 5000 }
  );
  assert.deepEqual(
    recencyComponent(publicationItem('pub:OLD', '2026-07-01T10:00:00.000Z'), ref),
    { type: 'older_than_30d', component: 'recency', points: 0 }
  );
});

test('future canonical time is clamped to zero age deterministically', () => {
  const ref = '2026-09-03T12:00:00.000Z';
  assert.equal(
    recencyComponent(publicationItem('pub:FUTURE', '2026-09-03T12:01:00.000Z'), ref).points,
    6000
  );
});

test('publication novelty distinguishes unseen, seen, and opened using integer points', () => {
  assert.deepEqual(noveltyComponent(null, 'publication'), {
    type: 'not_seen_before', component: 'novelty', points: 1000
  });
  assert.deepEqual(noveltyComponent({ first_seen_at: '2026-09-03T11:00:00.000Z', first_opened_at: null }, 'publication'), {
    type: 'seen_before', component: 'novelty', points: -500
  });
  assert.deepEqual(noveltyComponent({ first_seen_at: '2026-09-03T11:00:00.000Z', first_opened_at: '2026-09-03T11:05:00.000Z' }, 'publication'), {
    type: 'opened_before', component: 'novelty', points: -1500
  });
});

test('social activity novelty never invents an opened state', () => {
  assert.deepEqual(noveltyComponent({ first_seen_at: '2026-09-03T11:00:00.000Z', first_opened_at: '2026-09-03T11:05:00.000Z' }, 'social_activity'), {
    type: 'seen_before', component: 'novelty', points: -500
  });
});

test('scoreItem reconciles integer components exactly to ranking reasons', () => {
  const item = publicationItem('pub:P', '2026-09-03T10:00:00.000Z');
  const scored = scoreItem({
    item,
    sourceComponent: { type: 'subscribed_actor', component: 'source', points: 3000 },
    consumptionState: null,
    rankingReferenceTime: '2026-09-03T12:00:00.000Z'
  });
  assert.deepEqual(scored.score, {
    recency_points: 5000,
    source_points: 3000,
    novelty_points: 1000,
    total_points: 9000
  });
  assert.ok(scored.ranking_reasons.every(reason => Number.isInteger(reason.points)));
  assert.equal(scored.ranking_reasons.reduce((sum, reason) => sum + reason.points, 0), scored.score.total_points);
});

test('equal personalized scores delegate exactly to the v1 chronological comparator', () => {
  const a = { ...publicationItem('pub:A', '2026-09-03T10:00:00.000Z', 2), score: { total_points: 7000 } };
  const b = { ...publicationItem('pub:B', '2026-09-03T09:00:00.000Z', 3), score: { total_points: 7000 } };
  assert.equal(Math.sign(comparePersonalizedFeedItemsDesc(a, b)), Math.sign(compareFeedItemsDesc(a, b)));
});

test('higher total score always wins before chronological tie-break', () => {
  const olderHigh = { ...publicationItem('pub:HIGH', '2026-09-01T10:00:00.000Z', 1), score: { total_points: 8000 } };
  const newerLow = { ...publicationItem('pub:LOW', '2026-09-03T10:00:00.000Z', 999), score: { total_points: 7000 } };
  assert.ok(comparePersonalizedFeedItemsDesc(olderHigh, newerLow) < 0);
});
