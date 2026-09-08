const { canonicalStringify } = require('../../core/canonical-json');
const { AsyncSqlEventStore } = require('../../events/async-sql-event-store');
const { registerActor } = require('../../entity/service');
const { evaluateAuthority } = require('../../authority/policy');
const { createPublication } = require('../../publication/service');
const { projectPublicationStream } = require('../../publication/projector');
const { ConsumptionStore } = require('../../consumption/store');

const FIXED_TIME = '2026-09-08T00:00:00.000Z';

function fail(code, detail) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}
function same(actual, expected, code) {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) fail(code, { actual, expected });
}
function ok(value, code, detail) { if (!value) fail(code, detail); }
function errorShape(error) { return { code: error?.code ?? null, name: error?.name ?? null, message: error?.message ?? String(error) }; }
function plainObject(value) { return value && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value, keys) { return Object.keys(value).sort().join('|') === [...keys].sort().join('|'); }

function authority(label, streamId) {
  return {
    decision_id: `authz:contract:${label}`,
    principal_id: 'principal:contract', actor_id: 'actor:contract',
    policy_ref: 'policy:contract:v1', requested_action: 'relationship.propose',
    aggregate_id: streamId, credential_refs: [], decision: 'allow', evaluated_at: FIXED_TIME
  };
}
function draft(label, eventType = 'relationship.proposed', payload = {}) {
  return {
    event_id: `evt:contract:${label}`, schema_version: '0.1', event_type: eventType,
    actor_id: 'actor:contract', principal_id: 'principal:contract',
    causation_id: `cmd:contract:${label}`, correlation_id: `corr:contract:${label}`,
    occurred_at: FIXED_TIME, time_source: 'system', provenance_refs: [], payload: { label, ...payload }
  };
}
function appendRequest(label, streamId, expectedVersion, { key, digest, eventType, payload } = {}) {
  return {
    streamType: 'relationship', streamId, expectedVersion,
    events: [draft(label, eventType, payload)],
    authorityReceipt: authority(label, streamId),
    commandReceipt: {
      command_id: `cmd:contract:${label}`,
      idempotency_key: key ?? `idem:contract:${label}`,
      command_digest: digest ?? `digest:contract:${label}`,
      status: 'accepted', created_at: FIXED_TIME
    }
  };
}
function makeStore(sql, prefix = 'contract-token') {
  let token = 0;
  return new AsyncSqlEventStore(sql, { now: () => FIXED_TIME, token: () => `${prefix}-${++token}` });
}
function classifySettled(results) {
  return {
    fulfilled: results.filter(r => r.status === 'fulfilled'),
    rejected: results.filter(r => r.status === 'rejected')
  };
}
async function guardsEmpty(sql) { return Number((await sql.first('SELECT COUNT(*) AS n FROM append_batch_guards')).n) === 0; }

