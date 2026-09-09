// Local wrangler-dev end-to-end gate for AILP v0.1: drives the REAL
// cloudflare/worker.mjs (the actual production entry point -- AILP is not a
// separate test-only worker) over real HTTP against real local D1, using
// the same AI-client simulation helper the in-process tests use. This is
// the step between "in-process tests pass" and "real production" per the
// mssp-tdd-apr closure sequence: prove the whole stack together as an
// actual running Worker process before ever touching a live Cloudflare
// account.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { renderWranglerConfig } = require('./render-wrangler-config');
const {
  throwawayJwkPair,
  buildAiClient,
  buildChallengeRequest,
  buildLoginProof,
  signedRequestHeaders
} = require('../test/helpers/ailp-test-client');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = Number(process.env.TRELLIS_AILP_INTEGRATION_PORT ?? 8801);
const INTEGRATION_CONFIG = path.join(ROOT, '.trellis-ailp-worker-integration.wrangler.toml');
// Same rationale as the storage-runtime integration scripts: workerd's D1
// SQLite storage throws an opaque "internal error" when --persist-to is
// inside this project tree, so this lives under the OS temp dir instead.
const PERSIST_DIR = path.join(os.tmpdir(), 'trellis-storage-runtime-persist', 'ailp-worker-integration-local');
const DEFAULT_EVIDENCE = path.join(ROOT, 'validation', 'AILP_V1_WORKER_INTEGRATION_LOCAL.json');

function wranglerEntry() {
  if (process.env.WRANGLER_BIN) return { command: process.env.WRANGLER_BIN, prefixArgs: [] };
  const pkgPath = require.resolve('wrangler/package.json', { paths: [ROOT] });
  const entry = path.join(path.dirname(pkgPath), 'bin', 'wrangler.js');
  return { command: process.execPath, prefixArgs: [entry] };
}

