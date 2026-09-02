const { InvalidTransitionError } = require('../core/errors');

function invalid(message) {
  throw new InvalidTransitionError(message);
}

function foldEntity(events) {
  let state = {
    lifecycle: 'nonexistent',
    assertions: [],
    runtime_bindings: [],
    stream_version: 0,
    created_event_id: null,
    last_event_id: null
  };

  for (const event of events) {
    const payload = event.payload ?? {};
    switch (event.event_type) {
      case 'entity.registered':
        if (state.lifecycle !== 'nonexistent') invalid('ENTITY_ALREADY_REGISTERED');
        if (!payload.entity_id || !payload.entity_kind || typeof payload.actor_capable !== 'boolean') {
          invalid('INVALID_ENTITY_REGISTRATION');
        }
        state = {
          ...state,
          entity_id: payload.entity_id,
          entity_kind: payload.entity_kind,
          actor_capable: payload.actor_capable,
          lifecycle: 'active',
          display_name: payload.display_name ?? null,
          created_event_id: event.event_id
        };
        break;
      case 'entity.assertion_added':
        if (state.lifecycle === 'nonexistent') invalid('ENTITY_NOT_REGISTERED');
        state.assertions = [...state.assertions, { ...payload }];
        break;
      case 'entity.runtime_binding_added':
        if (state.lifecycle === 'nonexistent') invalid('ENTITY_NOT_REGISTERED');
        if (!payload.runtime_id) invalid('INVALID_RUNTIME_BINDING');
        state.runtime_bindings = [...state.runtime_bindings, { ...payload }];
        break;
      default:
        invalid(`UNKNOWN_ENTITY_EVENT:${event.event_type}`);
    }
    state.stream_version = event.stream_seq;
    state.last_event_id = event.event_id;
  }

  return state;
}

module.exports = { foldEntity };
