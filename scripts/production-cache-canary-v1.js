const { createHash } = require('node:crypto');
const { evaluateAuthority } = require('../authority/policy');
const { createPublication, withdrawPublication } = require('../publication/service');
const { projectPublicationStream } = require('../publication/projector');
const { foldPublication } = require('../publication/fold');

const PRODUCTION_CACHE_CANARY_V1 = Object.freeze({
  schema: 'trellis-production-validation-cache-canary:v1',
  publication_id: 'pub:trellis-validation-cache-canary-v1',
  author_actor_id: 'actor:trellis-validation',
  body: '[PRODUCTION VALIDATION CACHE CANARY v1]\n\nThis publication exists only to verify that public Web/API surfaces do not retain stale active content after canonical withdrawal.',
  provenance_refs: Object.freeze(['trellis:production-validation-cache-canary:v1']),
  correlation_id: 'corr:trellis-production-validation-cache-canary:v1',
  create: Object.freeze({
    command_id: 'cmd:pvfc1:create:pub:trellis-validation-cache-canary-v1',
    idempotency_key: 'pvfc1:create:pub:trellis-validation-cache-canary-v1',
    occurred_at: '2026-09-09T06:45:00.000Z'
  }),
  withdraw: Object.freeze({
    command_id: 'cmd:pvfc1:withdraw:pub:trellis-validation-cache-canary-v1',
    idempotency_key: 'pvfc1:withdraw:pub:trellis-validation-cache-canary-v1',
    occurred_at: '2026-09-09T06:45:01.000Z',
    reason: 'production_validation_cache_canary_completed',
    expected_version: 1
  }),
  origins: Object.freeze([
    'https://trellis.aispaces.app',
    'https://trellis.eveaispace.com'
  ]),
  warmup: Object.freeze({ rounds: 3, interval_ms: 250 }),
  convergence_offsets_ms: Object.freeze([0, 100, 250, 500, 1000, 2000, 5000]),
  stability: Object.freeze({ rounds: 10, interval_ms: 1000 })
});

const C = PRODUCTION_CACHE_CANARY_V1;

class ProductionCacheCanaryError extends Error {
  constructor(code, message, report) {
    super(message || code);
    this.name = 'ProductionCacheCanaryError';
    this.code = code;
    this.report = report;
  }
}

function requirePorts({ sql, eventStore }) {
  if (!sql || typeof sql.first !== 'function' || typeof sql.batch !== 'function') {
    throw new TypeError('PRODUCTION_CACHE_CANARY_SQL_PORT_REQUIRED');
  }
  if (!eventStore || typeof eventStore.readStream !== 'function' || typeof eventStore.append !== 'function') {
    throw new TypeError('PRODUCTION_CACHE_CANARY_EVENT_STORE_REQUIRED');
  }
}

function commandContext(sql, eventStore) {
  return {
    db: sql,
    sql,
    eventStore,
    authorize: evaluateAuthority,
    principalActorId: C.author_actor_id,
    capabilityGrants: [],
    credentialRefs: [],
    evaluatedAt: C.create.occurred_at
  };
}

function publicationSummary(state, hashChain = null, projection = null) {
  if (!state || state.lifecycle === 'nonexistent') {
    return { publication_id: C.publication_id, lifecycle: 'nonexistent', content: null, stream_version: 0, hash_chain: hashChain, projection };
  }
  return {
    publication_id: state.publication_id,
    lifecycle: state.lifecycle,
    content: state.lifecycle === 'active' ? { revision: state.current_revision, body: state.current_body } : null,
    visibility: state.visibility,
    stream_version: state.stream_version,
    withdrawal_reason: state.withdrawal_reason ?? null,
    hash_chain: hashChain,
    projection
  };
}

