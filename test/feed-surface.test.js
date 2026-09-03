const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createPublication } = require('../publication/service');
const { rebuildPublicationProjection } = require('../publication/projector');
const { availableFeedActions } = require('../feed/action-hints');
const { loadHomeFeedSurface } = require('../feed/read-service');
const { renderFeedHtml } = require('../feed/render-html');
const { renderFeedJson } = require('../feed/render-json');

function reg(store,id){registerActor({command_id:`reg:${id}`,idempotency_key:`reg:${id}`,principal_id:`principal:${id}`,entity_id:id},{eventStore:store,authorize:evaluateAuthority});}
function ctx(db,store,actor){return {db,eventStore:store,principalActorId:actor,capabilityGrants:[],evaluatedAt:'2026-09-03T03:30:00Z'};}
function pub(db,store,id,author,visibility='public',body=`body:${id}`){
  return createPublication({command_id:`pub:${id}`,idempotency_key:`pub:${id}`,principal_id:`principal:${author}`,publication_id:`pub:${id}`,author_actor_id:author,publication_type:'post',body,visibility},ctx(db,store,author)).publication_id;
}

test('Feed action hints are advisory navigation/product hints only',()=>{
  const publicationItem={item_type:'publication',publication:{lifecycle:'active',available_actions:['reply','quote']}};
  assert.deepEqual(availableFeedActions(publicationItem),['open_publication','reply','quote']);
  assert.deepEqual(availableFeedActions({item_type:'social_activity',activity:{type:'community_joined'}}),['open_community']);
  assert.deepEqual(availableFeedActions({item_type:'social_activity',activity:{type:'collaboration_started'}}),['open_relationship']);
});

test('Home Feed HTML and JSON render the same filtered visible item and escape authored HTML',()=>{
  const db=createTestDatabase(); const store=new SQLiteEventStore(db,{now:()=> '2026-09-03T03:31:00Z'});
  reg(store,'actor:A'); reg(store,'actor:B');
  pub(db,store,'visible','actor:A','public','<script>alert(1)</script> visible');
  pub(db,store,'hidden','actor:B','private','HIDDEN BODY');
  rebuildPublicationProjection(db,store);
  const before=db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n;
  const surface=loadHomeFeedSurface({subjectActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},db,eventStore:store,limit:20});
  const json=renderFeedJson(surface);
  const html=renderFeedHtml(surface);
  assert.match(json,/pub:visible/);
  assert.match(json,/<script>alert\(1\)<\/script> visible/);
  assert.match(html,/pub:visible/);
  assert.equal(html.includes('<script>alert(1)</script>'),false);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt; visible/);
  assert.equal(json.includes('pub:hidden'),false);
  assert.equal(html.includes('pub:hidden'),false);
  assert.equal(json.includes('HIDDEN BODY'),false);
  assert.equal(html.includes('HIDDEN BODY'),false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_events').get().n,before);
  assert.equal(surface.items[0].execution_authority.implied_by_feed_read,false);
});

test('Feed renderers are pure presentation modules with no storage imports',()=>{
  for(const file of ['render-html.js','render-json.js']){
    const source=fs.readFileSync(path.join(__dirname,'..','feed',file),'utf8');
    assert.equal(/event-store|sqlite|\.\.\/db\//.test(source),false,file);
  }
});

test('Feed public API exposes no canonical mutation shortcut',()=>{
  const service=require('../feed/read-service');
  for(const name of ['appendFeedEvent','createCanonicalFeedItem','markSeenCanonical','mutatePublication','mutateRelationship','autoFollowFromDiscovery']){
    assert.equal(service[name],undefined,name);
  }
});