async function executeStorageContract({ sql, backend = 'unknown' }) {
  const vectors = [];
  const equivalence = {};
  async function vector(name, fn) {
    try {
      const evidence = await fn();
      vectors.push({ name, status: 'PASS', evidence: evidence ?? null });
      return evidence;
    } catch (error) {
      vectors.push({ name, status: 'FAIL', error: errorShape(error), detail: error?.detail ?? null });
      return null;
    }
  }

  await vector('adapter-normalization', async () => {
    await sql.run('DROP TABLE IF EXISTS _trellis_contract_kv');
    await sql.run('CREATE TABLE _trellis_contract_kv (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT NOT NULL UNIQUE, v TEXT)');
    const run = await sql.run('INSERT INTO _trellis_contract_kv(k,v) VALUES (?,?)', ['alpha', 'one']);
    const first = await sql.first('SELECT k,v FROM _trellis_contract_kv WHERE k=?', ['alpha']);
    const all = await sql.all('SELECT k,v FROM _trellis_contract_kv ORDER BY k');
    ok(exactKeys(run, ['changes','last_row_id','rows_read','rows_written']), 'RUN_RESULT_SHAPE');
    ok(plainObject(run) && plainObject(first) && Array.isArray(all) && all.every(plainObject), 'BACKEND_OBJECT_LEAK');
    same(first, { k: 'alpha', v: 'one' }, 'FIRST_NORMALIZATION');
    same(all, [{ k: 'alpha', v: 'one' }], 'ALL_NORMALIZATION');
    return { run_keys: Object.keys(run).sort(), first, all };
  });

  await vector('missing-row-semantics', async () => {
    const first = await sql.first('SELECT k,v FROM _trellis_contract_kv WHERE k=?', ['missing']);
    const all = await sql.all('SELECT k,v FROM _trellis_contract_kv WHERE k=?', ['missing']);
    same(first, null, 'MISSING_FIRST_NOT_NULL');
    same(all, [], 'MISSING_ALL_NOT_EMPTY');
    return { first, all };
  });

  await vector('failed-batch-rollback', async () => {
    await sql.run('DROP TABLE IF EXISTS _trellis_contract_batch');
    await sql.run('CREATE TABLE _trellis_contract_batch (k TEXT PRIMARY KEY, v TEXT)');
    let failed = false;
    try {
      await sql.batch([
        { sql: 'INSERT INTO _trellis_contract_batch(k,v) VALUES (?,?)', params: ['dup','one'] },
        { sql: 'INSERT INTO _trellis_contract_batch(k,v) VALUES (?,?)', params: ['dup','two'] }
      ]);
    } catch { failed = true; }
    ok(failed, 'FAILED_BATCH_DID_NOT_THROW');
    const count = Number((await sql.first('SELECT COUNT(*) AS n FROM _trellis_contract_batch')).n);
    same(count, 0, 'FAILED_BATCH_PARTIAL_COMMIT');
    return { failed, count };
  });

  await vector('conditional-upsert-where', async () => {
    await sql.run('DROP TABLE IF EXISTS _trellis_contract_heads');
    await sql.run('CREATE TABLE _trellis_contract_heads (stream_id TEXT PRIMARY KEY, version INTEGER NOT NULL, write_token TEXT)');
    await sql.run('INSERT INTO _trellis_contract_heads(stream_id,version,write_token) VALUES (?,?,?)', ['s',1,'token-1']);
    const stale = await sql.run(`
      INSERT INTO _trellis_contract_heads(stream_id,version,write_token) VALUES (?,?,?)
      ON CONFLICT(stream_id) DO UPDATE SET version=excluded.version,write_token=excluded.write_token
      WHERE _trellis_contract_heads.version=?
    `, ['s',2,'token-2',0]);
    const row = await sql.first('SELECT version,write_token FROM _trellis_contract_heads WHERE stream_id=?', ['s']);
    same(row, { version: 1, write_token: 'token-1' }, 'CONDITIONAL_UPSERT_STALE_OVERWRITE');
    same(Number(stale.changes), 0, 'CONDITIONAL_UPSERT_STALE_CHANGES');
    return { row, changes: Number(stale.changes) };
  });

  await vector('autoincrement-never-reuses-deleted-max', async () => {
    await sql.run('DROP TABLE IF EXISTS _trellis_contract_auto');
    await sql.run('CREATE TABLE _trellis_contract_auto (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT)');
    for (const label of ['a','b','c']) await sql.run('INSERT INTO _trellis_contract_auto(label) VALUES (?)', [label]);
    await sql.run('DELETE FROM _trellis_contract_auto WHERE id=?', [3]);
    await sql.run('INSERT INTO _trellis_contract_auto(label) VALUES (?)', ['d']);
    const row = await sql.first('SELECT id,label FROM _trellis_contract_auto WHERE label=?', ['d']);
    same(row, { id: 4, label: 'd' }, 'AUTOINCREMENT_REUSED_DELETED_MAX');
    return row;
  });

  const store = makeStore(sql);

  await vector('eventstore-cas-stale-version', async () => {
    const stream = 'rel:contract:cas';
    await store.append(appendRequest('cas-seed', stream, 0));
    let code = null;
    try { await store.append(appendRequest('cas-stale', stream, 0)); } catch (error) { code = error?.code ?? null; }
    same(code, 'VERSION_CONFLICT', 'CAS_STALE_CLASSIFICATION');
    same((await store.readStream('relationship', stream)).length, 1, 'CAS_STALE_PARTIAL_APPEND');
    ok(await guardsEmpty(sql), 'CAS_GUARD_LEAK');
    return { code, events: 1 };
  });

  await vector('eventstore-concurrent-version-race', async () => {
    const stream = 'rel:contract:race';
    const result = classifySettled(await Promise.allSettled([
      store.append(appendRequest('race-a', stream, 0)),
      store.append(appendRequest('race-b', stream, 0))
    ]));
    same(result.fulfilled.length, 1, 'RACE_ACCEPT_COUNT');
    same(result.rejected.length, 1, 'RACE_REJECT_COUNT');
    same(result.rejected[0].reason?.code, 'VERSION_CONFLICT', 'RACE_CONFLICT_CLASSIFICATION');
    same((await store.readStream('relationship', stream)).length, 1, 'RACE_CANONICAL_COUNT');
    ok(await guardsEmpty(sql), 'RACE_GUARD_LEAK');
    return { accepted: 1, rejected: ['VERSION_CONFLICT'] };
  });

  await vector('idempotency-same-digest-race', async () => {
    const stream = 'rel:contract:idem-same';
    const result = classifySettled(await Promise.allSettled([
      store.append(appendRequest('idem-same-a', stream, 0, { key:'idem:contract:same', digest:'digest:contract:same' })),
      store.append(appendRequest('idem-same-b', stream, 0, { key:'idem:contract:same', digest:'digest:contract:same' }))
    ]));
    same(result.rejected.length, 0, 'IDEM_SAME_REJECTED');
    same(result.fulfilled.length, 2, 'IDEM_SAME_FULFILLED');
    same(result.fulfilled.map(r => Boolean(r.value.deduplicated)).sort(), [false,true], 'IDEM_SAME_DEDUPE_FLAGS');
    same((await store.readStream('relationship', stream)).length, 1, 'IDEM_SAME_CANONICAL_COUNT');
    ok(await guardsEmpty(sql), 'IDEM_SAME_GUARD_LEAK');
    return { outcomes: ['accepted','deduplicated'] };
  });

  await vector('idempotency-different-digest-race', async () => {
    const stream = 'rel:contract:idem-diff';
    const result = classifySettled(await Promise.allSettled([
      store.append(appendRequest('idem-diff-a', stream, 0, { key:'idem:contract:diff', digest:'digest:contract:a' })),
      store.append(appendRequest('idem-diff-b', stream, 0, { key:'idem:contract:diff', digest:'digest:contract:b' }))
    ]));
    same(result.fulfilled.length, 1, 'IDEM_DIFF_ACCEPT_COUNT');
    same(result.rejected.length, 1, 'IDEM_DIFF_REJECT_COUNT');
    same(result.rejected[0].reason?.code, 'IDEMPOTENCY_CONFLICT', 'IDEM_DIFF_CLASSIFICATION');
    same((await store.readStream('relationship', stream)).length, 1, 'IDEM_DIFF_CANONICAL_COUNT');
    ok(await guardsEmpty(sql), 'IDEM_DIFF_GUARD_LEAK');
    return { accepted: 1, rejected: ['IDEMPOTENCY_CONFLICT'] };
  });

  await vector('hash-chain-equivalence-fixture', async () => {
    const stream = 'rel:contract:hash';
    await store.append(appendRequest('hash-one', stream, 0));
    await store.append(appendRequest('hash-two', stream, 1, { eventType:'relationship.activated' }));
    const chain = await store.verifyHashChain('relationship', stream);
    same(chain, { ok:true, failureAt:null }, 'HASH_CHAIN_VERIFY');
    const events = await store.readStream('relationship', stream);
    equivalence.hash_chain = { ok:true, event_hashes: events.map(e => e.event_hash), prev_hashes: events.map(e => e.prev_event_hash) };
    return equivalence.hash_chain;
  });

  await vector('global-offset-ordering', async () => {
    const labels = ['order-a','order-b','order-c'];
    for (const [index,label] of labels.entries()) await store.append(appendRequest(label, `rel:contract:${label}`, 0, { payload:{order:index} }));
    const rows = await sql.all(`SELECT event_id,global_offset FROM canonical_events WHERE event_id IN (?,?,?) ORDER BY global_offset`, labels.map(x=>`evt:contract:${x}`));
    same(rows.map(r=>r.event_id), labels.map(x=>`evt:contract:${x}`), 'GLOBAL_OFFSET_ORDER');
    const offsets = rows.map(r=>Number(r.global_offset));
    ok(offsets[0] < offsets[1] && offsets[1] < offsets[2], 'GLOBAL_OFFSET_NOT_MONOTONIC', offsets);
    const relative = offsets.map(x=>x-offsets[0]);
    same(relative, [0,1,2], 'GLOBAL_OFFSET_RELATIVE_GAPS');
    equivalence.global_order = { event_ids: rows.map(r=>r.event_id), relative_offsets: relative };
    return equivalence.global_order;
  });

  await vector('projection-equivalence-fixture', async () => {
    await registerActor({
      command_id:'contract-actor-register', idempotency_key:'contract-actor-register',
      principal_id:'principal:contract', entity_id:'actor:contract', occurred_at:FIXED_TIME
    }, { eventStore:store, authorize:evaluateAuthority });
    await createPublication({
      command_id:'contract-publication-create', idempotency_key:'contract-publication-create',
      principal_id:'principal:contract', publication_id:'pub:contract', author_actor_id:'actor:contract',
      publication_type:'post', body:'contract body', visibility:'public', occurred_at:FIXED_TIME
    }, { db:sql, sql, eventStore:store, principalActorId:'actor:contract', capabilityGrants:[], evaluatedAt:FIXED_TIME });
    await projectPublicationStream(sql, store, 'pub:contract');
    const row = await sql.first(`SELECT publication_id,author_actor_id,publication_type,visibility,lifecycle,current_revision,current_body,stream_version,materializer_version FROM publications_current WHERE publication_id=?`, ['pub:contract']);
    equivalence.projection = row;
    same(row.publication_id, 'pub:contract', 'PROJECTION_ID');
    same(row.current_body, 'contract body', 'PROJECTION_BODY');
    same(Number(row.stream_version), 1, 'PROJECTION_VERSION');
    return row;
  });

  await vector('consumption-operational-equivalence', async () => {
    const before = Number((await sql.first('SELECT COUNT(*) AS n FROM canonical_events')).n);
    const consumption = new ConsumptionStore(sql);
    await consumption.recordSeen({consumerActorId:'actor:contract',targetKind:'publication',targetRef:'pub:contract',now:FIXED_TIME});
    await consumption.recordOpened({consumerActorId:'actor:contract',targetKind:'publication',targetRef:'pub:contract',now:'2026-09-08T00:01:00.000Z'});
    const state = await consumption.get('actor:contract','publication','pub:contract');
    const after = Number((await sql.first('SELECT COUNT(*) AS n FROM canonical_events')).n);
    same(after, before, 'CONSUMPTION_MUTATED_CANONICAL_HISTORY');
    equivalence.consumption = {
      consumer_actor_id:state.consumer_actor_id,target_kind:state.target_kind,target_ref:state.target_ref,
      first_seen_at:state.first_seen_at,first_opened_at:state.first_opened_at,last_touched_at:state.last_touched_at,
      expires_at:state.expires_at,state_version:Number(state.state_version),retention_policy_ref:state.retention_policy_ref
    };
    return equivalence.consumption;
  });

  await vector('backend-result-shapes-do-not-leak', async () => {
    const row = await sql.first('SELECT k,v FROM _trellis_contract_kv WHERE k=?', ['alpha']);
    const result = await sql.run('UPDATE _trellis_contract_kv SET v=? WHERE k=?', ['two','alpha']);
    ok(plainObject(row) && plainObject(result), 'BACKEND_RESULT_PROTOTYPE_LEAK');
    ok(exactKeys(result, ['changes','last_row_id','rows_read','rows_written']), 'BACKEND_RESULT_KEY_LEAK');
    return { row_proto:'Object', result_keys:Object.keys(result).sort() };
  });

  return {
    schema: 'trellis-storage-contract-v1',
    backend,
    status: vectors.every(v => v.status === 'PASS') ? 'PASS' : 'FAIL',
    vectors,
    equivalence
  };
}

module.exports = { executeStorageContract, FIXED_TIME };
