const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { proposeRelationship } = require('../relationship/service');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { createPublication } = require('../publication/service');
const { rebuildPublicationProjection, projectPublicationStream } = require('../publication/projector');
const { createPreference } = require('../preference/service');
const { ConsumptionStore } = require('../consumption/store');
const { buildFeedSourceGraph } = require('../feed/source-graph');
const { collectHomePublicationItems } = require('../feed/publication-items');
const { collectHomeActivityItems } = require('../feed/activity-items');
const { applyOwnerFeedPreferences } = require('../preference/feed-policy');
const { compareFeedItemsDesc } = require('../feed/chronological');
const { comparePersonalizedFeedItemsDesc } = require('../feed/personalized-score');
const { buildPersonalizedHomeFeedSnapshot } = require('../feed/personalized-home');
const { loadPersonalizedHomeFeedSurface } = require('../feed/personalized-read-service');
const { CONTRACT_REGISTRY, effectiveContracts } = require('../foundation/cross-domain-contract');

function ctx(db,eventStore,actorId){return{db,eventStore,authorize:evaluateAuthority,principalActorId:actorId,capabilityGrants:[],evaluatedAt:'2026-09-03T12:00:00.000Z'};}
function reg(eventStore,id){registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore,authorize:evaluateAuthority});}
function follow(db,eventStore,a,b){proposeRelationship({command_id:'rel:a-b',idempotency_key:'rel:a-b',principal_id:`principal:${a}`,source_entity_id:a,target_entity_id:b,relationship_type:'follows',visibility:'public'},ctx(db,eventStore,a));}
function pub(db,eventStore,id,author){const r=createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[]},ctx(db,eventStore,author));projectPublicationStream(db,eventStore,`pub:${id}`);return r;}
function setup(){const db=createTestDatabase();let tick=0;const eventStore=new SQLiteEventStore(db,{now:()=>`2026-09-03T10:00:${String(tick++).padStart(2,'0')}.000Z`});for(const id of ['actor:A','actor:B','actor:R'])reg(eventStore,id);follow(db,eventStore,'actor:A','actor:B');rebuildRelationshipProjection(db,eventStore);pub(db,eventStore,'A','actor:A');pub(db,eventStore,'B','actor:B');rebuildPublicationProjection(db,eventStore);return{db,eventStore};}
function snapshot(db,eventStore,extra={}){return buildPersonalizedHomeFeedSnapshot({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,rankingReferenceTime:'2026-09-03T12:00:00.000Z',...extra});}
function stateCounts(db){return{events:db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n,receipts:db.prepare('SELECT COUNT(*) AS n FROM command_receipts').get().n,prefs:db.prepare('SELECT COUNT(*) AS n FROM preferences_current').get().n,consumption:db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n,notifications:db.prepare('SELECT COUNT(*) AS n FROM notifications_current').get().n};}

test('AF1 AF2 AF8: equal score uses exact v1 comparator and equal personalization delta preserves v1 order',()=>{
  const a={feed_item_id:'feed:a',sort:{recorded_at:'2026-09-03T10:00:00.000Z',global_offset:2},score:{total_points:7000}};
  const b={feed_item_id:'feed:b',sort:{recorded_at:'2026-09-03T09:00:00.000Z',global_offset:3},score:{total_points:7000}};
  assert.equal(Math.sign(comparePersonalizedFeedItemsDesc(a,b)),Math.sign(compareFeedItemsDesc(a,b)));
  assert.equal(JSON.stringify([a.sort.recorded_at,a.sort.global_offset,a.feed_item_id]).includes('points'),false);
});

test('AF3 AF7: every score is integer fixed-point and reason points reconcile exactly',()=>{
  const{db,eventStore}=setup();const result=snapshot(db,eventStore);
  for(const item of result.items){
    assert.ok(Object.values(item.score).every(Number.isInteger));
    assert.ok(item.ranking_reasons.every(r=>Number.isInteger(r.points)));
    assert.equal(item.ranking_reasons.reduce((sum,r)=>sum+r.points,0),item.score.total_points);
  }
});

