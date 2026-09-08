const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const {
  RETENTION_POLICY_REF,
  DEFAULT_RETENTION_DAYS,
  normalizeConsumptionTarget
} = require('../consumption/types');
const { ConsumptionStore } = require('../consumption/store');

test('Consumption target normalization permits publication seen/opened and social-activity seen only', async () => {
  assert.deepEqual(normalizeConsumptionTarget('seen',{publication_id:'pub:P'}),{target_kind:'publication',target_ref:'pub:P'});
  assert.deepEqual(normalizeConsumptionTarget('opened',{publication_id:'pub:P'}),{target_kind:'publication',target_ref:'pub:P'});
  assert.deepEqual(normalizeConsumptionTarget('seen',{social_activity_event_id:'evt:E'}),{target_kind:'social_activity',target_ref:'evt:E'});
  assert.throws(()=>normalizeConsumptionTarget('opened',{social_activity_event_id:'evt:E'}),/CONSUMPTION_OPENED_TARGET_INVALID/);
});

test('seen records first_seen once and only refreshes operational retention metadata on retry', async () => {
  const db=createTestDatabase();
  const store=new ConsumptionStore(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n,0);
  await store.recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:P',now:'2026-09-03T10:00:00.000Z'});
  await store.recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:P',now:'2026-09-03T11:00:00.000Z'});
  const row=await store.get('actor:A','publication','pub:P');
  assert.equal(row.first_seen_at,'2026-09-03T10:00:00.000Z');
  assert.equal(row.first_opened_at,null);
  assert.equal(row.last_touched_at,'2026-09-03T11:00:00.000Z');
  assert.equal(row.expires_at,'2026-12-02T11:00:00.000Z');
  assert.equal(row.state_version,2);
  assert.equal(row.retention_policy_ref,RETENTION_POLICY_REF);
  assert.equal(DEFAULT_RETENTION_DAYS,90);
});

test('opened preserves prior seen time and sets first_opened once', async () => {
  const db=createTestDatabase();const store=new ConsumptionStore(db);
  await store.recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:P',now:'2026-09-03T10:00:00.000Z'});
  await store.recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:P',now:'2026-09-03T12:00:00.000Z'});
  await store.recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:P',now:'2026-09-03T13:00:00.000Z'});
  const row=await store.get('actor:A','publication','pub:P');
  assert.equal(row.first_seen_at,'2026-09-03T10:00:00.000Z');
  assert.equal(row.first_opened_at,'2026-09-03T12:00:00.000Z');
  assert.equal(row.last_touched_at,'2026-09-03T13:00:00.000Z');
  assert.equal(row.state_version,3);
});

test('opened-first establishes the weaker seen fact at the same trusted time', async () => {
  const db=createTestDatabase();const store=new ConsumptionStore(db);
  await store.recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:P',now:'2026-09-03T12:00:00.000Z'});
  const row=await store.get('actor:A','publication','pub:P');
  assert.equal(row.first_seen_at,'2026-09-03T12:00:00.000Z');
  assert.equal(row.first_opened_at,'2026-09-03T12:00:00.000Z');
});

test('expiry deletes only expired operational rows and never creates canonical consumption events', async () => {
  const db=createTestDatabase();const store=new ConsumptionStore(db);
  await store.recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:old',now:'2026-01-01T00:00:00.000Z'});
  await store.recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:new',now:'2026-08-01T00:00:00.000Z'});
  const deleted=await store.deleteExpired('2026-09-03T00:00:00.000Z');
  assert.equal(deleted,1);
  assert.equal(await store.get('actor:A','publication','pub:old'),null);
  assert.ok(await store.get('actor:A','publication','pub:new'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM canonical_events WHERE stream_type='consumption'").get().n,0);
});
