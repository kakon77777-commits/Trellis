function serializeProfileJson(profile) {
  if (!profile) return null;
  return JSON.parse(JSON.stringify(profile));
}

module.exports = { serializeProfileJson };
