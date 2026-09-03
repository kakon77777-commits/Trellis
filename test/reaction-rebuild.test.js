const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { createAuthorityReceipt } = require('../authority/receipts');
const { canonicalStringify } = require('../core/canonical-json');
const { createHash } = require('node:crypto');
const { deriveReactionId, REACTION_POLICY_REF } = require('../reaction/types');
const { projectReactionStream, rebuildReactionProjection } = require('../reaction/projector');

function digest(value) { return createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
function draft(commandId, actorId, eventType, payload) {
  return {
    event_id: `evt:${commandId}`, schema_version: '0.1', event_type: eventType,
    actor_id: actorId, principal_id: `principal:${actorId}`, causation_id: commandId,
    correlation_id: commandId, occurred_at: '2026-09-03T01:00:00Z', recorded_at: 'forged',
    time_source: 'system', provenance_refs: [], payload
  };
}
function append(store, { reactionId, seq, commandId, actorId, eventType, payload }) {
  const command = { commandId, actorId, eventType, payload };
  const authorityReceipt = createAuthorityReceipt({
    command_id: commandId, principal_id: `principal:${actorId}`, actor_id: actorId,
    requested_action: eventType, aggregate_id: reactionId, evaluated_at: '2026-09-03T01:00:00Z'
  }, 'allow', REACTION_POLICY_REF);
  return store.append({
    streamType: 'reaction', streamId: reactionId, expectedVersion: seq - 1,
    events: [draft(commandId, actorId, eventType, payload)], authorityReceipt,
    commandReceipt: {
      command_id: commandId, idempotency_key: `idem:${commandId}`, command_digest: digest(command),
      status: 'accepted', created_at: '2026-09-03T01:00:00Z'
    }
  });
}
function snapshot(db) { return db.prepare('SELECT * FROM reactions_current ORDER BY reaction_id').all(); }

test('Reaction projection can be destroyed and rebuilt exactly from canonical history', () => {
  const db = createTestDatabase();
  const store = new SQLiteEventStore(db, { now: () => '2026-09-03T01:00:01Z' });
  const rid = deriveReactionId('actor:B', 'pub:P');
  const base = {
    reaction_id: rid, actor_id: 'actor:B', publication_id: 'pub:P', scope_ref: null,
    visibility: 'public', audience_actor_ids: [], reaction_policy_ref: REACTION_POLICY_REF,
    reaction_type: 'like'
  };
  append(store, {reactionId:rid,seq:1,commandId:'cmd:r1',actorId:'actor:B',eventType:'reaction.created',payload:base});
  append(store, {reactionId:rid,seq:2,commandId:'cmd:r2',actorId:'actor:B',eventType:'reaction.changed',payload:{reaction_type:'love'}});
  append(store, {reactionId:rid,seq:3,commandId:'cmd:r3',actorId:'actor:B',eventType:'reaction.withdrawn',payload:{reason:'actor_withdrawn'}});
  append(store, {reactionId:rid,seq:4,commandId:'cmd:r4',actorId:'actor:B',eventType:'reaction.restored',payload:{reaction_type:'insightful'}});

  projectReactionStream(db, store, rid);
  const before = snapshot(db);
  assert.equal(before.length, 1);
  assert.equal(before[0].reaction_id, rid);
  assert.equal(before[0].actor_id, 'actor:B');
  assert.equal(before[0].publication_id, 'pub:P');
  assert.equal(before[0].lifecycle, 'active');
  assert.equal(before[0].reaction_type, 'insightful');
  assert.equal(before[0].stream_version, 4);

  db.exec('DELETE FROM reactions_current');
  assert.deepEqual(snapshot(db), []);
  rebuildReactionProjection(db, store);
  assert.deepEqual(snapshot(db), before);
});
