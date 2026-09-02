const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverActors, ACTOR_DISCOVERY_ALGORITHM_REF } = require('../discovery/actor-discovery');

function actor(id) {
  return {
    actor_id: id,
    profile: {
      actor_id: id,
      profile_ref: `/actors/${id}`,
      presentation: { display_name: { value: id, assertion_id: `assert:${id}` } }
    }
  };
}

function rel(id, source, target, type = 'follows') {
  return {
    relationship_id: id,
    source_entity_id: source,
    target_entity_id: target,
    relationship_type: type,
    scope_ref: null,
    visibility: 'public',
    lifecycle: 'active'
  };
}

function member(id, actorId, communityId) {
  return {
    relationship_id: id,
    source_entity_id: actorId,
    target_entity_id: communityId,
    relationship_type: 'member_of',
    scope_ref: communityId,
    visibility: 'public',
    lifecycle: 'active'
  };
}

function snapshot() {
  return {
    subject_actor_id: 'actor:A',
    viewer_scope: 'self',
    snapshot_ref: 'snapshot:1',
    actors: Object.fromEntries(['actor:A', 'actor:B', 'actor:C', 'actor:D', 'actor:X'].map(id => [id, actor(id)])),
    communities: {
      'community:C1': {
        community_id: 'community:C1',
        discoverability: 'public',
        presentation: { name: { value: 'C1', assertion_id: 'assert:C1' } },
        visible_member_count: 3
      }
    },
    relationships: [
      rel('rel:ax', 'actor:A', 'actor:X'),
      rel('rel:xb', 'actor:X', 'actor:B'),
      rel('rel:xc', 'actor:X', 'actor:C'),
      rel('rel:ad', 'actor:A', 'actor:D'),
      rel('rel:xd', 'actor:X', 'actor:D'),
      member('rel:a-c1', 'actor:A', 'community:C1'),
      member('rel:b-c1', 'actor:B', 'community:C1'),
      member('rel:c-c1', 'actor:C', 'community:C1')
    ]
  };
}

test('Actor discovery scores visible mutuals shared communities and two-hop paths', () => {
  const candidates = discoverActors(snapshot());
  const b = candidates.find(candidate => candidate.actor_id === 'actor:B');
  assert.ok(b);
  assert.equal(b.algorithm_ref, ACTOR_DISCOVERY_ALGORITHM_REF);
  assert.deepEqual(b.score_components, {
    mutual_visible_actors: 1,
    shared_visible_communities: 1,
    visible_two_hop_paths: 1
  });
  assert.equal(b.score, 8);
  assert.deepEqual(b.reasons.map(reason => reason.type).sort(), [
    'mutual_visible_actor',
    'shared_visible_community',
    'visible_two_hop_path'
  ]);
  assert.equal(b.profile.actor_id, 'actor:B');
});

test('self and already directly related Actors are excluded', () => {
  const ids = discoverActors(snapshot()).map(candidate => candidate.actor_id);
  assert.equal(ids.includes('actor:A'), false);
  assert.equal(ids.includes('actor:D'), false);
});

test('same-score Actor candidates use stable actor id tie breaking', () => {
  const ids = discoverActors(snapshot()).map(candidate => candidate.actor_id);
  assert.deepEqual(ids, ['actor:B', 'actor:C']);
});

test('multiple visible edge-pairs increase path count without duplicating mutual actor count', () => {
  const s = snapshot();
  s.relationships.push(rel('rel:ax2', 'actor:X', 'actor:A', 'reviews'));
  const b = discoverActors(s).find(candidate => candidate.actor_id === 'actor:B');
  assert.deepEqual(b.score_components, {
    mutual_visible_actors: 1,
    shared_visible_communities: 1,
    visible_two_hop_paths: 2
  });
  assert.equal(b.score, 9);
});
