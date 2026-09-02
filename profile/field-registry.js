const registry = require('../schemas/profile-fields.v0.1.json');

function getProfileField(fieldRef) {
  const field = registry.fields[fieldRef];
  if (!field) throw new TypeError(`PROFILE_FIELD_UNKNOWN:${fieldRef}`);
  return field;
}

function resolveAssertionVisibility(field, requestedVisibility) {
  const visibility = requestedVisibility ?? field.visibility.default;
  if (!field.visibility.allowed.includes(visibility)) {
    throw new TypeError(`PROFILE_VISIBILITY_NOT_ALLOWED:${visibility}`);
  }
  return visibility;
}

module.exports = {
  PROFILE_FIELD_REGISTRY_REF: registry.registry_ref,
  getProfileField,
  resolveAssertionVisibility
};
