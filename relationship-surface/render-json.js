function renderRelationshipJson(detail) {
  if (!detail) return null;
  return JSON.stringify(detail);
}

module.exports = { renderRelationshipJson };
