import d1AdapterModule from '../storage/d1-adapter.js';
import eventStoreModule from '../events/async-sql-event-store.js';
import canaryModule from '../scripts/production-cache-canary-v1.js';

const { D1Adapter } = d1AdapterModule;
const { AsyncSqlEventStore } = eventStoreModule;
const { PRODUCTION_CACHE_CANARY_V1, runProductionCacheCanaryV1 } = canaryModule;

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function runtime(env) {
  if (!env.DB) throw new TypeError('D1_BINDING_REQUIRED');
  const sql = new D1Adapter(env.DB);
  return { sql, eventStore: new AsyncSqlEventStore(sql) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok', { status: 200 });
    if (url.pathname !== '/__trellis/pvf/cache-canary-v1/run') {
      return json({ status: 'FAIL', error: 'ROUTE_NOT_FOUND' }, 404);
    }
    if (request.method !== 'POST') {
      return json({ status: 'FAIL', error: 'METHOD_NOT_ALLOWED' }, 405);
    }
    if (env.PVF_CACHE_CANARY_ENABLED !== 'true') {
      return json({ status: 'FAIL', error: 'PVF_CACHE_CANARY_DISABLED' }, 403);
    }
    try {
      const { sql, eventStore } = runtime(env);
      const report = await runProductionCacheCanaryV1({
        sql,
        eventStore,
        origins: [...PRODUCTION_CACHE_CANARY_V1.origins],
        fetchImpl: fetch
      });
      return json({ status: 'PASS', report });
    } catch (error) {
      return json({
        status: 'FAIL',
        error: {
          name: error?.name,
          code: error?.code,
          message: error?.message,
          report: error?.report
        }
      }, 500);
    }
  }
};
