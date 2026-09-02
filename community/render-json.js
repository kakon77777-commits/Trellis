function renderCommunityJson(surface) {
  if (!surface) return null;
  return JSON.stringify(surface);
}
module.exports = { renderCommunityJson };
