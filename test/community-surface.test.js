const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDatabase } = require('./helpers/test-db');
const { SQLiteEventStore } = require('../events/sqlite-event-store');
const { evaluateAuthority } = require('../authority/policy');
const { registerActor } = require('../entity/service');
const { createCommunity } = require('../community/service');
const { setCommunityName, setCommunityDescription, setCommunityDiscoverability } = require('../community/product-commands');
const { requestMembership, approveMembership } = require('../community/membership');
const { rebuildRelationshipProjection } = require('../projections/relationship-projector');
const { buildCommunitySurface } = require('../community/read-service');
const { renderCommunityJson } = require('../community/render-json');
const { renderCommunityHtml } = require('../community/render-html');

function setup(discoverability='public') {
  const db=createTestDatabase(); const eventStore=new SQLiteEventStore(db); const authorize=evaluateAuthority;
  for (const id of ['A','X']) registerActor({ command_id:`cmd:${id}`, idempotency_key:`idem:${id}`, principal_id:`principal:${id}`, entity_id:`actor:${id}` }, { eventStore, authorize });
  createCommunity({ command_id:'cmd:C', idempotency_key:'idem:C', principal_id:'principal:C', community_id:'community:C' }, { eventStore, authorize });
  const cctx={ eventStore, authorize, principalActorId:'community:C' };
  setCommunityName({ command_id:'cmd:name', idempotency_key:'idem:name', principal_id:'principal:C', community_id:'community:C', value:'<script>Research & Lab</script>' }, cctx);
  setCommunityDescription({ command_id:'cmd:desc', idempotency_key:'idem:desc', principal_id:'principal:C', community_id:'community:C', value:'Visible description' }, cctx);
  setCommunityDiscoverability({ command_id:'cmd:disc', idempotency_key:'idem:disc', principal_id:'principal:C', community_id:'community:C', value:discoverability }, cctx);
  return { db,eventStore,authorize };
}

function join(ctx, actor='A') {
  const pending=requestMembership({ command_id:`cmd:join-${actor}`, idempotency_key:`idem:join-${actor}`, principal_id:`principal:${actor}`, actor_id:`actor:${actor}`, community_id:'community:C' }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:`actor:${actor}` });
  approveMembership({ command_id:`cmd:approve-${actor}`, idempotency_key:`idem:approve-${actor}`, principal_id:'principal:C', community_id:'community:C', relationship_id:pending.relationship_id, expected_version:1 }, { eventStore:ctx.eventStore, authorize:ctx.authorize, principalActorId:'community:C' });
  rebuildRelationshipProjection(ctx.db, ctx.eventStore);
}

test('community surface is viewer-relative and private community returns null to nonmember', () => {
  const ctx=setup('private'); join(ctx,'A');
  const member=buildCommunitySurface({ communityId:'community:C', viewerContext:{viewer_actor_id:'actor:A'}, db:ctx.db, eventStore:ctx.eventStore });
  assert.equal(member.viewer_scope,'member');
  assert.equal(member.discoverability,'private');
  assert.equal(member.membership.viewer_is_member,true);
  const acting=buildCommunitySurface({ communityId:'community:C', viewerContext:{viewer_actor_id:'community:C'}, db:ctx.db, eventStore:ctx.eventStore });
  assert.equal(acting.viewer_scope,'community');
  assert.equal(buildCommunitySurface({ communityId:'community:C', viewerContext:{viewer_actor_id:'actor:X'}, db:ctx.db, eventStore:ctx.eventStore }), null);
});

test('community action hints are advisory and do not imply execution authority', () => {
  const publicCtx=setup('public');
  rebuildRelationshipProjection(publicCtx.db, publicCtx.eventStore);
  const visitor=buildCommunitySurface({ communityId:'community:C', viewerContext:{viewer_actor_id:'actor:X'}, db:publicCtx.db, eventStore:publicCtx.eventStore });
  assert.deepEqual(visitor.available_actions,['request_membership']);
  assert.equal(visitor.execution_authority.implied_by_membership,false);
  assert.equal(visitor.execution_authority.implied_by_social_role,false);

  const memberCtx=setup('public'); join(memberCtx,'A');
  const member=buildCommunitySurface({ communityId:'community:C', viewerContext:{viewer_actor_id:'actor:A'}, db:memberCtx.db, eventStore:memberCtx.eventStore });
  assert.deepEqual(member.available_actions,['leave']);
  const community=buildCommunitySurface({ communityId:'community:C', viewerContext:{viewer_actor_id:'community:C'}, db:memberCtx.db, eventStore:memberCtx.eventStore });
  assert.deepEqual(community.available_actions,['approve_membership','remove_member']);
});

test('HTML and JSON render the same filtered community surface and escape metadata', () => {
  const ctx=setup('public'); join(ctx,'A');
  const surface=buildCommunitySurface({ communityId:'community:C', viewerContext:{}, db:ctx.db, eventStore:ctx.eventStore });
  const json=JSON.parse(renderCommunityJson(surface));
  const html=renderCommunityHtml(surface);
  assert.equal(json.community_id,'community:C');
  assert.equal(json.presentation.name.value,'<script>Research & Lab</script>');
  assert.equal(html.includes('<script>Research & Lab</script>'),false);
  assert.equal(html.includes('&lt;script&gt;Research &amp; Lab&lt;/script&gt;'),true);
  assert.equal(html.includes('community:C'),true);
  assert.equal(html.includes('1 visible members'),true);
});

test('community renderers are pure presentation modules with no database or EventStore imports', () => {
  for (const file of ['render-html.js','render-json.js']) {
    const source=fs.readFileSync(path.join(__dirname,'..','community',file),'utf8');
    assert.equal(source.includes('event-store'),false);
    assert.equal(source.includes('sqlite'),false);
    assert.equal(source.includes("require('../db"),false);
  }
});
