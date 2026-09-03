const { InvalidTransitionError } = require('../core/errors');
const { validateReactionCreationPayload, validateReactionTypePayload } = require('./schemas');

const IMMUTABLE_FIELDS = ['actor_id', 'publication_id', 'scope_ref', 'visibility', 'audience_actor_ids', 'reaction_policy_ref'];

function invalid(message) { throw new InvalidTransitionError(message); }
function equalJson(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

function rejectImmutable(payload, state) {
  for (const field of IMMUTABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field) && !equalJson(payload[field], state[field])) {
      invalid(`REACTION_IMMUTABLE_FIELD_CHANGED:${field}`);
    }
  }
}

function foldReaction(events) {
  let state = {
    lifecycle: 'nonexistent',
    reaction_type: null,
    stream_version: 0,
    created_event_id: null,
    last_event_id: null,
    withdrawal_reason: null
  };

  for (const event of events) {
    const payload = event.payload ?? {};
    switch (event.event_type) {
      case 'reaction.created':
        if (state.lifecycle !== 'nonexistent') invalid('REACTION_ALREADY_CREATED');
        try { validateReactionCreationPayload(payload); } catch (error) { invalid(error.message); }
        state = {
          ...state,
          reaction_id: payload.reaction_id,
          actor_id: payload.actor_id,
          publication_id: payload.publication_id,
          scope_ref: payload.scope_ref ?? null,
          visibility: payload.visibility,
          audience_actor_ids: [...(payload.audience_actor_ids ?? [])],
          reaction_policy_ref: payload.reaction_policy_ref,
          lifecycle: 'active',
          reaction_type: payload.reaction_type,
          created_event_id: event.event_id,
          withdrawal_reason: null
        };
        break;
      case 'reaction.changed':
        if (state.lifecycle !== 'active') invalid('REACTION_CANNOT_CHANGE');
        rejectImmutable(payload, state);
        try { validateReactionTypePayload(payload); } catch (error) { invalid(error.message); }
        state.reaction_type = payload.reaction_type;
        break;
      case 'reaction.withdrawn':
        if (state.lifecycle !== 'active') invalid('REACTION_CANNOT_WITHDRAW');
        rejectImmutable(payload, state);
        state.lifecycle = 'withdrawn';
        state.reaction_type = null;
        state.withdrawal_reason = payload.reason ?? 'actor_withdrawn';
        break;
      case 'reaction.restored':
        if (state.lifecycle !== 'withdrawn') invalid('REACTION_CANNOT_RESTORE');
        rejectImmutable(payload, state);
        try { validateReactionTypePayload(payload); } catch (error) { invalid(error.message); }
        state.lifecycle = 'active';
        state.reaction_type = payload.reaction_type;
        state.withdrawal_reason = null;
        break;
      default:
        invalid(`UNKNOWN_REACTION_EVENT:${event.event_type}`);
    }
    state.stream_version = event.stream_seq;
    state.last_event_id = event.event_id;
  }
  return state;
}

module.exports = { foldReaction };
