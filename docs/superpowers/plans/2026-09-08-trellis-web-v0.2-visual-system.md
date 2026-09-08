# Trellis Web v0.2 Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved A′ Trellis Observatory visual system across Home, Discover, Actor, Publication, and Community without changing Trellis domain semantics, visibility, ranking, authority, storage, or machine-surface meaning.

**Architecture:** Keep the current async HTTP/domain composition and W1–W12 semantics intact. Add small pure rendering primitives (`Context Lens`, `Trellis Line`, node badges, graph/list fallback) under `web/render/`, then migrate each existing page renderer to those primitives. CSS/browser JS remain presentation-only; all semantic edges and counts must come from the already viewer-safe view model supplied by existing read services.

**Tech Stack:** Node.js >= 22.5.0, CommonJS page/render modules, server-rendered HTML, plain CSS design tokens, browser-native JavaScript progressive enhancement, `node:test`, existing Cloudflare Worker/D1 runtime unchanged.

**Spec:** `docs/superpowers/specs/2026-09-08-trellis-web-v0.2-visual-system-design.md`

**Approved design authority:** `design/trellis-web-v0.2-observatory @ f9241202212a4c49a0f73f9e3006a84f782e3a29`

**Implementation base:** create the implementation branch from the approved design branch so the frozen spec and this plan travel with the code. The underlying product/runtime base remains `main @ 8e2dce74333a5db2cfa9fdeea061db0121cc92e8`, whose verified suite is 489/489.

## Global Constraints

- Preserve Web v0.1 W1–W12 exactly; v0.2 is presentation-only.
- Preserve Storage Runtime v1 SR1–SR16; no storage or D1 redesign belongs in this work.
- `web/` and HTTP presentation code must not read D1/SQL directly or make Authority/visibility decisions.
- No semantic edge may be rendered unless an explicit viewer-safe relation/reference exists in the supplied view model.
- Structural Spine is decorative sequence grammar only and must not encode a social edge.
- Unknown backend reason codes must remain visible as raw codes; no generated explanation is permitted.
- HTML/JSON semantic parity remains exact through the existing semantic-fact-marker contract.
- Authored content remains escaped.
- Hidden and nonexistent resources remain non-oracular where current W12 semantics require it.
- Public v0.2 remains anonymous and read-only; do not render fake `Join`, `React`, `Post`, `Follow`, `My Trellis`, or other unavailable mutation controls.
- Viewer-relative counts use viewer-relative wording such as `visible members` / `visible relationships` when no absolute total is supplied.
- Graph/list semantic parity is mandatory for every semantic visual graph.
- Mobile removes the persistent third Context Lens column; page context becomes an in-flow disclosure and semantic graph presentation becomes adjacency/list-first.
- Normal text contrast target is at least 4.5:1; large text and essential UI target is at least 3:1.
- `prefers-reduced-motion: reduce` must remove nonessential movement; no animation carries unique semantic meaning.
- No force-directed/physics graph dependency is introduced in v0.2.
- No new required runtime dependency is introduced for the visual implementation.
- Every production behavior follows observed RED → minimal GREEN → focused regression → full Web regression → commit.
- After each checkpoint, create a recoverable Git bundle/source archive outside the worktree before starting the next stage.

---

## File Structure

### New focused render units

```text
web/render/context-lens.js       progressive page/item context disclosure
web/render/trellis-line.js       decorative spine + explicit semantic-edge renderer
web/render/node-badge.js         Actor/Community node identity presentation
web/render/graph-list.js         semantic text fallback + edge normalization
```

### Existing render units to modify

```text
web/render/shell.js
web/render/context-panel.js
web/render/home.js
web/render/explore.js
web/render/profile.js
web/render/publication.js
web/render/community.js
web/public/app.css
web/public/app.js
```

### New/expanded tests

```text
test/web-v0.2-shell-context.test.js
test/web-v0.2-trellis-line.test.js
test/web-v0.2-home.test.js
test/web-v0.2-discover.test.js
test/web-v0.2-actor.test.js
test/web-v0.2-publication.test.js
test/web-v0.2-community.test.js
test/web-v0.2-responsive-a11y.test.js
test/web-v0.2-visual-conformance.test.js
test/helpers/css-tokens.js
```

### Documentation

```text
docs/WEB_VISUAL_CONFORMANCE_v0.2.md
```

---

# Task 1 — Shared Observatory Tokens, Shell, and Context Lens

**Files:**
- Create: `web/render/context-lens.js`
- Modify: `web/render/context-panel.js`
- Modify: `web/render/shell.js`
- Modify: `web/public/app.css`
- Test: `test/web-v0.2-shell-context.test.js`

**Interfaces:**
- Consumes: existing `escapeHtml()` and existing page-level context data already supplied by page renderers.
- Produces:
  - `renderContextLens({ label, title, summaryRows, inspectionRows, machineHref, machineLabel, rankingItem }) -> HTML string`
  - existing `renderRankingExplanation(item)` remains supported and continues raw-code fallback.
  - `renderShell({...})` keeps its public call shape; page renderers may pass the new Context Lens HTML as `context`.

- [ ] **Step 1: Verify the approved baseline before modification**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected:

```text
489/489 tests PASS
syntax check PASS
git diff --check PASS
```

