const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LAYER_B_PATH = path.join(ROOT, 'validation', 'STORAGE_RUNTIME_V1_LAYER_B_D1_LOCAL.json');
const LAYER_C_PATH = path.join(ROOT, 'validation', 'STORAGE_RUNTIME_V1_LAYER_C_D1_LOCAL.json');
const GATE_PATH = path.join(ROOT, 'validation', 'STORAGE_RUNTIME_V1_GATE.json');

function readJsonIfPresent(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validLayerB(evidence) {
  return Boolean(
    evidence &&
    evidence.schema === 'trellis-storage-layer-b-local-v1' &&
    evidence.equivalence_match === true &&
    evidence.sqlite?.status === 'PASS' &&
    evidence.d1?.status === 'PASS'
  );
}

function validLayerC(evidence) {
  const routes = ['/', '/api/schema', '/.well-known/trellis.json', '/api/public/feed', '/api/public/directory'];
  const parity = ['public_feed', 'public_directory', 'actor', 'publication', 'community'];
  return Boolean(
    evidence &&
    evidence.schema === 'trellis-storage-layer-c-local-v1' &&
    evidence.worker_process_restart_persistence === true &&
    routes.every(route => evidence.public_route_status?.[route] === 200) &&
    parity.every(type => evidence.semantic_parity?.[type]) &&
    evidence.w6_claimed_actor_status === 400 &&
    evidence.w10_authored_script_escaped === true &&
    evidence.w11_personalized_owner_feed_status === 404 &&
    evidence.writes_enabled === false &&
    evidence.hidden_noninterference?.feed_equal === true &&
    evidence.hidden_noninterference?.directory_equal === true &&
    evidence.hidden_noninterference?.hidden_and_missing_same_404 === true &&
    evidence.canonical_verification?.hash_chain?.ok === true &&
    evidence.canonical_verification?.command_receipt?.idempotency_key === 'pub:p1' &&
    evidence.canonical_verification?.projection?.publication_id === 'pub:p1' &&
    Number(evidence.canonical_verification?.append_batch_guard_count) === 0
  );
}

const SANDBOX_EVIDENCE = Object.freeze({
  SR1: ['test/async-command-write.test.js', 'test/async-read-policy.test.js', 'test/async-derived-path.test.js'],
  SR2: ['cloudflare/worker.mjs', 'wrangler.toml.template'],
  SR3: ['storage/sqlite-adapter.js', 'test/storage-port.test.js'],
  SR4: ['storage/migration-loader.js', 'db/migrations/', 'test/migration-source.test.js'],
  SR5: ['events/async-sql-event-store.js', 'test/async-event-store-concurrency.test.js', 'test/storage-contract/contract-suite.js'],
  SR6: ['test/storage-contract/contract-suite.js'],
  SR7: ['test/storage-contract/contract-suite.js'],
  SR8: ['test/storage-contract/contract-suite.js'],
  SR9: ['test/storage-contract/contract-suite.js'],
  SR10: ['storage/results.js', 'test/storage-port.test.js', 'test/storage-contract/contract-suite.js'],
  SR11: ['db/sqlite.js', 'test/migration-source.test.js', 'cloudflare/worker.mjs'],
  SR12: ['test/cloudflare-worker-composition.test.js', 'test/storage-runtime-v1-seal.test.js'],
  SR13: ['test/storage-runtime-v1-seal.test.js', 'test/async-event-store-concurrency.test.js'],
  SR14: ['docs/superpowers/specs/2026-09-07-trellis-storage-runtime-v1-d1-design.md', 'events/async-sql-event-store.js'],
  SR15: ['test/storage-contract/contract-suite.js'],
  SR16: ['test/async-event-store.test.js', 'events/async-sql-event-store.js']
});

const BACKEND_EQUIVALENCE_INVARIANTS = new Set(['SR5','SR6','SR7','SR8','SR9','SR10','SR15']);

function buildGate({ layerBEvidence = null, layerCEvidence = null } = {}) {
  const layerBPass = validLayerB(layerBEvidence);
  const layerCPass = validLayerC(layerCEvidence);
  const invariants = Array.from({ length: 16 }, (_, index) => {
    const id = `SR${index + 1}`;
    const requiresLayerB = BACKEND_EQUIVALENCE_INVARIANTS.has(id);
    return {
      id,
      status: requiresLayerB && !layerBPass ? 'EXTERNAL_D1_REQUIRED' : 'PASS',
      sandbox_evidence: SANDBOX_EVIDENCE[id],
      external_evidence: requiresLayerB && layerBPass ? 'validation/STORAGE_RUNTIME_V1_LAYER_B_D1_LOCAL.json' : null
    };
  });

  const externalReleaseGates = [];
  if (!layerBPass) {
    externalReleaseGates.push({
      id: 'LAYER_B_D1_LOCAL',
      status: 'EXTERNAL_EXECUTION_REQUIRED',
      command: 'npm run test:storage:d1-local',
      evidence_file: 'validation/STORAGE_RUNTIME_V1_LAYER_B_D1_LOCAL.json'
    });
  }
  if (!layerCPass) {
    externalReleaseGates.push({
      id: 'LAYER_C_D1_WORKER_LOCAL',
      status: 'EXTERNAL_EXECUTION_REQUIRED',
      command: 'npm run test:storage:worker-d1-local',
      evidence_file: 'validation/STORAGE_RUNTIME_V1_LAYER_C_D1_LOCAL.json'
    });
  }

  return {
    schema: 'trellis-storage-runtime-v1-gate-v1',
    external_canonical_base: 'kakon77777-commits/Trellis@9520076a64c4af1c0238c1cc537e7e889f56e26e',
    overall_status: layerBPass && layerCPass ? 'PASS' : 'RELEASE_CANDIDATE_EXTERNAL_D1_REQUIRED',
    layers: {
      A: { status: 'PASS', evidence: 'sandbox full async SQLite suite' },
      B: {
        sqlite: { status: 'PASS', evidence: 'test/storage-contract/sqlite.test.js' },
        d1: { status: layerBPass ? 'PASS' : 'EXTERNAL_EXECUTION_REQUIRED', evidence: layerBPass ? 'validation/STORAGE_RUNTIME_V1_LAYER_B_D1_LOCAL.json' : null }
      },
      C: {
        harness: { status: 'PASS', evidence: 'test/cloudflare/' },
        d1_worker: { status: layerCPass ? 'PASS' : 'EXTERNAL_EXECUTION_REQUIRED', evidence: layerCPass ? 'validation/STORAGE_RUNTIME_V1_LAYER_C_D1_LOCAL.json' : null }
      }
    },
    invariants,
    external_release_gates: externalReleaseGates
  };
}

function writeGate(gate, output = GATE_PATH) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(gate, null, 2) + '\n', 'utf8');
  return output;
}

function main() {
  const gate = buildGate({
    layerBEvidence: readJsonIfPresent(LAYER_B_PATH),
    layerCEvidence: readJsonIfPresent(LAYER_C_PATH)
  });
  writeGate(gate);
  process.stdout.write(`${JSON.stringify({ status: gate.overall_status, gate: path.relative(ROOT, GATE_PATH), external_release_gates: gate.external_release_gates })}\n`);
  if (gate.overall_status !== 'PASS') process.exitCode = 2;
}

if (require.main === module) main();

module.exports = {
  validLayerB,
  validLayerC,
  buildGate,
  writeGate,
  readJsonIfPresent,
  LAYER_B_PATH,
  LAYER_C_PATH,
  GATE_PATH
};
