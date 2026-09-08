const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { renderContextLens } = require('../web/render/context-lens');
const { renderRankingExplanation } = require('../web/render/context-panel');
const { renderShell } = require('../web/render/shell');

test('Context Lens keeps technical inspection inside an accessible disclosure', () => {
  const html = renderContextLens({
    label: 'Context Lens',
    title: 'Public view',
    summaryRows: [['Viewer', 'Anonymous'], ['Ordering', 'Chronological']],
    inspectionRows: [['Algorithm', 'trellis-feed:public-chronological:v1'], ['Snapshot', 'abc123']],
    machineHref: '/api/public/feed'
  });
  assert.match(html, /<details[^>]*class="[^"]*context-inspection/);
  assert.match(html, /<summary[^>]*>Inspect context<\/summary>/);
  assert.match(html, /Anonymous/);
  assert.match(html, /trellis-feed:public-chronological:v1/);
  assert.match(html, /abc123/);
});

test('unknown ranking reason remains raw inside backend explanation', () => {
  const html = renderRankingExplanation({
    score: { total_points: 7 },
    ranking_reasons: [{ type: 'future_reason_xyz', component: 'future', points: 7 }]
  });
  assert.match(html, />future_reason_xyz</);
  assert.match(html, /data-reason-code="future_reason_xyz"/);
  assert.doesNotMatch(html, /because you may like/i);
});

test('shell preserves nav main aside landmarks and Observatory identity', () => {
  const html = renderShell({ title: 'Home', main: '<h1>Public graph activity</h1>', context: '<p>Context</p>' });
  assert.match(html, /<nav/);
  assert.match(html, /<main/);
  assert.match(html, /<aside/);
  assert.match(html, /Trellis/);
  assert.match(html, /EveMissLab/);
});

test('Observatory token families are centralized in app.css', () => {
  const css = fs.readFileSync(require.resolve('../web/public/app.css'), 'utf8');
  for (const token of [
    '--color-bg','--color-surface','--color-surface-raised','--color-text','--color-text-muted',
    '--color-line','--color-accent-primary','--color-accent-secondary','--color-focus',
    '--radius-sm','--radius-md','--radius-lg'
  ]) assert.match(css, new RegExp(`${token}:`));
});

test('Context Lens does not require hover to disclose inspection', () => {
  const html = renderContextLens({ label:'Context Lens', title:'Public', summaryRows:[], inspectionRows:[['Projection','p:1']] });
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
});
