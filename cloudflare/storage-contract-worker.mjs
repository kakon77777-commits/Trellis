import d1AdapterModule from '../storage/d1-adapter.js';
import contractModule from '../test/storage-contract/contract-suite.js';

const { D1Adapter } = d1AdapterModule;
const { executeStorageContract } = contractModule;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok', { status: 200 });
    if (url.pathname !== '/__trellis/storage-contract') return new Response('not found', { status: 404 });
    if (!env.DB) return Response.json({ status:'FAIL', error:'D1_BINDING_REQUIRED' }, { status:500 });
    try {
      const result = await executeStorageContract({ sql: new D1Adapter(env.DB), backend: 'd1-local' });
      return Response.json(result, { status: result.status === 'PASS' ? 200 : 500 });
    } catch (error) {
      return Response.json({ status:'FAIL', error:{ name:error?.name, code:error?.code, message:error?.message } }, { status:500 });
    }
  }
};
