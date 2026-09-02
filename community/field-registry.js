const registry = require('../schemas/community-fields.v0.1.json');

function getCommunityField(fieldRef) {
  const field = registry.fields[fieldRef];
  if (!field) throw new TypeError(`COMMUNITY_FIELD_UNKNOWN:${fieldRef}`);
  return field;
}

function resolveCommunityAssertionVisibility(field, requestedVisibility) {
  const visibility = requestedVisibility ?? field.visibility.default;
  if (!field.visibility.allowed.includes(visibility)) {
    throw new TypeError(`COMMUNITY_VISIBILITY_NOT_ALLOWED:${visibility}`);
  }
  return visibility;
}

module.exports = {
  COMMUNITY_FIELD_REGISTRY_REF: registry.registry_ref,
  getCommunityField,
  resolveCommunityAssertionVisibility
};
