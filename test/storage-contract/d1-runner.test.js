const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContractWranglerConfig } = require('../../scripts/run-d1-contract-local');

test('D1 local runner renders a dedicated contract Worker config over the real DB binding', () => {
  const text = buildContractWranglerConfig('123e4567-e89b-42d3-a456-426614174000');
  assert.match(text, /name = "evemisslab-trellis-storage-contract-local"/);
  assert.match(text, /main = "cloudflare\/storage-contract-worker\.mjs"/);
  assert.match(text, /binding = "DB"/);
  assert.match(text, /database_name = "evemisslab-trellis"/);
  assert.match(text, /database_id = "123e4567-e89b-42d3-a456-426614174000"/);
  assert.match(text, /migrations_dir = "db\/migrations"/);
});
