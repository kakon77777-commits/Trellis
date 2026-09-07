const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
const {setupWebSystem,counts}=require('./helpers/web-system');
const {createTrellisServer}=require('../http/server');
const {CONTRACT_REGISTRY}=require('../foundation/cross-domain-contract');
const {renderRankingExplanation}=require('../web/render/context-panel');
const {semanticFactsFromViewModel,parseSemanticFactMarkers}=require('../web/render/semantic-facts');

async function withServer(fn){
 const {db,store}=setupWebSystem(); const server=createTrellisServer({db,eventStore:store});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const {port}=server.address();
 try{return await fn({base:`http://127.0.0.1:${port}`,db,store});}
 finally{await new Promise(resolve=>server.close(resolve));}
}

async function textResponse(base,p){const r=await fetch(base+p);return {status:r.status,type:r.headers.get('content-type')??'',body:await r.text()};}

test('W1/W6/W9/W11: real HTTP server preserves public parity and never fabricates owner identity',async()=>withServer(async({base})=>{
 const vectors=[['public_feed','/','/api/public/feed'],['public_directory','/discover','/api/public/directory'],['actor','/actors/actor%3AA','/api/actors/actor%3AA'],['publication','/publications/pub%3Ap1','/api/publications/pub%3Ap1'],['community','/communities/community%3AC','/api/communities/community%3AC']];
 for(const [type,h,a] of vectors){const hr=await textResponse(base,h), ar=await textResponse(base,a);assert.equal(hr.status,200);assert.equal(ar.status,200);assert.deepEqual(parseSemanticFactMarkers(hr.body),semanticFactsFromViewModel(type,JSON.parse(ar.body)));}
 assert.equal((await textResponse(base,'/api/feed/home')).status,404);
 assert.equal((await textResponse(base,'/?viewer_actor_id=actor:A')).status,400);
 const meta=JSON.parse((await textResponse(base,'/.well-known/trellis.json')).body);assert.equal(meta.writes_enabled,false);
}));

test('W2: context panel is exactly accountable to backend reason code/point data',()=>{
 const item={score:{total_points:6500},ranking_reasons:[{type:'followed_actor',component:'source',points:2000},{type:'recent_24h',component:'recency',points:4000},{type:'seen_before',component:'novelty',points:500}]};
 // Deliberately inconsistent fixture must be visible rather than silently corrected by Web.
 const html=renderRankingExplanation(item);
 for(const reason of item.ranking_reasons){assert.match(html,new RegExp(`data-reason-code="${reason.type}"`));assert.match(html,new RegExp(`data-reason-points="${reason.points}"`));}
 assert.match(html,/data-total-points="6500"/);
});

test('W3/W4/W5/W8: adapter source boundaries stay stateless and non-authoritative',()=>{
 assert.equal(CONTRACT_REGISTRY.http,undefined); assert.equal(CONTRACT_REGISTRY.web,undefined);
 const webRoot=path.join(__dirname,'..','web');
 const files=[]; const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(f.endsWith('.js'))files.push(f);}};walk(webRoot);
 for(const file of files){const source=fs.readFileSync(file,'utf8');for(const token of ['node:sqlite','authority/policy','evaluateAuthority','.prepare(','localStorage','sessionStorage','indexedDB'])assert.equal(source.includes(token),false,`${file}:${token}`);}
 const routeRoot=path.join(__dirname,'..','http','routes'); const routeFiles=[];walkRoute(routeRoot,routeFiles);
 function walkRoute(d,out){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walkRoute(f,out);else if(f.endsWith('.js'))out.push(f);}}
 for(const file of routeFiles){const source=fs.readFileSync(file,'utf8');for(const token of ['node:sqlite','../db/','../../db/','authority/policy','evaluateAuthority','.prepare(','SELECT ','INSERT ','UPDATE ','DELETE FROM'])assert.equal(source.includes(token),false,`${file}:${token}`);}
});

test('W7/W10/W12 and read-only GET contract: hidden facts do not leak and GET routes mutate nothing',async()=>withServer(async({base,db})=>{
 const before=counts(db);
 const home=await textResponse(base,'/'); assert.equal(home.status,200); assert.doesNotMatch(home.body,/<script>alert\(1\)<\/script>/);assert.match(home.body,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 const hidden=await textResponse(base,'/communities/community%3ACprivate'); const missing=await textResponse(base,'/communities/community%3Amissing');assert.equal(hidden.status,404);assert.equal(missing.status,404);assert.equal(hidden.body,missing.body);
 for(const p of ['/discover','/actors/actor%3AA','/publications/pub%3Ap1','/communities/community%3AC','/.well-known/trellis.json','/api/schema','/llms.txt']) assert.equal((await textResponse(base,p)).status,200,p);
 assert.deepEqual(counts(db),before);
}));

test('release manifest includes runnable Web command and syntax gate covers adapter layers',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));
 assert.equal(pkg.scripts['start:web'],'node http/server.js');
 for(const token of ['http/*.js','http/routes/*.js','http/view-models/*.js','web/render/*.js','web/public/*.js'])assert.match(pkg.scripts.check,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
