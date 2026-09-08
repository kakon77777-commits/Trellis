const test=require('node:test');
const assert=require('node:assert/strict');
const { createPublicRequestContext } = require('../http/request-context');
const { createHttpApp, dispatchRequest } = require('../http/app');

function req(url='/', headers={}, method='GET'){return {url,headers,method};}

test('public request context remains anonymous',async ()=>{
  assert.deepEqual(createPublicRequestContext(req('/')), {viewerContext:{}});
});

test('public request context rejects client-claimed actor identity in query/header/cookie',async ()=>{
  for(const r of [
    req('/?viewer_actor_id=actor:A'),
    req('/?subject_actor_id=actor:A'),
    req('/',{'x-actor-id':'actor:A'}),
    req('/',{cookie:'actor_id=actor:A'}),
    req('/',{cookie:'viewer_actor_id=actor:A'})
  ]) assert.throws(()=>createPublicRequestContext(r),/CLIENT_CLAIMED_ACTOR_ID_NOT_ALLOWED/);
});

test('HTTP core supports GET/HEAD only and emits security headers',async()=>{
  const route=async ({url})=> url.pathname==='/' ? {status:200,headers:{'content-type':'text/plain; charset=utf-8'},body:'ok'} : null;
  const get=await dispatchRequest(req('/',{},'GET'),{routeHandlers:[route]});
  assert.equal(get.status,200); assert.equal(get.body,'ok');
  assert.match(get.headers['content-security-policy'],/default-src 'self'/);
  const head=await dispatchRequest(req('/',{},'HEAD'),{routeHandlers:[route]});
  assert.equal(head.status,200); assert.equal(head.body,'');
  const post=await dispatchRequest(req('/',{},'POST'),{routeHandlers:[route]});
  assert.equal(post.status,405);
});

test('createHttpApp writes dispatch response to a node-style response object',async()=>{
  const route=async()=>({status:200,headers:{'content-type':'text/plain'},body:'hello'});
  const app=createHttpApp({routeHandlers:[route]});
  const seen={headers:{},body:''};
  const res={
    writeHead(status,headers){seen.status=status;seen.headers=headers;},
    end(body=''){seen.body=body;}
  };
  await app(req('/'),res);
  assert.equal(seen.status,200); assert.equal(seen.body,'hello');
});
