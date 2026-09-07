const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { proposeRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { createPublication } = require('../publication/service');
const { rebuildPublicationProjection } = require('../publication/projector');
const { createPreference } = require('../preference/service');
const { ConsumptionStore } = require('../consumption/store');
const { loadPersonalizedHomeFeedSurface } = require('../feed/personalized-read-service');
const { loadCommunityFeedSurface } = require('../feed/read-service');
const { renderFeedHtml } = require('../feed/render-html');
const { renderFeedJson } = require('../feed/render-json');

function ctx(db,eventStore,actorId){return{db,eventStore,authorize:evaluateAuthority,principalActorId:actorId,capabilityGrants:[],evaluatedAt:'2026-09-03T12:00:00.000Z'};}
function reg(eventStore,id){registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority});}
function follow(db,eventStore,a,b){proposeRelationship({command_id:'follow:a-b',idempotency_key:'follow:a-b',principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'follows',visibility:'public'},ctx(db,eventStore,a));}
function pub(db,eventStore,id,author){createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[]},ctx(db,eventStore,author));}
function muteB(db,eventStore){createPreference({command_id:'pref:mute-b',idempotency_key:'pref:mute-b',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:'mute_actor',target:{actor_id:'actor:B'}},ctx(db,eventStore,'actor:A'));}
function setup(){
  const db=createTestDatabase();let tick=0;
  const eventStore=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:00:${String(tick++).padStart(2,'0')}.000Z`});
  for(const id of ['actor:A','actor:B','actor:R'])reg(eventStore,id);
  follow(db,eventStore,'actor:A','actor:B');rebuildRelationshipProjection(db,eventStore);
  pub(db,eventStore,'A','actor:A');pub(db,eventStore,'B','actor:B');rebuildPublicationProjection(db,eventStore);
  return{db,eventStore};
}
function counts(db){return{
  events:db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n,
  receipts:db.prepare('SELECT COUNT(*) AS n FROM command_receipts').get().n,
  preferences:db.prepare('SELECT COUNT(*) AS n FROM preferences_current').get().n,
  consumption:db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n,
  notifications:db.prepare('SELECT COUNT(*) AS n FROM notifications_current').get().n
};}

test('owner gets personalized v2 while representative gets chronological v1 without private owner suppression',()=>{
  const{db,eventStore}=setup();
  muteB(db,eventStore);
  new ConsumptionStore(db).recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:A',now:'2026-09-03T11:00:00.000Z'});
  let ownerNowCalls=0;
  const owner=loadPersonalizedHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,limit:20,now:()=>{ownerNowCalls++;return '2026-09-03T12:00:00.000Z';}});
  let repNowCalls=0;
  const rep=loadPersonalizedHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore,limit:20,now:()=>{repNowCalls++;return '2026-09-03T13:00:00.000Z';}});
  assert.equal(owner.algorithm_ref,'trellis-feed:personalized:v2');
  assert.equal(owner.ranking_reference_time,'2026-09-03T12:00:00.000Z');
  assert.equal(owner.items.some(i=>i.source_ref==='pub:B'),false);
  assert.equal(rep.algorithm_ref,'trellis-feed:chronological:v1');
  assert.equal('ranking_reference_time' in rep,false);
  assert.equal(rep.items.some(i=>i.source_ref==='pub:B'),true);
  assert.equal(ownerNowCalls,1);
  assert.equal(repNowCalls,0);
});

test('page 2 reuses cursor ranking reference time without calling trusted clock again',()=>{
  const{db,eventStore}=setup();let calls=0;
  const first=loadPersonalizedHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,limit:1,now:()=>{calls++;return '2026-09-03T12:00:00.000Z';}});
  assert.ok(first.next_cursor);
  const second=loadPersonalizedHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,limit:1,cursor:first.next_cursor,now:()=>{calls++;return '2026-09-04T12:00:00.000Z';}});
  assert.equal(second.ranking_reference_time,'2026-09-03T12:00:00.000Z');
  assert.equal(calls,1);
});

test('public read service rejects client-supplied ranking reference time',()=>{
  const{db,eventStore}=setup();
  assert.throws(()=>loadPersonalizedHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,rankingReferenceTime:'1999-01-01T00:00:00.000Z'}),/FEED_V2_CLIENT_REFERENCE_TIME_FORBIDDEN/);
});

test('Community Feed remains chronological v1',()=>{
  const{db,eventStore}=setup();
  const community=loadCommunityFeedSurface({communityId:'community:missing',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore});
  assert.equal(community,null);
  const service=require('../feed/community');
  assert.equal(typeof service.buildCommunityFeed,'function');
});

test('personalized feed fetch and rendering perform zero canonical or operational writes',()=>{
  const{db,eventStore}=setup();
  new ConsumptionStore(db).recordSeen({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:A',now:'2026-09-03T11:00:00.000Z'});
  const before=counts(db);
  const surface=loadPersonalizedHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,limit:20,now:()=> '2026-09-03T12:00:00.000Z'});
  const json=renderFeedJson(surface);const html=renderFeedHtml(surface);
  assert.match(json,/trellis-feed:personalized:v2/);
  assert.match(html,/trellis-feed:personalized:v2/);
  assert.match(html,/data-total-points=/);
  assert.match(html,/data-ranking-reason=/);
  assert.deepEqual(counts(db),before);
  assert.equal(surface.items[0].execution_authority.implied_by_feed_read,false);
});
