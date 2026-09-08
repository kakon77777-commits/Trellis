const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { deepStrictEqual } = require('node:assert/strict');
const { openMigratedDatabase } = require('../db/sqlite');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { executeStorageContract } = require('../test/storage-contract/contract-suite');
const { renderWranglerConfig } = require('./render-wrangler-config');

const ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = Number(process.env.TRELLIS_D1_CONTRACT_PORT ?? 8799);
const CONTRACT_CONFIG = path.join(ROOT, '.trellis-storage-contract.wrangler.toml');
// miniflare's local D1 SQLite storage is deliberately kept OUTSIDE the project
// tree (in the OS temp dir) rather than under ROOT: on some real project
// trees, workerd's D1 SQLite storage throws an opaque "internal error" when
// its --persist-to directory lives inside that tree — reproduced independent
// of SQL content, config content, compatibility_date, and process CWD; the
// identical install/query/database against a --persist-to outside the tree
// succeeds every time. --persist-to is passed as an absolute path, so its
// location is unaffected by CWD.
const PERSIST_DIR = path.join(os.tmpdir(), 'trellis-storage-runtime-persist', 'contract-local');
const DEFAULT_EVIDENCE = path.join(ROOT, 'validation', 'STORAGE_RUNTIME_V1_LAYER_B_D1_LOCAL.json');

function wranglerEntry() {
  if (process.env.WRANGLER_BIN) return { command: process.env.WRANGLER_BIN, prefixArgs: [] };
  const pkgPath = require.resolve('wrangler/package.json', { paths: [ROOT] });
  const entry = path.join(path.dirname(pkgPath), 'bin', 'wrangler.js');
  return { command: process.execPath, prefixArgs: [entry] };
}

function buildContractWranglerConfig(databaseId) {
  return renderWranglerConfig({ databaseId })
    .replace('name = "evemisslab-trellis"', 'name = "evemisslab-trellis-storage-contract-local"')
    .replace('main = "cloudflare/worker.mjs"', 'main = "cloudflare/storage-contract-worker.mjs"');
}

function runWrangler(args, { capture = false } = {}) {
  const { command, prefixArgs } = wranglerEntry();
  const result = spawnSync(command, [...prefixArgs, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`WRANGLER_COMMAND_FAILED:${args.join(' ')}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result;
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

async function runSQLiteReference() {
  const db = openMigratedDatabase(':memory:');
  try {
    return await executeStorageContract({ sql: new SQLiteAsyncAdapter(db), backend: 'sqlite' });
  } finally {
    db.close();
  }
}

async function runD1LocalContract({ databaseId, evidencePath = DEFAULT_EVIDENCE, port = DEFAULT_PORT } = {}) {
  if (!databaseId) throw new TypeError('TRELLIS_D1_DATABASE_ID_REQUIRED');
  const sqlite = await runSQLiteReference();
  if (sqlite.status !== 'PASS') throw new Error('SQLITE_REFERENCE_CONTRACT_FAILED');

  fs.rmSync(PERSIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(PERSIST_DIR, { recursive: true });
  fs.writeFileSync(CONTRACT_CONFIG, buildContractWranglerConfig(databaseId), 'utf8');

  const common = ['--config', CONTRACT_CONFIG];
  runWrangler([
    'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', PERSIST_DIR, ...common
  ]);

  const devEntry = wranglerEntry();
  const child = spawn(devEntry.command, [
    ...devEntry.prefixArgs,
    'dev', '--config', CONTRACT_CONFIG,
    '--persist-to', PERSIST_DIR,
    '--port', String(port),
    '--log-level', 'error'
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', chunk => { stdout += chunk.toString(); process.stdout.write(chunk); });
  child.stderr?.on('data', chunk => { stderr += chunk.toString(); process.stderr.write(chunk); });

  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitForHealth(origin, child);
    const response = await fetch(`${origin}/__trellis/storage-contract`);
    const d1 = await response.json();
    if (!response.ok || d1.status !== 'PASS') {
      const error = new Error('D1_LOCAL_CONTRACT_FAILED');
      error.result = d1;
      throw error;
    }
    deepStrictEqual(d1.equivalence, sqlite.equivalence);

    const evidence = {
      schema: 'trellis-storage-layer-b-local-v1',
      generated_at: new Date().toISOString(),
      equivalence_match: true,
      sqlite,
      d1,
      wrangler: {
        persist_dir: path.relative(ROOT, PERSIST_DIR),
        config: path.relative(ROOT, CONTRACT_CONFIG),
        database_name: 'evemisslab-trellis',
        binding: 'DB',
        stdout,
        stderr
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
  const evidence = await runD1LocalContract({
    databaseId: process.env.TRELLIS_D1_DATABASE_ID,
    evidencePath: process.env.TRELLIS_D1_EVIDENCE_OUT || DEFAULT_EVIDENCE
  });
  process.stdout.write(`${JSON.stringify({ status:'PASS', equivalence_match:evidence.equivalence_match, evidence:process.env.TRELLIS_D1_EVIDENCE_OUT || DEFAULT_EVIDENCE })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    if (error?.result) console.error(JSON.stringify(error.result, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  buildContractWranglerConfig,
  runD1LocalContract,
  runSQLiteReference,
  CONTRACT_CONFIG,
  PERSIST_DIR,
  DEFAULT_EVIDENCE
};
