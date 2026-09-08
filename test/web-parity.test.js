const test=require('node:test');
const assert=require('node:assert/strict');
const {setupWebSystem}=require('./helpers/web-system');
const {createPublicServiceFacade}=require('../http/view-models/public');
const {createPublicRoutes}=require('../http/routes/public');
const {createResourceRoutes}=require('../http/routes/resources');
const {dispatchRequest}=require('../http/app');
const {semanticFactsFromViewModel,parseSemanticFactMarkers}=require('../web/render/semantic-facts');
async function call(path,services){return dispatchRequest({url:path,method:'GET',headers:{}},{routeHandlers:[createPublicRoutes(),createResourceRoutes()],services});}

test('HTML and JSON expose identical normalized semantic facts for all five public resource types',async()=>{
 const {sql,store}=(await setupWebSystem()); const services=createPublicServiceFacade({sql,eventStore:store});
 const vectors=[
  ['public_feed','/','/api/public/feed'],['public_directory','/discover','/api/public/directory'],
  ['actor','/actors/actor%3AA','/api/actors/actor%3AA'],['publication','/publications/pub%3Ap1','/api/publications/pub%3Ap1'],
  ['community','/communities/community%3AC','/api/communities/community%3AC']
 ];
 for(const [type,humanPath,apiPath] of vectors){
   const html=await call(humanPath,services); const json=await call(apiPath,services);
   assert.equal(html.status,200); assert.equal(json.status,200);
   assert.deepEqual(parseSemanticFactMarkers(html.body),semanticFactsFromViewModel(type,JSON.parse(json.body)),type);
 }
});
