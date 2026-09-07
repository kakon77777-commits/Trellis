const test=require('node:test');
const assert=require('node:assert/strict');
const { setupWebSystem, counts }=require('./helpers/web-system');
const { createPublicServiceFacade }=require('../http/view-models/public');
const { createPublicRoutes }=require('../http/routes/public');
const { createResourceRoutes }=require('../http/routes/resources');
const { dispatchRequest }=require('../http/app');

async function call(path,services){return dispatchRequest({url:path,method:'GET',headers:{}},{routeHandlers:[createPublicRoutes(),createResourceRoutes()],services});}

test('public API routes expose viewer-safe resources and hide hidden/nonexistent distinction',async()=>{
  const {db,store}=setupWebSystem(); const services=createPublicServiceFacade({db,eventStore:store});
  const actor=await call('/api/actors/actor%3AA',services);
  assert.equal(actor.status,200); assert.equal(JSON.parse(actor.body).actor_id,'actor:A');
  const pub=await call('/api/publications/pub%3Ap1',services);
  assert.equal(pub.status,200); assert.equal(JSON.parse(pub.body).publication_id,'pub:p1');
  const community=await call('/api/communities/community%3AC',services);
  assert.equal(community.status,200);
  const hidden=await call('/api/communities/community%3ACprivate',services);
  const missing=await call('/api/communities/community%3Amissing',services);
  assert.equal(hidden.status,404); assert.equal(missing.status,404); assert.equal(hidden.body,missing.body);
});

test('public feed and directory APIs are read-only and do not mutate canonical or operational state',async()=>{
  const {db,store}=setupWebSystem(); const services=createPublicServiceFacade({db,eventStore:store});
  const before=counts(db);
  const feed=await call('/api/public/feed?limit=2',services);
  const directory=await call('/api/public/directory',services);
  assert.equal(feed.status,200); assert.equal(directory.status,200);
  assert.equal(JSON.parse(feed.body).items.length,2);
  assert.equal(JSON.parse(directory.body).actors.length,2);
  assert.deepEqual(counts(db),before);
});
