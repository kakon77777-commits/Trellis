const test=require('node:test');
const assert=require('node:assert/strict');
const {createTestDatabase}=require('./helpers/test-db');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {evaluateAuthority}=require('../authority/policy');
const {registerActor}=require('../entity/service');
const {createPublication}=require('../publication/service');
const {projectPublicationStream}=require('../publication/projector');
const {createReaction}=require('../reaction/service');
const {processSourceEvent,acknowledgeNotification}=require('../notification/service');
const {buildNotificationInbox,loadNotificationInboxSurface}=require('../notification/read-service');
const {createPreference,withdrawPreference,restorePreference}=require('../preference/service');

function reg(store,a){registerActor({command_id:`reg:${a}`,idempotency_key:`reg:${a}`,principal_id:`principal:${a}`,entity_id:a},{eventStore:store,authorize:evaluateAuthority});}
function ctx(db,store,a,extra={}){return{db,eventStore:store,authorize:evaluateAuthority,principalActorId:a,evaluatedAt:'2026-09-03T16:00:00Z',capabilityGrants:[],...extra};}
function pctx(db,store){return{db,eventStore:store,principalId:'principal:notification-processor',capabilityGrants:[{active:true,principal_id:'principal:notification-processor',capability:'notification:issue',scope_ref:null}],evaluatedAt:'2026-09-03T16:01:00Z'};}
function setup(){
  const db=createTestDatabase();let tick=0;const store=new SQLiteEventStore(db,{now:()=>`2026-09-03T16:00:${String(tick++).padStart(2,'0')}Z`});
  for(const a of ['actor:A','actor:B','actor:C','actor:R'])reg(store,a);
  createPublication({command_id:'pub:P',idempotency_key:'pub:P',principal_id:'principal:actor:A',publication_id:'pub:P',author_actor_id:'actor:A',publication_type:'post',body:'p',visibility:'public',audience_actor_ids:[]},ctx(db,store,'actor:A'));projectPublicationStream(db,store,'pub:P');
  const reaction=createReaction({command_id:'rx:B',idempotency_key:'rx:B',principal_id:'principal:actor:B',actor_id:'actor:B',publication_id:'pub:P',reaction_type:'like'},ctx(db,store,'actor:B'));
  const issued=processSourceEvent({eventId:reaction.receipt.result_event_ids[0],commandId:'notify:B',idempotencyKey:'notify:B'},pctx(db,store));
  return{db,store,issued};
}
function pref(id,type,target){return{command_id:`pref:${id}`,idempotency_key:`pref:${id}`,principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_type:type,target};}
function inbox(db,store,viewer={viewer_actor_id:'actor:A'}){return loadNotificationInboxSurface({recipientActorId:'actor:A',viewerContext:viewer,db,eventStore:store});}

test('mute actor suppresses only matching current Notification before unread count and snapshot',()=>{
  const {db,store,issued}=setup();
  const before=inbox(db,store);assert.equal(before.items.length,1);assert.equal(before.unread_count,1);
  createPreference(pref('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  const after=inbox(db,store);
  assert.equal(after.items.length,0);assert.equal(after.unread_count,0);assert.notEqual(after.snapshot_ref,before.snapshot_ref);
  assert.equal(store.readStream('notification',issued.notification_id).length,1);
});

test('mute withdrawal/restoration changes owner Inbox projection without mutating receipt acknowledgement state',()=>{
  const {db,store,issued}=setup();
  const mute=createPreference(pref('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  assert.equal(buildNotificationInbox({recipientActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store}).items.length,0);
  withdrawPreference({command_id:'pref:mute:w',idempotency_key:'pref:mute:w',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:mute.preference_id,expected_version:1},ctx(db,store,'actor:A'));
  assert.equal(inbox(db,store).items.length,1);
  acknowledgeNotification({command_id:'ack',idempotency_key:'ack',principal_id:'principal:actor:A',notification_id:issued.notification_id,expected_version:1},ctx(db,store,'actor:A'));
  restorePreference({command_id:'pref:mute:r',idempotency_key:'pref:mute:r',principal_id:'principal:actor:A',owner_actor_id:'actor:A',preference_id:mute.preference_id,expected_version:2},ctx(db,store,'actor:A'));
  assert.equal(inbox(db,store).items.length,0);
  const row=db.prepare('SELECT acknowledged FROM notifications_current WHERE notification_id=?').get(issued.notification_id);assert.equal(row.acknowledged,1);
});

test('bookmark, dismiss, and not-interested do not affect Notification Inbox',()=>{
  const {db,store}=setup();const before=inbox(db,store);
  createPreference(pref('bookmark','bookmark_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'));
  createPreference(pref('ni','not_interested_publication',{publication_id:'pub:P'}),ctx(db,store,'actor:A'));
  assert.deepEqual(inbox(db,store),before);
});

test('representative Inbox read remains unsuppressed because Preference audience is owner-only',()=>{
  const {db,store}=setup();
  createPreference(pref('mute','mute_actor',{actor_id:'actor:B'}),ctx(db,store,'actor:A'));
  const owner=inbox(db,store,{viewer_actor_id:'actor:A'});
  const representative=inbox(db,store,{viewer_actor_id:'actor:R',represents_actor_ids:['actor:A']});
  assert.equal(owner.items.length,0);
  assert.equal(representative.items.length,1);
  assert.equal(representative.items[0].source_actor_id,'actor:B');
});
