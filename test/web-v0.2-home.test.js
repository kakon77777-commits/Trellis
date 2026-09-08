const test = require('node:test');
const assert = require('node:assert/strict');
const { renderHomePage } = require('../web/render/home');

function fixture() {
  return {
    algorithm_ref:'trellis-feed:public-chronological:v1',
    projection_version:'trellis-feed:public:0.1',
    snapshot_ref:'snap-1',
    items:[{
      item_type:'publication', source_ref:'pub:p1', sort:{recorded_at:'2026-09-08T00:00:00Z'},
      publication:{author_actor_id:'actor:A',publication_type:'post',visibility:'public',visible_reply_count:2,content:{body:'Readable body'}}
    }]
  };
}

test('Home prioritizes Actor and content over raw publication id', () => {
  const html = renderHomePage(fixture());
  assert.match(html, /actor:A/);
  assert.match(html, /Readable body/);
  assert.doesNotMatch(html, /<h1[^>]*>pub:p1<\/h1>/);
});

test('Home Structural Spine is decorative rather than a relation edge', () => {
  const html = renderHomePage(fixture());
  assert.match(html, /trellis-spine/);
  assert.doesNotMatch(html, /data-relation-type="chronological"/);
});

test('Home Context Lens is compact by default and inspection contains algorithm and snapshot', () => {
  const html = renderHomePage(fixture());
  assert.match(html, /Public view/i);
  assert.match(html, /Chronological/i);
  assert.match(html, /<details[^>]*context-inspection/);
  assert.match(html, /trellis-feed:public-chronological:v1/);
  assert.match(html, /snap-1/);
});

test('Home renders no fake mutation controls', () => {
  const html = renderHomePage(fixture());
  assert.doesNotMatch(html, /<button[^>]*>\s*(Post|React|Follow|Join)/i);
});

test('Home empty state refuses synthesized activity', () => {
  const html = renderHomePage({...fixture(),items:[]});
  assert.match(html, /No public activity yet/);
  assert.match(html, /Nothing is synthesized to make the network appear active/);
});
