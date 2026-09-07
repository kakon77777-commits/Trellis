const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourceComponentForItem } = require('../feed/source-tier');

function graph(extra = {}) {
  return {
    subject_actor_id: 'actor:A',
    actor_source_ids: [],
    community_source_ids: [],
    source_relationships: [],
    ...extra
  };
}

test('self publication has highest source tier even when community scoped', () => {
  const item = { item_type:'publication', publication:{author_actor_id:'actor:A',scope_ref:'community:C'} };
  assert.deepEqual(sourceComponentForItem(item, graph({community_source_ids:['community:C']})), {
    type:'self_publication', component:'source', points:4000
  });
});

test('subscription outranks follow for the same unscoped author without stacking', () => {
  const item = { item_type:'publication', publication:{author_actor_id:'actor:B',scope_ref:null} };
  const sourceGraph = graph({
    actor_source_ids:['actor:B'],
    source_relationships:[
      {relationship_type:'follows',target_entity_id:'actor:B'},
      {relationship_type:'subscribes_to',target_entity_id:'actor:B'}
    ]
  });
  assert.deepEqual(sourceComponentForItem(item, sourceGraph), {
    type:'subscribed_actor', component:'source', points:3000
  });
});

test('community-scoped publication uses community source instead of author follow strength', () => {
  const item = { item_type:'publication', publication:{author_actor_id:'actor:B',scope_ref:'community:C'} };
  const sourceGraph = graph({
    actor_source_ids:['actor:B'],
    community_source_ids:['community:C'],
    source_relationships:[{relationship_type:'subscribes_to',target_entity_id:'actor:B'}]
  });
  assert.deepEqual(sourceComponentForItem(item, sourceGraph), {
    type:'community_source', component:'source', points:1000
  });
});

test('subject-involved collaboration is strongest activity source tier', () => {
  const item = {item_type:'social_activity',activity:{type:'collaboration_started',source_actor_id:'actor:A',target_actor_id:'actor:B',scope_ref:null}};
  assert.deepEqual(sourceComponentForItem(item, graph()), {
    type:'subject_involved_activity', component:'source', points:2500
  });
});

test('subscribed actor activity outranks followed actor activity', () => {
  const item = {item_type:'social_activity',activity:{type:'collaboration_started',source_actor_id:'actor:B',target_actor_id:'actor:C',scope_ref:null}};
  const sourceGraph = graph({
    actor_source_ids:['actor:B','actor:C'],
    source_relationships:[
      {relationship_type:'subscribes_to',target_entity_id:'actor:B'},
      {relationship_type:'follows',target_entity_id:'actor:C'}
    ]
  });
  assert.deepEqual(sourceComponentForItem(item, sourceGraph), {
    type:'subscribed_actor_activity', component:'source', points:2000
  });
});

test('visible community membership activity gets community activity tier', () => {
  const item = {item_type:'social_activity',activity:{type:'community_joined',actor_id:'actor:B',community_id:'community:C'}};
  assert.deepEqual(sourceComponentForItem(item, graph({community_source_ids:['community:C']})), {
    type:'community_activity', component:'source', points:1000
  });
});

test('source tier cannot be invented from an item outside the supplied visible source graph', () => {
  const item = {item_type:'publication',publication:{author_actor_id:'actor:X',scope_ref:null}};
  assert.throws(() => sourceComponentForItem(item, graph()), /FEED_V2_SOURCE_TIER_NOT_FOUND/);
});
