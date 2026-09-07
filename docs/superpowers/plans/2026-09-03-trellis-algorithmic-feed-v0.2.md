# Trellis Algorithmic Feed v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, explainable owner-only personalized ranking to the existing Home Feed without expanding Feed v0.1's viewer-safe candidate universe or weakening chronological fallback.

**Architecture:** Feed v0.2 reuses the existing `buildFeedSourceGraph()`, Publication collector, Activity collector, and hard Preference filter to obtain the exact eligible item set. A new ranking layer then reads exact-item Consumption state only for those surviving items, computes versioned integer score components, sorts by score and the existing v0.1 chronological comparator, and produces a v2 snapshot/cursor pinned to one trusted ranking reference time. Representative reads and Community Feed remain on the unchanged v0.1 chronological path.

**Tech Stack:** Node.js >=22.5.0, CommonJS, `node:test`, SQLite via `node:sqlite`, existing Trellis EventStore / Preference / Consumption / Feed modules.

**Spec:** `docs/superpowers/specs/2026-09-03-trellis-algorithmic-feed-v0.2-design.md`

## Global Constraints

- `algorithm_ref = trellis-feed:personalized:v2`.
- `projection_version = trellis-feed:0.2`.
- Candidate generation MUST remain Feed v0.1 viewer-filtered source graph + existing Publication/Activity collectors.
- Personal Preference is a hard filter and MUST execute before scoring.
- Consumption is exact-item weak evidence only and MUST NOT expand candidates.
- Reaction, Notification, bookmark, Profile text, Discovery score, Trust, model/provider identity, and telemetry are not v0.2 ranking signals.
- Scores and component points are integers only; no floating-point or stochastic ranking.
- One trusted `ranking_reference_time` is pinned per personalized snapshot and reused by pagination.
- Equal `total_points` MUST delegate to the existing v0.1 `compareFeedItemsDesc()` comparator.
- Representative Home Feed reads MUST return the existing chronological v1 projection without owner-private personalization.
- Community Feed remains chronological v1.
- Algorithmic Feed reads MUST NOT write canonical events, command receipts, Preferences, Consumption, or Notifications.

---

## File Structure

- Create `feed/personalized-score.js` — fixed-point recency/source/novelty components, score reasons, personalized comparator.
- Create `feed/source-tier.js` — deterministic source-tier classification derived only from the viewer-filtered v0.1 source graph and item projection.
- Create `feed/consumption-signal.js` — exact-item lookup from `consumption_state` for already-eligible Feed items.
- Create `feed/personalized-home.js` — v0.2 assembly pipeline over v0.1 visible candidates and existing hard Preference filter.
- Create `feed/personalized-snapshot.js` — v2 snapshot material including ranking reference time and scored item projections.
- Create `feed/personalized-cursor.js` — v2 cursor encoding/decoding/pagination with score and pinned time.
- Create `feed/personalized-read-service.js` — owner personalized read, representative v1 fallback, JSON/HTML reuse.
- Modify `feed/chronological.js` only if needed to export/reuse the existing comparator; do not duplicate it.
- Modify `package.json` only in the final release task if a new folder/pattern is not already covered by `feed/*.js`.
- Add focused tests under `test/algorithmic-feed-*.test.js` and final `test/algorithmic-feed-conformance.test.js`.

---

### Task 1: Fixed-Point Scoring and Total-Order Comparator

**Files:**
- Create: `feed/personalized-score.js`
- Modify: `feed/chronological.js` only if its comparator is not already exported
- Test: `test/algorithmic-feed-score.test.js`

**Interfaces:**
- Consumes: Feed item shape containing `sort.recorded_at`, `sort.global_offset`, `feed_item_id`.
- Produces: `recencyComponent(item, rankingReferenceTime)`, `noveltyComponent(state, itemType)`, `scoreItem({item, sourceComponent, consumptionState, rankingReferenceTime})`, `comparePersonalizedFeedItemsDesc(a,b)`.

- [ ] **Step 1: Write the failing scoring/comparator tests**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  recencyComponent,
  noveltyComponent,
  scoreItem,
  comparePersonalizedFeedItemsDesc
} = require('../feed/personalized-score');
const { compareFeedItemsDesc } = require('../feed/chronological');

test('recency uses deterministic integer buckets at one reference time', () => {
  const ref = '2026-09-03T12:00:00.000Z';
  const item = { sort: { recorded_at: '2026-09-03T10:00:00.000Z' } };
  assert.deepEqual(recencyComponent(item, ref), { type: 'recent_6h', component: 'recency', points: 5000 });
});

