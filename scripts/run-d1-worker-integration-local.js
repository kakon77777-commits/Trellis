const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { renderWranglerConfig } = require('./render-wrangler-config');
const { parseSemanticFactMarkers, semanticFactsFromViewModel } = require('../web/render/semantic-facts');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = Number(process.env.TRELLIS_D1_INTEGRATION_PORT ?? 8800);
const INTEGRATION_CONFIG = path.join(ROOT, '.trellis-worker-integration.wrangler.toml');
// See run-d1-contract-local.js for why this lives outside ROOT: workerd's D1
// SQLite storage throws an opaque "internal error" when --persist-to is
// inside this project tree, independent of SQL/config/compat-date/CWD; the
// identical setup against a --persist-to outside the tree succeeds reliably.
const PERSIST_DIR = path.join(os.tmpdir(), 'trellis-storage-runtime-persist', 'worker-integration-local');
const DEFAULT_EVIDENCE = path.join(ROOT, 'validation', 'STORAGE_RUNTIME_V1_LAYER_C_D1_LOCAL.json');

function wranglerEntry() {
  if (process.env.WRANGLER_BIN) return { command: process.env.WRANGLER_BIN, prefixArgs: [] };
  const pkgPath = require.resolve('wrangler/package.json', { paths: [ROOT] });
  const entry = path.join(path.dirname(pkgPath), 'bin', 'wrangler.js');
  return { command: process.execPath, prefixArgs: [entry] };
}

function buildIntegrationWranglerConfig(databaseId) {
  return renderWranglerConfig({ databaseId })
    .replace('name = "evemisslab-trellis"', 'name = "evemisslab-trellis-worker-integration-local"')
    .replace('main = "cloudflare/worker.mjs"', 'main = "cloudflare/integration-gate-worker.mjs"');
}

function runWrangler(args) {
  const { command, prefixArgs } = wranglerEntry();
  const result = spawnSync(command, [...prefixArgs, ...args], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`WRANGLER_COMMAND_FAILED:${args.join(' ')}`);
}

async function waitForHealth(origin, child, timeoutMs = 30000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const error = new Error('WRANGLER_DEV_HEALTH_TIMEOUT');
  error.cause = lastError;
  throw error;
}

