const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function surface(overrides={}) {
  return {
    publication_id:'pub:1',author_actor_id:'actor:A',publication_type:'post',scope_ref:null,visibility:'public',lifecycle:'active',withdrawal_reason:null,
    content:{revision:1,body:'<script>alert("x")</script>'},reference_context:null,visible_replies:[],visible_reply_count:0,
    available_actions:[],execution_authority:{implied_by_publication_read:false,implied_by_social_membership:false},viewer_scope:'public',projection_version:'publication-surface:0.1',...overrides
  };
}

test('active author sees revise withdraw reply quote; readable viewer sees reply quote only', () => {
  const { availablePublicationActions } = require('../publication/action-hints');
  const p=surface();
  assert.deepEqual(availablePublicationActions({publication:p,viewerContext:{viewer_actor_id:'actor:A'}}),['reply','quote','revise','withdraw']);
  assert.deepEqual(availablePublicationActions({publication:p,viewerContext:{viewer_actor_id:'actor:B'}}),['reply','quote']);
  assert.deepEqual(availablePublicationActions({publication:p,viewerContext:{}}),[]);
});

test('withdrawn publication offers no new reply quote revise or withdraw actions', () => {
  const { availablePublicationActions } = require('../publication/action-hints');
  assert.deepEqual(availablePublicationActions({publication:surface({lifecycle:'withdrawn',content:null}),viewerContext:{viewer_actor_id:'actor:A'}}),[]);
  assert.deepEqual(availablePublicationActions({publication:surface({lifecycle:'withdrawn',content:null}),viewerContext:{viewer_actor_id:'actor:B'}}),[]);
});

test('JSON and HTML render the same filtered facts and HTML escapes content', () => {
  const { renderPublicationJson } = require('../publication/render-json');
  const { renderPublicationHtml } = require('../publication/render-html');
  const s=surface({available_actions:['reply','quote']});
  const parsed=JSON.parse(renderPublicationJson(s));
  assert.deepEqual(parsed,s);
  const html=renderPublicationHtml(s);
  assert.equal(html.includes('<script>alert'),false);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('pub:1'));
  assert.ok(html.includes('reply'));
});

test('renderers contain no storage or EventStore dependency', () => {
  for(const file of ['render-html.js','render-json.js']) {
    const source=fs.readFileSync(path.join(__dirname,'..','publication',file),'utf8');
    assert.equal(source.includes('sqlite'),false);
    assert.equal(source.includes('EventStore'),false);
    assert.equal(source.includes("../events"),false);
  }
});
