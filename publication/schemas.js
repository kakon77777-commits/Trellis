const { resolvePublicationPolicy } = require('./types');

function requireString(payload, field) {
  if (typeof payload[field] !== 'string' || payload[field].length === 0) {
    throw new TypeError(`INVALID_PUBLICATION:${field}`);
  }
}

function canonicalAudience(value) {
  if (!Array.isArray(value)) throw new TypeError('PUBLICATION_AUDIENCE_INVALID');
  if (value.some(item => typeof item !== 'string' || item.length === 0)) throw new TypeError('PUBLICATION_AUDIENCE_INVALID');
  const sorted = [...new Set(value)].sort();
  if (sorted.length !== value.length || sorted.some((item, i) => item !== value[i])) {
    throw new TypeError('PUBLICATION_AUDIENCE_NOT_CANONICAL');
  }
  return sorted;
}

function validatePublicationCreationPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('INVALID_PUBLICATION');
  for (const field of ['publication_id', 'author_actor_id', 'publication_type', 'visibility', 'publication_policy_ref']) {
    requireString(payload, field);
  }
  const policy = resolvePublicationPolicy(payload.publication_type);
  if (payload.publication_policy_ref !== policy.publication_policy_ref) throw new TypeError('PUBLICATION_POLICY_REF_INVALID');
  if (!policy.allowed_visibility.includes(payload.visibility)) throw new TypeError('PUBLICATION_VISIBILITY_INVALID');
  if (typeof payload.body !== 'string') throw new TypeError('PUBLICATION_BODY_INVALID');
  if (payload.revision_number !== 1) throw new TypeError('PUBLICATION_INITIAL_REVISION_INVALID');
  if (payload.reply_to_ref && payload.quote_of_ref) throw new TypeError('PUBLICATION_REFERENCE_CONFLICT');
  for (const field of ['reply_to_ref', 'quote_of_ref']) {
    if (payload[field] !== null && payload[field] !== undefined && (typeof payload[field] !== 'string' || payload[field].length === 0)) {
      throw new TypeError(`INVALID_PUBLICATION:${field}`);
    }
  }
  const audience = canonicalAudience(payload.audience_actor_ids ?? []);
  if (payload.visibility === 'scope_members' && (typeof payload.scope_ref !== 'string' || payload.scope_ref.length === 0)) {
    throw new TypeError('PUBLICATION_SCOPE_REQUIRED');
  }
  if (payload.visibility === 'participants' && audience.length === 0) throw new TypeError('PUBLICATION_PARTICIPANTS_REQUIRED');
  if (payload.visibility !== 'participants' && audience.length !== 0) throw new TypeError('PUBLICATION_AUDIENCE_FORBIDDEN');
  return payload;
}

function validateRevisionPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('INVALID_PUBLICATION_REVISION');
  if (!Number.isInteger(payload.revision_number) || payload.revision_number < 2) throw new TypeError('PUBLICATION_REVISION_NUMBER_INVALID');
  if (!Number.isInteger(payload.supersedes_revision) || payload.supersedes_revision < 1) throw new TypeError('PUBLICATION_SUPERSEDES_INVALID');
  if (typeof payload.body !== 'string') throw new TypeError('PUBLICATION_BODY_INVALID');
  return payload;
}

module.exports = { validatePublicationCreationPayload, validateRevisionPayload };
