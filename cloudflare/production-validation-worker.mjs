import d1AdapterModule from '../storage/d1-adapter.js';
import eventStoreModule from '../events/async-sql-event-store.js';
import fixtureModule from '../scripts/production-validation-fixture-v1.js';

const { D1Adapter } = d1AdapterModule;
const { AsyncSqlEventStore } = eventStoreModule;
const { seedProductionValidationFixtureV1, verifyProductionValidationFixtureV1 } = fixtureModule;

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
    try {
      const { sql, eventStore } = runtime(env);
      if (url.pathname === '/__trellis/pvf/seed' && request.method === 'POST') {
        return json({ status: 'PASS', seeded: await seedProductionValidationFixtureV1({ sql, eventStore }) });
      }
      if (url.pathname === '/__trellis/pvf/verify' && request.method === 'GET') {
        return json({ status: 'PASS', report: await verifyProductionValidationFixtureV1({ sql, eventStore }) });
      }
    } catch (error) {
      return json({
        status: 'FAIL',
        error: { name: error?.name, code: error?.code, message: error?.message, report: error?.report }
      }, 500);
    }
    return json({ status: 'FAIL', error: 'ROUTE_NOT_FOUND' }, 404);
  }
};
