const test=require('node:test');
const assert=require('node:assert/strict');
const {renderCommunityPage}=require('../web/render/community');

function communityFixture(){
  const edges=Array.from({length:14},(_,i)=>({relationship_id:`rel:${i+1}`,relationship_type:i%2?'collaborates_with':'follows',source_entity_id:`actor:${(i%3)+1}`,target_entity_id:`actor:${((i+1)%3)+1}`}));
  return {community_id:'community:C',presentation:{name:{value:'AI Research'},description:{value:'Research community'}},discoverability:'public',membership:{visible_members:[{actor_id:'actor:1'},{actor_id:'actor:2'},{actor_id:'actor:3'}],visible_member_count:3},local_graph:{visible_scoped_relationships:edges,visible_relationship_count:14},viewer_scope:'public',projection_version:'community-surface:0.1'};
}

test('Community member count is explicitly viewer-relative',()=>{
  assert.match(renderCommunityPage(communityFixture()),/3 visible members/);
});

test('Community graph preview contains only supplied visible scoped edges',()=>{
  const surface=communityFixture(); const html=renderCommunityPage(surface);
  for(const edge of surface.local_graph.visible_scoped_relationships.slice(0,12)) assert.match(html,new RegExp(`data-edge-id="${edge.relationship_id}"`));
  assert.doesNotMatch(html,/rel:not-visible/);
});

test('Community preview uses deterministic subset vocabulary not ranking vocabulary',()=>{
  const html=renderCommunityPage(communityFixture());
  assert.match(html,/Showing 12 of 14 visible relationships/);
  assert.doesNotMatch(html,/Top 12|Most relevant|Most important/i);
});

test('Community visual graph and preview fallback contain the same 12 edge ids',()=>{
  const html=renderCommunityPage(communityFixture());
  for(const edge of communityFixture().local_graph.visible_scoped_relationships.slice(0,12)){
    assert.match(html,new RegExp(`data-edge-id="${edge.relationship_id}"`));
    assert.match(html,new RegExp(`data-graph-fallback-id="${edge.relationship_id}"`));
  }
});

test('Community full graph list contains every viewer-visible edge',()=>{
  const html=renderCommunityPage(communityFixture());
  for(const edge of communityFixture().local_graph.visible_scoped_relationships) assert.match(html,new RegExp(`data-full-edge-id="${edge.relationship_id}"`));
});

test('empty Community graph uses epistemically bounded wording',()=>{
  const html=renderCommunityPage({...communityFixture(),local_graph:{visible_scoped_relationships:[],visible_relationship_count:0}});
  assert.match(html,/No visible local relationships/);
  assert.match(html,/does not assert that no other relationships exist/);
});
