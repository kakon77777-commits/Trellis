const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openMigratedDatabase } = require('../db/sqlite');
const { SQLiteAsyncAdapter } = require('../storage/sqlite-adapter');
const { AsyncSqlEventStore } = require('../events/async-sql-event-store');

const ROOT = path.join(__dirname, '..');

class CountingSqlPort {
  constructor(inner, shared = { batchCalls: 0 }) {
    this.inner = inner;
    this.shared = shared;
  }
  first(sql, params) { return this.inner.first(sql, params); }
  all(sql, params) { return this.inner.all(sql, params); }
  run(sql, params) { return this.inner.run(sql, params); }
  async batch(statements) {
    this.shared.batchCalls += 1;
    return await this.inner.batch(statements);
  }
  session(options) { return new CountingSqlPort(this.inner.session(options), this.shared); }
}

function appendRequest(label, expectedVersion) {
  return {
    streamType: 'relationship',
    streamId: 'rel:sr13-race',
    expectedVersion,
    events: [{
      event_id: `evt:${label}`,
      schema_version: '0.1',
      event_type: 'relationship.proposed',
      actor_id: 'actor:A',
      principal_id: 'principal:A',
      causation_id: `cmd:${label}`,
      correlation_id: `corr:${label}`,
      occurred_at: '2026-09-08T02:00:00.000Z',
      time_source: 'system',
      provenance_refs: [],
      payload: { relationship_id: 'rel:sr13-race' }
    }],
    authorityReceipt: {
      decision_id: `authz:${label}`,
      principal_id: 'principal:A',
      actor_id: 'actor:A',
      policy_ref: 'policy:test:v1',
      requested_action: 'relationship.propose',
      aggregate_id: 'rel:sr13-race',
      credential_refs: [],
      decision: 'allow',
      evaluated_at: '2026-09-08T02:00:00.000Z'
    },
    commandReceipt: {
      command_id: `cmd:${label}`,
      idempotency_key: `idem:${label}`,
      command_digest: `digest:${label}`,
      status: 'accepted',
      created_at: '2026-09-08T02:00:00.000Z'
    }
  };
}

test('SR13: a losing CAS performs no automatic second append/rebase attempt', async () => {
  const db = openMigratedDatabase(':memory:');
  const counted = new CountingSqlPort(new SQLiteAsyncAdapter(db));
  let token = 0;
  const store = new AsyncSqlEventStore(counted, {
    now: () => '2026-09-08T02:00:01.000Z',
    token: () => `sr13-token-${++token}`
  });
  try {
    const settled = await Promise.allSettled([
      store.append(appendRequest('a', 0)),
      store.append(appendRequest('b', 0))
    ]);
    assert.equal(settled.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(settled.filter(x => x.status === 'rejected').length, 1);
    assert.equal(settled.find(x => x.status === 'rejected').reason?.code, 'VERSION_CONFLICT');
    assert.equal(counted.shared.batchCalls, 2, 'each caller gets exactly one CAS batch; loser is never rebased/retried');
    assert.equal((await store.readStream('relationship', 'rel:sr13-race')).length, 1);
  } finally {
    db.close();
  }
});

test('SR1-SR16 machine gate ledger is complete and honest about external D1 release gates', () => {
  const gatePath = path.join(ROOT, 'validation', 'STORAGE_RUNTIME_V1_GATE.json');
  const docPath = path.join(ROOT, 'docs', 'STORAGE_RUNTIME_V1_CONFORMANCE.md');
  assert.equal(fs.existsSync(gatePath), true, 'machine gate ledger');
  assert.equal(fs.existsSync(docPath), true, 'human conformance map');
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.equal(gate.schema, 'trellis-storage-runtime-v1-gate-v1');
  assert.deepEqual(gate.invariants.map(x => x.id), Array.from({ length: 16 }, (_, i) => `SR${i + 1}`));
  assert.equal(gate.layers.A.status, 'PASS');
  assert.equal(gate.layers.B.sqlite.status, 'PASS');

  // The gate is a structural honesty mechanism, not a static prose claim: it
  // reports EXTERNAL_EXECUTION_REQUIRED when the real-D1 evidence files are
  // absent (Sol's own sandbox has no Wrangler/D1 access) and PASS once they
  // exist and genuinely pass (produced by real `npm run test:storage:d1-local`
  // / `test:storage:worker-d1-local` runs against a real Cloudflare D1
  // database). Assert whichever state actually holds in THIS checkout,
  // rather than hard-coding one branch — both are valid, honestly-reported
  // states of the same mechanism.
  const layerBEvidencePath = path.join(ROOT, 'validation', 'STORAGE_RUNTIME_V1_LAYER_B_D1_LOCAL.json');
  const layerCEvidencePath = path.join(ROOT, 'validation', 'STORAGE_RUNTIME_V1_LAYER_C_D1_LOCAL.json');
  const hasRealD1Evidence = fs.existsSync(layerBEvidencePath) && fs.existsSync(layerCEvidencePath);

  if (hasRealD1Evidence) {
    assert.equal(gate.overall_status, 'PASS');
    assert.equal(gate.layers.B.d1.status, 'PASS');
    assert.equal(gate.layers.C.d1_worker.status, 'PASS');
    assert.equal(gate.external_release_gates.length, 0);
  } else {
    assert.equal(gate.overall_status, 'RELEASE_CANDIDATE_EXTERNAL_D1_REQUIRED');
    assert.equal(gate.layers.B.d1.status, 'EXTERNAL_EXECUTION_REQUIRED');
    assert.equal(gate.layers.C.d1_worker.status, 'EXTERNAL_EXECUTION_REQUIRED');
    assert.equal(gate.external_release_gates.length, 2);
    for (const external of gate.external_release_gates) {
      assert.equal(external.status, 'EXTERNAL_EXECUTION_REQUIRED');
      assert.match(external.command, /^npm run test:storage:/);
      assert.match(external.evidence_file, /^validation\/STORAGE_RUNTIME_V1_LAYER_[BC]_D1_LOCAL\.json$/);
    }
  }

  for (const invariant of gate.invariants) {
    for (const evidenceRef of invariant.sandbox_evidence) {
      const evidencePath = path.join(ROOT, evidenceRef);
      assert.equal(fs.existsSync(evidencePath), true, `${invariant.id}:${evidenceRef}`);
    }
  }
  const doc = fs.readFileSync(docPath, 'utf8');
  for (let i = 1; i <= 16; i += 1) assert.match(doc, new RegExp(`\\bSR${i}\\b`));
  assert.match(doc, /483\/483 PASS/);
  assert.match(doc, /EXTERNAL_EXECUTION_REQUIRED/);
});

test('final storage boundary keeps D1 binding at Cloudflare composition roots only', () => {
  const forbiddenRoots = ['web', path.join('http', 'routes'), path.join('http', 'view-models')];
  for (const relativeRoot of forbiddenRoots) {
    const root = path.join(ROOT, relativeRoot);
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(file);
        else if (entry.isFile() && file.endsWith('.js')) {
          const source = fs.readFileSync(file, 'utf8');
          assert.equal(/env\.DB|D1Adapter|cloudflare\/worker/.test(source), false, path.relative(ROOT, file));
        }
      }
    }
  }
});
