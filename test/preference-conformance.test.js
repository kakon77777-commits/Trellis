const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {proposeRelationship}=require('../relationship/service');
const {rebuildRelationshipProjection}=require('../projections/relationship-projector');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {loadPublicationSurface}=require('../publication/read-service');
const {createReaction}=require('../reaction/service');
const {processSourceEvent}=require('../notification/service');
const {loadNotificationInboxSurface}=require('../notification/read-service');
const {buildHomeFeed}=require('../feed/home');
const {buildDiscoverySurface}=require('../discovery/read-service');
const {createPreference,withdrawPreference,restorePreference}=require('../preference/service');
const {loadPreferenceSurface}=require('../preference/read-service');
const {derivePreferenceId,PREFERENCE_POLICY_REF,normalizePreferenceTarget}=require('../preference/types');
const {foldPreference}=require('../preference/fold');
const {rebuildPreferenceProjection}=require('../preference/projector');

function ctx(db,store,a,extra={}){return{db,eventStore:store,authorize:evaluateAuthority,principalActorId:a,evaluatedAt:'2026-09-03T18:00:00Z',capabilityGrants:[],...extra};}
function pctx(db,store){return{db,eventStore:store,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T18:01:00Z'};}
function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function pub(db,store,id,a){const r=createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${a}`,publication_id:id,author_actor_id:a,publication_type:'post',body:`body:${id}`,visibility:'public',audience_actor_ids:[]},ctx(db,store,a));projectPublicationStream(db,store,id);return r;}
function pref(id,type,target){return{command_id:`pref:${id}`,idempotency_key:`pref:${id}`,principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:type,target};}
function setup(){
  const db=createTestDatabase();let tick=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T18:00:${String(tick++).padStart(2,'0')}Z`});
  for(const a of ['actor:A','actor:B','actor:X','actor:R'])reg(store,a);
  proposeRelationship({command_id:'follow:B',idempotency_key:'follow:B',principal_id:'principal:actor:A',source_entity_id:'actor:A',target_entity_id:'actor:B',relationship_type:'follows',visibility:'public'},ctx(db,store,'actor:A'));
  proposeRelationship({command_id:'follow:X',idempotency_key:'follow:X',principal_id:'principal:actor:A',source_entity_id:'actor:A',target_entity_id:'actor:X',relationship_type:'follows',visibility:'public'},ctx(db,store,'actor:A'));
  rebuildRelationshipProjection(db,store);
  pub(db,store,'pub:A','actor:A');pub(db,store,'pub:B','actor:B');pub(db,store,'pub:X','actor:X');
  return{db,store};
}
function event(event_type,stream_seq,payload={}){return{event_id:`evt:${stream_seq}`,event_type,stream_seq,payload};}

test('Q2 aggregate identity includes immutable preference_id in fold enforcement',()=>{
  const target={publication_id:'pub:P'};const pid=derivePreferenceId('actor:A','bookmark_publication',target);const normalized=normalizePreferenceTarget('bookmark_publication',target);
  const created=event('preference.created',1,{preference_id:pid,owner_actor_id:'actor:A',preference_type:'bookmark_publication',...normalized,preference_policy_ref:PREFERENCE_POLICY_REF});
  assert.throws(()=>foldPreference([created,event('preference.withdrawn',2,{preference_id:'preference:other'})]),/PREFERENCE_IMMUTABLE_FIELD_CHANGED:preference_id/);
});