async function verifyProductionCacheCanaryCanonicalState({ sql, eventStore, expectedLifecycle = null }) {
  requirePorts({ sql, eventStore });
  const history = await eventStore.readStream('publication', C.publication_id);
  const state = history.length ? foldPublication(history) : foldPublication([]);
  const projection = await sql.first(
    'SELECT publication_id, lifecycle, visibility, current_body, stream_version, withdrawal_reason FROM publications_current WHERE publication_id = ?',
    [C.publication_id]
  );
  const hashChain = history.length ? await eventStore.verifyHashChain('publication', C.publication_id) : { ok: true, count: 0 };
  const summary = publicationSummary(state, hashChain, projection ?? null);
  if (expectedLifecycle !== null && summary.lifecycle !== expectedLifecycle) {
    throw new ProductionCacheCanaryError(
      'CANONICAL_STATE_MISMATCH',
      `Expected canonical canary lifecycle ${expectedLifecycle}, got ${summary.lifecycle}`,
      { canonical: summary }
    );
  }
  if (history.length) {
    if (!projection || projection.stream_version !== state.stream_version || projection.lifecycle !== state.lifecycle) {
      throw new ProductionCacheCanaryError(
        'CANONICAL_PROJECTION_MISMATCH',
        'Canary publication projection does not match canonical stream state',
        { canonical: summary }
      );
    }
    if (!hashChain?.ok) {
      throw new ProductionCacheCanaryError('CANONICAL_HASH_CHAIN_FAILURE', 'Canary publication hash chain verification failed', { canonical: summary });
    }
  }
  return summary;
}

async function createProductionCacheCanaryV1({ sql, eventStore }) {
  requirePorts({ sql, eventStore });
  const result = await createPublication({
    command_id: C.create.command_id,
    idempotency_key: C.create.idempotency_key,
    principal_id: `principal:${C.author_actor_id}`,
    correlation_id: C.correlation_id,
    provenance_refs: [...C.provenance_refs],
    occurred_at: C.create.occurred_at,
    publication_id: C.publication_id,
    author_actor_id: C.author_actor_id,
    publication_type: 'post',
    body: C.body,
    visibility: 'public',
    audience_actor_ids: [],
    reply_to_ref: null,
    quote_of_ref: null,
    scope_ref: null
  }, commandContext(sql, eventStore));
  await projectPublicationStream(sql, eventStore, C.publication_id);
  const summary = await verifyProductionCacheCanaryCanonicalState({ sql, eventStore });
  return { ...summary, deduplicated: Boolean(result?.receipt?.deduplicated) };
}

async function withdrawProductionCacheCanaryV1({ sql, eventStore }) {
  requirePorts({ sql, eventStore });
  const result = await withdrawPublication({
    command_id: C.withdraw.command_id,
    idempotency_key: C.withdraw.idempotency_key,
    principal_id: `principal:${C.author_actor_id}`,
    correlation_id: C.correlation_id,
    provenance_refs: [...C.provenance_refs],
    occurred_at: C.withdraw.occurred_at,
    publication_id: C.publication_id,
    expected_version: C.withdraw.expected_version,
    reason: C.withdraw.reason
  }, {
    ...commandContext(sql, eventStore),
    evaluatedAt: C.withdraw.occurred_at
  });
  await projectPublicationStream(sql, eventStore, C.publication_id);
  const summary = await verifyProductionCacheCanaryCanonicalState({ sql, eventStore, expectedLifecycle: 'withdrawn' });
  return { ...summary, deduplicated: Boolean(result?.receipt?.deduplicated) };
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const entry = Object.entries(headers).find(([key]) => String(key).toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1]) : null;
}

function responseMeta(response) {
  return {
    status: response.status,
    headers: {
      content_type: headerValue(response.headers, 'content-type'),
      cf_cache_status: headerValue(response.headers, 'cf-cache-status'),
      age: headerValue(response.headers, 'age'),
      cache_control: headerValue(response.headers, 'cache-control'),
      etag: headerValue(response.headers, 'etag'),
      date: headerValue(response.headers, 'date')
    }
  };
}

function feedContainsCanary(feed) {
  return (feed?.items ?? []).some(item => item?.publication?.publication_id === C.publication_id);
}

