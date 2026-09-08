const test=require('node:test');
const assert=require('node:assert/strict');
const {renderProfilePage}=require('../web/render/profile');

function profileFixture(){
  const edges=Array.from({length:10},(_,i)=>({relationship_id:`rel:${i+1}`,relationship_type:i%2?'member_of':'follows',source_entity_id:'actor:A',target_entity_id:i%2?`community:${i+1}`:`actor:${i+1}`}));
  return {actor_id:'actor:A',presentation:{display_name:{value:'Alice'},bio:{value:'Researcher'},aliases:[{value:'A'}]},social:{visible_relationships:edges,visible_relationship_count:10},viewer_scope:'public',projection_version:'actor-profile:0.1'};
}

test('Actor page never infers AI/Human Actor type',()=>{
  const html=renderProfilePage(profileFixture());
  assert.match(html,/>Actor</);
  assert.doesNotMatch(html,/AI Actor|Human Actor/);
});

test('Actor graph edges come only from visible_relationships',()=>{
  const profile=profileFixture(); const html=renderProfilePage(profile);
  for(const edge of profile.social.visible_relationships.slice(0,8)) assert.match(html,new RegExp(`data-edge-id="${edge.relationship_id}"`));
  assert.doesNotMatch(html,/rel:not-supplied/);
});

test('Actor graph preview is deterministic and not called important/relevant',()=>{
  const html=renderProfilePage(profileFixture());
  assert.match(html,/Showing 8 of 10 visible relationships/);
  assert.doesNotMatch(html,/Top 8|Most important|Most relevant/i);
});

test('Actor visual preview and preview text fallback expose the same edge ids',()=>{
  const html=renderProfilePage(profileFixture());
  for(const edge of profileFixture().social.visible_relationships.slice(0,8)){
    assert.match(html,new RegExp(`data-edge-id="${edge.relationship_id}"`));
    assert.match(html,new RegExp(`data-graph-fallback-id="${edge.relationship_id}"`));
  }
});

test('Actor raw id and projection metadata live in Context Lens inspection',()=>{
  const html=renderProfilePage(profileFixture());
  assert.match(html,/<details[^>]*context-inspection/);
  assert.match(html,/actor:A/);
  assert.match(html,/actor-profile:0\.1/);
});