test('opened publication novelty is exact integer penalty', () => {
  assert.deepEqual(noveltyComponent({ first_opened_at: '2026-09-03T11:00:00.000Z' }, 'publication'), {
    type: 'opened_before', component: 'novelty', points: -1500
  });
});

test('equal scores delegate exactly to v1 chronological comparator', () => {
  const a = { feed_item_id:'feed:a', sort:{recorded_at:'2026-09-03T10:00:00.000Z',global_offset:2}, score:{total_points:7000} };
  const b = { feed_item_id:'feed:b', sort:{recorded_at:'2026-09-03T09:00:00.000Z',global_offset:3}, score:{total_points:7000} };
  assert.equal(Math.sign(comparePersonalizedFeedItemsDesc(a,b)), Math.sign(compareFeedItemsDesc(a,b)));
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/algorithmic-feed-score.test.js`

Expected: FAIL because `feed/personalized-score.js` does not exist.

- [ ] **Step 3: Implement minimal fixed-point scoring**

```js
const { compareFeedItemsDesc } = require('./chronological');

const RECENCY_BUCKETS = [
  [60*60*1000, 6000, 'recent_1h'],
  [6*60*60*1000, 5000, 'recent_6h'],
  [24*60*60*1000, 4000, 'recent_24h'],
  [72*60*60*1000, 3000, 'recent_72h'],
  [7*24*60*60*1000, 2000, 'recent_7d'],
  [30*24*60*60*1000, 1000, 'recent_30d']
];

function recencyComponent(item, rankingReferenceTime) {
  const age = Math.max(0, Date.parse(rankingReferenceTime) - Date.parse(item.sort.recorded_at));
  const bucket = RECENCY_BUCKETS.find(([max]) => age <= max);
  return bucket
    ? { type: bucket[2], component: 'recency', points: bucket[1] }
    : { type: 'older_than_30d', component: 'recency', points: 0 };
}

function noveltyComponent(row, itemType) {
  if (!row) return { type:'not_seen_before', component:'novelty', points:1000 };
  if (itemType === 'publication' && row.first_opened_at) return { type:'opened_before', component:'novelty', points:-1500 };
  return { type:'seen_before', component:'novelty', points:-500 };
}

function scoreItem({ item, sourceComponent, consumptionState, rankingReferenceTime }) {
  const reasons = [recencyComponent(item, rankingReferenceTime), sourceComponent, noveltyComponent(consumptionState, item.item_type)];
  const total = reasons.reduce((sum, reason) => sum + reason.points, 0);
  return { ...item, score:{recency_points:reasons[0].points,source_points:sourceComponent.points,novelty_points:reasons[2].points,total_points:total}, ranking_reasons:reasons };
}

function comparePersonalizedFeedItemsDesc(a,b) {
  if (a.score.total_points !== b.score.total_points) return b.score.total_points - a.score.total_points;
  return compareFeedItemsDesc(a,b);
}
```

- [ ] **Step 4: Run targeted and full tests**

Run: `node --test test/algorithmic-feed-score.test.js && npm test`

Expected: targeted PASS and full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add feed/personalized-score.js feed/chronological.js test/algorithmic-feed-score.test.js
git commit -m "feat: add deterministic feed v2 scoring"
```

---

### Task 2: Source-Tier Classification From Viewer-Safe v1 Sources

**Files:**
- Create: `feed/source-tier.js`
- Test: `test/algorithmic-feed-source-tier.test.js`

**Interfaces:**
- Consumes: v0.1 `sourceGraph` and existing Feed item projection.
- Produces: `sourceComponentForItem(item, sourceGraph)` returning exactly one `{type,component:'source',points}`.

- [ ] **Step 1: Write failing precedence tests**

```js
test('subscription outranks follow for the same unscoped publication', () => {
  const sourceGraph = {
    subject_actor_id:'actor:A',
    actor_source_ids:['actor:B'],
    community_source_ids:[],
    source_relationships:[
      {relationship_type:'follows',target_entity_id:'actor:B'},
      {relationship_type:'subscribes_to',target_entity_id:'actor:B'}
    ]
  };
  const item = {item_type:'publication', publication:{author_actor_id:'actor:B',scope_ref:null}};
  assert.deepEqual(sourceComponentForItem(item,sourceGraph), {type:'subscribed_actor',component:'source',points:3000});
});

test('self publication beats community source', () => {
  const item = {item_type:'publication',publication:{author_actor_id:'actor:A',scope_ref:'community:C'}};
  assert.equal(sourceComponentForItem(item,{subject_actor_id:'actor:A',source_relationships:[],community_source_ids:['community:C']}).type,'self_publication');
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/algorithmic-feed-source-tier.test.js`

Expected: FAIL because source-tier module is missing.

- [ ] **Step 3: Implement deterministic single-tier classification**

Use only `sourceGraph.source_relationships`, `sourceGraph.community_source_ids`, subject identity, and the already-visible item projection. Never query hidden relationships or add candidates.

- [ ] **Step 4: Run targeted and full tests**

Run: `node --test test/algorithmic-feed-source-tier.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add feed/source-tier.js test/algorithmic-feed-source-tier.test.js
git commit -m "feat: classify feed v2 source strength"
```

---

### Task 3: Exact-Item Consumption Lookup Only

**Files:**
- Create: `feed/consumption-signal.js`
- Test: `test/algorithmic-feed-consumption.test.js`

**Interfaces:**
- Consumes: already-visible Feed item, owner Actor ID, SQLite DB.
- Produces: `consumptionForFeedItem({ownerActorId,item,db})` returning the exact row or `null`.

- [ ] **Step 1: Write failing exact-item tests**

```js
test('publication Feed item resolves only its exact publication consumption row', () => {
  const row = consumptionForFeedItem({ownerActorId:'actor:A',item:{item_type:'publication',source_ref:'pub:P'},db});
  assert.equal(row.target_ref,'pub:P');
});

test('consumption for another publication cannot affect this item', () => {
  assert.equal(consumptionForFeedItem({ownerActorId:'actor:A',item:{item_type:'publication',source_ref:'pub:OTHER'},db}),null);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/algorithmic-feed-consumption.test.js`

Expected: FAIL because module is missing.

- [ ] **Step 3: Implement exact lookup using `ConsumptionStore.get()`**

```js
const { ConsumptionStore } = require('../consumption/store');
function consumptionForFeedItem({ ownerActorId, item, db }) {
  const store = new ConsumptionStore(db);
  if (item.item_type === 'publication') return store.get(ownerActorId,'publication',item.source_ref);
  if (item.item_type === 'social_activity') return store.get(ownerActorId,'social_activity',item.source_event_ref);
  return null;
}
```

Do not scan all Consumption rows and do not perform candidate discovery here.

- [ ] **Step 4: Run targeted/full regression**

Run: `node --test test/algorithmic-feed-consumption.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add feed/consumption-signal.js test/algorithmic-feed-consumption.test.js
git commit -m "feat: add exact-item feed consumption signal"
```

---

### Task 4: Personalized Home Feed Assembly

**Files:**
- Create: `feed/personalized-home.js`
- Test: `test/algorithmic-feed-home.test.js`

**Interfaces:**
- Consumes: `buildFeedSourceGraph()`, `collectHomePublicationItems()`, `collectHomeActivityItems()`, `applyOwnerFeedPreferences()`, Tasks 1–3 helpers.
- Produces: `buildPersonalizedHomeFeed({subjectActorId,viewerContext,db,eventStore,disclosurePolicy,rankingReferenceTime})`.

- [ ] **Step 1: Write failing vertical-slice tests**

Required assertions:

```js
assert.deepEqual(v2PrePreferenceIds, v1PrePreferenceIds);
assert.equal(v2.items.some(i => i.source_ref === dismissedPublication), false);
assert.equal(v2.items.find(i => i.source_ref === seenPublication).score.novelty_points, -500);
assert.equal(v2.items.find(i => i.source_ref === openedPublication).score.novelty_points, -1500);
assert.deepEqual(scoreBeforeBookmark, scoreAfterBookmark);
assert.equal(v2.algorithm_ref, 'trellis-feed:personalized:v2');
```

Also assert all score/reason values are integers and `total_points === sum(ranking_reasons.points)`.

- [ ] **Step 2: Run RED**

Run: `node --test test/algorithmic-feed-home.test.js`

Expected: FAIL because personalized builder is missing.

- [ ] **Step 3: Implement the v2 pipeline**

Pipeline MUST be exactly:

```js
const sourceGraph = buildFeedSourceGraph(...);
const visibleCandidates = [
  ...collectHomePublicationItems(...),
  ...collectHomeActivityItems(...)
];
const filtered = applyOwnerFeedPreferences({ownerActorId:subjectActorId,viewerContext,items:visibleCandidates,db});
const scored = filtered.map(item => scoreItem({
  item,
  sourceComponent: sourceComponentForItem(item,sourceGraph),
  consumptionState: consumptionForFeedItem({ownerActorId:subjectActorId,item,db}),
  rankingReferenceTime
}));
scored.sort(comparePersonalizedFeedItemsDesc);
```

No Feed candidate collector may be replaced or broadened.

- [ ] **Step 4: Run targeted/full regression**

Run: `node --test test/algorithmic-feed-home.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add feed/personalized-home.js test/algorithmic-feed-home.test.js
git commit -m "feat: assemble personalized home feed v2"
```

---

### Task 5: v2 Snapshot, Cursor, and Pinned Ranking Time

**Files:**
- Create: `feed/personalized-snapshot.js`
- Create: `feed/personalized-cursor.js`
- Modify: `feed/personalized-home.js`
- Test: `test/algorithmic-feed-cursor.test.js`

**Interfaces:**
- Produces: `computePersonalizedFeedSnapshotRef(...)`, `encodePersonalizedFeedCursor()`, `decodePersonalizedFeedCursor()`, `paginatePersonalizedFeed()`.

- [ ] **Step 1: Write failing snapshot/cursor tests**

Test that cursor contains:

```js
{
  algorithm_ref:'trellis-feed:personalized:v2',
  snapshot_ref:'...',
  ranking_reference_time:'2026-09-03T12:00:00.000Z',
  last_total_points:8000,
  last_recorded_at:'...',
  last_global_offset:412,
  last_item_id:'feed:...'
}
```

Assert page 2 reuses the pinned reference time, visible scored-state change throws `FEED_SNAPSHOT_CHANGED`, and hidden-only/irrelevant state changes do not change the snapshot.

- [ ] **Step 2: Run RED**

Run: `node --test test/algorithmic-feed-cursor.test.js`

Expected: FAIL because v2 snapshot/cursor modules are missing.

- [ ] **Step 3: Implement v2 snapshot and pagination**

Snapshot material MUST include only:

```text
algorithm_ref
projection_version
ranking_reference_time
subject/viewer identity and scope
viewer-filtered source_graph
final scored items
```

Cursor matching MUST include `last_total_points` plus the complete v1 chronological key.

- [ ] **Step 4: Run targeted/full regression**

Run: `node --test test/algorithmic-feed-cursor.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add feed/personalized-snapshot.js feed/personalized-cursor.js feed/personalized-home.js test/algorithmic-feed-cursor.test.js
git commit -m "feat: add replayable personalized feed pagination"
```

---

### Task 6: Read Service, Representative Fallback, and Presentation Parity

**Files:**
- Create: `feed/personalized-read-service.js`
- Modify: `feed/render-html.js` only if generic rendering currently strips v2 score fields
- Modify: `feed/render-json.js` only if required for exact object parity
- Test: `test/algorithmic-feed-surface.test.js`

**Interfaces:**
- Produces: `loadPersonalizedHomeFeedSurface({subjectActorId,viewerContext,db,eventStore,disclosurePolicy,limit,cursor,now})`.

- [ ] **Step 1: Write failing self/representative/fallback tests**

```js
test('owner gets personalized v2 while representative gets chronological v1', () => {
  const owner = loadPersonalizedHomeFeedSurface({...ownerArgs});
  const rep = loadPersonalizedHomeFeedSurface({...representativeArgs});
  assert.equal(owner.algorithm_ref,'trellis-feed:personalized:v2');
  assert.equal(rep.algorithm_ref,'trellis-feed:chronological:v1');
  assert.equal('ranking_reference_time' in rep,false);
});
```

Also assert Community Feed remains v1 and rendering does not create canonical or operational writes.

- [ ] **Step 2: Run RED**

Run: `node --test test/algorithmic-feed-surface.test.js`

Expected: FAIL because personalized read service is missing.

- [ ] **Step 3: Implement explicit owner-only personalization**

If `viewer_actor_id !== subject_actor_id`, delegate directly to existing Feed v1 read path. Do not inspect owner Preferences or Consumption first. For owner reads, pin one trusted `now()` value as `ranking_reference_time`, build/paginate v2, and pass the same final object to JSON/HTML adapters.

- [ ] **Step 4: Run targeted/full regression**

Run: `node --test test/algorithmic-feed-surface.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add feed/personalized-read-service.js feed/render-html.js feed/render-json.js test/algorithmic-feed-surface.test.js
git commit -m "feat: expose personalized feed v2 surface"
```

---

### Task 7: Determinism, Non-Signals, and Chronological Degeneration

**Files:**
- Test: `test/algorithmic-feed-cross-domain.test.js`
- Modify production only if the RED demonstrates an actual coupling.

**Interfaces:**
- Verifies AF2, AF6, AF12–AF17 and Foundation X3 behavior.

- [ ] **Step 1: Write cross-domain RED tests**

Required cases:

```text
same eligible inputs + same ranking_reference_time -> deep-equal scores/reasons/order/snapshot/pagination
all S+N equal -> v2 order equals v1 order
Reaction create/change/withdraw -> no v2 score/order/snapshot change
Notification issue/ack -> no v2 score/order/snapshot change
bookmark -> no ranking effect
hidden relationship / hidden target / hidden Consumption row -> no ranking signal
Consumption loss -> Feed remains available and missing row becomes unseen
representative -> v1 fallback regardless of owner's private state
Community Feed -> v1 unchanged
```

- [ ] **Step 2: Run RED or immediate GREEN**

Run: `node --test test/algorithmic-feed-cross-domain.test.js`

If all behavior is already correct, record that no production patch is required. If a failure appears, use systematic debugging and change only the layer responsible for the demonstrated coupling.

- [ ] **Step 3: Run full regression**

Run: `npm test && npm run check && git diff --check`

Expected: PASS.

- [ ] **Step 4: Commit tests/fixes**

```bash
git add test/algorithmic-feed-cross-domain.test.js feed/
git commit -m "test: seal algorithmic feed cross-domain boundaries"
```

---

### Task 8: AF1–AF17 Final Conformance and Release Gate

**Files:**
- Create: `test/algorithmic-feed-conformance.test.js`
- Create: `docs/ALGORITHMIC_FEED_CONFORMANCE_v0.2.md`
- Modify: `package.json` only if needed for syntax coverage

**Interfaces:**
- Final executable mapping of AF1–AF17 plus inherited X1–X3.

- [ ] **Step 1: Write final conformance RED**

The test MUST verify:

```text
AF1 score DESC then exact v1 comparator
AF2 equal S+N degenerates to v1 order
AF3 all score fields integer
AF4 one trusted ranking_reference_time per snapshot
AF5 reference time included in snapshot/cursor identity
AF6 deterministic replay deep equality
AF7 sum(reason.points) == total_points
AF8 tie-break values never appear as score reasons
AF9 scored candidates equal hard-filter(v1 visible pre-preference candidates)
AF10 no suppressed item is scored
AF11 exact-item consumption only
AF12 Reaction/Notification/bookmark non-signals
AF13 representative chronological fallback
AF14 Consumption loss preserves Feed availability
AF15 reads do not mutate canonical/operational state
AF16 invisible/ineligible facts produce zero ranking signal
AF17 Community Feed remains chronological v1
X1-X3 registry entry for feed remains unchanged
```

Also test invalid client-supplied ranking reference time if the public read API does not permit it.

- [ ] **Step 2: Run RED**

Run: `node --test test/algorithmic-feed-conformance.test.js`

Expected: any remaining missing release-discipline or invariant gap is exposed explicitly.

- [ ] **Step 3: Make only the minimal final fixes**

Do not add new ranking features. Fix only demonstrated AF1–AF17 gaps, syntax coverage, or conformance documentation.

- [ ] **Step 4: Run two complete pre-commit gates**

Run twice:

```bash
npm test
npm run check
git diff --check consumption/v0.1...HEAD
git diff --check
```

Expected: full suite PASS twice, syntax PASS twice, both diff checks clean.

- [ ] **Step 5: Commit final seal**

```bash
git add test/algorithmic-feed-conformance.test.js docs/ALGORITHMIC_FEED_CONFORMANCE_v0.2.md package.json feed/
git commit -m "test: seal Algorithmic Feed v0.2 conformance"
```

- [ ] **Step 6: Fresh final-HEAD verification**

Run:

```bash
npm test
npm run check
git diff --check consumption/v0.1...HEAD
git status --short
```

Expected: all tests PASS, syntax PASS, diff clean, working tree clean.