function stateFromBoolean(active, withdrawn) {
  if (active && !withdrawn) return 'active';
  if (withdrawn && !active) return 'withdrawn';
  return 'invalid';
}

async function requestText(url, fetchImpl) {
  const response = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
  const meta = responseMeta(response);
  const body = await response.text();
  const bodyBuffer = Buffer.from(body, 'utf8');
  const body_sha256 = createHash('sha256').update(bodyBuffer).digest('hex');
  const body_bytes = bodyBuffer.length;
  if (meta.status >= 500) {
    throw new ProductionCacheCanaryError('PUBLIC_PROBE_5XX', `Production probe returned ${meta.status} for ${url}`, { url, response: { ...meta, body_sha256, body_bytes } });
  }
  return { ...meta, body, body_sha256, body_bytes };
}

function compactResponse(result) {
  const { body, value, ...rest } = result;
  return rest;
}

async function requestJson(url, fetchImpl) {
  const result = await requestText(url, fetchImpl);
  let value = null;
  try { value = JSON.parse(result.body); } catch {}
  return { ...result, value };
}

async function observeProductionCacheCanaryOrigin(origin, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('PRODUCTION_CACHE_CANARY_FETCH_REQUIRED');
  const encodedId = encodeURIComponent(C.publication_id);
  const home = await requestText(`${origin}/`, fetchImpl);
  const feed = await requestJson(`${origin}/api/public/feed`, fetchImpl);
  const publicationHtml = await requestText(`${origin}/publications/${encodedId}`, fetchImpl);
  const publicationApi = await requestJson(`${origin}/api/publications/${encodedId}`, fetchImpl);

  const homeHasId = home.body.includes(encodedId);
  const homeHasBody = home.body.includes(C.body);
  const homeState = stateFromBoolean(
    home.status === 200 && homeHasId && homeHasBody,
    home.status === 200 && !homeHasId && !homeHasBody
  );

  const feedHasCanary = feed.status === 200 && feedContainsCanary(feed.value);
  const feedState = stateFromBoolean(
    feedHasCanary,
    feed.status === 200 && !feedHasCanary
  );

  const detailHtmlHasBody = publicationHtml.body.includes(C.body);
  const detailHtmlWithdrawn = publicationHtml.body.includes('Withdrawn publication');
  const detailHtmlState = stateFromBoolean(
    publicationHtml.status === 200 && detailHtmlHasBody,
    publicationHtml.status === 200 && !detailHtmlHasBody && detailHtmlWithdrawn
  );

  const detailApiActive = publicationApi.status === 200 && publicationApi.value?.lifecycle === 'active' && publicationApi.value?.content?.body === C.body;
  const detailApiWithdrawn = publicationApi.status === 200 && publicationApi.value?.lifecycle === 'withdrawn' && publicationApi.value?.content === null;
  const detailApiState = stateFromBoolean(detailApiActive, detailApiWithdrawn);

  return {
    origin,
    surfaces: {
      home: { state: homeState, response: compactResponse(home) },
      feed_api: { state: feedState, snapshot_ref: feed.value?.snapshot_ref ?? null, response: compactResponse(feed) },
      publication_html: { state: detailHtmlState, response: compactResponse(publicationHtml) },
      publication_api: { state: detailApiState, lifecycle: publicationApi.value?.lifecycle ?? null, response: compactResponse(publicationApi) }
    }
  };
}

function flattenSurfaceStates(round) {
  const states = [];
  for (const observation of round.observations) {
    for (const [surface, result] of Object.entries(observation.surfaces)) {
      states.push({ key: `${observation.origin}|${surface}`, origin: observation.origin, surface, state: result.state });
    }
  }
  return states;
}

function snapshotRefs(round) {
  return round.observations.map(observation => observation.surfaces.feed_api.snapshot_ref);
}

function equalNonNull(values) {
  return values.length > 0 && values.every(value => value != null && value === values[0]);
}

