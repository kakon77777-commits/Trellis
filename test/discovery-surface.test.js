const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { setupDiscoverySystem }=require('./helpers/discovery-system');
const { buildDiscoverySurface }=require('../discovery/read-service');
const { renderDiscoveryJson }=require('../discovery/render-json');
const { renderDiscoveryHtml }=require('../discovery/render-html');

test('Discovery surface returns Actor and Community candidates from one viewer-relative snapshot',()=>{
  const {db,store}=setupDiscoverySystem();
  const surface=buildDiscoverySurface({ subjectActorId:'actor:A', viewerContext:{viewer_actor_id:'actor:A'}, db, eventStore:store });
  assert.equal(surface.subject_actor_id,'actor:A');
  assert.equal(surface.viewer_scope,'self');
  assert.equal(surface.actor_discovery.algorithm_ref,'trellis-discovery:actor-graph:v1');
  assert.deepEqual(surface.actor_discovery.candidates.map(x=>x.actor_id),['actor:B']);
  assert.equal(surface.community_discovery.algorithm_ref,'trellis-discovery:community-graph:v1');
  assert.deepEqual(surface.community_discovery.candidates.map(x=>x.community_id),['community:C2']);
  assert.equal(surface.execution_authority.implied_by_discovery_read,false);
  assert.equal(surface.projection_version,'discovery-surface:0.1');
  assert.ok(surface.snapshot_ref);
});

test('representative viewer computes discovery for represented subject rather than itself',()=>{
  const {db,store}=setupDiscoverySystem();
  const surface=buildDiscoverySurface({ subjectActorId:'actor:A', viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']}, db, eventStore:store });
  assert.equal(surface.subject_actor_id,'actor:A');
  assert.equal(surface.viewer_scope,'representative');
  assert.deepEqual(surface.actor_discovery.candidates.map(x=>x.actor_id),['actor:B']);
});

test('HTML and JSON render the same filtered Discovery surface without hidden ids',()=>{
  const {db,store}=setupDiscoverySystem({candidateName:'<script>alert(1)</script>'});
  const surface=buildDiscoverySurface({ subjectActorId:'actor:A', viewerContext:{viewer_actor_id:'actor:A'}, db, eventStore:store });
  const json=renderDiscoveryJson(surface);
  const html=renderDiscoveryHtml(surface);
  assert.deepEqual(JSON.parse(json),surface);
  assert.match(html,/Related Actors/);
  assert.match(html,/Related Communities/);
  assert.equal(html.includes('<script>alert(1)</script>'),false);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(json.includes('actor:Y'),false);
  assert.equal(html.includes('actor:Y'),false);
  assert.doesNotMatch(html,/trusted|safe recommendation/i);
});

test('Discovery renderers are presentation-only and do not import storage or EventStore',()=>{
  for(const file of ['render-html.js','render-json.js']){
    const source=fs.readFileSync(path.join(__dirname,'..','discovery',file),'utf8');
    assert.doesNotMatch(source,/sqlite|event-store|SQLiteEventStore|canonical_events/);
  }
});
