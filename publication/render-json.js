function renderPublicationJson(surface) {
  if (!surface) return null;
  return JSON.stringify(surface);
}
module.exports = { renderPublicationJson };
