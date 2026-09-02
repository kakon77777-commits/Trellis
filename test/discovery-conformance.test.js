const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const packageJson=require('../package.json');
const { setupDiscoverySystem, follow, createCommunityWithMetadata, join }=require('./helpers/discovery-system');
const { buildDiscoverySurface }=require('../discovery/read-service');
const { buildDiscoverySnapshot }=require('../discovery/visible-graph');
const { discoverActors }=require('../discovery/actor-discovery');
const { discoverCommunities }=require('../discovery/community-discovery');
const { rebuildRelationshipProjection }=require('../projections/relationship-projector');
const { rebuildActorProfileProjection }=require('../profile/projector');

function canonicalEventCount(db){return db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;}
function relationshipIds(snapshot){return new Set(snapshot.relationships.map(r=>r.relationship_id));}

function assertReasonsVisible(snapshot,actorCandidates,communityCandidates){
  const relIds=relationshipIds(snapshot);
  for(const candidate of actorCandidates){
    for(const reason of candidate.reasons){
      if(reason.actor_id) assert.ok(snapshot.actors[reason.actor_id],`hidden actor reason ${reason.actor_id}`);
      if(reason.via_actor_id) assert.ok(snapshot.actors[reason.via_actor_id],`hidden via actor ${reason.via_actor_id}`);
      if(reason.community_id) assert.ok(snapshot.communities[reason.community_id],`hidden community reason ${reason.community_id}`);
      if(reason.subject_relationship_id) assert.ok(relIds.has(reason.subject_relationship_id));
      if(reason.candidate_relationship_id) assert.ok(relIds.has(reason.candidate_relationship_id));
    }
  }
  for(const candidate of communityCandidates){
    for(const reason of candidate.reasons){
      if(reason.actor_id) assert.ok(snapshot.actors[reason.actor_id],`hidden actor reason ${reason.actor_id}`);
      if(reason.via_actor_id) assert.ok(snapshot.actors[reason.via_actor_id],`hidden via actor ${reason.via_actor_id}`);
      if(reason.subject_relationship_id) assert.ok(relIds.has(reason.subject_relationship_id));
      if(reason.membership_relationship_id) assert.ok(relIds.has(reason.membership_relationship_id));
      for(const communityId of reason.subject_community_ids??[]) assert.ok(snapshot.communities[communityId]);
    }
  }
}

test('D1-D12 vertical slice is derived deterministic explainable and authority-separated',()=>{
  const {db,store}=setupDiscoverySystem();
  const eventCountBefore=canonicalEventCount(db);
  const viewer={viewer_actor_id:'actor:A'};
  const before=buildDiscoverySurface({subjectActorId:'actor:A',viewerContext:viewer,db,eventStore:store});
  const eventCountAfter=canonicalEventCount(db);

  assert.equal(eventCountAfter,eventCountBefore,'Discovery read mutated canonical history');
  assert.deepEqual(before.actor_discovery.candidates.map(x=>x.actor_id),['actor:B']);
  assert.deepEqual(before.community_discovery.candidates.map(x=>x.community_id),['community:C2']);
  assert.equal(JSON.stringify(before).includes('actor:Y'),false);
  assert.equal(JSON.stringify(before).includes('community:Cprivate'),false);
  assert.equal(before.execution_authority.implied_by_discovery_read,false);

  const snapshot=buildDiscoverySnapshot({subjectActorId:'actor:A',viewerContext:viewer,db,eventStore:store});
  assertReasonsVisible(snapshot,discoverActors(snapshot),discoverCommunities(snapshot));

  const representative=buildDiscoverySurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore:store});
  assert.equal(representative.subject_actor_id,'actor:A');
  assert.equal(representative.viewer_scope,'representative');
  assert.deepEqual(representative.actor_discovery.candidates.map(x=>x.actor_id),['actor:B']);
});

test('hidden Trellis facts have zero Discovery influence including snapshot ref',()=>{
  const {db,store}=setupDiscoverySystem();
  const viewer={viewer_actor_id:'actor:A'};
  const before=buildDiscoverySurface({subjectActorId:'actor:A',viewerContext:viewer,db,eventStore:store});

  follow(store,'actor:B','actor:Y','hidden-by','participants');
  createCommunityWithMetadata(store,'community:Chidden','private','Hidden Community');
  join(store,'actor:Y','community:Chidden','y-hidden-community');
  rebuildRelationshipProjection(db,store);

  const after=buildDiscoverySurface({subjectActorId:'actor:A',viewerContext:viewer,db,eventStore:store});
  assert.deepEqual(after,before);
});

test('Discovery recomputes identically after disposable projection destruction and rebuild',()=>{
  const {db,store}=setupDiscoverySystem();
  const args={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store};
  const before=buildDiscoverySurface(args);

  db.exec('DELETE FROM relationships_current; DELETE FROM actor_profile_assertions_current; DELETE FROM actor_profile_current;');
  rebuildRelationshipProjection(db,store);
  rebuildActorProfileProjection(db,store);

  const after=buildDiscoverySurface(args);
  const again=buildDiscoverySurface(args);
  assert.deepEqual(after,before);
  assert.deepEqual(again,after);
});

test('runtime or model metadata is not an Actor affinity scoring input',()=>{
  const {db,store}=setupDiscoverySystem();
  const snapshot=buildDiscoverySnapshot({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});
  const before=discoverActors(snapshot).map(x=>({actor_id:x.actor_id,score:x.score,reasons:x.reasons}));
  const modified=structuredClone(snapshot);
  modified.actors['actor:B'].profile.runtime_bindings=[{runtime_id:'runtime:other',model:'different-model',provider:'different-provider'}];
  const after=discoverActors(modified).map(x=>({actor_id:x.actor_id,score:x.score,reasons:x.reasons}));
  assert.deepEqual(after,before);
});

test('Discovery production modules expose no canonical social mutation shortcut',()=>{
  const discoveryDir=path.join(__dirname,'..','discovery');
  const files=fs.readdirSync(discoveryDir).filter(file=>file.endsWith('.js'));
  const exported=new Set();
  let source='';
  for(const file of files){
    const modulePath=path.join(discoveryDir,file);
    source+=fs.readFileSync(modulePath,'utf8');
    for(const name of Object.keys(require(modulePath))) exported.add(name);
  }
  for(const forbidden of ['append','proposeRelationship','activateRelationship','requestMembership','approveMembership','autoFollow','autoJoin','grantAuthority','promoteAiBoardCandidate']){
    assert.equal(exported.has(forbidden),false,`forbidden Discovery API exported: ${forbidden}`);
  }
  assert.doesNotMatch(source,/require\(['"]\.\.\/relationship\/service['"]\)/);
  assert.doesNotMatch(source,/require\(['"]\.\.\/community\/membership['"]\)/);
});

test('syntax release gate includes every Discovery module',()=>{
  assert.match(packageJson.scripts.check,/discovery\/\*\.js/);
});
