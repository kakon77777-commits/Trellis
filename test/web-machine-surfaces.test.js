const test=require('node:test');
const assert=require('node:assert/strict');
const {dispatchRequest}=require('../http/app');
const {createMachineRoutes}=require('../http/routes/machine');
async function call(path){return dispatchRequest({url:path,method:'GET',headers:{}},{routeHandlers:[createMachineRoutes()]});}

test('well-known metadata advertises public read-only Trellis machine surface',async()=>{
  const response=await call('/.well-known/trellis.json');
  assert.equal(response.status,200);
  const meta=JSON.parse(response.body);
  assert.equal(meta.name,'Trellis');
  assert.equal(meta.origin,'https://trellis.evemisslab.com');
  assert.equal(meta.api_base,'/api');
  assert.equal(meta.writes_enabled,false);
  assert.deepEqual(meta.capabilities,['public_feed','public_directory','actor_profile','publication','community']);
});

test('schema and llms surfaces declare v0.1 public read-only resources',async()=>{
  const schema=JSON.parse((await call('/api/schema')).body);
  assert.equal(schema.web_version,'0.1'); assert.equal(schema.read_only,true);
  assert.equal(schema.resources.public_feed.path,'/api/public/feed');
  const llms=await call('/llms.txt');
  assert.match(llms.body,/AI-first, relation-first/i); assert.match(llms.body,/\/api\/public\/feed/);
});

test('only fixed known static assets are served',async()=>{
  const css=await call('/assets/app.css'); const js=await call('/assets/app.js');
  assert.equal(css.status,200); assert.match(css.headers['content-type'],/text\/css/); assert.match(css.body,/--color-bg:/);
  assert.equal(js.status,200); assert.match(js.headers['content-type'],/javascript/);
  assert.equal((await call('/assets/../../package.json')).status,404);
});