If baseline differs, stop and reconcile the implementation branch with the approved design/base before changing production files.

- [ ] **Step 2: Write failing Context Lens and token tests**

Create `test/web-v0.2-shell-context.test.js` with five tests:

```js
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
```

- [ ] **Step 3: Run focused test and verify RED**

Run:

```bash
node --test test/web-v0.2-shell-context.test.js
```

Expected: FAIL because `web/render/context-lens.js` and the v0.2 token family do not exist yet.

- [ ] **Step 4: Implement minimal `renderContextLens()`**

Create `web/render/context-lens.js`:

```js
const { escapeHtml } = require('./shell');
const { renderRankingExplanation } = require('./context-panel');

function row([label, value]) {
  return `<div class="context-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderContextLens({
  label = 'Context Lens',
  title = 'Public view',
  summaryRows = [],
  inspectionRows = [],
  machineHref = null,
  machineLabel = 'Machine surface',
  rankingItem = null
} = {}) {
  const summary = summaryRows.length ? `<dl class="context-summary">${summaryRows.map(row).join('')}</dl>` : '';
  const inspection = inspectionRows.length
    ? `<details class="context-inspection"><summary>Inspect context</summary><dl>${inspectionRows.map(row).join('')}</dl></details>`
    : '';
  const machine = machineHref
    ? `<a class="context-machine-link" href="${escapeHtml(machineHref)}">${escapeHtml(machineLabel)} ↗</a>`
    : '';
  const ranking = rankingItem ? renderRankingExplanation(rankingItem) : '';
  return `<section class="context-card context-lens"><p class="eyebrow">${escapeHtml(label)}</p><h2>${escapeHtml(title)}</h2>${summary}${inspection}${machine}</section>${ranking}`;
}

module.exports = { renderContextLens };
```

Do not add any data loading or interpretation logic.

- [ ] **Step 5: Consolidate CSS tokens without changing domain behavior**

Replace the v0.1 token set with the approved v0.2 families. Use these initial values, which satisfy the intended contrast targets and may be adjusted only if focused contrast tests prove a better accessible value:

```css
:root {
  --color-bg: #0a0d12;
  --color-surface: #111722;
  --color-surface-raised: #171f2c;
  --color-text: #f2f5f8;
  --color-text-muted: #a7b0bf;
  --color-line: #2a3443;
  --color-accent-primary: #72e5df;
  --color-accent-secondary: #b6a5ff;
  --color-focus: #8cf3ed;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
}
```

Update existing selectors to use these token names instead of the old aliases. Keep the current dark color scheme and no required remote asset/font dependency.

- [ ] **Step 6: Make shell vocabulary Observatory-oriented but route-neutral**

Preserve the existing navigation routes and landmarks. Update only presentation copy/classes needed for:

```text
Trellis / EveMissLab
Home
Discover
Communities
Public surface
Machine API
```

Do not render future authenticated routes.

- [ ] **Step 7: Verify focused GREEN and old Context Panel tests**

Run:

```bash
node --test test/web-v0.2-shell-context.test.js test/web-context-panel.test.js test/web-pages.test.js
npm run check
```

Expected: all focused tests PASS and unknown raw reason fallback remains green.

- [ ] **Step 8: Run full Web regression**

Run:

```bash
node --test test/web-*.test.js test/web-v0.2-shell-context.test.js
```

Expected: zero failures.

- [ ] **Step 9: Commit Task 1**

```bash
git add web/render/context-lens.js web/render/context-panel.js web/render/shell.js web/public/app.css test/web-v0.2-shell-context.test.js
git commit -m "feat(web): add Observatory shell and Context Lens"
```

---

# Task 2 — Trellis Line, Node Badge, and Graph/List Primitives

**Files:**
- Create: `web/render/trellis-line.js`
- Create: `web/render/node-badge.js`
- Create: `web/render/graph-list.js`
- Modify: `web/public/app.css`
- Test: `test/web-v0.2-trellis-line.test.js`

**Interfaces:**
- Produces:
  - `renderStructuralSpine({ position }) -> decorative HTML`
  - `renderSemanticEdge(edge, { sourceLabel, targetLabel, directed }) -> semantic-edge HTML`
  - `renderNodeBadge({ kind, label, href, meta }) -> node HTML`
  - `edgeFact(edge) -> { relationship_id, relationship_type, source_entity_id, target_entity_id }`
  - `renderGraphList(edges, { title, idPrefix }) -> accessible text fallback`
- Semantic edge functions consume explicit edge input only; they never query or infer.

- [ ] **Step 1: Write failing rendering-grammar tests**

Create five tests in `test/web-v0.2-trellis-line.test.js`:

```js
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
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-v0.2-trellis-line.test.js
```

Expected: FAIL because the three new rendering modules do not exist.

- [ ] **Step 3: Implement pure rendering primitives**

Implement `trellis-line.js` with no imports outside rendering helpers:

```js
const { escapeHtml } = require('./shell');

function renderStructuralSpine({ position = 'middle' } = {}) {
  return `<span class="trellis-spine trellis-spine-${escapeHtml(position)}" aria-hidden="true"></span>`;
}

