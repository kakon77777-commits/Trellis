const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { setDisplayName } = require('../profile/product-commands');
const { setCommunityName, setCommunityDiscoverability } = require('../community/product-commands');
const { buildPublicDirectory } = require('../discovery/public-directory');

function ctx(db,store,actor){return {db,sql:db,eventStore:store,authorize:evaluateAuthority,principalActorId:actor,evaluatedAt:'2026-09-07T16:30:00Z'};}
async function reg(store,id){(await registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore:store,authorize:evaluateAuthority}));}
async function nameActor(db,store,id,value,visibility='public'){
  (await setDisplayName({command_id:`name:${id}`,idempotency_key:`name:${id}`,principal_id:`principal:${id}`,actor_id:id,value,visibility},ctx(db,store,id)));
}
async function makeCommunity(db,store,id,name,discoverability){
  (await createCommunity({command_id:`create:${id}`,idempotency_key:`create:${id}`,principal_id:`principal:${id}`,community_id:id},{eventStore:store,authorize:evaluateAuthority}));
  (await setCommunityName({command_id:`cname:${id}`,idempotency_key:`cname:${id}`,principal_id:`principal:${id}`,community_id:id,value:name},ctx(db,store,id)));
  if(discoverability!=='public') (await setCommunityDiscoverability({command_id:`disc:${id}`,idempotency_key:`disc:${id}`,principal_id:`principal:${id}`,community_id:id,value:discoverability},ctx(db,store,id)));
}
async function setup(){
  const db=createTestDatabase(); const store=new SQLiteEventStore(db,{now:()=> '2026-09-07T16:30:00Z'});
  for(const id of ['actor:A','actor:B','actor:bare']) (await reg(store,id));
  (await nameActor(db,store,'actor:A','Alpha'));
  (await nameActor(db,store,'actor:B','Hidden Name','private'));
  (await makeCommunity(db,store,'community:public','Public Lab','public'));
  (await makeCommunity(db,store,'community:unlisted','Quiet Lab','unlisted'));
  (await makeCommunity(db,store,'community:private','Secret Lab','private'));
  return {db,store};
}

test('public directory advertises only actors with public presentation and public communities',async ()=>{
  const {db,store}=(await setup());
  const directory=(await buildPublicDirectory({db,eventStore:store}));
  assert.deepEqual(directory.actors.map(x=>x.actor_id),['actor:A']);
  assert.deepEqual(directory.communities.map(x=>x.community_id),['community:public']);
  assert.equal(directory.algorithm_ref,'trellis-directory:public:v1');
});

test('private-only presentation and unlisted/private communities do not affect anonymous directory snapshot',async ()=>{
  const {db,store}=(await setup());
  const before=(await buildPublicDirectory({db,eventStore:store}));
  (await reg(store,'actor:C'));
  (await nameActor(db,store,'actor:C','Private C','private'));
  (await makeCommunity(db,store,'community:hidden2','Hidden Two','private'));
  const after=(await buildPublicDirectory({db,eventStore:store}));
  assert.deepEqual(after,before);
});
