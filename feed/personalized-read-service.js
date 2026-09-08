const { loadHomeFeedSurface } = require('./read-service');
const { buildPersonalizedHomeFeed } = require('./personalized-home');
const { paginatePersonalizedFeed, decodePersonalizedFeedCursor } = require('./personalized-cursor');
const { decorateFeedItem } = require('./action-hints');

function requireTrustedReferenceTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('INVALID_RANKING_REFERENCE_TIME');
  }
  return value;
}

function rankingReferenceTimeForRequest({ cursor = null, now }) {
  if (cursor) return decodePersonalizedFeedCursor(cursor).ranking_reference_time;
  const value = typeof now === 'function' ? now() : new Date().toISOString();
  return requireTrustedReferenceTime(value);
}

async function loadPersonalizedHomeFeedSurface(args) {
  if (Object.prototype.hasOwnProperty.call(args ?? {}, 'rankingReferenceTime') ||
      Object.prototype.hasOwnProperty.call(args ?? {}, 'ranking_reference_time')) {
    throw new TypeError('FEED_V2_CLIENT_REFERENCE_TIME_FORBIDDEN');
  }
  const subjectActorId = args?.subjectActorId;
  const viewerActorId = args?.viewerContext?.viewer_actor_id;
  if (viewerActorId !== subjectActorId) return await loadHomeFeedSurface(args);

  const rankingReferenceTime = rankingReferenceTimeForRequest({ cursor: args.cursor ?? null, now: args.now });
  const feed = await buildPersonalizedHomeFeed({
    subjectActorId,
    viewerContext: args.viewerContext,
    db: args.db,
    eventStore: args.eventStore,
    disclosurePolicy: args.disclosurePolicy,
    rankingReferenceTime
  });
  const page = paginatePersonalizedFeed({ feed, limit: args.limit ?? 20, cursor: args.cursor ?? null });
  return {
    ...feed,
    items: page.items.map(decorateFeedItem),
    next_cursor: page.next_cursor
  };
}

module.exports = {
  loadPersonalizedHomeFeedSurface,
  rankingReferenceTimeForRequest,
  requireTrustedReferenceTime
};