test('Q1-Q13 vertical slice preserves source truth while owner projection is controlled',()=>{
  const {db,store}=setup();
  const feedArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store};
  const discoveryArgs={subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store};
  const discoveryBefore=buildDiscoverySurface(discoveryArgs);
  const baseFeed=buildHomeFeed(feedArgs);assert.ok(baseFeed.items.some(i=>i.feed_item_id==='feed:publication:pub:B'));assert.ok(baseFeed.items.some(i=>i.feed_item_id==='feed:publication:pub:X'));

  const bookmark=createPreference(pref('bookmark','bookmark_publication',{publication_id:'pub:B'}),ctx(db,store,'actor:A'));
  assert.deepEqual(buildHomeFeed(feedArgs),baseFeed,'Q7 bookmark must not rank/filter Feed');

  createPreference(pref('ni','not_interested_publication',{publication_id:'pub:X'}),ctx(db,store,'actor:A'));
  let feed=buildHomeFeed(feedArgs);assert.equal(feed.items.some(i=>i.feed_item_id==='feed:publication:pub:X'),false);assert.ok(loadPublicationSurface({publicationId:'pub:X',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store}));
  assert.deepEqual(buildDiscoverySurface(discoveryArgs),discoveryBefore,'Q6 not-interested must not become Discovery affinity');

  const rx=createReaction({command_id:'rx:B',idempotency_key:'rx:B',principal_id:'principal:actor:B',actor_id:'actor:B',publication_id:'pub:A',reaction_type:'like'},ctx(db,store,'actor:B'));
  const notification=processSourceEvent({eventId:rx.receipt.result_event_ids[0],commandId:'notify:B',idempotencyKey:'notify:B'},pctx(db,store));
  assert.equal(loadNotificationInboxSurface({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store}).items.length,1);

  const sourceCountsBefore=Object.fromEntries(db.prepare(`SELECT stream_type,COUNT(*) AS n FROM canonical_events WHERE stream_type!='preference' GROUP BY stream_type ORDER BY stream_type`).all().map(r=>[r.stream_type,r.n]));
  const mute=createPreference(pref('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  feed=buildHomeFeed(feedArgs);assert.equal(feed.items.some(i=>i.feed_item_id==='feed:publication:pub:B'),false);
  const ownerInbox=loadNotificationInboxSurface({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});assert.equal(ownerInbox.items.length,0);assert.equal(ownerInbox.unread_count,0);
  const sourceCountsAfter=Object.fromEntries(db.prepare(`SELECT stream_type,COUNT(*) AS n FROM canonical_events WHERE stream_type!='preference' GROUP BY stream_type ORDER BY stream_type`).all().map(r=>[r.stream_type,r.n]));assert.deepEqual(sourceCountsAfter,sourceCountsBefore,'Q11 preference mutated source histories');
  assert.equal(store.readStream('notification',notification.notification_id).length,1);assert.ok(loadPublicationSurface({publicationId:'pub:B',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store}));

  assert.throws(()=>loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore:store}),/PREFERENCE_NOT_AUTHORIZED/);
  const repFeed=buildHomeFeed({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore:store});assert.equal(repFeed.items.some(i=>i.feed_item_id==='feed:publication:pub:B'),true);
  const repInbox=loadNotificationInboxSurface({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']},db,eventStore:store});assert.equal(repInbox.items.length,1);

  withdrawPreference({command_id:'pref:mute:w',idempotency_key:'pref:mute:w',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:mute.preference_id,expected_version:1},ctx(db,store,'actor:A'));
  assert.equal(buildHomeFeed(feedArgs).items.some(i=>i.feed_item_id==='feed:publication:pub:B'),true);
  restorePreference({command_id:'pref:mute:r',idempotency_key:'pref:mute:r',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:mute.preference_id,expected_version:2},ctx(db,store,'actor:A'));
  assert.equal(buildHomeFeed(feedArgs).items.some(i=>i.feed_item_id==='feed:publication:pub:B'),false);
  assert.equal(derivePreferenceId('actor:A','mute_actor',{actor_id:'actor:B'}),mute.preference_id);
  assert.equal(store.verifyHashChain('preference',mute.preference_id).ok,true);
  assert.equal(store.verifyHashChain('preference',bookmark.preference_id).ok,true);
});

test('Preference projection is destructively rebuildable and raw owner surface contains no visibility field',()=>{
  const {db,store}=setup();createPreference(pref('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  const surface=loadPreferenceSurface({ownerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store});assert.equal(surface.preferences.every(p=>!Object.hasOwn(p,'visibility')&&!Object.hasOwn(p,'scope_ref')&&!Object.hasOwn(p,'audience_actor_ids')),true);
  const before=db.prepare('SELECT * FROM preferences_current ORDER BY preference_id').all();db.exec('DELETE FROM preferences_current');rebuildPreferenceProjection(db,store);assert.deepEqual(db.prepare('SELECT * FROM preferences_current ORDER BY preference_id').all(),before);
});

test('Q1/Q8/Q12 negative API surface has no block, relationship mutation, ranking, or consumption command',()=>{
  const service=require('../preference/service');
  assert.deepEqual(Object.keys(service).sort(),['createPreference','restorePreference','withdrawPreference']);
  const source=fs.readFileSync(require.resolve('../preference/service'),'utf8');
  for(const forbidden of ['blockActor','unfollow','relationship.terminate','seen','dwell','scroll_depth']) assert.equal(source.includes(forbidden),false,forbidden);
});

test('release syntax gate explicitly covers preference modules',()=>{
  const pkg=require('../package.json');assert.match(pkg.scripts.check,/preference\/\*\.js/);
});
