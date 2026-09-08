const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGate } = require('../scripts/evaluate-storage-runtime-v1-gate');

function layerBPass() {
  return {
    schema: 'trellis-storage-layer-b-local-v1',
    equivalence_match: true,
    sqlite: { status: 'PASS' },
    d1: { status: 'PASS' }
  };
}
function layerCPass() {
  return {
    schema: 'trellis-storage-layer-c-local-v1',
    worker_process_restart_persistence: true,
    public_route_status: {
      '/': 200,
      '/api/schema': 200,
      '/.well-known/trellis.json': 200,
      '/api/public/feed': 200,
      '/api/public/directory': 200
    },
    semantic_parity: {
      public_feed: {}, public_directory: {}, actor: {}, publication: {}, community: {}
    },
    w6_claimed_actor_status: 400,
    w10_authored_script_escaped: true,
    w11_personalized_owner_feed_status: 404,
    writes_enabled: false,
    hidden_noninterference: {
      feed_equal: true,
      directory_equal: true,
      hidden_and_missing_same_404: true
    },
    canonical_verification: {
      hash_chain: { ok: true },
      command_receipt: { idempotency_key: 'pub:p1' },
      projection: { publication_id: 'pub:p1' },
      append_batch_guard_count: 0
    }
  };
}

test('gate evaluator stays external-required with no real D1 evidence', () => {
  const gate = buildGate({ layerBEvidence: null, layerCEvidence: null });
  assert.equal(gate.overall_status, 'RELEASE_CANDIDATE_EXTERNAL_D1_REQUIRED');
  assert.equal(gate.external_release_gates.length, 2);
  assert.equal(gate.layers.B.d1.status, 'EXTERNAL_EXECUTION_REQUIRED');
  assert.equal(gate.layers.C.d1_worker.status, 'EXTERNAL_EXECUTION_REQUIRED');
});

test('gate evaluator does not accept Layer B alone as final release', () => {
  const gate = buildGate({ layerBEvidence: layerBPass(), layerCEvidence: null });
  assert.equal(gate.overall_status, 'RELEASE_CANDIDATE_EXTERNAL_D1_REQUIRED');
  assert.equal(gate.external_release_gates.length, 1);
  assert.equal(gate.layers.B.d1.status, 'PASS');
  assert.equal(gate.layers.C.d1_worker.status, 'EXTERNAL_EXECUTION_REQUIRED');
});

test('gate evaluator reaches PASS only when both Layer B and Layer C evidence pass', () => {
  const gate = buildGate({ layerBEvidence: layerBPass(), layerCEvidence: layerCPass() });
  assert.equal(gate.overall_status, 'PASS');
  assert.equal(gate.external_release_gates.length, 0);
  assert.equal(gate.layers.B.d1.status, 'PASS');
  assert.equal(gate.layers.C.d1_worker.status, 'PASS');
  assert.equal(gate.invariants.length, 16);
  assert.equal(gate.invariants.every(item => item.status === 'PASS'), true);
});