function buildIntegrationWranglerConfig(databaseId, rpPrivateKeyJwk, port) {
  const base = renderWranglerConfig({ databaseId })
    .replace('name = "evemisslab-trellis"', 'name = "evemisslab-trellis-ailp-integration-local"');
  // TOML literal strings ('...') -- no escaping needed for a base64url/JSON
  // blob or a plain http:// URL, as long as neither contains a single quote
  // or newline (a JWK of {kty,crv,x,d} never does; neither does a localhost
  // URL). rpPrivateKeyJwk is a THROWAWAY local test key, generated fresh for
  // this run only -- never the real AILP_RP_PRIVATE_KEY_JWK production
  // secret. AILP_LOCAL_TEST_ALLOWED_ORIGIN is likewise a local-only escape
  // hatch (see cloudflare/worker.mjs) so this test can pass AILP's
  // exact-origin allowlist while talking to 127.0.0.1 -- never set in real
  // production config.
  return [
    base,
    '',
    '[vars]',
    `AILP_RP_PRIVATE_KEY_JWK = '${JSON.stringify(rpPrivateKeyJwk)}'`,
    `AILP_LOCAL_TEST_ALLOWED_ORIGIN = 'http://127.0.0.1:${port}'`,
    ''
  ].join('\n');
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
      const response = await fetch(`${origin}/.well-known/ailp`);
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

function startWorker(port) {
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

async function callReal(origin, { method, path: routePath, headers = {}, body }) {
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${origin}${routePath}`, { method, headers, body: bodyText });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
  return { status: response.status, body: parsed };
}

async function runAilpWorkerIntegration({ databaseId, evidencePath = DEFAULT_EVIDENCE, port = DEFAULT_PORT } = {}) {
  if (!databaseId) throw new TypeError('TRELLIS_D1_DATABASE_ID_REQUIRED');
  fs.rmSync(PERSIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(PERSIST_DIR, { recursive: true });
  const rpPrivateKeyJwk = throwawayJwkPair().privateJwk;
  fs.writeFileSync(INTEGRATION_CONFIG, buildIntegrationWranglerConfig(databaseId, rpPrivateKeyJwk, port), 'utf8');

  runWrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', PERSIST_DIR, '--config', INTEGRATION_CONFIG]);

  const origin = `http://127.0.0.1:${port}`;
  const child = startWorker(port);
  try {
    await waitForHealth(origin, child);

    // -- pre-existing anonymous surface still works, unaffected by AILP --
    const home = await callReal(origin, { method: 'GET', path: '/' });
    assert.equal(home.status, 200);
    const wellKnownTrellis = await callReal(origin, { method: 'GET', path: '/.well-known/trellis.json' });
    assert.equal(wellKnownTrellis.status, 200);
    const claimedIdentity = await callReal(origin, { method: 'GET', path: '/?viewer_actor_id=actor:A' });
    assert.equal(claimedIdentity.status, 400, 'W6 must still reject over real HTTP');

    // -- discovery --
    const discovery = await callReal(origin, { method: 'GET', path: '/.well-known/ailp' });
    assert.equal(discovery.status, 200);
    assert.equal(discovery.body.relying_party_verification_method.id, 'key:rp:trellis');

    // -- the real vertical slice, over real HTTP against a real local D1 --
    const client = buildAiClient({ aiIdentityId: 'ai:local-worker-integration', runtimeId: 'runtime:local-worker-integration' });
    const register = await callReal(origin, { method: 'POST', path: '/ailp/v1/identities/register', body: client.identityRoot });
    assert.equal(register.status, 202);

    const challengeRequest = buildChallengeRequest(client);
    const challenge = (await callReal(origin, { method: 'POST', path: '/ailp/v1/challenges', body: challengeRequest })).body;

    const loginProof = buildLoginProof(client, challenge, challengeRequest);
    const authenticate = await callReal(origin, {
      method: 'POST', path: '/ailp/v1/authenticate',
      body: { challenge_request: challengeRequest, login_proof: loginProof, runtime_certificate: client.runtimeCertificate }
    });
    assert.equal(authenticate.status, 200);
    assert.equal(authenticate.body.recognition_receipt.reason_codes[0], 'first_seen_self_root');
    const sessionId = authenticate.body.session_grant.session_id;

    const sessionHeaders = signedRequestHeaders(client, { method: 'GET', targetUri: origin + '/ailp/v1/session', sessionId, bodyBuffer: Buffer.alloc(0) });
    const sessionCheck = await callReal(origin, { method: 'GET', path: '/ailp/v1/session', headers: sessionHeaders });
    assert.equal(sessionCheck.status, 200);
    assert.equal(sessionCheck.body.state, 'active');

    const bootstrapBody = { requested_actor_id: 'actor:local-worker-integration' };
    const bootstrapBuffer = Buffer.from(JSON.stringify(bootstrapBody), 'utf8');
    const bootstrapHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: origin + '/ailp/v1/actor-bindings/bootstrap', sessionId, bodyBuffer: bootstrapBuffer });
    const bootstrap = await callReal(origin, { method: 'POST', path: '/ailp/v1/actor-bindings/bootstrap', headers: bootstrapHeaders, body: bootstrapBody });
    assert.equal(bootstrap.status, 201);
    assert.equal(bootstrap.body.session_grant.session_class, 'actor_bound');
    const actorSessionId = bootstrap.body.session_grant.session_id;

    const revokeHeaders = signedRequestHeaders(client, { method: 'POST', targetUri: origin + '/ailp/v1/session/revoke', sessionId: actorSessionId, bodyBuffer: Buffer.alloc(0) });
    const revoke = await callReal(origin, { method: 'POST', path: '/ailp/v1/session/revoke', headers: revokeHeaders });
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.state, 'revoked');

    // -- Layer C style gate: restart the Worker process, prove persistence survives --
    // Two complementary checks, both reading real persisted D1 state rather
    // than any in-memory cache that a restart would otherwise reset:
    //   1. a session that was NEVER revoked still authenticates normally
    //      (positive proof: ordinary state persists and keeps working);
    //   2. the REVOKED session still correctly rejects everything, including
    //      its own read-only status check -- authenticateSessionRequest's
    //      very first gate is session.state === 'active', so a revoked
    //      session cannot be used for ANY action, not just writes. If this
    //      instead came back 200 after the restart, THAT would mean the
    //      revocation itself had been lost/reverted.
    await stopChild(child);
    const restarted = startWorker(port);
    let stillActive;
    let stillRevoked;
    try {
      await waitForHealth(origin, restarted);

      const stillActiveHeaders = signedRequestHeaders(client, { method: 'GET', targetUri: origin + '/ailp/v1/session', sessionId, bodyBuffer: Buffer.alloc(0) });
      stillActive = await callReal(origin, { method: 'GET', path: '/ailp/v1/session', headers: stillActiveHeaders });
      assert.equal(stillActive.status, 200, 'a session that was never revoked must still authenticate after a Worker restart');
      assert.equal(stillActive.body.state, 'active');

      const revokedHeaders = signedRequestHeaders(client, { method: 'GET', targetUri: origin + '/ailp/v1/session', sessionId: actorSessionId, bodyBuffer: Buffer.alloc(0) });
      stillRevoked = await callReal(origin, { method: 'GET', path: '/ailp/v1/session', headers: revokedHeaders });
      assert.equal(stillRevoked.status, 400, 'revocation must survive a Worker restart -- a revoked session must stay rejected, not silently become usable again');
      assert.equal(stillRevoked.body.error, 'SESSION_NOT_ACTIVE');
    } finally {
      await stopChild(restarted);
    }

    const evidence = {
      schema: 'trellis-ailp-v1-worker-integration-local',
      generated_at: new Date().toISOString(),
      real_http: true,
      real_local_d1: true,
      worker_process_restart_persistence: {
        still_active_session_status_after_restart: stillActive.status,
        revoked_session_stays_rejected_after_restart_status: stillRevoked.status,
        revoked_session_error_after_restart: stillRevoked.body.error
      },
      anonymous_surface_unaffected: { home_status: home.status, well_known_trellis_status: wellKnownTrellis.status, w6_claimed_actor_status: claimedIdentity.status },
      discovery_status: discovery.status,
      vertical_slice: {
        register_status: register.status,
        authenticate_status: authenticate.status,
        recognition_reason: authenticate.body.recognition_receipt.reason_codes[0],
        session_check_status: sessionCheck.status,
        actor_bootstrap_status: bootstrap.status,
        session_class_after_bootstrap: bootstrap.body.session_grant.session_class,
        revoke_status: revoke.status
      },
      wrangler: { database_name: 'evemisslab-trellis', binding: 'DB', config: path.relative(ROOT, INTEGRATION_CONFIG), persist_dir: path.relative(ROOT, PERSIST_DIR) }
    };
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    return evidence;
  } finally {
    await stopChild(child);
  }
}

async function main() {
  const evidence = await runAilpWorkerIntegration({
    databaseId: process.env.TRELLIS_D1_DATABASE_ID,
    evidencePath: process.env.TRELLIS_AILP_EVIDENCE_OUT || DEFAULT_EVIDENCE
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', worker_process_restart_persistence: evidence.worker_process_restart_persistence, evidence: process.env.TRELLIS_AILP_EVIDENCE_OUT || DEFAULT_EVIDENCE })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    if (error?.response) console.error(JSON.stringify(error.response, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { buildIntegrationWranglerConfig, runAilpWorkerIntegration, INTEGRATION_CONFIG, PERSIST_DIR, DEFAULT_EVIDENCE };
