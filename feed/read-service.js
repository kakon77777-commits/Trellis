const { buildHomeFeed } = require('./home');
const { buildCommunityFeed } = require('./community');
const { paginateFeed } = require('./cursor');
const { decorateFeedItem } = require('./action-hints');

function paginatedSurface(feed, { limit = 20, cursor = null } = {}) {
  if (!feed) return null;
  const page = paginateFeed({ feed, limit, cursor });
  return {
    ...feed,
    items: page.items.map(decorateFeedItem),
    next_cursor: page.next_cursor
  };
}

function loadHomeFeedSurface(args) {
  const feed = buildHomeFeed(args);
  return paginatedSurface(feed, args);
}

function loadCommunityFeedSurface(args) {
  const feed = buildCommunityFeed(args);
  return paginatedSurface(feed, args);
}

module.exports = { loadHomeFeedSurface, loadCommunityFeedSurface, paginatedSurface };