function startWorker(port = DEFAULT_PORT) {
  const devEntry = wranglerEntry();
  const child = spawn(devEntry.command, [
    ...devEntry.prefixArgs,
    'dev', '--config', INTEGRATION_CONFIG,
    '--persist-to', PERSIST_DIR,
    '--port', String(port),
    '--log-level', 'error'
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', chunk => process.stdout.write(chunk));
  child.stderr?.on('data', chunk => process.stderr.write(chunk));
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function requestText(origin, route, options = {}) {
  const response = await fetch(`${origin}${route}`, options);
  return {
    status: response.status,
    content_type: response.headers.get('content-type') ?? '',
    body: await response.text()
  };
}

async function requestJson(origin, route, options = {}) {
  const result = await requestText(origin, route, options);
  let value = null;
  try { value = JSON.parse(result.body); } catch {}
  return { ...result, value };
}

async function requireIntegrationPass(origin, route, options = {}) {
  const response = await requestJson(origin, route, options);
  if (response.status !== 200 || response.value?.status !== 'PASS') {
    const error = new Error(`INTEGRATION_CONTROL_FAILED:${route}`);
    error.response = response;
    throw error;
  }
  return response.value;
}

async function assertSemanticParity(origin) {
  const vectors = [
    ['public_feed', '/', '/api/public/feed'],
    ['public_directory', '/discover', '/api/public/directory'],
    ['actor', '/actors/actor%3AA', '/api/actors/actor%3AA'],
    ['publication', '/publications/pub%3Ap1', '/api/publications/pub%3Ap1'],
    ['community', '/communities/community%3AC', '/api/communities/community%3AC']
  ];
  const results = {};
  for (const [type, humanRoute, apiRoute] of vectors) {
    const human = await requestText(origin, humanRoute);
    const machine = await requestJson(origin, apiRoute);
    assert.equal(human.status, 200, humanRoute);
    assert.equal(machine.status, 200, apiRoute);
    const humanFacts = parseSemanticFactMarkers(human.body);
    const machineFacts = semanticFactsFromViewModel(type, machine.value);
    assert.deepEqual(humanFacts, machineFacts, type);
    results[type] = { human_route: humanRoute, api_route: apiRoute, fact_count: humanFacts.length };
  }
  return results;
}

async function capturePublicCollections(origin) {
  const feed = await requestJson(origin, '/api/public/feed');
  const directory = await requestJson(origin, '/api/public/directory');
  assert.equal(feed.status, 200);
  assert.equal(directory.status, 200);
  return { feed: feed.value, directory: directory.value };
}

async function runD1WorkerIntegration({ databaseId, evidencePath = DEFAULT_EVIDENCE, port = DEFAULT_PORT } = {}) {
  if (!databaseId) throw new TypeError('TRELLIS_D1_DATABASE_ID_REQUIRED');
  fs.rmSync(PERSIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(PERSIST_DIR, { recursive: true });
  fs.writeFileSync(INTEGRATION_CONFIG, buildIntegrationWranglerConfig(databaseId), 'utf8');

  runWrangler([
    'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', PERSIST_DIR,
    '--config', INTEGRATION_CONFIG
  ]);

  const origin = `http://127.0.0.1:${port}`;
  let child = startWorker(port);
  try {
    await waitForHealth(origin, child);
    const seed = await requireIntegrationPass(origin, '/__trellis/integration/seed-public', { method: 'POST' });
    const firstVerification = await requireIntegrationPass(origin, '/__trellis/integration/verify');
    assert.equal(firstVerification.verification.hash_chain.ok, true);
    assert.equal(firstVerification.verification.command_receipt.idempotency_key, 'pub:p1');

    // Layer C persistence gate: discard the Worker process and create a fresh request runtime
    // over the same local D1 persistent state before validating the public surface.
    await stopChild(child);
    child = startWorker(port);
    await waitForHealth(origin, child);

    const requiredRoutes = ['/', '/api/schema', '/.well-known/trellis.json', '/api/public/feed', '/api/public/directory'];
    const routeStatus = {};
    for (const route of requiredRoutes) {
      const response = await requestText(origin, route);
      assert.equal(response.status, 200, route);
      routeStatus[route] = response.status;
    }

    const parity = await assertSemanticParity(origin);

    const claimedIdentity = await requestText(origin, '/?viewer_actor_id=actor:A');
    assert.equal(claimedIdentity.status, 400);
    const ownerFeed = await requestText(origin, '/api/feed/home');
    assert.equal(ownerFeed.status, 404);
    const wellKnown = await requestJson(origin, '/.well-known/trellis.json');
    assert.equal(wellKnown.value?.writes_enabled, false);

    const home = await requestText(origin, '/');
    assert.doesNotMatch(home.body, /<script>alert\(1\)<\/script>/);
    assert.match(home.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

    const beforeHidden = await capturePublicCollections(origin);
    await requireIntegrationPass(origin, '/__trellis/integration/add-hidden', { method: 'POST' });
    const afterHidden = await capturePublicCollections(origin);
    assert.deepEqual(afterHidden.feed, beforeHidden.feed, 'FEED_HIDDEN_NONINTERFERENCE');
    assert.deepEqual(afterHidden.directory, beforeHidden.directory, 'DIRECTORY_HIDDEN_NONINTERFERENCE');

    const hidden = await requestText(origin, '/communities/community%3ACprivate');
    const missing = await requestText(origin, '/communities/community%3Amissing');
    assert.equal(hidden.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(hidden.body, missing.body);

    const verification = await requireIntegrationPass(origin, '/__trellis/integration/verify');
    assert.equal(verification.verification.hash_chain.ok, true);
    assert.equal(verification.verification.command_receipt.idempotency_key, 'pub:p1');
    assert.equal(verification.verification.projection.publication_id, 'pub:p1');
    assert.equal(verification.verification.append_batch_guard_count, 0);

    const evidence = {
      schema: 'trellis-storage-layer-c-local-v1',
      generated_at: new Date().toISOString(),
      worker_process_restart_persistence: true,
      seed,
      public_route_status: routeStatus,
      semantic_parity: parity,
      w6_claimed_actor_status: claimedIdentity.status,
      w10_authored_script_escaped: true,
      w11_personalized_owner_feed_status: ownerFeed.status,
      writes_enabled: wellKnown.value?.writes_enabled,
      hidden_noninterference: {
        feed_equal: true,
        directory_equal: true,
        hidden_and_missing_same_404: true,
        before_feed_snapshot_ref: beforeHidden.feed?.snapshot_ref,
        after_feed_snapshot_ref: afterHidden.feed?.snapshot_ref,
        before_directory_snapshot_ref: beforeHidden.directory?.snapshot_ref,
        after_directory_snapshot_ref: afterHidden.directory?.snapshot_ref
      },
      canonical_verification: verification.verification,
      wrangler: {
        database_name: 'evemisslab-trellis',
        binding: 'DB',
        config: path.relative(ROOT, INTEGRATION_CONFIG),
        persist_dir: path.relative(ROOT, PERSIST_DIR)
      }
    };
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    return evidence;
  } finally {
    await stopChild(child);
  }
}

async function main() {
  const evidence = await runD1WorkerIntegration({
    databaseId: process.env.TRELLIS_D1_DATABASE_ID,
    evidencePath: process.env.TRELLIS_D1_LAYER_C_EVIDENCE_OUT || DEFAULT_EVIDENCE
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', worker_process_restart_persistence: evidence.worker_process_restart_persistence, evidence: process.env.TRELLIS_D1_LAYER_C_EVIDENCE_OUT || DEFAULT_EVIDENCE })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    if (error?.response) console.error(JSON.stringify(error.response, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  buildIntegrationWranglerConfig,
  runD1WorkerIntegration,
  startWorker,
  stopChild,
  INTEGRATION_CONFIG,
  PERSIST_DIR,
  DEFAULT_EVIDENCE
};
