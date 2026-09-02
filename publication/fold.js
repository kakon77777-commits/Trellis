const { InvalidTransitionError } = require('../core/errors');
const { validatePublicationCreationPayload, validateRevisionPayload } = require('./schemas');

const IMMUTABLE_FIELDS = [
  'author_actor_id', 'publication_type', 'scope_ref', 'visibility',
  'audience_actor_ids', 'reply_to_ref', 'quote_of_ref', 'publication_policy_ref'
];

function invalid(message) { throw new InvalidTransitionError(message); }

function equalJson(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

function rejectImmutableFields(payload, state) {
  for (const field of IMMUTABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field) && !equalJson(payload[field], state[field])) {
      invalid(`PUBLICATION_IMMUTABLE_FIELD_CHANGED:${field}`);
    }
  }
}

function foldPublication(events) {
  let state = {
    lifecycle: 'nonexistent',
    current_revision: 0,
    current_body: null,
    revisions: [],
    stream_version: 0,
    created_event_id: null,
    last_event_id: null,
    withdrawal_reason: null
  };

  for (const event of events) {
    const payload = event.payload ?? {};
    switch (event.event_type) {
      case 'publication.created': {
        if (state.lifecycle !== 'nonexistent') invalid('PUBLICATION_ALREADY_CREATED');
        try { validatePublicationCreationPayload(payload); } catch (error) { invalid(error.message); }
        state = {
          ...state,
          publication_id: payload.publication_id,
          author_actor_id: payload.author_actor_id,
          publication_type: payload.publication_type,
          scope_ref: payload.scope_ref ?? null,
          visibility: payload.visibility,
          audience_actor_ids: [...(payload.audience_actor_ids ?? [])],
          reply_to_ref: payload.reply_to_ref ?? null,
          quote_of_ref: payload.quote_of_ref ?? null,
          publication_policy_ref: payload.publication_policy_ref,
          lifecycle: 'active',
          current_revision: 1,
          current_body: payload.body,
          revisions: [{ revision_number: 1, body: payload.body, event_id: event.event_id }],
          created_event_id: event.event_id
        };
        break;
      }
      case 'publication.revision_added': {
        if (state.lifecycle !== 'active') invalid('PUBLICATION_CANNOT_REVISE');
        rejectImmutableFields(payload, state);
        try { validateRevisionPayload(payload); } catch (error) { invalid(error.message); }
        if (payload.revision_number !== state.current_revision + 1) invalid('PUBLICATION_REVISION_SEQUENCE_INVALID');
        if (payload.supersedes_revision !== state.current_revision) invalid('PUBLICATION_REVISION_SUPERSESSION_INVALID');
        state.current_revision = payload.revision_number;
        state.current_body = payload.body;
        state.revisions = [...state.revisions, { revision_number: payload.revision_number, body: payload.body, event_id: event.event_id }];
        break;
      }
      case 'publication.withdrawn':
        if (state.lifecycle !== 'active') invalid('PUBLICATION_CANNOT_WITHDRAW');
        rejectImmutableFields(payload, state);
        state.lifecycle = 'withdrawn';
        state.withdrawal_reason = payload.reason ?? 'author_withdrawn';
        break;
      default:
        invalid(`UNKNOWN_PUBLICATION_EVENT:${event.event_type}`);
    }
    state.stream_version = event.stream_seq;
    state.last_event_id = event.event_id;
  }
  return state;
}

module.exports = { foldPublication };