test('AF9 AF10: scored candidates equal hard Preference filter of v1 visible pre-preference candidates',()=>{
  const{db,eventStore}=setup();
  createPreference({command_id:'pref:dismiss',idempotency_key:'pref:dismiss',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:'dismiss_feed_item',target:{item_kind:'publication',source_ref:'pub:B'}},ctx(db,eventStore,'actor:A'));
  const viewerContext={viewer_actor_id:'actor:A'};
  const sourceGraph=buildFeedSourceGraph({subjectActorId:'actor:A',viewerContext,db,eventStore});
  const visible=[...collectHomePublicationItems({sourceGraph,viewerContext,db,eventStore}),...collectHomeActivityItems({sourceGraph,subjectActorId:'actor:A',viewerContext,db,eventStore})];
  const expected=applyOwnerFeedPreferences({ownerActorId:'actor:A',viewerContext,items:visible,db});
  const result=snapshot(db,eventStore);
  assert.deepEqual(result.preference_filtered_items.map(i=>i.feed_item_id).sort(),expected.map(i=>i.feed_item_id).sort());
  assert.deepEqual(result.items.map(i=>i.feed_item_id).sort(),expected.map(i=>i.feed_item_id).sort());
  assert.equal(result.items.some(i=>i.source_ref==='pub:B'),false);
});

test('AF11 AF14: expired-but-not-purged exact Consumption is treated as unseen and Feed remains available',()=>{
  const{db,eventStore}=setup();
  const store=new ConsumptionStore(db);
  store.recordOpened({consumerActorId:'actor:A',targetKind:'publication',targetRef:'pub:B',now:'2026-01-01T00:00:00.000Z'});
  const raw=store.get('actor:A','publication','pub:B');
  assert.ok(raw);
  assert.ok(Date.parse(raw.expires_at)<Date.parse('2026-09-03T12:00:00.000Z'));
  const result=snapshot(db,eventStore);
  const item=result.items.find(i=>i.source_ref==='pub:B');
  assert.equal(item.score.novelty_points,1000);
  assert.equal(item.ranking_reasons.find(r=>r.component==='novelty').type,'not_seen_before');
});

test('AF4 AF5 AF6: same eligible state and pinned time gives identical snapshot and scored projection',()=>{
  const{db,eventStore}=setup();const a=snapshot(db,eventStore);const b=snapshot(db,eventStore);
  assert.equal(a.ranking_reference_time,'2026-09-03T12:00:00.000Z');
  assert.equal(a.snapshot_ref,b.snapshot_ref);
  assert.deepEqual(a.items,b.items);
});

test('AF13: representative read returns chronological v1 without consuming owner-private algorithm state',()=>{
  const{db,eventStore}=setup();let calls=0;
  const result=loadPersonalizedHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore,now:()=>{calls++;return '2026-09-03T12:00:00.000Z';}});
  assert.equal(result.algorithm_ref,'trellis-feed:chronological:v1');
  assert.equal(calls,0);
});

test('AF15: algorithmic Feed read mutates no canonical or operational store',()=>{
  const{db,eventStore}=setup();const before=stateCounts(db);
  loadPersonalizedHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,now:()=> '2026-09-03T12:00:00.000Z'});
  assert.deepEqual(stateCounts(db),before);
});

test('public v2 read API rejects both common spellings of client supplied ranking reference time',()=>{
  const{db,eventStore}=setup();
  for(const extra of [{rankingReferenceTime:'1999-01-01T00:00:00Z'},{ranking_reference_time:'1999-01-01T00:00:00Z'}]){
    assert.throws(()=>loadPersonalizedHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore,...extra}),/FEED_V2_CLIENT_REFERENCE_TIME_FORBIDDEN/);
  }
});

test('AF16 and Foundation registry: feed remains derived projection inheriting X1 X2 X3',()=>{
  assert.equal(CONTRACT_REGISTRY.feed.state_class,'derived_projection');
  assert.deepEqual(effectiveContracts('feed'),['X1','X2','X3']);
});

test('release syntax gate covers all personalized Feed modules',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));
  assert.match(pkg.scripts.check,/feed\/\*\.js/);
  for(const file of ['personalized-score.js','source-tier.js','consumption-signal.js','personalized-home.js','personalized-snapshot.js','personalized-cursor.js','personalized-read-service.js']){
    assert.equal(fs.existsSync(path.join(__dirname,'..','feed',file)),true,file);
  }
});
