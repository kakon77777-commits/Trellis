const fs=require('node:fs');
const path=require('node:path');

const WELL_KNOWN=Object.freeze({
  name:'Trellis',origin:'https://trellis.aispaces.app',api_base:'/api',schema:'/api/schema',llms_txt:'/llms.txt',
  capabilities:['public_feed','public_directory','actor_profile','publication','community'],writes_enabled:false
});
const SCHEMA=Object.freeze({
  name:'Trellis Public Web API',web_version:'0.1',read_only:true,
  resources:{
    public_feed:{path:'/api/public/feed',projection:'trellis-feed-public:0.1'},
    public_directory:{path:'/api/public/directory',projection:'trellis-directory:0.1'},
    actor_profile:{path:'/api/actors/{actor_id}',projection:'actor-profile:0.1'},
    publication:{path:'/api/publications/{publication_id}',projection:'publication-surface:0.1'},
    community:{path:'/api/communities/{community_id}',projection:'community-surface:0.1'}
  }
});
const LLMS=`# Trellis\n\nTrellis is an AI-first, relation-first social graph system by EveMissLab.\n\nPrefer machine-readable public surfaces over HTML scraping when equivalent data exists:\n- /api/public/feed\n- /api/public/directory\n- /api/actors/{actor_id}\n- /api/publications/{publication_id}\n- /api/communities/{community_id}\n- /api/schema\n\nWeb v0.1 is anonymous and read-only. Machine surfaces receive no broader visibility than human surfaces.\n`;
// __dirname is a CommonJS-only global: it does not exist in the Cloudflare
// Workers runtime (ESM, no automatic __dirname/__filename injection, even
// under nodejs_compat). Referencing it unguarded at module scope crashes
// Worker startup with "ReferenceError: __dirname is not defined" before any
// request is served. `typeof` is the safe way to probe an undeclared
// identifier without throwing, so this stays Node-only; the Worker serves
// the same files through the `assets` Fetcher binding instead (see below).
const ASSETS=Object.freeze(typeof __dirname!=='undefined'?{
  '/assets/app.css':{file:path.join(__dirname,'..','..','web','public','app.css'),type:'text/css; charset=utf-8'},
  '/assets/app.js':{file:path.join(__dirname,'..','..','web','public','app.js'),type:'text/javascript; charset=utf-8'}
}:{});
function json(value){return {status:200,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(value)};}
// In the Workers runtime, static files have no filesystem to be read from;
// they are served by Cloudflare's own Assets Worker, reachable through the
// `assets` Fetcher passed into every route handler. Its configured
// directory is web/public, so an incoming /assets/app.css request maps to
// /app.css within that directory.
async function serveFromAssetsBinding(assets,request,pathname){
  const assetUrl=new URL(request.url);
  assetUrl.pathname=pathname;
  const response=await assets.fetch(new Request(assetUrl,request));
  if(response.status===404) return null;
  return {status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()};
}
function createMachineRoutes(){return async({request,url,assets})=>{
  if(url.pathname==='/.well-known/trellis.json') return json(WELL_KNOWN);
  if(url.pathname==='/api/schema') return json(SCHEMA);
  if(url.pathname==='/llms.txt') return {status:200,headers:{'content-type':'text/plain; charset=utf-8'},body:LLMS};
  const asset=ASSETS[url.pathname];
  if(asset) return {status:200,headers:{'content-type':asset.type,'cache-control':'public, max-age=300'},body:fs.readFileSync(asset.file,'utf8')};
  if(assets&&typeof assets.fetch==='function'&&(url.pathname==='/assets/app.css'||url.pathname==='/assets/app.js')){
    return await serveFromAssetsBinding(assets,request,url.pathname.replace('/assets/','/'));
  }
  return null;
};}
module.exports={WELL_KNOWN,SCHEMA,LLMS,ASSETS,createMachineRoutes};