function renderSemanticEdge(edge, { sourceLabel, targetLabel, directed = false } = {}) {
  if (!edge) return '';
  const source = sourceLabel ?? edge.source_entity_id;
  const target = targetLabel ?? edge.target_entity_id;
  return `<div class="semantic-edge" data-edge-id="${escapeHtml(edge.relationship_id ?? '')}" data-source-id="${escapeHtml(edge.source_entity_id)}" data-target-id="${escapeHtml(edge.target_entity_id)}" data-relation-type="${escapeHtml(edge.relationship_type)}"${directed ? ' data-directed="true"' : ''}><span class="graph-node">${escapeHtml(source)}</span><span class="graph-line">${escapeHtml(edge.relationship_type)}${directed ? ' →' : ''}</span><span class="graph-node">${escapeHtml(target)}</span></div>`;
}

module.exports = { renderStructuralSpine, renderSemanticEdge };
```

`graph-list.js` must normalize exact fields and render the same facts in text. `node-badge.js` must render only supplied `kind/label/href/meta`; it must not classify Actors by name or metadata.

- [ ] **Step 4: Add deterministic static graph styles**

Add CSS for:

```text
.trellis-spine
.semantic-edge
.graph-node
.graph-line
.node-badge
```

No continuous animation, physics, particles, or inferred proximity styling.

- [ ] **Step 5: Verify GREEN**

```bash
node --test test/web-v0.2-trellis-line.test.js
npm run check
```

Expected: 5/5 focused tests PASS.

- [ ] **Step 6: Run full Web regression**

```bash
node --test test/web-*.test.js test/web-v0.2-*.test.js
```

Expected: zero failures.

- [ ] **Step 7: Commit Task 2**

```bash
git add web/render/trellis-line.js web/render/node-badge.js web/render/graph-list.js web/public/app.css test/web-v0.2-trellis-line.test.js
git commit -m "feat(web): add Trellis rendering grammar"
```

- [ ] **Step 8: Checkpoint A**

Outside the worktree, create a Git bundle and tracked-source archive named with the Task 2 HEAD, verify both, and record SHA-256. This checkpoint must contain Tasks 1–2 plus the approved spec/plan.

---

# Task 3 — Home: Chronological Stream Observatory

**Files:**
- Modify: `web/render/home.js`
- Modify: `web/public/app.css`
- Test: `test/web-v0.2-home.test.js`

**Interfaces:**
- Consumes: existing public-feed view model only.
- Consumes `renderContextLens()` and `renderStructuralSpine()`.
- Produces: redesigned `renderHomePage(feed)` with unchanged semantic fact markers.

- [ ] **Step 1: Write five failing Home tests**

```js
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
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-v0.2-home.test.js
```

Expected: failures against the current v0.1 Home hierarchy/context/empty-state copy.

- [ ] **Step 3: Implement the Home composition**

Refactor `home.js` so publication cards follow:

```text
Actor identity -> publication type/content -> visibility/reply count -> inspection
```

Use Structural Spine only as decorative feed sequence grammar. Keep activity cards based on supplied activity fields; do not synthesize an edge unless the item already contains explicit source/target/relation data.

Context Lens summary rows:

```js
[
  ['Viewer', 'Anonymous'],
  ['Ordering', 'Chronological']
]
```

Inspection rows:

```js
[
  ['Algorithm', feed.algorithm_ref],
  ['Projection', feed.projection_version],
  ['Snapshot', feed.snapshot_ref]
]
```

Machine link: `/api/public/feed`.

- [ ] **Step 4: Verify Home GREEN + W1 parity**

```bash
node --test test/web-v0.2-home.test.js test/web-public-feed.test.js test/web-parity.test.js test/web-pages.test.js
```

Expected: zero failures; semantic marker parity remains unchanged.

- [ ] **Step 5: Full Web regression and commit**

```bash
node --test test/web-*.test.js test/web-v0.2-*.test.js
npm run check
git diff --check
git add web/render/home.js web/public/app.css test/web-v0.2-home.test.js
git commit -m "feat(web): redesign Home as Observatory stream"
```

---

# Task 4 — Discover: Public Node Index

**Files:**
- Modify: `web/render/explore.js`
- Modify: `web/public/app.css`
- Test: `test/web-v0.2-discover.test.js`

**Interfaces:**
- Consumes: existing `{ actors, communities, algorithm_ref, projection_version, snapshot_ref }` public directory only.
- Consumes `renderNodeBadge()` and `renderContextLens()`.
- Produces: redesigned `renderExplorePage(directory)` with no inter-card semantic edges.

- [ ] **Step 1: Write four failing Discover tests**

Create tests proving:

```js
test('Discover renders Actor and Community node grammar without directory edges', () => {
  const html = renderExplorePage(directoryFixture());
  assert.match(html, /data-node-kind="actor"/);
  assert.match(html, /data-node-kind="community"/);
  assert.doesNotMatch(html, /data-relation-type=/);
});

test('Discover Community count wording is viewer-relative', () => {
  const html = renderExplorePage(directoryFixture());
  assert.match(html, /3 visible members/);
});

test('Discover Context Lens states deterministic public-by-construction index', () => {
  const html = renderExplorePage(directoryFixture());
  assert.match(html, /Public-by-construction/);
  assert.match(html, /trellis-directory:public:v1/);
  assert.match(html, /snapshot-directory/);
});

