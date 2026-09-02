const { InvalidTransitionError } = require('../core/errors');
const { validateProposalPayload } = require('./schemas');

const IMMUTABLE_FIELDS = [
  'relationship_id',
  'source_entity_id',
  'target_entity_id',
  'relationship_type',
  'scope_ref',
  'taxonomy_ref',
  'visibility',
  'visibility_policy_ref'
];

function invalid(message) {
  throw new InvalidTransitionError(message);
}

function assertImmutable(state, payload = {}) {
  for (const field of IMMUTABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      const expected = state[field] ?? null;
      const actual = payload[field] ?? null;
      if (actual !== expected) invalid(`IMMUTABLE_FIELD_CHANGED:${field}`);
    }
  }
}

function foldRelationship(events) {
  let state = {
    lifecycle: 'nonexistent',
    termination_reason: null,
    evidence_count: 0,
    annotation_count: 0,
    open_contestations: [],
    open_contestation_count: 0,
    stream_version: 0,
    created_event_id: null,
    last_event_id: null
  };

  for (const event of events) {
    const payload = event.payload ?? {};

    if (event.event_type === 'relationship.proposed') {
      if (state.lifecycle !== 'nonexistent') invalid('RELATIONSHIP_ALREADY_EXISTS');
      validateProposalPayload(payload);
      state = {
        ...state,
        relationship_id: payload.relationship_id,
        source_entity_id: payload.source_entity_id,
        target_entity_id: payload.target_entity_id,
        relationship_type: payload.relationship_type,
        scope_ref: payload.scope_ref ?? null,
        taxonomy_ref: payload.taxonomy_ref,
        visibility: payload.visibility,
        visibility_policy_ref: payload.visibility_policy_ref,
        lifecycle: 'proposed',
        created_event_id: event.event_id
      };
    } else {
      if (state.lifecycle === 'nonexistent') invalid('RELATIONSHIP_NOT_PROPOSED');
      assertImmutable(state, payload);

      switch (event.event_type) {
        case 'relationship.activated':
          if (state.lifecycle !== 'proposed') invalid('RELATIONSHIP_CANNOT_ACTIVATE');
          state.lifecycle = 'active';
          break;
        case 'relationship.terminated':
          if (!['proposed', 'active'].includes(state.lifecycle)) invalid('RELATIONSHIP_CANNOT_TERMINATE');
          state.lifecycle = 'terminated';
          state.termination_reason = payload.reason ?? 'other';
          break;
        case 'relationship.evidence_added':
          state.evidence_count += 1;
          break;
        case 'relationship.annotation_added':
          state.annotation_count += 1;
          break;
        case 'relationship.contestation_opened': {
          const id = payload.contestation_id;
          if (!id || state.open_contestations.includes(id)) invalid('INVALID_CONTESTATION_OPEN');
          state.open_contestations = [...state.open_contestations, id];
          state.open_contestation_count = state.open_contestations.length;
          break;
        }
        case 'relationship.contestation_resolved': {
          const id = payload.contestation_id;
          if (!id || !state.open_contestations.includes(id)) invalid('INVALID_CONTESTATION_RESOLUTION');
          state.open_contestations = state.open_contestations.filter(value => value !== id);
          state.open_contestation_count = state.open_contestations.length;
          break;
        }
        default:
          invalid(`UNKNOWN_RELATIONSHIP_EVENT:${event.event_type}`);
      }
    }

    state.stream_version = event.stream_seq;
    state.last_event_id = event.event_id;
  }

  return state;
}

module.exports = { foldRelationship, IMMUTABLE_FIELDS };
