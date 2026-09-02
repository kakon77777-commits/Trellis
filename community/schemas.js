const { COMMUNITY_FIELD_REGISTRY_REF, getCommunityField, resolveCommunityAssertionVisibility } = require('./field-registry');

function requiredString(payload, field) {
  if (typeof payload[field] !== 'string' || payload[field].length === 0) {
    throw new TypeError(`COMMUNITY_ASSERTION_INVALID:${field}`);
  }
}

function validateUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
  } catch {
    throw new TypeError('COMMUNITY_VALUE_INVALID_URL');
  }
}

function validateCommunityAssertionPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('COMMUNITY_ASSERTION_INVALID');
  requiredString(payload, 'assertion_id');
  requiredString(payload, 'field_ref');
  if (payload.operation !== 'assert') throw new TypeError('COMMUNITY_ASSERTION_OPERATION_INVALID');
  if (payload.field_registry_ref !== COMMUNITY_FIELD_REGISTRY_REF) throw new TypeError('COMMUNITY_FIELD_REGISTRY_REF_INVALID');
  const field = getCommunityField(payload.field_ref);
  resolveCommunityAssertionVisibility(field, payload.visibility);
  if (typeof payload.value !== 'string') throw new TypeError('COMMUNITY_VALUE_INVALID_TYPE');
  if (field.value_type === 'string' && field.max_length && payload.value.length > field.max_length) throw new TypeError('COMMUNITY_VALUE_TOO_LONG');
  if (field.value_type === 'url') validateUrl(payload.value);
  if (field.value_type === 'enum' && !field.values.includes(payload.value)) throw new TypeError(`COMMUNITY_VALUE_INVALID:${payload.value}`);
  return payload;
}

module.exports = { validateCommunityAssertionPayload };
