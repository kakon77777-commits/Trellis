const test = require('node:test');
const assert = require('node:assert/strict');
const { derivePreferenceId, PREFERENCE_POLICY_REF, normalizePreferenceTarget } = require('../preference/types');
const { foldPreference } = require('../preference/fold');
const { validatePreferenceCreationPayload } = require('../preference/schemas');

function event(event_type, stream_seq, payload = {}) {
  return { event_id: `evt:${stream_seq}`, event_type, stream_seq, payload };
}

function createdPayload(type='bookmark_publication', target={ publication_id:'pub:P' }) {
  const normalized = normalizePreferenceTarget(type, target);
  return {
    preference_id: derivePreferenceId('actor:A', type, target),
    owner_actor_id: 'actor:A',
    preference_type: type,
    ...normalized,
    preference_policy_ref: PREFERENCE_POLICY_REF
  };
}

test('preference ID is deterministic per owner-type-target tuple', () => {
  const target={publication_id:'pub:P'};
  const id=derivePreferenceId('actor:A','bookmark_publication',target);
  assert.equal(id,derivePreferenceId('actor:A','bookmark_publication',target));
  assert.notEqual(id,derivePreferenceId('actor:A','not_interested_publication',target));
  assert.notEqual(id,derivePreferenceId('actor:B','bookmark_publication',target));
});

test('preference target normalization is canonical and typed', () => {
  assert.deepEqual(normalizePreferenceTarget('bookmark_publication',{publication_id:'pub:P'}),{target_kind:'publication',target_ref:'pub:P',target_item_kind:null});
  assert.deepEqual(normalizePreferenceTarget('not_interested_publication',{publication_id:'pub:P'}),{target_kind:'publication',target_ref:'pub:P',target_item_kind:null});
  assert.deepEqual(normalizePreferenceTarget('mute_actor',{actor_id:'actor:B'}),{target_kind:'actor',target_ref:'actor:B',target_item_kind:null});
  assert.deepEqual(normalizePreferenceTarget('dismiss_feed_item',{item_kind:'social_activity',source_ref:'evt:E'}),{target_kind:'feed_item',target_ref:'evt:E',target_item_kind:'social_activity'});
  assert.throws(()=>normalizePreferenceTarget('dismiss_feed_item',{item_kind:'other',source_ref:'x'}),/PREFERENCE_FEED_ITEM_KIND_INVALID/);
});

test('preference lifecycle is created to withdrawn to restored on same aggregate', () => {
  const payload=createdPayload();
  const active=foldPreference([event('preference.created',1,payload)]);
  assert.equal(active.lifecycle,'active');
  assert.equal(active.preference_id,payload.preference_id);
  const withdrawn=foldPreference([event('preference.created',1,payload),event('preference.withdrawn',2,{reason:'owner_withdrawn'})]);
  assert.equal(withdrawn.lifecycle,'withdrawn');
  const restored=foldPreference([event('preference.created',1,payload),event('preference.withdrawn',2,{}),event('preference.restored',3,{})]);
  assert.equal(restored.lifecycle,'active');
  assert.equal(restored.preference_id,payload.preference_id);
});

test('preference identity fields are immutable after creation', () => {
  const payload=createdPayload();
  for (const [field,value] of [
    ['owner_actor_id','actor:B'],['preference_type','mute_actor'],['target_kind','actor'],['target_ref','actor:B'],['target_item_kind','publication'],['preference_policy_ref','other']
  ]) {
    assert.throws(()=>foldPreference([event('preference.created',1,payload),event('preference.withdrawn',2,{[field]:value})]),new RegExp(`PREFERENCE_IMMUTABLE_FIELD_CHANGED:${field}`));
  }
});

test('preference creation schema has no visibility scope or audience override', () => {
  const payload=createdPayload();
  assert.doesNotThrow(()=>validatePreferenceCreationPayload(payload));
  for (const field of ['visibility','scope_ref','audience_actor_ids']) {
    assert.throws(()=>validatePreferenceCreationPayload({...payload,[field]: field==='audience_actor_ids'?['actor:A']:'public'}),/PREFERENCE_AUDIENCE_OVERRIDE_FORBIDDEN/);
  }
});

test('invalid lifecycle transitions and unknown events are rejected', () => {
  const payload=createdPayload();
  assert.throws(()=>foldPreference([event('preference.created',1,payload),event('preference.created',2,payload)]),/PREFERENCE_ALREADY_CREATED/);
  assert.throws(()=>foldPreference([event('preference.created',1,payload),event('preference.restored',2,{})]),/PREFERENCE_CANNOT_RESTORE/);
  assert.throws(()=>foldPreference([event('preference.created',1,payload),event('preference.withdrawn',2,{}),event('preference.withdrawn',3,{})]),/PREFERENCE_CANNOT_WITHDRAW/);
  assert.throws(()=>foldPreference([event('preference.created',1,payload),event('preference.unknown',2,{})]),/UNKNOWN_PREFERENCE_EVENT/);
});
