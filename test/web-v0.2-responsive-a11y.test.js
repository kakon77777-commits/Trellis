const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {readRootTokens,contrast}=require('./helpers/css-tokens');
const {setupWebSystem}=require('./helpers/web-system');
const {createPublicServiceFacade}=require('../http/view-models/public');
const {createPublicRoutes}=require('../http/routes/public');
const {createResourceRoutes}=require('../http/routes/resources');
const {dispatchRequest}=require('../http/app');
function loadCss(){return fs.readFileSync(require.resolve('../web/public/app.css'),'utf8');}
async function call(path,services){return dispatchRequest({url:path,method:'GET',headers:{}},{routeHandlers:[createPublicRoutes(),createResourceRoutes()],services});}

test('mobile page-level Context Lens is a collapsed disclosure after page lead and before page body on all five public surfaces',async()=>{
  const {sql,store}=await setupWebSystem();
  const services=createPublicServiceFacade({sql,eventStore:store});
  for(const path of ['/','/discover','/actors/actor%3AA','/publications/pub%3Ap1','/communities/community%3AC']){
    const response=await call(path,services);
    assert.equal(response.status,200,path);
    const html=response.body;
    const lead=html.indexOf('data-page-lead');
    const drawer=html.indexOf('mobile-context-drawer');
    const body=html.indexOf('data-page-body');
    assert.ok(lead>=0,`${path}: page lead marker`);
    assert.ok(drawer>lead,`${path}: Context Lens follows page lead`);
    assert.ok(body>drawer,`${path}: Context Lens precedes page body`);
    assert.match(html,/<details class="mobile-context-drawer">\s*<summary>Context Lens<\/summary>/,`${path}: default-collapsed details`);
    assert.doesNotMatch(html,/<details class="mobile-context-drawer"[^>]*\sopen(?:\s|=|>)/,`${path}: drawer is not open by default`);
  }
});

test('mobile layout swaps the persistent desktop Context Lens for the in-flow drawer',()=>{
  const css=loadCss();
  assert.match(css,/\.mobile-context-panel\s*\{[^}]*display:\s*none/s);
  assert.match(css,/@media\s*\(max-width:\s*720px\)[\s\S]*\.desktop-context-panel\s*\{[^}]*display:\s*none/s);
  assert.match(css,/@media\s*\(max-width:\s*720px\)[\s\S]*\.mobile-context-panel\s*\{[^}]*display:\s*block/s);
});

test('mobile semantic graph prefers one-column adjacency/list grammar',()=>{
  const css=loadCss();
  assert.match(css,/\.semantic-edge\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test('required text/accent tokens pass contrast targets against supported surfaces',()=>{
  const tokens=readRootTokens(loadCss());
  for(const bg of ['--color-bg','--color-surface','--color-surface-raised']){
    assert.ok(contrast(tokens['--color-text'],tokens[bg])>=4.5,`text on ${bg}`);
    assert.ok(contrast(tokens['--color-text-muted'],tokens[bg])>=4.5,`muted on ${bg}`);
    assert.ok(contrast(tokens['--color-accent-primary'],tokens[bg])>=3,`primary on ${bg}`);
    assert.ok(contrast(tokens['--color-accent-secondary'],tokens[bg])>=3,`secondary on ${bg}`);
  }
});

test('reduced motion removes nonessential transition/animation duration',()=>{
  const css=loadCss();
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css,/transition:\s*none\s*!important/);
  assert.match(css,/animation:\s*none\s*!important/);
});

test('browser enhancement source contains no storage or authoritative social cache',()=>{
  const js=fs.readFileSync(require.resolve('../web/public/app.js'),'utf8');
  assert.doesNotMatch(js,/localStorage|indexedDB|sessionStorage|fetch\([^)]*api\/.*(relationship|publication|community)/i);
});
