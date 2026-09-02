const {
  PROFILE_FIELD_REGISTRY_REF,
  getProfileField,
  resolveAssertionVisibility
} = require('./field-registry');

function requiredString(payload, field) {
  if (typeof payload[field] !== 'string' || payload[field].length === 0) {
    throw new TypeError(`PROFILE_ASSERTION_INVALID:${field}`);
  }
}

function validateUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
  } catch {
    throw new TypeError('PROFILE_VALUE_INVALID_URL');
  }
}

function validateAssertionPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('PROFILE_ASSERTION_INVALID');
  if (Object.prototype.hasOwnProperty.call(payload, 'scope_ref')) {
    throw new TypeError('PROFILE_ASSERTION_SCOPE_FORBIDDEN');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'verified')) {
    throw new TypeError('PROFILE_ASSERTION_VERIFICATION_FORBIDDEN');
  }

  requiredString(payload, 'assertion_id');
  requiredString(payload, 'field_ref');
  requiredString(payload, 'operation');
  if (!['assert', 'retract'].includes(payload.operation)) {
    throw new TypeError(`PROFILE_ASSERTION_OPERATION_INVALID:${payload.operation}`);
  }
  if (payload.field_registry_ref !== PROFILE_FIELD_REGISTRY_REF) {
    throw new TypeError('PROFILE_FIELD_REGISTRY_REF_INVALID');
  }

  const field = getProfileField(payload.field_ref);
  resolveAssertionVisibility(field, payload.visibility);

  if (payload.operation === 'assert') {
    if (typeof payload.value !== 'string') throw new TypeError('PROFILE_VALUE_INVALID_TYPE');
    if (field.value_type === 'string' && field.max_length && payload.value.length > field.max_length) {
      throw new TypeError('PROFILE_VALUE_TOO_LONG');
    }
    if (field.value_type === 'url') validateUrl(payload.value);
    if (Object.prototype.hasOwnProperty.call(payload, 'target_assertion_id')) {
      throw new TypeError('PROFILE_ASSERT_TARGET_FORBIDDEN');
    }
  } else {
    requiredString(payload, 'target_assertion_id');
    if (Object.prototype.hasOwnProperty.call(payload, 'value')) {
      throw new TypeError('PROFILE_RETRACT_VALUE_FORBIDDEN');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'supersedes_assertion_id')) {
      throw new TypeError('PROFILE_RETRACT_SUPERSEDES_FORBIDDEN');
    }
  }

  return payload;
}

module.exports = { validateAssertionPayload };