test('Discover does not advertise recommendation semantics', () => {
  const html = renderExplorePage(directoryFixture());
  assert.doesNotMatch(html, /Recommended|Trending|For you|Most relevant|Suggested/i);
});
```

`directoryFixture()` must include one Actor and one public Community whose membership projection reports `visible_member_count: 3`.

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-v0.2-discover.test.js
```

Expected: current v0.1 card vocabulary/context does not satisfy all v0.2 assertions.

- [ ] **Step 3: Implement node-index composition**

Render two explicit sections with anchors:

```text
#actors
#communities
```

Use Actor `●` and Community `◇` node presentation through `node-badge.js`. Do not add client-side ranking/filter semantics. Use `visible_member_count` exactly as provided and label it `N visible members`.

Context Lens summary:

```text
Public index
Anonymous viewer
Alphabetical
Public-by-construction
```

Inspection contains directory algorithm/projection/snapshot and exact inclusion explanation already implied by the public-directory service.

- [ ] **Step 4: Verify Discover GREEN + hidden-fact noninterference**

```bash
node --test test/web-v0.2-discover.test.js test/web-public-directory.test.js test/web-parity.test.js
```

Expected: zero failures.

- [ ] **Step 5: Full Web regression and commit**

```bash
node --test test/web-*.test.js test/web-v0.2-*.test.js
npm run check
git diff --check
git add web/render/explore.js web/public/app.css test/web-v0.2-discover.test.js
git commit -m "feat(web): redesign Discover as public node index"
```

- [ ] **Step 6: Checkpoint B**

Create and verify a recoverable bundle/source archive for Tasks 1–4 before Actor work begins.

---

# Task 5 — Actor Profile: Viewer-Safe Social Edges

**Files:**
- Modify: `web/render/profile.js`
- Modify: `web/public/app.css`
- Test: `test/web-v0.2-actor.test.js`

**Interfaces:**
- Consumes: existing Actor Profile only, especially `profile.social.visible_relationships`.
- Consumes `renderSemanticEdge()`, `renderGraphList()`, `renderNodeBadge()`, and `renderContextLens()`.
- Produces: Actor page where rendered semantic edges are a deterministic subset of the supplied visible relationships and text fallback represents the same preview facts.

- [ ] **Step 1: Write five failing Actor tests**

Use a fixture with 10 visible relationships and no `actor_kind` field.

Required assertions:

```js
test('Actor page never infers AI/Human Actor type', () => {
  const html = renderProfilePage(profileFixture());
  assert.match(html, />Actor</);
  assert.doesNotMatch(html, /AI Actor|Human Actor/);
});

test('Actor graph edges come only from visible_relationships', () => {
  const profile = profileFixture();
  const html = renderProfilePage(profile);
  for (const edge of profile.social.visible_relationships.slice(0,8)) {
    assert.match(html, new RegExp(`data-edge-id="${edge.relationship_id}"`));
  }
  assert.doesNotMatch(html, /rel:not-supplied/);
});

test('Actor graph preview is deterministic and not called important/relevant', () => {
  const html = renderProfilePage(profileFixture());
  assert.match(html, /Showing 8 of 10 visible relationships/);
  assert.doesNotMatch(html, /Top 8|Most important|Most relevant/i);
});

test('Actor visual preview and preview text fallback expose the same edge ids', () => {
  const html = renderProfilePage(profileFixture());
  for (const edge of profileFixture().social.visible_relationships.slice(0,8)) {
    assert.match(html, new RegExp(`data-edge-id="${edge.relationship_id}"`));
    assert.match(html, new RegExp(`data-graph-fallback-id="${edge.relationship_id}"`));
  }
});

test('Actor raw id and projection metadata live in Context Lens inspection', () => {
  const html = renderProfilePage(profileFixture());
  assert.match(html, /<details[^>]*context-inspection/);
  assert.match(html, /actor:A/);
  assert.match(html, /actor-profile:0\.1/);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-v0.2-actor.test.js
```

Expected: current Profile has a flat relation list and no semantic-edge preview component.

- [ ] **Step 3: Implement deterministic Actor graph preview**

In `profile.js` define:

```js
const ACTOR_GRAPH_PREVIEW_LIMIT = 8;
```

Use exactly:

```js
const allEdges = profile.social?.visible_relationships ?? [];
const previewEdges = allEdges.slice(0, ACTOR_GRAPH_PREVIEW_LIMIT);
```

Do not sort by an invented score. Render each preview edge using explicit source/target/type. Because the current projection does not provide a separate directionality ontology flag, do not infer `directed=true` from the relation name; preserve source/target ordering in attributes/text and use a neutral visual connector unless a future explicit direction flag is supplied.

Render a preview text fallback with the same `previewEdges`, plus a `<details>` full list containing all visible edges when `allEdges.length > previewEdges.length`.

- [ ] **Step 4: Verify Actor GREEN + existing Profile behavior**

```bash
node --test test/web-v0.2-actor.test.js test/web-pages.test.js test/web-parity.test.js test/profile-*.test.js
```

Expected: zero failures.

- [ ] **Step 5: Full regression and commit**

```bash
npm test
npm run check
git diff --check
git add web/render/profile.js web/public/app.css test/web-v0.2-actor.test.js
git commit -m "feat(web): render Actor visible Trellis"
```

