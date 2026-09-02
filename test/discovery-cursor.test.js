const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeCursor, decodeCursor, paginateCandidates } = require('../discovery/cursor');

const candidates = [
  { actor_id:'actor:A', score:10 },
  { actor_id:'actor:B', score:8 },
  { actor_id:'actor:C', score:8 },
  { actor_id:'actor:D', score:4 }
];

test('cursor pagination is stable and has no duplicates', () => {
  const first=paginateCandidates(candidates,{ limit:2, cursor:null, algorithmRef:'algo:v1', snapshotRef:'snap:1' });
  assert.deepEqual(first.candidates.map(x=>x.actor_id),['actor:A','actor:B']);
  assert.ok(first.next_cursor);
  const second=paginateCandidates(candidates,{ limit:2, cursor:first.next_cursor, algorithmRef:'algo:v1', snapshotRef:'snap:1' });
  assert.deepEqual(second.candidates.map(x=>x.actor_id),['actor:C','actor:D']);
  assert.equal(second.next_cursor,null);
  assert.equal(new Set([...first.candidates,...second.candidates].map(x=>x.actor_id)).size,4);
});

test('same state produces byte-stable cursor', () => {
  const a=paginateCandidates(candidates,{ limit:2, algorithmRef:'algo:v1', snapshotRef:'snap:1' });
  const b=paginateCandidates(candidates,{ limit:2, algorithmRef:'algo:v1', snapshotRef:'snap:1' });
  assert.equal(a.next_cursor,b.next_cursor);
  assert.deepEqual(decodeCursor(a.next_cursor),{
    algorithm_ref:'algo:v1', snapshot_ref:'snap:1', last_score:8, last_entity_id:'actor:B'
  });
});

test('cursor rejects algorithm mismatch', () => {
  const cursor=encodeCursor({ algorithm_ref:'algo:v1', snapshot_ref:'snap:1', last_score:8, last_entity_id:'actor:B' });
  assert.throws(()=>paginateCandidates(candidates,{ limit:2, cursor, algorithmRef:'algo:v2', snapshotRef:'snap:1' }),/DISCOVERY_CURSOR_MISMATCH/);
});

test('cursor rejects visible snapshot mismatch', () => {
  const cursor=encodeCursor({ algorithm_ref:'algo:v1', snapshot_ref:'snap:1', last_score:8, last_entity_id:'actor:B' });
  assert.throws(()=>paginateCandidates(candidates,{ limit:2, cursor, algorithmRef:'algo:v1', snapshotRef:'snap:2' }),/DISCOVERY_SNAPSHOT_CHANGED/);
});

test('same snapshot ref keeps cursor valid even if unrelated hidden state changed elsewhere', () => {
  const first=paginateCandidates(candidates,{ limit:2, algorithmRef:'algo:v1', snapshotRef:'visible-hash' });
  const second=paginateCandidates(candidates,{ limit:2, cursor:first.next_cursor, algorithmRef:'algo:v1', snapshotRef:'visible-hash' });
  assert.deepEqual(second.candidates.map(x=>x.actor_id),['actor:C','actor:D']);
});
