const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { ConsumptionStore } = require('../consumption/store');
const { consumptionForFeedItem } = require('../feed/consumption-signal');

test('publication Feed item resolves only its exact publication consumption row', async () => {
  const db = createTestDatabase();
  const store = new ConsumptionStore(db);
  await store.recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:P',now:'2026-09-03T10:00:00.000Z'});
  await store.recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:OTHER',now:'2026-09-03T10:05:00.000Z'});
  const row = (await consumptionForFeedItem({ownerActorId:'actor:A',item:{item_type:'publication',source_ref:'pub:P'},db}));
  assert.equal(row.target_ref,'pub:P');
  assert.equal(row.first_opened_at,null);
});

test('consumption for another publication cannot affect this item', async () => {
  const db = createTestDatabase();
  await new ConsumptionStore(db).recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:P',now:'2026-09-03T10:00:00.000Z'});
  assert.equal((await consumptionForFeedItem({ownerActorId:'actor:A',item:{item_type:'publication',source_ref:'pub:OTHER'},db})),null);
});

test('social activity Feed item resolves only its source event consumption row', async () => {
  const db = createTestDatabase();
  await new ConsumptionStore(db).recordSeen({consumerActorId:'actor:A',targetKind:'social_activity',targetRef:'evt:E1',now:'2026-09-03T10:00:00.000Z'});
  const row = (await consumptionForFeedItem({ownerActorId:'actor:A',item:{item_type:'social_activity',source_event_ref:'evt:E1'},db}));
  assert.equal(row.target_kind,'social_activity');
  assert.equal(row.target_ref,'evt:E1');
});

test('unknown Feed item kind yields no Consumption signal rather than expanding candidate semantics', async () => {
  const db = createTestDatabase();
  assert.equal((await consumptionForFeedItem({ownerActorId:'actor:A',item:{item_type:'unknown',source_ref:'x'},db})),null);
});
