import d1AdapterModule from '../storage/d1-adapter.js';
import runtimeModule from '../runtime/build-dependencies.js';
import appModule from '../http/app.js';

const { D1Adapter } = d1AdapterModule;
const { buildHttpRuntime } = runtimeModule;
const { dispatchRequest } = appModule;

export function buildWorkerDependencies(env = {}) {
  if (!env.DB) throw new TypeError('D1_BINDING_REQUIRED');
  const sql = new D1Adapter(env.DB);
  return buildHttpRuntime({ sql });
}

function toFetchResponse(response) {
  return new Response(response.body ?? '', {
    status: response.status,
    headers: response.headers
  });
}

export default {
  async fetch(request, env) {
    const runtime = buildWorkerDependencies(env);
    const response = await dispatchRequest(request, {
      routeHandlers: runtime.routeHandlers,
      services: runtime.services,
      assets: env.ASSETS
    });
    return toFetchResponse(response);
  }
};
