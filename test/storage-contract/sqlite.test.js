const test = require('node:test');
const assert = require('node:assert/strict');
const { openMigratedDatabase } = require('../../db/sqlite');
const { SQLiteAsyncAdapter } = require('../../storage/sqlite-adapter');
const { executeStorageContract } = require('./contract-suite');

test('Layer B reusable storage contract passes on SQLiteAsyncAdapter', async () => {
  const db = openMigratedDatabase(':memory:');
  try {
    const result = await executeStorageContract({ sql: new SQLiteAsyncAdapter(db), backend: 'sqlite' });
    assert.equal(result.status, 'PASS', JSON.stringify(result, null, 2));
    assert.ok(result.vectors.length >= 11);
    assert.ok(result.vectors.every(vector => vector.status === 'PASS'));
    assert.deepEqual(result.equivalence.global_order.relative_offsets, [0, 1, 2]);
    assert.equal(result.equivalence.hash_chain.ok, true);
    assert.equal(result.equivalence.projection.publication_id, 'pub:contract');
    assert.equal(result.equivalence.consumption.target_ref, 'pub:contract');
  } finally {
    db.close();
  }
});