---

# Task 6 — Publication Detail: Reading + Content Edges

**Files:**
- Modify: `web/render/publication.js`
- Modify: `web/public/app.css`
- Test: `test/web-v0.2-publication.test.js`

**Interfaces:**
- Consumes only the existing Publication Surface: body/revision, lifecycle, reference context, direct viewer-visible replies, reaction summary, viewer scope, projection version.
- Produces: reading-first detail with active/withdrawn/unavailable reference states and direct reply structure.

- [ ] **Step 1: Write six failing Publication tests**

Required tests:

```js
test('Publication body outranks raw publication id in heading hierarchy', () => {
  const html = renderPublicationPage(activeFixture());
  assert.match(html, /Readable publication body/);
  assert.doesNotMatch(html, /<h1[^>]*>pub:p1<\/h1>/);
});

test('active reference renders viewer-safe preview', () => {
  const html = renderPublicationPage(activeReferenceFixture());
  assert.match(html, /Referenced publication/i);
  assert.match(html, /Parent preview/);
});

test('withdrawn reference never reconstructs old body', () => {
  const html = renderPublicationPage(withdrawnReferenceFixture());
  assert.match(html, /Publication withdrawn/i);
  assert.doesNotMatch(html, /Old secret body/);
});

test('unavailable reference remains non-oracular', () => {
  const html = renderPublicationPage(unavailableReferenceFixture());
  assert.match(html, /Reference unavailable/i);
  assert.doesNotMatch(html, /hidden|does not exist|permission denied/i);
});

test('Publication renders only supplied direct replies as reply edges', () => {
  const html = renderPublicationPage(activeFixture());
  assert.match(html, /pub:reply-1/);
  assert.doesNotMatch(html, /pub:grandchild-not-supplied/);
});

test('public reaction summary is read-only presentation', () => {
  const html = renderPublicationPage(activeFixture());
  assert.match(html, /agree/);
  assert.doesNotMatch(html, /<button[^>]*>\s*(React|Like|Agree)/i);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-v0.2-publication.test.js
```

Expected: current Publication ID-centric hierarchy/reference presentation fails v0.2 expectations.

- [ ] **Step 3: Implement reading-first Publication layout**

Use publication type as an eyebrow and author as the main identity. Keep authored body escaped. Put publication ID, revision, projection, viewer scope, lifecycle, and visibility into Context Lens inspection/summary as appropriate.

Reference rendering contract:

```text
active      -> supplied author/preview + open reference link
withdrawn   -> withdrawn state + supplied publication_id only
unavailable -> neutral unavailable wording only
```

Do not distinguish hidden from nonexistent.

Direct replies use only `surface.visible_replies`; render source publication → reply as content-edge structure without recursively loading grandchildren.

Reaction summary renders backend keys/counts as inert aggregate text/pills.

- [ ] **Step 4: Verify GREEN + W10/W12 regression**

```bash
node --test test/web-v0.2-publication.test.js test/web-pages.test.js test/web-parity.test.js test/web-conformance.test.js
```

Expected: zero failures, authored script remains escaped, hidden/missing behavior unchanged.

- [ ] **Step 5: Full regression and commit**

```bash
npm test
npm run check
git diff --check
git add web/render/publication.js web/public/app.css test/web-v0.2-publication.test.js
git commit -m "feat(web): redesign Publication content graph"
```

- [ ] **Step 6: Checkpoint C**

Create and verify a recoverable bundle/source archive for Tasks 1–6.

---

# Task 7 — Community Detail: Local Visible Graph

**Files:**
- Modify: `web/render/community.js`
- Modify: `web/public/app.css`
- Test: `test/web-v0.2-community.test.js`

**Interfaces:**
- Consumes only `surface.membership.visible_members` / `visible_member_count` and `surface.local_graph.visible_scoped_relationships` / `visible_relationship_count`.
- Produces deterministic local graph preview + equal preview fallback + complete full list disclosure.

- [ ] **Step 1: Write six failing Community tests**

Use a fixture with 14 visible scoped relationships and 3 visible members.

```js
test('Community member count is explicitly viewer-relative', () => {
  assert.match(renderCommunityPage(communityFixture()), /3 visible members/);
});

test('Community graph preview contains only supplied visible scoped edges', () => {
  const surface = communityFixture();
  const html = renderCommunityPage(surface);
  for (const edge of surface.local_graph.visible_scoped_relationships.slice(0,12)) {
    assert.match(html, new RegExp(`data-edge-id="${edge.relationship_id}"`));
  }
  assert.doesNotMatch(html, /rel:not-visible/);
});

test('Community preview uses deterministic subset vocabulary not ranking vocabulary', () => {
  const html = renderCommunityPage(communityFixture());
  assert.match(html, /Showing 12 of 14 visible relationships/);
  assert.doesNotMatch(html, /Top 12|Most relevant|Most important/i);
});

test('Community visual graph and preview fallback contain the same 12 edge ids', () => {
  const html = renderCommunityPage(communityFixture());
  for (const edge of communityFixture().local_graph.visible_scoped_relationships.slice(0,12)) {
    assert.match(html, new RegExp(`data-edge-id="${edge.relationship_id}"`));
    assert.match(html, new RegExp(`data-graph-fallback-id="${edge.relationship_id}"`));
  }
});

test('Community full graph list contains every viewer-visible edge', () => {
  const html = renderCommunityPage(communityFixture());
  for (const edge of communityFixture().local_graph.visible_scoped_relationships) {
    assert.match(html, new RegExp(`data-full-edge-id="${edge.relationship_id}"`));
  }
});

test('empty Community graph uses epistemically bounded wording', () => {
  const html = renderCommunityPage({...communityFixture(),local_graph:{visible_scoped_relationships:[],visible_relationship_count:0}});
  assert.match(html, /No visible local relationships/);
  assert.match(html, /does not assert that no other relationships exist/);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-v0.2-community.test.js
```

