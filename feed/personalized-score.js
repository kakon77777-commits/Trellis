const { compareFeedItemsDesc } = require('./chronological');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECENCY_BUCKETS = [
  [HOUR_MS, 6000, 'recent_1h'],
  [6 * HOUR_MS, 5000, 'recent_6h'],
  [DAY_MS, 4000, 'recent_24h'],
  [3 * DAY_MS, 3000, 'recent_72h'],
  [7 * DAY_MS, 2000, 'recent_7d'],
  [30 * DAY_MS, 1000, 'recent_30d']
];

function parseTime(value, errorCode) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(errorCode);
  return ms;
}

function recencyComponent(item, rankingReferenceTime) {
  const referenceMs = parseTime(rankingReferenceTime, 'INVALID_RANKING_REFERENCE_TIME');
  const createdMs = parseTime(item?.sort?.recorded_at, 'INVALID_FEED_ITEM_RECORDED_AT');
  const age = Math.max(0, referenceMs - createdMs);
  const bucket = RECENCY_BUCKETS.find(([maxAge]) => age <= maxAge);
  if (!bucket) return { type: 'older_than_30d', component: 'recency', points: 0 };
  return { type: bucket[2], component: 'recency', points: bucket[1] };
}

function noveltyComponent(row, itemType) {
  if (!row) return { type: 'not_seen_before', component: 'novelty', points: 1000 };
  if (itemType === 'publication' && row.first_opened_at) {
    return { type: 'opened_before', component: 'novelty', points: -1500 };
  }
  return { type: 'seen_before', component: 'novelty', points: -500 };
}

function validateSourceComponent(sourceComponent) {
  if (!sourceComponent || sourceComponent.component !== 'source' || !Number.isInteger(sourceComponent.points)) {
    throw new TypeError('INVALID_SOURCE_COMPONENT');
  }
  return sourceComponent;
}

function scoreItem({ item, sourceComponent, consumptionState, rankingReferenceTime }) {
  const recency = recencyComponent(item, rankingReferenceTime);
  const source = validateSourceComponent(sourceComponent);
  const novelty = noveltyComponent(consumptionState, item?.item_type);
  const rankingReasons = [recency, source, novelty];
  const totalPoints = rankingReasons.reduce((sum, reason) => sum + reason.points, 0);
  return {
    ...item,
    score: {
      recency_points: recency.points,
      source_points: source.points,
      novelty_points: novelty.points,
      total_points: totalPoints
    },
    ranking_reasons: rankingReasons
  };
}

function comparePersonalizedFeedItemsDesc(a, b) {
  const scoreA = a?.score?.total_points;
  const scoreB = b?.score?.total_points;
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) throw new TypeError('INVALID_PERSONALIZED_FEED_SCORE');
  if (scoreA !== scoreB) return scoreB - scoreA;
  return compareFeedItemsDesc(a, b);
}

module.exports = {
  recencyComponent,
  noveltyComponent,
  scoreItem,
  comparePersonalizedFeedItemsDesc
};
