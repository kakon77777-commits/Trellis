const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');

test('Layer C local harness wraps the production Worker and exercises real local D1 persistence/W1-W12', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'cloudflare', 'integration-gate-worker.mjs'), 'utf8');
  const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'run-d1-worker-integration-local.js'), 'utf8');
  assert.match(worker, /productionWorker/);
  assert.match(worker, /new D1Adapter\(env\.DB\)/);
  assert.match(worker, /seedPublicFixture/);
  assert.match(worker, /addHiddenFixture/);
  assert.match(worker, /verifyIntegrationFixture/);
  assert.match(runner, /wrangler/);
  assert.match(runner, /migrations/);
  assert.match(runner, /--local/);
  assert.match(runner, /--persist-to/);
  assert.match(runner, /stopChild/);
  assert.match(runner, /startWorker/g);
  for (const route of ['/', '/api/schema', '/.well-known/trellis.json', '/api/public/feed', '/api/public/directory']) {
    assert.ok(runner.includes(route), route);
  }
  assert.match(runner, /parseSemanticFactMarkers/);
  assert.match(runner, /semanticFactsFromViewModel/);
  assert.match(runner, /FEED_HIDDEN_NONINTERFERENCE|hidden_noninterference/);
});

test('Layer C release manifest exposes the external D1 gate and syntax-checks nested Cloudflare tests', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:storage:worker-d1-local'], 'node scripts/run-d1-worker-integration-local.js');
  assert.match(pkg.scripts.check, /test\/cloudflare\/\*\.js/);
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /\.trellis-worker-integration\.wrangler\.toml/);
  assert.match(ignore, /\.trellis-d1-integration-state\//);
});
