const { InvalidTransitionError } = require('../core/errors');
const { COMMUNITY_FIELD_REGISTRY_REF, getCommunityField } = require('./field-registry');
const { validateCommunityAssertionPayload } = require('./schemas');

function invalid(message) { throw new InvalidTransitionError(message); }

function foldCommunityAssertions(entityEvents) {
  const state = { active_single: {}, assertions_by_id: {}, history: [] };
  for (const event of entityEvents) {
    if (event.event_type !== 'entity.assertion_added') continue;
    const payload = event.payload ?? {};
    if (payload.field_registry_ref !== COMMUNITY_FIELD_REGISTRY_REF) continue;
    validateCommunityAssertionPayload(payload);
    if (state.assertions_by_id[payload.assertion_id]) invalid(`ASSERTION_IMMUTABLE:${payload.assertion_id}`);
    const field = getCommunityField(payload.field_ref);
    const record = { ...payload, event_id:event.event_id, actor_id:event.actor_id, principal_id:event.principal_id, stream_seq:event.stream_seq, active:true };
    state.assertions_by_id[payload.assertion_id] = record;
    state.history.push(record);
    if (field.cardinality !== 'single') invalid(`COMMUNITY_CARDINALITY_UNSUPPORTED:${payload.field_ref}`);
    const current = state.active_single[payload.field_ref];
    if (current) {
      if (payload.supersedes_assertion_id !== current.assertion_id) invalid(`COMMUNITY_SUPERSESSION_REQUIRED:${payload.field_ref}`);
      current.active = false;
    } else if (payload.supersedes_assertion_id) {
      invalid(`COMMUNITY_SUPERSESSION_TARGET_NOT_ACTIVE:${payload.supersedes_assertion_id}`);
    }
    state.active_single[payload.field_ref] = record;
  }
  return state;
}

function resolveCommunityDiscoverability(entityEvents) {
  const state = foldCommunityAssertions(entityEvents);
  return state.active_single['community:discoverability:v1']?.value ?? 'public';
}

module.exports = { foldCommunityAssertions, resolveCommunityDiscoverability };
