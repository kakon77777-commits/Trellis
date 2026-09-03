const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createCommunity}=require('../community/service');
const {requestMembership,approveMembership}=require('../community/membership');
const {proposeRelationship,activateRelationship}=require('../relationship/service');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {loadPublicationSurface}=require('../publication/read-service');
const {buildHomeFeed}=require('../feed/home');
const {buildCommunityFeed}=require('../feed/community');
const {createPreference,withdrawPreference,restorePreference}=require('../preference/service');

function ctx(db,store,actor,extra={}){return{db,eventStore:store,principalActorId:actor,evaluatedAt:'2026-09-03T15:00:00Z',authorize:evaluateAuthority,...extra};}
function reg(store,id){registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore:store,authorize:evaluateAuthority});}
function follow(db,store,source,target,id){return proposeRelationship({command_id:`follow:${id}`,idempotency_key:`follow:${id}`,principal_id:`principal:${source}`,source_entity_id:source,target_entity_id:target,relationship_type:'follows',visibility:'public'},ctx(db,store,source)).relationship_id;}
function collab(db,store,a,b,id,scope_ref=null){const rel=proposeRelationship({command_id:`collab:${id}`,idempotency_key:`collab:${id}`,principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'collaborates_with',visibility:'public',...(scope_ref?{scope_ref}:{})},ctx(db,store,a)).relationship_id;activateRelationship({command_id:`collab:${id}:act`,idempotency_key:`collab:${id}:act`,principal_id:`principal:${b}`,relationship_id:rel,expected_version:1},ctx(db,store,b));return rel;}
function publication(db,store,id,author,extra={}){createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:id,author_actor_id:author,publication_type:'post',body:`body ${id}`,visibility:'public',audience_actor_ids:[],...extra},ctx(db,store,author,extra.context??{}));projectPublicationStream(db,store,id);}
function join(db,store,actor,community,id){const pending=requestMembership({command_id:`join:${id}`,idempotency_key:`join:${id}`,principal_id:`principal:${actor}`,actor_id:actor,community_id:community},ctx(db,store,actor));approveMembership({command_id:`approve:${id}`,idempotency_key:`approve:${id}`,principal_id:`principal:${community}`,community_id:community,relationship_id:pending.relationship_id,expected_version:1},ctx(db,store,community));return pending.relationship_id;}
function pref(id,type,target){return{command_id:`pref:${id}`,idempotency_key:`pref:${id}`,principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:type,target};}
function setup(){
  const db=createTestDatabase();const store=new SQLiteEventStore(db,{now:()=> '2026-09-03T15:00:01Z'});
  for(const id of ['actor:A','actor:B','actor:X','actor:R']) reg(store,id);
  follow(db,store,'actor:A','actor:B','ab');follow(db,store,'actor:A','actor:X','ax');collab(db,store,'actor:B','actor:X','bx');
  publication(db,store,'pub:B','actor:B');publication(db,store,'pub:X','actor:X');publication(db,store,'pub:A','actor:A');
  rebuildRelationshipProjection(db,store);
  return{db,store};
}
function home(db,store,viewer={viewer_actor_id:'actor:A'}){return buildHomeFeed({subjectActorId:'actor:A',viewerContext:viewer,db,eventStore:store});}
function ids(feed){return feed.items.map(i=>i.feed_item_id);}

test('bookmark does not change Feed items order or snapshot',()=>{
  const {db,store}=setup();const before=home(db,store);
  createPreference(pref('bookmark','bookmark_publication',{publication_id:'pub:B'}),ctx(db,store,'actor:A'));
  const after=home(db,store);assert.deepEqual(after,before);
});

test('dismiss exact social activity suppresses only that stable Feed item before snapshot',()=>{
  const {db,store}=setup();const before=home(db,store);
  const activity=before.items.find(i=>i.item_type==='social_activity'&&i.activity.type==='collaboration_started');
  assert.ok(activity);
  createPreference(pref('dismiss','dismiss_feed_item',{item_kind:'social_activity',source_ref:activity.source_event_ref}),ctx(db,store,'actor:A'));
  const after=home(db,store);
  assert.equal(ids(after).includes(activity.feed_item_id),false);
  assert.equal(ids(after).includes('feed:publication:pub:B'),true);
  assert.notEqual(after.snapshot_ref,before.snapshot_ref);
});

test('not interested suppresses exact Publication Feed item but not direct Publication access',()=>{
  const {db,store}=setup();
  createPreference(pref('ni','not_interested_publication',{publication_id:'pub:X'}),ctx(db,store,'actor:A'));
  const feed=home(db,store);
  assert.equal(ids(feed).includes('feed:publication:pub:X'),false);
  assert.ok(loadPublicationSurface({publicationId:'pub:X',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store}));
  assert.equal(ids(feed).includes('feed:publication:pub:B'),true);
});

test('mute actor suppresses actor-authored publication and activities involving actor; withdraw/restore reverses same directive',()=>{
  const {db,store}=setup();
  const mute=createPreference(pref('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  let feed=home(db,store);
  assert.equal(ids(feed).includes('feed:publication:pub:B'),false);
  assert.equal(feed.items.some(i=>i.item_type==='social_activity'&&(i.activity.source_actor_id==='actor:B'||i.activity.target_actor_id==='actor:B')),false);
  assert.equal(ids(feed).includes('feed:publication:pub:X'),true);
  withdrawPreference({command_id:'pref:mute:w',idempotency_key:'pref:mute:w',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:mute.preference_id,expected_version:1},ctx(db,store,'actor:A'));
  feed=home(db,store);assert.equal(ids(feed).includes('feed:publication:pub:B'),true);
  restorePreference({command_id:'pref:mute:r',idempotency_key:'pref:mute:r',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:mute.preference_id,expected_version:2},ctx(db,store,'actor:A'));
  feed=home(db,store);assert.equal(ids(feed).includes('feed:publication:pub:B'),false);
});

test('representative reading subject Feed does not receive subject owner-private suppression',()=>{
  const {db,store}=setup();
  createPreference(pref('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  const owner=home(db,store,{viewer_actor_id:'actor:A'});
  const representative=home(db,store,{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']});
  assert.equal(ids(owner).includes('feed:publication:pub:B'),false);
  assert.equal(ids(representative).includes('feed:publication:pub:B'),true);
});

test('mute actor also suppresses same actor in owner Community Feed without changing Community source state',()=>{
  const {db,store}=setup();
  createCommunity({command_id:'community:C',idempotency_key:'community:C',principal_id:'principal:community:C',community_id:'community:C'},{eventStore:store,authorize:evaluateAuthority});
  join(db,store,'actor:A','community:C','a-c');join(db,store,'actor:B','community:C','b-c');
  collab(db,store,'actor:B','actor:A','ba-c','community:C');
  rebuildRelationshipProjection(db,store);
  publication(db,store,'pub:CB','actor:B',{scope_ref:'community:C',visibility:'scope_members',context:{capabilityGrants:[{active:true,principal_id:'principal:actor:B',capability:'publication:create',scope_ref:'community:C'}]}});
  createPreference(pref('mute-community','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  const feed=buildCommunityFeed({communityId:'community:C',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});
  assert.equal(ids(feed).includes('feed:publication:pub:CB'),false);
  assert.equal(feed.items.some(i=>i.item_type==='social_activity'&&JSON.stringify(i.activity).includes('actor:B')),false);
  assert.equal(store.readStream('publication','pub:CB').length,1);
});
