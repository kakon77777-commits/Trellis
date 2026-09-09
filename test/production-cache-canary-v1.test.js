const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTestDatabase } = require('./helpers/test-db');
const { AsyncSqlEventStore } = require('../events/async-sql-event-store');
const { foldPublication } = require('../publication/fold');
const {
  seedProductionValidationFixtureV1
} = require('../scripts/production-validation-fixture-v1');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'production-cache-canary-v1.js');
const WORKER = path.join(__dirname, '..', 'cloudflare', 'production-cache-canary-worker.mjs');

function loadCanary() {
  assert.equal(fs.existsSync(SCRIPT), true, 'production cache canary script must exist');
  return require(SCRIPT);
}

function createRuntime() {
  const db = createTestDatabase();
  let tick = 0;
  const store = new AsyncSqlEventStore(db.sql, {
    now: () => `2026-09-09T06:40:${String(tick++).padStart(2, '0')}.000Z`
  });
  return { db, sql: db.sql, eventStore: store };
}

function fakeClock() {
  let value = 0;
  return {
    now: () => value,
    sleep: async ms => { value += ms; },
    value: () => value
  };
}

function publicationIdInFeed(feed, publicationId) {
  return (feed?.items ?? []).some(item => item?.publication?.publication_id === publicationId);
}

function makeResponse(body, { status = 200, contentType = 'text/plain; charset=utf-8', cache = 'MISS', age = '0' } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': contentType,
      'cf-cache-status': cache,
      'age': age,
      'cache-control': 'public, max-age=30'
    }
  });
}

function makeProductionFetch({ eventStore, clock, propagationDelayMs = 250, regressAtMs = null }) {
  let firstWithdrawObservedAt = null;
  return async function fetchImpl(input) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const mod = loadCanary();
    const C = mod.PRODUCTION_CACHE_CANARY_V1;
    const history = await eventStore.readStream('publication', C.publication_id);
    const canonical = history.length ? foldPublication(history) : null;
    const withdrawn = canonical?.lifecycle === 'withdrawn';
    if (withdrawn && firstWithdrawObservedAt === null) firstWithdrawObservedAt = clock.now();
    const elapsed = firstWithdrawObservedAt === null ? -1 : clock.now() - firstWithdrawObservedAt;
    let publicState = withdrawn && elapsed >= propagationDelayMs ? 'withdrawn' : 'active';
    if (regressAtMs !== null && withdrawn && elapsed >= regressAtMs) publicState = 'active';

    const feed = publicState === 'active'
      ? { snapshot_ref: 'snapshot-pre', items: [{ item_type: 'publication', publication: { publication_id: C.publication_id } }] }
      : { snapshot_ref: 'snapshot-post', items: [] };
    const detail = publicState === 'active'
      ? { publication_id: C.publication_id, lifecycle: 'active', content: { revision: 1, body: C.body } }
      : { publication_id: C.publication_id, lifecycle: 'withdrawn', content: null };

    if (url.pathname === '/api/public/feed') {
      return makeResponse(feed, { contentType: 'application/json; charset=utf-8' });
    }
    if (url.pathname === `/api/publications/${encodeURIComponent(C.publication_id)}`) {
      return makeResponse(detail, { contentType: 'application/json; charset=utf-8' });
    }
    if (url.pathname === `/publications/${encodeURIComponent(C.publication_id)}`) {
      const html = publicState === 'active'
        ? `<html><body>${C.publication_id}\n${C.body}</body></html>`
        : '<html><body><h1>Withdrawn publication</h1></body></html>';
      return makeResponse(html, { contentType: 'text/html; charset=utf-8' });
    }
    if (url.pathname === '/') {
      const html = publicState === 'active'
        ? `<html><body><a href="/publications/${encodeURIComponent(C.publication_id)}">${C.body}</a></body></html>`
        : '<html><body>Public Trellis</body></html>';
      return makeResponse(html, { contentType: 'text/html; charset=utf-8' });
    }
    return makeResponse('Not Found', { status: 404 });
  };
}

test('cache canary implementation files exist and export the approved one-shot v1 API', async () => {
  assert.equal(fs.existsSync(SCRIPT), true);
  assert.equal(fs.existsSync(WORKER), true);
  const mod = loadCanary();
  for (const name of [
    'PRODUCTION_CACHE_CANARY_V1',
    'createProductionCacheCanaryV1',
    'withdrawProductionCacheCanaryV1',
    'verifyProductionCacheCanaryCanonicalState',
    'observeProductionCacheCanaryOrigin',
    'runProductionCacheCanaryV1'
  ]) assert.ok(mod[name], name);
  const workerSource = fs.readFileSync(WORKER, 'utf8');
  assert.match(workerSource, /PVF_CACHE_CANARY_ENABLED/);
  assert.match(workerSource, /production-cache-canary-v1/);
});

