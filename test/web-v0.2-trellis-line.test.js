const test = require('node:test');
const assert = require('node:assert/strict');
const { renderStructuralSpine, renderSemanticEdge } = require('../web/render/trellis-line');
const { renderGraphList, edgeFact } = require('../web/render/graph-list');

const edge = {
  relationship_id: 'rel:1',
  relationship_type: 'follows',
  source_entity_id: 'actor:A',
  target_entity_id: 'actor:B'
};

test('Structural Spine is decorative and contains no relationship fact', () => {
  const html = renderStructuralSpine({ position: 'middle' });
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /relationship|source_entity|target_entity|follows/);
});

test('semantic edge requires an explicit edge object', () => {
  assert.equal(renderSemanticEdge(null), '');
  assert.equal(renderSemanticEdge(undefined), '');
});

test('semantic edge preserves explicit source target and type', () => {
  const html = renderSemanticEdge(edge, { sourceLabel:'Alice', targetLabel:'Bob', directed:true });
  assert.match(html, /data-source-id="actor:A"/);
  assert.match(html, /data-target-id="actor:B"/);
  assert.match(html, /data-relation-type="follows"/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
});

test('visual edge and text fallback normalize to the same edge fact', () => {
  const fact = edgeFact(edge);
  const list = renderGraphList([edge], { title:'Visible relationships', idPrefix:'actor-graph' });
  assert.deepEqual(fact, edge);
  assert.match(list, /follows/);
  assert.match(list, /actor:A/);
  assert.match(list, /actor:B/);
});

test('direction arrow appears only when caller supplies explicit directed=true', () => {
  assert.match(renderSemanticEdge(edge, { directed:true }), /data-directed="true"/);
  assert.doesNotMatch(renderSemanticEdge(edge, { directed:false }), /data-directed="true"/);
});
