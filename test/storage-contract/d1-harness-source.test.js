const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

test('real D1 Layer B harness uses a Worker D1 binding and never a hand-written fake', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'cloudflare', 'storage-contract-worker.mjs'), 'utf8');
  const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'run-d1-contract-local.js'), 'utf8');
  assert.match(worker, /new D1Adapter\(env\.DB\)/);
  assert.match(worker, /executeStorageContract/);
  assert.doesNotMatch(worker, /fake|mock/i);
  assert.match(runner, /wrangler/);
  assert.match(runner, /d1["']?,?\s*["']migrations|migrations/);
  assert.match(runner, /--local/);
  assert.match(runner, /--persist-to/);
  assert.match(runner, /deepStrictEqual|equivalence/);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.check, /test\/storage-contract\/\*\.js/);
});
