const test=require('node:test');
const assert=require('node:assert/strict');
const {renderPublicationPage}=require('../web/render/publication');

function activeFixture(){return{publication_id:'pub:p1',author_actor_id:'actor:A',publication_type:'post',visibility:'public',lifecycle:'active',content:{revision:2,body:'Readable publication body'},reference_context:null,visible_replies:[{publication_id:'pub:reply-1',author_actor_id:'actor:B',lifecycle:'active',detail_ref:'/publications/pub%3Areply-1'}],visible_reply_count:1,reaction_summary:{agree:3,useful:1},viewer_scope:'public',projection_version:'publication-surface:0.1'};}
function activeReferenceFixture(){return{...activeFixture(),reference_context:{status:'active',publication_id:'pub:parent',author_actor_id:'actor:P',preview:'Parent preview'}};}
function withdrawnReferenceFixture(){return{...activeFixture(),reference_context:{status:'withdrawn',publication_id:'pub:parent'}};}
function unavailableReferenceFixture(){return{...activeFixture(),reference_context:{status:'unavailable'}};}

test('Publication body outranks raw publication id in heading hierarchy',()=>{
  const html=renderPublicationPage(activeFixture());
  assert.match(html,/Readable publication body/);
  assert.doesNotMatch(html,/<h1[^>]*>pub:p1<\/h1>/);
});

test('active reference renders viewer-safe preview',()=>{
  const html=renderPublicationPage(activeReferenceFixture());
  assert.match(html,/Referenced publication/i);
  assert.match(html,/Parent preview/);
});

test('withdrawn reference never reconstructs old body',()=>{
  const html=renderPublicationPage(withdrawnReferenceFixture());
  assert.match(html,/Publication withdrawn/i);
  assert.doesNotMatch(html,/Old secret body/);
});

test('unavailable reference remains non-oracular',()=>{
  const html=renderPublicationPage(unavailableReferenceFixture());
  assert.match(html,/Reference unavailable/i);
  assert.doesNotMatch(html,/hidden (reference|publication)|does not exist|permission denied/i);
});

test('Publication renders only supplied direct replies as reply edges',()=>{
  const html=renderPublicationPage(activeFixture());
  assert.match(html,/pub:reply-1/);
  assert.doesNotMatch(html,/pub:grandchild-not-supplied/);
});

test('public reaction summary is read-only presentation',()=>{
  const html=renderPublicationPage(activeFixture());
  assert.match(html,/agree/);
  assert.doesNotMatch(html,/<button[^>]*>\s*(React|Like|Agree)/i);
});
