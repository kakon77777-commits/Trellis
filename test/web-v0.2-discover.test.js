const test=require('node:test');
const assert=require('node:assert/strict');
const {renderExplorePage}=require('../web/render/explore');

function directoryFixture(){return{
  actors:[{actor_id:'actor:A',presentation:{display_name:{value:'Alice'},bio:{value:'Public bio'}},viewer_scope:'public',projection_version:'actor-profile:0.1',detail_ref:'/actors/actor%3AA'}],
  communities:[{community_id:'community:C',presentation:{name:{value:'AI Research'},description:{value:'Public community'}},discoverability:'public',membership:{visible_member_count:3,visible_members:[{actor_id:'actor:A'}]},viewer_scope:'public',projection_version:'community-surface:0.1',detail_ref:'/communities/community%3AC'}],
  algorithm_ref:'trellis-directory:public:v1',projection_version:'trellis-directory:0.1',snapshot_ref:'snapshot-directory'
};}

test('Discover renders Actor and Community node grammar without directory edges',()=>{
  const html=renderExplorePage(directoryFixture());
  assert.match(html,/data-node-kind="actor"/);
  assert.match(html,/data-node-kind="community"/);
  assert.doesNotMatch(html,/data-relation-type=/);
});

test('Discover Community count wording is viewer-relative',()=>{
  const html=renderExplorePage(directoryFixture());
  assert.match(html,/3 visible members/);
});

test('Discover Context Lens states deterministic public-by-construction index',()=>{
  const html=renderExplorePage(directoryFixture());
  assert.match(html,/Public-by-construction/);
  assert.match(html,/trellis-directory:public:v1/);
  assert.match(html,/snapshot-directory/);
});

test('Discover does not advertise recommendation semantics',()=>{
  const html=renderExplorePage(directoryFixture());
  assert.doesNotMatch(html,/Recommended|Trending|For you|Most relevant|Suggested/i);
});
