const test = require('node:test');
const assert = require('node:assert/strict');

const {
  foldProfileAssertions
} = require('../profile/fold');
const {
  getProfileField,
  resolveAssertionVisibility
} = require('../profile/field-registry');
const { validateAssertionPayload } = require('../profile/schemas');

function event(seq, payload) {
  return {
    event_id: `evt:${seq}`,
    event_type: 'entity.assertion_added',
    stream_seq: seq,
    actor_id: 'actor:A',
    principal_id: 'principal:A',
    provenance_refs: [],
    payload
  };
}

test('single-valued assertion becomes active', () => {
  const state = foldProfileAssertions([
    event(1, {
      assertion_id: 'assert:1',
      field_ref: 'profile:display_name:v1',
      operation: 'assert',
      value: 'Aletheia',
      visibility: 'public',
      field_registry_ref: 'profile-fields:0.1',
      supersedes_assertion_id: null
    })
  ]);

  assert.equal(state.active_single['profile:display_name:v1'].value, 'Aletheia');
  assert.equal(state.history.length, 1);
});

test('single-valued assertion requires explicit supersession', () => {
  const events = [
    event(1, {
      assertion_id: 'assert:1', field_ref: 'profile:display_name:v1', operation: 'assert',
      value: 'Aletheia', visibility: 'public', field_registry_ref: 'profile-fields:0.1',
      supersedes_assertion_id: null
    }),
    event(2, {
      assertion_id: 'assert:2', field_ref: 'profile:display_name:v1', operation: 'assert',
      value: 'New Name', visibility: 'public', field_registry_ref: 'profile-fields:0.1',
      supersedes_assertion_id: null
    })
  ];

  assert.throws(() => foldProfileAssertions(events), /PROFILE_SUPERSESSION_REQUIRED/);
});

test('correct supersession replaces active single value without deleting history', () => {
  const state = foldProfileAssertions([
    event(1, {
      assertion_id: 'assert:1', field_ref: 'profile:display_name:v1', operation: 'assert',
      value: 'Aletheia', visibility: 'public', field_registry_ref: 'profile-fields:0.1',
      supersedes_assertion_id: null
    }),
    event(2, {
      assertion_id: 'assert:2', field_ref: 'profile:display_name:v1', operation: 'assert',
      value: 'New Name', visibility: 'participants', field_registry_ref: 'profile-fields:0.1',
      supersedes_assertion_id: 'assert:1'
    })
  ]);

  assert.equal(state.active_single['profile:display_name:v1'].assertion_id, 'assert:2');
  assert.equal(state.active_single['profile:display_name:v1'].visibility, 'participants');
  assert.equal(state.history.length, 2);
  assert.equal(state.assertions_by_id['assert:1'].active, false);
});

test('multi-valued aliases coexist and retract individually', () => {
  const state = foldProfileAssertions([
    event(1, {
      assertion_id: 'assert:1', field_ref: 'profile:alias:v1', operation: 'assert',
      value: 'Aletheia', visibility: 'participants', field_registry_ref: 'profile-fields:0.1'
    }),
    event(2, {
      assertion_id: 'assert:2', field_ref: 'profile:alias:v1', operation: 'assert',
      value: 'Ale', visibility: 'public', field_registry_ref: 'profile-fields:0.1'
    }),
    event(3, {
      assertion_id: 'assert:3', field_ref: 'profile:alias:v1', operation: 'retract',
      target_assertion_id: 'assert:1', visibility: 'participants', field_registry_ref: 'profile-fields:0.1'
    })
  ]);

  assert.deepEqual(state.active_multi['profile:alias:v1'].map(a => a.assertion_id), ['assert:2']);
  assert.equal(state.assertions_by_id['assert:1'].active, false);
  assert.equal(state.history.length, 3);
});

test('retracting an unknown assertion fails', () => {
  assert.throws(() => foldProfileAssertions([
    event(1, {
      assertion_id: 'assert:r', field_ref: 'profile:alias:v1', operation: 'retract',
      target_assertion_id: 'assert:missing', visibility: 'public', field_registry_ref: 'profile-fields:0.1'
    })
  ]), /PROFILE_RETRACT_TARGET_NOT_ACTIVE/);
});

test('assertion id is immutable and cannot be replayed with different visibility', () => {
  assert.throws(() => foldProfileAssertions([
    event(1, {
      assertion_id: 'assert:1', field_ref: 'profile:alias:v1', operation: 'assert',
      value: 'A', visibility: 'public', field_registry_ref: 'profile-fields:0.1'
    }),
    event(2, {
      assertion_id: 'assert:1', field_ref: 'profile:alias:v1', operation: 'assert',
      value: 'A', visibility: 'private', field_registry_ref: 'profile-fields:0.1'
    })
  ]), /ASSERTION_IMMUTABLE/);
});

test('field registry resolves allowed defaults and rejects scope_members', () => {
  const field = getProfileField('profile:alias:v1');
  assert.equal(resolveAssertionVisibility(field), 'participants');
  assert.equal(resolveAssertionVisibility(field, 'private'), 'private');
  assert.throws(() => resolveAssertionVisibility(field, 'scope_members'), /PROFILE_VISIBILITY_NOT_ALLOWED/);
});

test('profile assertions reject scope_ref and self-declared verification', () => {
  const base = {
    assertion_id: 'assert:1', field_ref: 'profile:bio:v1', operation: 'assert', value: 'bio',
    visibility: 'public', field_registry_ref: 'profile-fields:0.1'
  };
  assert.throws(() => validateAssertionPayload({ ...base, scope_ref: 'project:X' }), /PROFILE_ASSERTION_SCOPE_FORBIDDEN/);
  assert.throws(() => validateAssertionPayload({ ...base, verified: true }), /PROFILE_ASSERTION_VERIFICATION_FORBIDDEN/);
});

test('URL fields reject malformed URLs and retract forbids a value', () => {
  assert.throws(() => validateAssertionPayload({
    assertion_id: 'assert:1', field_ref: 'profile:website:v1', operation: 'assert',
    value: 'not-a-url', visibility: 'public', field_registry_ref: 'profile-fields:0.1'
  }), /PROFILE_VALUE_INVALID_URL/);

  assert.throws(() => validateAssertionPayload({
    assertion_id: 'assert:2', field_ref: 'profile:alias:v1', operation: 'retract',
    target_assertion_id: 'assert:1', value: 'forbidden', visibility: 'public',
    field_registry_ref: 'profile-fields:0.1'
  }), /PROFILE_RETRACT_VALUE_FORBIDDEN/);
});
