const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {VC_REGISTRY}=require('./helpers/web-v0.2-vc-registry');
const {setupWebSystem}=require('./helpers/web-system');
const {createPublicServiceFacade}=require('../http/view-models/public');
const {createPublicRoutes}=require('../http/routes/public');
const {createResourceRoutes}=require('../http/routes/resources');
const {dispatchRequest}=require('../http/app');
const {semanticFactsFromViewModel,parseSemanticFactMarkers}=require('../web/render/semantic-facts');

const REQUIRED=Array.from({length:14},(_,i)=>`VC${i+1}`);
async function call(url,services){return dispatchRequest({url,method:'GET',headers:{}},{routeHandlers:[createPublicRoutes(),createResourceRoutes()],services});}

test('VC registry covers VC1-VC14 with no skipped state',()=>{
  assert.deepEqual(Object.keys(VC_REGISTRY).sort(),REQUIRED.sort());
  for(const [id,refs] of Object.entries(VC_REGISTRY)){
    assert.ok(Array.isArray(refs)&&refs.length>0,id);
    assert.doesNotMatch(refs.join(' '),/SKIP|PENDING/i,id);
  }
});

test('five-page Observatory vertical slice preserves human/API semantic parity',async()=>{
  const {sql,store}=await setupWebSystem();
  const services=createPublicServiceFacade({sql,eventStore:store});
  const vectors=[
    ['public_feed','/','/api/public/feed'],['public_directory','/discover','/api/public/directory'],
    ['actor','/actors/actor%3AA','/api/actors/actor%3AA'],['publication','/publications/pub%3Ap1','/api/publications/pub%3Ap1'],
    ['community','/communities/community%3AC','/api/communities/community%3AC']
  ];
  for(const [type,humanPath,apiPath] of vectors){
    const html=await call(humanPath,services); const json=await call(apiPath,services);
    assert.equal(html.status,200,humanPath); assert.equal(json.status,200,apiPath);
    assert.match(html.body,/Trellis/); assert.match(html.body,/context-inspection/);
    assert.doesNotMatch(html.body,/<button[^>]*>\s*(Post|React|Follow|Join|My Trellis)/i);
    assert.deepEqual(parseSemanticFactMarkers(html.body),semanticFactsFromViewModel(type,JSON.parse(json.body)),type);
  }
  const publication=await call('/publications/pub%3Ap1',services);
  assert.doesNotMatch(publication.body,/<script>alert\(1\)<\/script>/);
  assert.match(publication.body,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('presentation source audit forbids storage authority SQL and social cache paths',()=>{
  const dirs=['web/render','web/public'];
  const files=dirs.flatMap(dir=>fs.readdirSync(dir).filter(name=>/\.(js|css)$/.test(name)).map(name=>path.join(dir,name)));
  const js=files.filter(file=>file.endsWith('.js')).map(file=>[file,fs.readFileSync(file,'utf8')]);
  for(const [file,source] of js){
    assert.doesNotMatch(source,/node:sqlite|storage\/d1-adapter|env\.DB|evaluateAuthority/i,file);
    assert.doesNotMatch(source,/\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET|[A-Za-z_])/i,file);
    assert.doesNotMatch(source,/localStorage|indexedDB|sessionStorage/i,file);
  }
  const primitive=fs.readFileSync('web/render/trellis-line.js','utf8');
  assert.match(primitive,/if\s*\(!edge\)\s*return\s*''/);
  assert.doesNotMatch(primitive,/relationship_id\s*:/);
});
