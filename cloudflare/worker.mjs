import d1AdapterModule from '../storage/d1-adapter.js';
import runtimeModule from '../runtime/build-dependencies.js';
import appModule from '../http/app.js';
import keysModule from '../ailp/keys.js';

const { D1Adapter } = d1AdapterModule;
const { buildHttpRuntime } = runtimeModule;
const { dispatchRequest } = appModule;
const { loadRpSigningKey } = keysModule;

export function buildWorkerDependencies(env = {}) {
  if (!env.DB) throw new TypeError('D1_BINDING_REQUIRED');
  const sql = new D1Adapter(env.DB);
  // AILP is optional at the Worker level: an environment without the secret
  // configured yet just serves the existing anonymous GET/HEAD surface,
  // rather than failing Worker startup.
  let ailpRpKey;
  try {
    ailpRpKey = loadRpSigningKey(env);
  } catch (e) {
    ailpRpKey = undefined;
  }
  return buildHttpRuntime({ sql, ailpRpKey });
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
