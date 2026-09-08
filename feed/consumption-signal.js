const { ConsumptionStore } = require('../consumption/store');

function validReferenceTime(value) {
  if (value === undefined || value === null) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError('INVALID_RANKING_REFERENCE_TIME');
  return ms;
}

function eligibleRow(row, rankingReferenceTime) {
  if (!row) return null;
  const referenceMs = validReferenceTime(rankingReferenceTime);
  if (referenceMs === null) return row;
  const expiresMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresMs)) throw new TypeError('INVALID_CONSUMPTION_EXPIRY');
  return expiresMs <= referenceMs ? null : row;
}

async function consumptionForFeedItem({ ownerActorId, item, db, rankingReferenceTime }) {
  const store = new ConsumptionStore(db);
  if (item?.item_type === 'publication') return eligibleRow(await store.get(ownerActorId, 'publication', item.source_ref), rankingReferenceTime);
  if (item?.item_type === 'social_activity') return eligibleRow(await store.get(ownerActorId, 'social_activity', item.source_event_ref), rankingReferenceTime);
  return null;
}

module.exports = { consumptionForFeedItem, eligibleRow };
