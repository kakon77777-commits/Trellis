const { InvalidTransitionError } = require('../core/errors');
const { getProfileField } = require('./field-registry');
const { validateAssertionPayload } = require('./schemas');

function invalid(message) {
  throw new InvalidTransitionError(message);
}

function foldProfileAssertions(entityEvents) {
  const state = {
    active_single: {},
    active_multi: {},
    assertions_by_id: {},
    history: []
  };

  for (const event of entityEvents) {
    if (event.event_type !== 'entity.assertion_added') continue;
    const payload = event.payload ?? {};
    validateAssertionPayload(payload);

    if (state.assertions_by_id[payload.assertion_id]) {
      invalid(`ASSERTION_IMMUTABLE:${payload.assertion_id}`);
    }

    const record = {
      ...payload,
      event_id: event.event_id,
      actor_id: event.actor_id,
      principal_id: event.principal_id,
      provenance_refs: event.provenance_refs ?? [],
      stream_seq: event.stream_seq,
      active: payload.operation === 'assert'
    };
    state.assertions_by_id[payload.assertion_id] = record;
    state.history.push(record);

    const field = getProfileField(payload.field_ref);
    if (payload.operation === 'assert') {
      if (field.cardinality === 'single') {
        const current = state.active_single[payload.field_ref];
        if (current) {
          if (payload.supersedes_assertion_id !== current.assertion_id) {
            invalid(`PROFILE_SUPERSESSION_REQUIRED:${payload.field_ref}`);
          }
          current.active = false;
        } else if (payload.supersedes_assertion_id) {
          invalid(`PROFILE_SUPERSESSION_TARGET_NOT_ACTIVE:${payload.supersedes_assertion_id}`);
        }
        state.active_single[payload.field_ref] = record;
      } else {
        if (payload.supersedes_assertion_id) {
          invalid(`PROFILE_MULTI_SUPERSESSION_FORBIDDEN:${payload.field_ref}`);
        }
        state.active_multi[payload.field_ref] = [
          ...(state.active_multi[payload.field_ref] ?? []),
          record
        ];
      }
      continue;
    }

    const target = state.assertions_by_id[payload.target_assertion_id];
    if (!target || !target.active) {
      invalid(`PROFILE_RETRACT_TARGET_NOT_ACTIVE:${payload.target_assertion_id}`);
    }
    if (target.field_ref !== payload.field_ref) {
      invalid('PROFILE_RETRACT_FIELD_MISMATCH');
    }
    target.active = false;
    if (field.cardinality === 'single') {
      if (state.active_single[payload.field_ref]?.assertion_id === target.assertion_id) {
        delete state.active_single[payload.field_ref];
      }
    } else {
      state.active_multi[payload.field_ref] = (state.active_multi[payload.field_ref] ?? [])
        .filter(item => item.assertion_id !== target.assertion_id);
    }
    record.active = false;
  }

  return state;
}

module.exports = { foldProfileAssertions };