Expected: current Community renders every edge in a flat graph and does not implement the preview/full-list vocabulary.

- [ ] **Step 3: Implement deterministic Community local graph**

Define:

```js
const COMMUNITY_GRAPH_PREVIEW_LIMIT = 12;
```

Use `visible_scoped_relationships.slice(0, 12)` without ranking/relevance inference. Render static node/edge geometry and a matching text fallback for the preview. If more edges exist, render a full accessible `<details>` list using all supplied visible edges.

Do not use force simulation or client-side graph discovery.

- [ ] **Step 4: Verify Community GREEN + graph parity regression**

```bash
node --test test/web-v0.2-community.test.js test/web-pages.test.js test/web-parity.test.js test/community-*.test.js
```

Expected: zero failures.

- [ ] **Step 5: Full regression and commit**

```bash
npm test
npm run check
git diff --check
git add web/render/community.js web/public/app.css test/web-v0.2-community.test.js
git commit -m "feat(web): render Community local Observatory graph"
```

---

# Task 8 — Responsive/Mobile Grammar, Contrast, and Reduced Motion

**Files:**
- Create: `test/helpers/css-tokens.js`
- Modify: `web/public/app.css`
- Modify: `web/public/app.js`
- Test: `test/web-v0.2-responsive-a11y.test.js`

**Interfaces:**
- CSS controls responsive composition only.
- Browser JS may enhance disclosure/highlight states only and must not cache/recompute social truth.
- `test/helpers/css-tokens.js` exports deterministic token parsing + contrast calculation for test use.

- [ ] **Step 1: Write five failing responsive/accessibility tests**

Create `test/helpers/css-tokens.js` with a small parser/contrast utility used only by tests. Then write:

```js
test('mobile layout removes persistent third-column Context Lens', () => {
  const css = loadCss();
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.match(css, /\.context-panel\s*\{[^}]*position:\s*static/s);
});

test('mobile semantic graph prefers one-column adjacency/list grammar', () => {
  const css = loadCss();
  assert.match(css, /\.semantic-edge\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test('required text/accent tokens pass contrast targets against supported surfaces', () => {
  const tokens = readRootTokens(loadCss());
  for (const bg of ['--color-bg','--color-surface','--color-surface-raised']) {
    assert.ok(contrast(tokens['--color-text'], tokens[bg]) >= 4.5);
    assert.ok(contrast(tokens['--color-text-muted'], tokens[bg]) >= 4.5);
    assert.ok(contrast(tokens['--color-accent-primary'], tokens[bg]) >= 3);
    assert.ok(contrast(tokens['--color-accent-secondary'], tokens[bg]) >= 3);
  }
});

test('reduced motion removes nonessential transition/animation duration', () => {
  const css = loadCss();
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /transition:\s*none\s*!important/);
  assert.match(css, /animation:\s*none\s*!important/);
});

test('browser enhancement source contains no storage or authoritative social cache', () => {
  const js = fs.readFileSync(require.resolve('../web/public/app.js'),'utf8');
  assert.doesNotMatch(js, /localStorage|indexedDB|sessionStorage|fetch\([^)]*api\/.*(relationship|publication|community)/i);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-v0.2-responsive-a11y.test.js
```

Expected: at least the new token parser/mobile semantic-edge rules fail until v0.2 responsive CSS is finished.

- [ ] **Step 3: Implement responsive Observatory CSS**

Required breakpoints:

```text
Desktop: persistent nav + main + Context Lens
Intermediate: narrower nav; Context Lens may flow below/alongside main
Mobile <=720px: single content column + bottom nav + in-flow Context Lens
```

On mobile, semantic-edge visual layout becomes a one-column/adjacency presentation; do not scale a desktop graph below readable width.

- [ ] **Step 4: Keep browser JS enhancement-only**

`web/public/app.js` may add classes/data attributes for disclosure/selection highlighting, but must not fetch additional social truth, persist graph state, or manufacture relation data. Native `<details>` must remain functional without JS.

- [ ] **Step 5: Verify GREEN**

```bash
node --test test/web-v0.2-responsive-a11y.test.js test/web-pages.test.js test/web-boundaries.test.js
npm run check
```

Expected: zero failures.

- [ ] **Step 6: Full regression and commit**

```bash
npm test
npm run check
git diff --check
git add web/public/app.css web/public/app.js test/helpers/css-tokens.js test/web-v0.2-responsive-a11y.test.js
git commit -m "feat(web): seal Observatory responsive accessibility"
```