async function observeRound(origins, fetchImpl, phase, elapsedMs) {
  const observations = [];
  for (const origin of origins) observations.push(await observeProductionCacheCanaryOrigin(origin, { fetchImpl }));
  return { phase, elapsed_ms: elapsedMs, observations };
}

function assertRoundAllState(round, expectedState, code, report) {
  const states = flattenSurfaceStates(round);
  const invalid = states.filter(item => item.state !== expectedState);
  if (invalid.length) {
    report.failures.push(...invalid.map(item => `${item.key}:${item.state}`));
    throw new ProductionCacheCanaryError(code, `Expected every public canary surface to be ${expectedState}`, report);
  }
}

function defaultClock() {
  return {
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
  };
}

async function sleepUntil(clock, target) {
  const remaining = target - clock.now();
  if (remaining > 0) await clock.sleep(remaining);
}

async function runProductionCacheCanaryV1({
  sql,
  eventStore,
  origins = [...C.origins],
  fetchImpl = globalThis.fetch,
  clock = defaultClock()
}) {
  requirePorts({ sql, eventStore });
  if (!Array.isArray(origins) || origins.length !== 2) throw new TypeError('PRODUCTION_CACHE_CANARY_TWO_ORIGINS_REQUIRED');
  if (typeof fetchImpl !== 'function') throw new TypeError('PRODUCTION_CACHE_CANARY_FETCH_REQUIRED');
  if (!clock || typeof clock.now !== 'function' || typeof clock.sleep !== 'function') throw new TypeError('PRODUCTION_CACHE_CANARY_CLOCK_REQUIRED');

  const report = {
    schema: C.schema,
    status: 'RUNNING',
    publication_id: C.publication_id,
    origins: [...origins],
    pre: { warmup_rounds: [], snapshot_ref: null },
    canonical: null,
    convergence: { rounds: [], first_new_ms: null, all_converged_ms: null },
    stability: { rounds: [] },
    post: { snapshot_ref: null },
    failures: []
  };

  const initial = await verifyProductionCacheCanaryCanonicalState({ sql, eventStore });
  if (initial.lifecycle === 'withdrawn') {
    report.canonical = initial;
    throw new ProductionCacheCanaryError('CACHE_CANARY_V1_ALREADY_COMPLETED', 'Production cache canary v1 is already withdrawn; use a new canary version', report);
  }

  const created = await createProductionCacheCanaryV1({ sql, eventStore });
  if (created.lifecycle !== 'active' || created.content?.body !== C.body) {
    report.canonical = created;
    throw new ProductionCacheCanaryError('CANARY_CREATE_PRECONDITION_FAILED', 'Cache canary did not reach canonical active state', report);
  }

  const warmupStart = clock.now();
  for (let index = 0; index < C.warmup.rounds; index += 1) {
    await sleepUntil(clock, warmupStart + index * C.warmup.interval_ms);
    const round = await observeRound(origins, fetchImpl, 'warmup', clock.now() - warmupStart);
    report.pre.warmup_rounds.push(round);
    assertRoundAllState(round, 'active', 'PRE_STATE_NOT_VISIBLE', report);
    const snapshots = snapshotRefs(round);
    if (!equalNonNull(snapshots)) {
      report.failures.push(`warmup-snapshot-parity:${snapshots.join('|')}`);
      throw new ProductionCacheCanaryError('PRE_SNAPSHOT_PARITY_FAILURE', 'Production domains returned different pre-withdraw feed snapshots', report);
    }
    report.pre.snapshot_ref = snapshots[0];
  }

  const withdrawn = await withdrawProductionCacheCanaryV1({ sql, eventStore });
  report.canonical = withdrawn;
  if (withdrawn.lifecycle !== 'withdrawn' || withdrawn.content !== null) {
    throw new ProductionCacheCanaryError('CANONICAL_WITHDRAWAL_NOT_CONFIRMED', 'Canonical withdrawal was not confirmed before public polling', report);
  }

  const convergenceStart = clock.now();
  const seenWithdrawn = new Set();
  let convergedRound = null;
  for (const offset of C.convergence_offsets_ms) {
    await sleepUntil(clock, convergenceStart + offset);
    const elapsed = clock.now() - convergenceStart;
    const round = await observeRound(origins, fetchImpl, 'convergence', elapsed);
    report.convergence.rounds.push(round);
    const states = flattenSurfaceStates(round);
    for (const item of states) {
      if (item.state === 'withdrawn') {
        if (report.convergence.first_new_ms === null) report.convergence.first_new_ms = elapsed;
        seenWithdrawn.add(item.key);
      } else if (item.state === 'active' && seenWithdrawn.has(item.key)) {
        report.failures.push(`${item.key}:active-after-withdrawn@${elapsed}`);
        throw new ProductionCacheCanaryError('STALE_CACHE_REGRESSION', 'A public surface returned active canary state after already observing withdrawn state', report);
      }
    }
    const snapshots = snapshotRefs(round);
    const allWithdrawn = states.every(item => item.state === 'withdrawn');
    const snapshotsConverged = equalNonNull(snapshots) && snapshots[0] !== report.pre.snapshot_ref;
    if (allWithdrawn && snapshotsConverged) {
      report.convergence.all_converged_ms = elapsed;
      convergedRound = round;
      break;
    }
  }

  if (!convergedRound) {
    throw new ProductionCacheCanaryError('PUBLIC_STATE_CONVERGENCE_TIMEOUT', 'Public canary state did not converge across both domains within 5 seconds', report);
  }

  const stabilityStart = clock.now();
  for (let index = 0; index < C.stability.rounds; index += 1) {
    await sleepUntil(clock, stabilityStart + (index + 1) * C.stability.interval_ms);
    const elapsed = clock.now() - convergenceStart;
    const round = await observeRound(origins, fetchImpl, 'stability', elapsed);
    report.stability.rounds.push(round);
    const states = flattenSurfaceStates(round);
    const active = states.filter(item => item.state === 'active');
    if (active.length) {
      report.failures.push(...active.map(item => `${item.key}:active-after-convergence@${elapsed}`));
      throw new ProductionCacheCanaryError('STALE_CACHE_REGRESSION', 'A public surface regressed to active canary state during the stability window', report);
    }
    const invalid = states.filter(item => item.state !== 'withdrawn');
    if (invalid.length) {
      report.failures.push(...invalid.map(item => `${item.key}:${item.state}@${elapsed}`));
      throw new ProductionCacheCanaryError('PUBLIC_POST_STATE_INVALID', 'A public surface left the withdrawn state during the stability window', report);
    }
  }

  const finalRound = report.stability.rounds.at(-1) ?? convergedRound;
  const finalSnapshots = snapshotRefs(finalRound);
  if (!equalNonNull(finalSnapshots)) {
    report.failures.push(`post-snapshot-parity:${finalSnapshots.join('|')}`);
    throw new ProductionCacheCanaryError('POST_SNAPSHOT_PARITY_FAILURE', 'Production domains ended with different post-withdraw feed snapshots', report);
  }
  if (finalSnapshots[0] === report.pre.snapshot_ref) {
    report.failures.push('post-snapshot-equals-pre');
    throw new ProductionCacheCanaryError('POST_SNAPSHOT_NOT_CHANGED', 'Post-withdraw feed snapshot did not change from pre-withdraw snapshot', report);
  }

  report.post.snapshot_ref = finalSnapshots[0];
  report.status = 'PASS';
  return report;
}

module.exports = {
  PRODUCTION_CACHE_CANARY_V1,
  ProductionCacheCanaryError,
  createProductionCacheCanaryV1,
  withdrawProductionCacheCanaryV1,
  verifyProductionCacheCanaryCanonicalState,
  observeProductionCacheCanaryOrigin,
  runProductionCacheCanaryV1
};
