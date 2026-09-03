const { REACTION_POLICY_REF, isReactionType } = require('./types');

const VISIBILITIES = new Set(['public', 'private', 'participants', 'scope_members']);

function stringField(payload, field) {
  if (typeof payload[field] !== 'string' || payload[field].length === 0) throw new TypeError(`INVALID_REACTION:${field}`);
}

function canonicalAudience(value) {
  if (!Array.isArray(value)) throw new TypeError('REACTION_AUDIENCE_INVALID');
  if (value.some(item => typeof item !== 'string' || item.length === 0)) throw new TypeError('REACTION_AUDIENCE_INVALID');
  const sorted = [...new Set(value)].sort();
  if (sorted.length !== value.length || sorted.some((item, i) => item !== value[i])) throw new TypeError('REACTION_AUDIENCE_NOT_CANONICAL');
  return sorted;
}

function validateReactionType(value) {
  if (!isReactionType(value)) throw new TypeError('REACTION_TYPE_INVALID');
}

function validateReactionCreationPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('INVALID_REACTION');
  for (const field of ['reaction_id', 'actor_id', 'publication_id', 'visibility', 'reaction_policy_ref']) stringField(payload, field);
  if (payload.reaction_policy_ref !== REACTION_POLICY_REF) throw new TypeError('REACTION_POLICY_REF_INVALID');
  if (!VISIBILITIES.has(payload.visibility)) throw new TypeError('REACTION_VISIBILITY_INVALID');
  canonicalAudience(payload.audience_actor_ids ?? []);
  if (payload.scope_ref !== null && payload.scope_ref !== undefined && (typeof payload.scope_ref !== 'string' || payload.scope_ref.length === 0)) throw new TypeError('REACTION_SCOPE_INVALID');
  if (payload.visibility === 'scope_members' && !payload.scope_ref) throw new TypeError('REACTION_SCOPE_REQUIRED');
  if (payload.visibility === 'participants' && (payload.audience_actor_ids ?? []).length === 0) throw new TypeError('REACTION_PARTICIPANTS_REQUIRED');
  if (payload.visibility !== 'participants' && (payload.audience_actor_ids ?? []).length !== 0) throw new TypeError('REACTION_AUDIENCE_FORBIDDEN');
  validateReactionType(payload.reaction_type);
  return payload;
}

function validateReactionTypePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('INVALID_REACTION_EVENT');
  validateReactionType(payload.reaction_type);
  return payload;
}

module.exports = { validateReactionCreationPayload, validateReactionTypePayload };