test('create and withdraw use canonical command flow and per-stream projection for the one-shot canary', async () => {
  const { db, sql, eventStore } = createRuntime();
  try {
    await seedProductionValidationFixtureV1({ sql, eventStore });
    const mod = loadCanary();
    const created = await mod.createProductionCacheCanaryV1({ sql, eventStore });
    assert.equal(created.lifecycle, 'active');
    assert.equal(created.content.body, mod.PRODUCTION_CACHE_CANARY_V1.body);
    const rowBefore = await sql.first('SELECT lifecycle, current_body, stream_version FROM publications_current WHERE publication_id = ?', [mod.PRODUCTION_CACHE_CANARY_V1.publication_id]);
    assert.deepEqual(rowBefore, { lifecycle: 'active', current_body: mod.PRODUCTION_CACHE_CANARY_V1.body, stream_version: 1 });

    const withdrawn = await mod.withdrawProductionCacheCanaryV1({ sql, eventStore });
    assert.equal(withdrawn.lifecycle, 'withdrawn');
    assert.equal(withdrawn.content, null);
    const rowAfter = await sql.first('SELECT lifecycle, current_body, stream_version FROM publications_current WHERE publication_id = ?', [mod.PRODUCTION_CACHE_CANARY_V1.publication_id]);
    assert.equal(rowAfter.lifecycle, 'withdrawn');
    assert.equal(rowAfter.stream_version, 2);
  } finally {
    db.close();
  }
});

test('runner performs 3x250ms warm-up, converges within 5s, then holds 10x1s without stale regression', async () => {
  const { db, sql, eventStore } = createRuntime();
  try {
    await seedProductionValidationFixtureV1({ sql, eventStore });
    const mod = loadCanary();
    const clock = fakeClock();
    const report = await mod.runProductionCacheCanaryV1({
      sql,
      eventStore,
      origins: ['https://trellis.aispaces.app', 'https://trellis.eveaispace.com'],
      fetchImpl: makeProductionFetch({ eventStore, clock, propagationDelayMs: 250 }),
      clock
    });
    assert.equal(report.status, 'PASS');
    assert.equal(report.pre.warmup_rounds.length, 3);
    assert.equal(report.pre.snapshot_ref, 'snapshot-pre');
    const firstHomeResponse = report.pre.warmup_rounds[0].observations[0].surfaces.home.response;
    assert.match(firstHomeResponse.body_sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof firstHomeResponse.body_bytes, 'number');
    assert.equal(Object.prototype.hasOwnProperty.call(firstHomeResponse, 'body'), false, 'evidence stores hashes, not repeated full bodies');
    assert.equal(report.convergence.all_converged_ms, 250);
    assert.equal(report.stability.rounds.length, 10);
    assert.equal(report.post.snapshot_ref, 'snapshot-post');
    assert.notEqual(report.post.snapshot_ref, report.pre.snapshot_ref);
    assert.equal(report.failures.length, 0);
  } finally {
    db.close();
  }
});

test('runner reports PUBLIC_STATE_CONVERGENCE_TIMEOUT when canonical withdrawal never reaches all public surfaces within 5s', async () => {
  const { db, sql, eventStore } = createRuntime();
  try {
    await seedProductionValidationFixtureV1({ sql, eventStore });
    const mod = loadCanary();
    const clock = fakeClock();
    await assert.rejects(
      mod.runProductionCacheCanaryV1({
        sql,
        eventStore,
        origins: ['https://trellis.aispaces.app', 'https://trellis.eveaispace.com'],
        fetchImpl: makeProductionFetch({ eventStore, clock, propagationDelayMs: 6000 }),
        clock
      }),
      error => error?.code === 'PUBLIC_STATE_CONVERGENCE_TIMEOUT' && error?.report?.canonical?.lifecycle === 'withdrawn'
    );
  } finally {
    db.close();
  }
});

test('runner reports STALE_CACHE_REGRESSION when a surface returns active again after observing withdrawn state', async () => {
  const { db, sql, eventStore } = createRuntime();
  try {
    await seedProductionValidationFixtureV1({ sql, eventStore });
    const mod = loadCanary();
    const clock = fakeClock();
    await assert.rejects(
      mod.runProductionCacheCanaryV1({
        sql,
        eventStore,
        origins: ['https://trellis.aispaces.app', 'https://trellis.eveaispace.com'],
        fetchImpl: makeProductionFetch({ eventStore, clock, propagationDelayMs: 100, regressAtMs: 1500 }),
        clock
      }),
      error => error?.code === 'STALE_CACHE_REGRESSION' && Array.isArray(error?.report?.failures)
    );
  } finally {
    db.close();
  }
});
