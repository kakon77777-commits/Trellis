const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverCommunities, COMMUNITY_DISCOVERY_ALGORITHM_REF } = require('../discovery/community-discovery');

function actor(id) {
  return { actor_id:id, profile:{ actor_id:id, profile_ref:`/actors/${id}`, presentation:{} } };
}
function community(id, discoverability='public', count=0) {
  return { community_id:id, community_ref:`/communities/${id}`, discoverability, presentation:{ name:{ value:id, assertion_id:`assert:${id}` } }, visible_member_count:count };
}
function rel(id, source, target, type='follows', lifecycle='active') {
  return { relationship_id:id, source_entity_id:source, target_entity_id:target, relationship_type:type, scope_ref:type==='member_of'?target:null, visibility:'public', lifecycle };
}
function snapshot() {
  return {
    subject_actor_id:'actor:A', viewer_scope:'self', snapshot_ref:'snapshot:community',
    actors:Object.fromEntries(['actor:A','actor:B','actor:X'].map(id=>[id,actor(id)])),
    communities:{
      'community:C1':community('community:C1','public',2),
      'community:C2':community('community:C2','public',2),
      'community:Cpending':community('community:Cpending','public',1),
      'community:Cunlisted':community('community:Cunlisted','unlisted',1),
      'community:Cprivate':community('community:Cprivate','private',1)
    },
    relationships:[
      rel('rel:ax','actor:A','actor:X'),
      rel('rel:a-c1','actor:A','community:C1','member_of'),
      rel('rel:b-c1','actor:B','community:C1','member_of'),
      rel('rel:x-c2','actor:X','community:C2','member_of'),
      rel('rel:b-c2','actor:B','community:C2','member_of'),
      rel('rel:a-pending','actor:A','community:Cpending','member_of','proposed'),
      rel('rel:x-unlisted','actor:X','community:Cunlisted','member_of'),
      rel('rel:x-private','actor:X','community:Cprivate','member_of')
    ]
  };
}

test('Community discovery scores visible connected members paths and membership overlap', () => {
  const candidates=discoverCommunities(snapshot());
  const c2=candidates.find(candidate=>candidate.community_id==='community:C2');
  assert.ok(c2);
  assert.equal(c2.algorithm_ref,COMMUNITY_DISCOVERY_ALGORITHM_REF);
  assert.deepEqual(c2.score_components,{
    connected_visible_members:1,
    visible_paths:1,
    visible_membership_overlap:1
  });
  assert.equal(c2.score,8);
  assert.deepEqual(c2.reasons.map(reason=>reason.type).sort(),[
    'connected_visible_member','visible_community_path','visible_membership_overlap'
  ]);
  assert.equal(c2.community.community_id,'community:C2');
});

test('active and pending memberships exclude Communities from discovery', () => {
  const ids=discoverCommunities(snapshot()).map(candidate=>candidate.community_id);
  assert.equal(ids.includes('community:C1'),false);
  assert.equal(ids.includes('community:Cpending'),false);
});

test('unlisted and private Communities never enter generic discovery', () => {
  const ids=discoverCommunities(snapshot()).map(candidate=>candidate.community_id);
  assert.equal(ids.includes('community:Cunlisted'),false);
  assert.equal(ids.includes('community:Cprivate'),false);
});

test('multiple visible direct edges increase path count without duplicating connected member count', () => {
  const s=snapshot();
  s.relationships.push(rel('rel:xa-review','actor:X','actor:A','reviews'));
  const c2=discoverCommunities(s).find(candidate=>candidate.community_id==='community:C2');
  assert.deepEqual(c2.score_components,{
    connected_visible_members:1,
    visible_paths:2,
    visible_membership_overlap:1
  });
  assert.equal(c2.score,9);
});
