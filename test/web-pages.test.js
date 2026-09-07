const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {setupWebSystem}=require('./helpers/web-system');
const {createPublicServiceFacade}=require('../http/view-models/public');
const {createPublicRoutes}=require('../http/routes/public');
const {createResourceRoutes}=require('../http/routes/resources');
const {dispatchRequest}=require('../http/app');
const {renderCommunityPage}=require('../web/render/community');

async function call(path,services){return dispatchRequest({url:path,method:'GET',headers:{}},{routeHandlers:[createPublicRoutes(),createResourceRoutes()],services});}

test('five public human surfaces render one semantic responsive shell',async()=>{
  const {db,store}=setupWebSystem(); const services=createPublicServiceFacade({db,eventStore:store});
  for(const path of ['/','/discover','/actors/actor%3AA','/publications/pub%3Ap1','/communities/community%3AC']){
    const response=await call(path,services);
    assert.equal(response.status,200,path);
    assert.match(response.headers['content-type'],/text\/html/);
    assert.match(response.body,/<nav/); assert.match(response.body,/<main/); assert.match(response.body,/<aside/);
    assert.match(response.body,/Trellis/); assert.match(response.body,/\/assets\/app\.css/);
  }
});

test('authored publication content is escaped instead of executed',async()=>{
  const {db,store}=setupWebSystem(); const services=createPublicServiceFacade({db,eventStore:store});
  const response=await call('/publications/pub%3Ap1',services);
  assert.doesNotMatch(response.body,/<script>alert\(1\)<\/script>/);
  assert.match(response.body,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('community graph visual and text fallback represent the same visible edge ids',()=>{
  const surface={community_id:'community:C',presentation:{name:{value:'Commons'}},discoverability:'public',membership:{visible_members:[],visible_member_count:0},local_graph:{visible_scoped_relationships:[
    {relationship_id:'rel:1',relationship_type:'collaborates_with',source_entity_id:'actor:A',target_entity_id:'actor:B'},
    {relationship_id:'rel:2',relationship_type:'trusts',source_entity_id:'actor:B',target_entity_id:'actor:C'}
  ],visible_relationship_count:2},available_actions:[],execution_authority:{},viewer_scope:'public',projection_version:'community-surface:0.1'};
  const html=renderCommunityPage(surface);
  for(const id of ['rel:1','rel:2']){
    assert.match(html,new RegExp(`data-graph-edge-id="${id.replace(':','\\:')}"`.replace('\\: ',':')));
    assert.match(html,new RegExp(`data-graph-fallback-id="${id.replace(':','\\:')}"`.replace('\\: ',':')));
  }
});

test('web CSS has design tokens, focus treatment, reduced-motion and mobile layout',()=>{
  const css=fs.readFileSync(require.resolve('../web/public/app.css'),'utf8');
  assert.match(css,/--color-bg:/); assert.match(css,/:focus-visible/); assert.match(css,/prefers-reduced-motion/); assert.match(css,/@media/);
});