- [ ] **Step 7: Checkpoint D**

Create and verify a recoverable bundle/source archive for Tasks 1–8.

---

# Task 9 — VC1–VC14 Executable Visual Conformance Seal

**Files:**
- Create: `test/web-v0.2-visual-conformance.test.js`
- Create: `docs/WEB_VISUAL_CONFORMANCE_v0.2.md`
- Modify: `package.json` only if a dedicated `test:web:v0.2` script is added; the existing `npm test` and `npm run check` remain authoritative.

**Interfaces:**
- Produces one executable visual-conformance gate mapping VC1–VC14 to actual renderer behavior and inherited W1–W12 tests.
- Does not add production semantics.

- [ ] **Step 1: Write three failing seal tests**

The new conformance file has three high-level tests.

### Test A — VC registry coverage

```js
const REQUIRED = Array.from({length:14},(_,i)=>`VC${i+1}`);
assert.deepEqual(Object.keys(VC_REGISTRY).sort(), REQUIRED.sort());
```

`VC_REGISTRY` maps each VC id to exact test files/assertions and must not contain `SKIP`/`PENDING` states.

### Test B — five-page Observatory vertical slice

Build the existing Web fixture and request:

```text
/
/discover
/actors/actor%3AA
/publications/pub%3Ap1
/communities/community%3AC
```

Require:

```text
200 status
shared Observatory shell
Context Lens disclosure
no fake mutation actions
authored script escaped
semantic fact markers still parse
HTML/API normalized facts remain equal
```

### Test C — boundary/source audit

Read `web/render/*.js` and `web/public/*.js` and assert no imports/references to:

```text
node:sqlite
storage/d1-adapter
env.DB
evaluateAuthority
raw SQL SELECT/INSERT/UPDATE/DELETE in presentation files
localStorage/indexedDB authoritative cache
```

