import productionWorker from './worker.mjs';
import d1AdapterModule from '../storage/d1-adapter.js';
import eventStoreModule from '../events/async-sql-event-store.js';
import fixtureModule from '../test/cloudflare/integration-fixture.js';

const { D1Adapter } = d1AdapterModule;
const { AsyncSqlEventStore } = eventStoreModule;
const { seedPublicFixture, addHiddenFixture, verifyIntegrationFixture } = fixtureModule;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function integrationRuntime(env) {
  if (!env.DB) throw new TypeError('D1_BINDING_REQUIRED');
  const sql = new D1Adapter(env.DB);
  return { sql, eventStore: new AsyncSqlEventStore(sql) };
}

async function handleIntegrationRequest(request, env, pathname) {
  const { sql, eventStore } = integrationRuntime(env);
  if (pathname === '/__trellis/integration/seed-public' && request.method === 'POST') {
    return json({ status: 'PASS', fixture: await seedPublicFixture({ sql, eventStore }) });
  }
  if (pathname === '/__trellis/integration/add-hidden' && request.method === 'POST') {
    return json({ status: 'PASS', fixture: await addHiddenFixture({ sql, eventStore }) });
  }
  if (pathname === '/__trellis/integration/verify' && request.method === 'GET') {
    return json({ status: 'PASS', verification: await verifyIntegrationFixture({ sql, eventStore }) });
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok', { status: 200 });
    if (url.pathname.startsWith('/__trellis/integration/')) {
      try {
        const response = await handleIntegrationRequest(request, env, url.pathname);
        return response ?? json({ status: 'FAIL', error: 'INTEGRATION_ROUTE_NOT_FOUND' }, 404);
      } catch (error) {
        return json({
          status: 'FAIL',
          error: { name: error?.name, code: error?.code, message: error?.message }
        }, 500);
      }
    }
    return productionWorker.fetch(request, env);
  }
};
