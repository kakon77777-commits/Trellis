const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computePersonalizedFeedSnapshotRef } = require('../feed/personalized-snapshot');
const {
  encodePersonalizedFeedCursor,
  decodePersonalizedFeedCursor,
  paginatePersonalizedFeed,
  cursorForPersonalizedItem
} = require('../feed/personalized-cursor');

function item(id, points, recordedAt, offset) {
  return {
    feed_item_id:id,
    item_type:'publication',
    source_ref:id.replace('feed:publication:',''),
    sort:{recorded_at:recordedAt,global_offset:offset},
    score:{recency_points:4000,source_points:3000,novelty_points:points-7000,total_points:points},
    ranking_reasons:[]
  };
}
function feed(extra={}) {
  const items=[
    item('feed:publication:pub:A',9000,'2026-09-03T10:00:00.000Z',3),
    item('feed:publication:pub:B',8000,'2026-09-03T09:00:00.000Z',2),
    item('feed:publication:pub:C',7000,'2026-09-03T08:00:00.000Z',1)
  ];
  const base={
    feed_type:'home',subject_actor_id:'actor:A',viewer_scope:'self',algorithm_ref:'trellis-feed:personalized:v2',
    projection_version:'trellis-feed:0.2',ranking_reference_time:'2026-09-03T12:00:00.000Z',
    source_graph:{subject_actor_id:'actor:A',viewer_scope:'self',actor_source_ids:[],community_source_ids:[],source_relationships:[]},
    items
  };
  const merged={...base,...extra};
  merged.snapshot_ref=computePersonalizedFeedSnapshotRef({
    subjectActorId:merged.subject_actor_id,
    viewerContext:{viewer_actor_id:'actor:A'},
    viewerScope:merged.viewer_scope,
    sourceGraph:merged.source_graph,
    items:merged.items,
    rankingReferenceTime:merged.ranking_reference_time
  });
  return merged;
}

test('personalized cursor carries score, chronological key, and pinned ranking reference time',()=>{
  const f=feed();
  const cursor=cursorForPersonalizedItem(f,f.items[1]);
  assert.deepEqual(cursor,{
    algorithm_ref:'trellis-feed:personalized:v2',snapshot_ref:f.snapshot_ref,ranking_reference_time:'2026-09-03T12:00:00.000Z',
    last_total_points:8000,last_recorded_at:'2026-09-03T09:00:00.000Z',last_global_offset:2,last_item_id:'feed:publication:pub:B'
  });
  assert.deepEqual(decodePersonalizedFeedCursor(encodePersonalizedFeedCursor(cursor)),cursor);
});

test('page 2 uses the same snapshot and ranking reference time pinned by page 1 cursor',()=>{
  const f=feed();
  const page1=paginatePersonalizedFeed({feed:f,limit:2});
  assert.deepEqual(page1.items.map(i=>i.feed_item_id),['feed:publication:pub:A','feed:publication:pub:B']);
  const decoded=decodePersonalizedFeedCursor(page1.next_cursor);
  assert.equal(decoded.ranking_reference_time,f.ranking_reference_time);
  const page2=paginatePersonalizedFeed({feed:f,limit:2,cursor:page1.next_cursor});
  assert.deepEqual(page2.items.map(i=>i.feed_item_id),['feed:publication:pub:C']);
  assert.equal(page2.next_cursor,null);
});

test('visible scored-state change changes personalized snapshot',()=>{
  const before=feed();
  const changedItems=before.items.map(i=>i.feed_item_id==='feed:publication:pub:B'?{...i,score:{...i.score,novelty_points:-500,total_points:6500}}:i);
  const after=feed({items:changedItems});
  assert.notEqual(after.snapshot_ref,before.snapshot_ref);
});

test('ranking reference time is part of snapshot identity',()=>{
  const a=feed({ranking_reference_time:'2026-09-03T12:00:00.000Z'});
  const b=feed({ranking_reference_time:'2026-09-03T12:00:01.000Z'});
  assert.notEqual(a.snapshot_ref,b.snapshot_ref);
});

test('cursor fails with FEED_SNAPSHOT_CHANGED when snapshot or pinned reference time differs',()=>{
  const original=feed();
  const cursor=paginatePersonalizedFeed({feed:original,limit:1}).next_cursor;
  const changed=feed({ranking_reference_time:'2026-09-03T13:00:00.000Z'});
  assert.throws(()=>paginatePersonalizedFeed({feed:changed,limit:1,cursor}),/FEED_SNAPSHOT_CHANGED/);
});

test('cursor item match includes total score and complete chronological key',()=>{
  const f=feed();
  const cursor=decodePersonalizedFeedCursor(paginatePersonalizedFeed({feed:f,limit:1}).next_cursor);
  const tampered=encodePersonalizedFeedCursor({...cursor,last_total_points:123});
  assert.throws(()=>paginatePersonalizedFeed({feed:f,limit:1,cursor:tampered}),/INVALID_FEED_CURSOR/);
});
