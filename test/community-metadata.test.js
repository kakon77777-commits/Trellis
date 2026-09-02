const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { createCommunity } = require('../community/service');
const { foldCommunityAssertions, resolveCommunityDiscoverability } = require('../community/fold');
const { setCommunityName, setCommunityDescription, setCommunityAvatarUrl, setCommunityDiscoverability } = require('../community/product-commands');

function setup() {
  const db = createTestDatabase();
  const eventStore = new SQLiteEventStore(db);
  createCommunity({ command_id:'cmd:c', idempotency_key:'idem:c', principal_id:'principal:c', community_id:'community:C' }, { eventStore, authorize:evaluateAuthority });
  const context = { eventStore, authorize:evaluateAuthority, principalActorId:'community:C', evaluatedAt:'2026-09-02T09:00:00Z' };
  return { db, eventStore, context };
}

function cmd(id, extra={}) {
  return { command_id:`cmd:${id}`, idempotency_key:`idem:${id}`, principal_id:'principal:c', community_id:'community:C', ...extra };
}

test('community metadata uses append-only assertions and explicit supersession', () => {
  const { eventStore, context } = setup();
  const first = setCommunityName(cmd('name1', { value:'Research Lab' }), context);
  assert.throws(() => setCommunityName(cmd('name2', { value:'New Name' }), context), /COMMUNITY_SUPERSESSION_REQUIRED/);
  setCommunityName(cmd('name3', { value:'New Name', supersedes_assertion_id:first.assertion_id }), context);
  const state = foldCommunityAssertions(eventStore.readStream('entity', 'community:C'));
  assert.equal(state.active_single['community:name:v1'].value, 'New Name');
  assert.equal(state.history.length, 2);
});

test('community discoverability accepts only public unlisted private and resolves current value', () => {
  const { eventStore, context } = setup();
  setCommunityDiscoverability(cmd('d1', { value:'private' }), context);
  assert.equal(resolveCommunityDiscoverability(eventStore.readStream('entity','community:C')), 'private');
  assert.throws(() => setCommunityDiscoverability(cmd('d2', { value:'friends_only' }), context), /COMMUNITY_VALUE_INVALID/);
});

test('community assertion visibility is immutable per assertion and registry is distinct from profile', () => {
  const { eventStore, context } = setup();
  const first = setCommunityDescription(cmd('desc1', { value:'Secret lab', visibility:'private' }), context);
  const events = eventStore.readStream('entity','community:C');
  const state = foldCommunityAssertions(events);
  assert.equal(state.assertions_by_id[first.assertion_id].visibility, 'private');
  assert.equal(state.assertions_by_id[first.assertion_id].field_registry_ref, 'community-fields:0.1');
  assert.throws(() => foldCommunityAssertions([...events, {
    event_id:'evt:bad', stream_seq:events.length+1, event_type:'entity.assertion_added', actor_id:'community:C', principal_id:'principal:c', payload:{
      assertion_id:'assert:bad', field_ref:'profile:bio:v1', operation:'assert', value:'x', visibility:'public', field_registry_ref:'community-fields:0.1'
    }
  }]), /COMMUNITY_FIELD_UNKNOWN/);
});

test('community metadata write requires acting-as community context', () => {
  const { context } = setup();
  assert.throws(() => setCommunityAvatarUrl(cmd('avatar', { value:'https://example.com/a.png' }), { ...context, principalActorId:'actor:creator' }), /POLICY_DENIED/);
});