Also require all semantic-edge renderer calls to receive an explicit edge object from page data rather than constructing hidden relation data inside the primitive.

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-v0.2-visual-conformance.test.js
```

Expected: FAIL because `VC_REGISTRY`/final conformance document do not yet exist.

- [ ] **Step 3: Implement VC registry and conformance mapping**

Keep the registry test-only, for example:

```js
const VC_REGISTRY = Object.freeze({
  VC1:['test/web-conformance.test.js','test/web-parity.test.js'],
  VC2:['test/web-context-panel.test.js','test/web-v0.2-shell-context.test.js'],
  VC3:['test/web-v0.2-shell-context.test.js'],
  VC4:['test/web-v0.2-trellis-line.test.js'],
  VC5:['test/web-v0.2-actor.test.js','test/web-v0.2-community.test.js'],
  VC6:['test/web-v0.2-trellis-line.test.js','test/web-v0.2-actor.test.js'],
  VC7:['test/web-v0.2-discover.test.js','test/web-v0.2-community.test.js'],
  VC8:['test/web-v0.2-publication.test.js','test/web-conformance.test.js'],
  VC9:['test/web-v0.2-responsive-a11y.test.js'],
  VC10:['test/web-v0.2-responsive-a11y.test.js'],
  VC11:['test/web-v0.2-responsive-a11y.test.js'],
  VC12:['test/web-v0.2-responsive-a11y.test.js'],
  VC13:['test/web-v0.2-home.test.js','test/web-v0.2-publication.test.js'],
  VC14:['test/web-v0.2-community.test.js']
});
```

Write `docs/WEB_VISUAL_CONFORMANCE_v0.2.md` mapping V1–V6, W1–W12 inheritance, and VC1–VC14 to exact modules/tests. Do not claim empirical browser compatibility beyond what has actually been tested.

- [ ] **Step 4: Verify seal GREEN**

```bash
node --test test/web-v0.2-visual-conformance.test.js
node --test test/web-context-panel.test.js test/web-conformance.test.js test/web-parity.test.js test/web-pages.test.js test/web-v0.2-*.test.js
```

Expected: zero failures.

- [ ] **Step 5: Run the full repository gate twice**

Run twice from the same clean candidate tree:

```bash
npm test
npm run check
git diff --check 8e2dce74333a5db2cfa9fdeea061db0121cc92e8...HEAD
git status --short
```

Expected on each run:

```text
0 test failures
syntax PASS
diff check PASS
only intentional tracked changes before final commit
```

The exact final test count must equal the suite actually produced by the committed tests; do not hard-code a success claim before the run.

- [ ] **Step 6: Commit visual conformance seal**

```bash
git add test/web-v0.2-visual-conformance.test.js docs/WEB_VISUAL_CONFORMANCE_v0.2.md package.json
git commit -m "test(web): seal Trellis Observatory visual conformance"
```

---

# Task 10 — Final Reproducible Delivery and Clean-Extract Verification

**Files:**
- No runtime source edits expected.
- Generate artifacts outside the Git worktree.

**Interfaces:**
- Final branch contains approved spec + implementation plan + all v0.2 implementation commits.
- Delivery must be reconstructable without chat history.

- [ ] **Step 1: Fresh final-HEAD verification**

```bash
npm test
npm run check
git diff --check 8e2dce74333a5db2cfa9fdeea061db0121cc92e8...HEAD
git status --short
```

Completion requires zero failures and a clean tree.

- [ ] **Step 2: Verify W1 semantic parity directly one last time**

```bash
node --test test/web-parity.test.js test/web-conformance.test.js test/web-v0.2-visual-conformance.test.js
```

Expected: PASS for all five public human/API surfaces and final VC gate.

- [ ] **Step 3: Build tracked-source archive**

Use `git archive` from final HEAD so `.git`, local databases, Wrangler state, caches, and untracked files cannot enter the source package.

Required artifact name:

```text
Trellis_Web_v0.2_Observatory_SOURCE_<HEAD>.zip
```

- [ ] **Step 4: Build complete Git bundle**

Create:

```text
Trellis_Web_v0.2_Observatory_<HEAD>.git.bundle
```

Verify with:

```bash
git bundle verify <bundle>
```

and confirm final HEAD is reachable.

- [ ] **Step 5: Export patch series and base-to-head diff**

Create:

```text
patches/*.patch
diffs/8e2dce7-to-<HEAD>.diff
```

using `git format-patch` and `git diff --binary`.

- [ ] **Step 6: Clean-extract verification**

Extract the source ZIP into a fresh directory and run:

```bash
npm test
npm run check
```

If dependencies are not vendored, use the same already-available dependency installation state or document the exact environmental requirement; do not claim clean-extract runtime verification if dependencies cannot actually be resolved.

- [ ] **Step 7: Create final evidence package**

Final single ZIP layout:

```text
Trellis_Web_v0.2_Observatory_FINAL_<DATE>.zip
├─ README_HANDOFF.md
├─ git/
│  └─ Trellis_Web_v0.2_Observatory_<HEAD>.git.bundle
├─ source/
│  └─ Trellis_Web_v0.2_Observatory_SOURCE_<HEAD>.zip
├─ patches/
├─ diffs/
├─ evidence/
│  ├─ final-full.log
│  ├─ final-check.log
│  ├─ parity.log
│  ├─ visual-conformance.log
│  └─ clean-extract.log
├─ design/
│  ├─ 2026-09-08-trellis-web-v0.2-visual-system-design.md
│  └─ 2026-09-08-trellis-web-v0.2-visual-system-implementation-plan.md
└─ SHA256SUMS
```

- [ ] **Step 8: Verify outer package**

Unzip the outer package to a fresh verification directory and run:

```bash
sha256sum -c SHA256SUMS
```

Also verify the inner source ZIP integrity and Git bundle again. Only then report the final SHA-256 and download link.

---

# Checkpoint Schedule

```text
Checkpoint A — Tasks 1–2
Shared Observatory shell, Context Lens, Trellis rendering grammar

Checkpoint B — Tasks 1–4
Home + Discover complete

Checkpoint C — Tasks 1–6
Actor + Publication complete

Checkpoint D — Tasks 1–8
Community + responsive/accessibility complete

Checkpoint E / FINAL — Tasks 1–10
W1–W12 + V1–V6 + VC1–VC14 sealed and reproducibly packaged
```

Each checkpoint must include at minimum a verified Git bundle, tracked-source archive, current spec/plan, focused/full evidence available at that stage, and SHA-256.

---

# Plan Self-Review

## Spec coverage

- V1 Reading before instrumentation: Tasks 3, 5, 6, 7.
- V2 Viewer-safe projection before rendering: Global constraints + Tasks 3–7 + Task 9 source audit.
- V3 No visual edge without a domain edge: Task 2 primitive contract + Tasks 5–7.
- V4 Progressive verifiability: Task 1 Context Lens + all page tasks.
- V5 Graph/list semantic parity: Tasks 2, 5, 7 + Task 9 VC5.
- V6 Absence of visibility is not proof of absence: Tasks 4 and 7 + VC7/VC14.
- W1–W12 preservation: inherited in every task, directly sealed in Task 9 and reverified Task 10.
- Home / Stream: Task 3.
- Discover / Nodes: Task 4.
- Actor / Social Edges: Task 5.
- Publication / Content Edges: Task 6.
- Community / Local Graph: Task 7.
- Mobile Context Lens + adjacency grammar: Task 8.
- WCAG AA token checks: Task 8.
- Reduced motion: Task 8.
- No fake public actions: Tasks 3, 6, 9.
- VC1–VC14: Task 9 registry + executable gate.
- Reproducible canonical handoff: Task 10.

## Placeholder scan

The plan contains no deferred implementation placeholders. Every behavior is assigned to an explicit task, file, test, and verification command.

## Type/interface consistency

- `renderContextLens()` is defined once in Task 1 and reused by later page renderers.
- `renderStructuralSpine()` / `renderSemanticEdge()` are defined in Task 2 and remain pure render functions.
- `renderGraphList()` consumes the same explicit edge objects used by semantic visual graphs.
- Actor graph preview limit is 8; Community preview limit is 12; neither is called ranking/relevance.
- Existing page renderer public entry points remain `renderHomePage`, `renderExplorePage`, `renderProfilePage`, `renderPublicationPage`, `renderCommunityPage`.
- Existing semantic fact markers remain the W1 HTML/JSON parity mechanism.

## Scope check

This plan changes only presentation/rendering and conformance evidence. It does not add authentication, mutation routes, domain data, ranking, storage behavior, new graph ontology, or a frontend framework.
