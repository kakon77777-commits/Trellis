# Trellis Feed v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, viewer-relative Trellis Home Feed and Community Feed that projects viewer-safe Publication roots and a small allowlist of social activities without introducing any Feed canonical truth.

**Architecture:** Feed is a fan-out-on-read derived layer. It first authorizes the Feed subject/viewer context, then resolves only viewer-visible source relationships, projects viewer-readable Publication roots and allowlisted social activities, sorts them chronologically by canonical creation/source-event order, and paginates with a deterministic visible-input snapshot. Renderers consume the already-filtered Feed object and have no storage or mutation access.

**Tech Stack:** Node.js >=22.5.0, CommonJS, built-in `node:test`, `node:assert/strict`, `node:crypto`, existing `node:sqlite` Trellis storage/projection stack.

**Spec:** `docs/superpowers/specs/2026-09-03-trellis-feed-v0.1-design.md`

## Global Constraints

- Feed inherits Foundation Cross-Domain Contract X1-X3.
- Feed introduces no canonical event stream or authoritative Feed table.
- Feed candidate generation occurs only after viewer visibility projection.
- Hidden source relationships/memberships cannot affect candidate presence, ordering, counts, snapshot refs, or cursors.
- Home Feed source relationships are only active viewer-visible `follows`, `subscribes_to`, and `member_of` relationships plus subject-self.
- `trusts`, `collaborates_with`, `reviews`, `delegates_to`, and Discovery scores are not Feed subscriptions.
- Replies (`reply_to_ref != null`) are excluded as Home/Community root Feed Publications.
- Publication revisions update rendered content but never resurface/reorder the item.
- Withdrawn Publications are excluded from current Feed.
- Publication reference context always comes from the Publication read service and inherits O13-O15.
- Social Activity v0.1 allowlist contains only `member_of` activation and `collaborates_with` activation.
- Feed activity items are derived from canonical source events and never become canonical objects.
- Feed action hints are advisory only and never reusable as authorization.
- Feed Subject and Viewer remain distinct; read authority grants no social mutation authority.
- No engagement, ML/LLM ranking, reactions, read/seen state, notifications, persistent dismissals, or AI Board message ingestion.
- No persistent Feed cache/table is required in v0.1.

---

## File Map

```text
feed/
├── context.js
├── source-graph.js
├── publication-items.js
├── activity-items.js
├── chronological.js
├── snapshot.js
├── cursor.js
├── action-hints.js
├── home.js
├── community.js
├── read-service.js
├── render-html.js
└── render-json.js

test/
├── feed-context.test.js
├── feed-source-graph.test.js
├── feed-publications.test.js
├── feed-activities.test.js
├── feed-home.test.js
├── feed-community.test.js
├── feed-cursor.test.js
├── feed-surface.test.js
└── feed-conformance.test.js

docs/
└── FEED_CONFORMANCE_v0.1.md
```

No Feed migration or authoritative Feed table is created.

---

### Task 1: Feed Subject Authority and Viewer-Visible Source Graph

**Files:**
- Create: `feed/context.js`
- Create: `feed/source-graph.js`
- Create: `test/feed-context.test.js`
- Create: `test/feed-source-graph.test.js`

**Interfaces:**
- Produces: `authorizeFeedSubject(subjectActorId, viewerContext) -> { viewer_scope }`
- Produces: `buildFeedSourceGraph({ subjectActorId, viewerContext, db, eventStore, disclosurePolicy }) -> FeedSourceGraph`
- `FeedSourceGraph` contains only viewer-visible actor/community source relationships.

- [ ] **Step 1: Write RED tests for subject/viewer separation**

Tests must prove:

```text
subject self -> allowed
explicit representative -> allowed
unrelated viewer -> FEED_NOT_AUTHORIZED
representative viewer does not replace subject_actor_id
```

Also capture canonical event count before/after the read and require no change.

- [ ] **Step 2: Run the context test and verify RED**

Run:

```bash
node --test test/feed-context.test.js
```

Expected: FAIL because `feed/context.js` does not exist.

- [ ] **Step 3: Implement minimal Feed context**

`authorizeFeedSubject` must mirror the established Discovery subject/viewer split without importing mutation services. It may inspect `viewer_actor_id` and `represents_actor_ids` only.

- [ ] **Step 4: Write RED source-graph tests**

Create real Trellis actors/relationships and prove:

```text
public follows(A,B) -> B actor source
follows(A,X) denied by current disclosure policy -> X not source
visible subscribes_to(A,Y) -> Y actor source
visible member_of(A,C) -> C community source
private/hidden member_of(A,C2) -> C2 not source
trusts/collaborates_with/reviews/delegates_to -> never source
```

- [ ] **Step 5: Run source-graph test and verify RED**

```bash
node --test test/feed-source-graph.test.js
```

Expected: FAIL because `feed/source-graph.js` is missing.

- [ ] **Step 6: Implement source graph using existing visibility contracts**

Query only active relationships involving the subject as source for `follows`, `subscribes_to`, and `member_of`; filter each through existing `canViewRelationship(...)` with the Community membership resolver before adding it to the source set.

Return stable-sorted arrays:

```js
{
  subject_actor_id,
  viewer_scope,
  actor_source_ids,
  community_source_ids,
  source_relationships
}
```

- [ ] **Step 7: Run Task 1 tests and full regression**

```bash
node --test test/feed-context.test.js test/feed-source-graph.test.js
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add feed/context.js feed/source-graph.js test/feed-context.test.js test/feed-source-graph.test.js
git commit -m "feat: add viewer-safe Feed source graph"
```

---

### Task 2: Publication Root Feed Items and Creation-Time Ordering

**Files:**
- Create: `feed/publication-items.js`
- Create: `feed/chronological.js`
- Create: `test/feed-publications.test.js`

**Interfaces:**
- Produces: `collectHomePublicationItems({ sourceGraph, viewerContext, db, eventStore, disclosurePolicy }) -> FeedItem[]`
- Produces: `publicationFeedItem({ publicationSurface, creationEvent }) -> FeedItem`
- Produces: `sortFeedItems(items) -> FeedItem[]`

- [ ] **Step 1: Write RED Publication candidate tests**

Use real Publication commands/projections and verify:

```text
subject root Publication -> included
visible followed actor global root Publication -> included
hidden-follow actor public Publication -> excluded
visible Community-scoped root Publication -> included
reply_to_ref Publication -> excluded
withdrawn Publication -> excluded
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test test/feed-publications.test.js
```

Expected: FAIL because Publication Feed collector is absent.

- [ ] **Step 3: Implement root Publication collection**

For each candidate row, call `loadPublicationSurface(...)`; never expose a raw `publications_current` row directly.

Only include `lifecycle='active'` and `reply_to_ref IS NULL`.

Resolve the canonical `publication.created` event from `canonical_events` and use its `recorded_at` and `global_offset` as immutable sort metadata.

- [ ] **Step 4: Add RED revision-ordering test**

Create P1, create later P2, revise P1, and require:

```text
P1 body == revised body
P2 remains newer than P1
P1 sort metadata still equals P1 publication.created event
```

- [ ] **Step 5: Implement deterministic chronological sorter**

Sort descending by:

```text
recorded_at
global_offset
feed_item_id
```

with stable string comparison for the final key.

- [ ] **Step 6: Run Publication tests and full regression**

```bash
node --test test/feed-publications.test.js
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add feed/publication-items.js feed/chronological.js test/feed-publications.test.js
git commit -m "feat: project Publication roots into chronological Feed"
```

---

### Task 3: Allowlisted Social Activity Projection

**Files:**
- Create: `feed/activity-items.js`
- Create: `test/feed-activities.test.js`

**Interfaces:**
- Produces: `collectHomeActivityItems({ sourceGraph, subjectActorId, viewerContext, db, eventStore, disclosurePolicy }) -> FeedItem[]`
- Produces: `collectCommunityActivityItems({ communityId, viewerContext, db, eventStore, disclosurePolicy }) -> FeedItem[]`

- [ ] **Step 1: Write RED activity allowlist tests**

Prove:

```text
visible member_of activation -> community_joined activity
visible collaborates_with activation -> collaboration_started activity
follow activation -> no activity item
relationship termination -> no activity item
contestation/evidence -> no activity item
```

- [ ] **Step 2: Add RED hidden-activity tests**

A hidden `member_of` or hidden `collaborates_with` relation must not produce:

```text
activity item
activity count
source-event reference
ordering effect
```

- [ ] **Step 3: Run and verify RED**

```bash
node --test test/feed-activities.test.js
```

Expected: FAIL because activity projector is absent.

- [ ] **Step 4: Implement activity projection from canonical activation events**

Query canonical `relationship.activated` events, resolve the corresponding current relationship state, and apply existing viewer relationship visibility before constructing an activity.

Allow only:

```text
member_of -> community_joined
collaborates_with -> collaboration_started
```

Use the source event's `recorded_at`, `global_offset`, and `event_id` as immutable ordering/identity data.

- [ ] **Step 5: Implement Home relevance filter**

Home Feed activity is relevant only when:

```text
community_joined -> community is in visible community source set
collaboration_started -> subject is endpoint OR at least one endpoint is a visible actor source
```

No Discovery signal is consulted.

- [ ] **Step 6: Run tests and regression**

```bash
node --test test/feed-activities.test.js
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add feed/activity-items.js test/feed-activities.test.js
git commit -m "feat: add allowlisted social activity Feed projection"
```

---

### Task 4: Home Feed Assembly and X3 Visible-Input Snapshot

**Files:**
- Create: `feed/snapshot.js`
- Create: `feed/home.js`
- Create: `test/feed-home.test.js`

**Interfaces:**
- Produces: `buildHomeFeedSnapshot(...) -> { snapshot_ref, source_graph, publication_items, activity_items }`
- Produces: `buildHomeFeed(...) -> FeedSurface`
- Algorithm ref: `trellis-feed:chronological:v1`

- [ ] **Step 1: Write RED full Home Feed acceptance test**

Create A, B, X, C with:

```text
A follows B public
A follows X canonical, but current disclosure policy denies this source relation to the Feed viewer
A member_of C visible
```

Create P1 from B, P2 from X, P3 from A, reply P4 to P1, scoped P5 in C.

Require Feed roots exactly P1/P3/P5 and never P2/P4.

- [ ] **Step 2: Add RED hidden-fact noninterference test**

Capture full Feed snapshot/output, then add only viewer-invisible:

```text
hidden relationship
private membership
private Publication
hidden allowlisted activity source
```

Require exact deep equality of:

```text
items
ordering
snapshot_ref
```

- [ ] **Step 3: Run and verify RED**

```bash
node --test test/feed-home.test.js
```

Expected: FAIL because Home Feed assembly does not exist.

- [ ] **Step 4: Implement snapshot from already-visible inputs only**

Compute SHA-256 over canonical JSON containing only:

```text
subject_actor_id
viewer identity/representation key
algorithm_ref
visible source graph
viewer-visible Publication item projections + immutable sort keys
viewer-visible Activity item projections + immutable sort keys
projection-version refs
```

Do not hash hidden DB counts or raw canonical totals.

- [ ] **Step 5: Implement Home Feed assembly**

Combine Publication and Activity items, apply `sortFeedItems`, and return:

```js
{
  feed_type: 'home',
  subject_actor_id,
  viewer_scope,
  algorithm_ref,
  snapshot_ref,
  items,
  projection_version: 'trellis-feed:0.1'
}
```

Feed assembly has no EventStore append/mutation dependency.

- [ ] **Step 6: Run tests and regression**

```bash
node --test test/feed-home.test.js
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add feed/snapshot.js feed/home.js test/feed-home.test.js
git commit -m "feat: assemble deterministic viewer-relative Home Feed"
```

---

### Task 5: Community Feed

**Files:**
- Create: `feed/community.js`
- Create: `test/feed-community.test.js`

**Interfaces:**
- Produces: `buildCommunityFeed({ communityId, viewerContext, db, eventStore, disclosurePolicy }) -> FeedSurface | null`

- [ ] **Step 1: Write RED Community Feed tests**

Verify a readable Community Feed includes only:

```text
active root Publications with scope_ref = communityId
member_of activation for that Community
collaborates_with activation with scope_ref = communityId
```

and excludes:

```text
global Publications
replies
other Community Publications
non-allowlisted events
withdrawn Publications
```

- [ ] **Step 2: Add RED private Community test**

An outsider unable to read a private Community gets `null`/NOT_VISIBLE-equivalent and learns no item count, event ID, or snapshot.

- [ ] **Step 3: Run and verify RED**

```bash
node --test test/feed-community.test.js
```

Expected: FAIL because Community Feed does not exist.

- [ ] **Step 4: Implement Community Feed using existing Community read authority**

Call `buildCommunitySurface(...)` first. If it returns null, stop before Publication/activity candidate generation.

Then collect only viewer-readable, Community-scoped roots and allowlisted Community activities.

- [ ] **Step 5: Run tests and regression**

```bash
node --test test/feed-community.test.js
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add feed/community.js test/feed-community.test.js
git commit -m "feat: add viewer-relative Community Feed"
```

---

### Task 6: Cursor and Snapshot-Stable Pagination

**Files:**
- Create: `feed/cursor.js`
- Create: `test/feed-cursor.test.js`

**Interfaces:**
- Produces: `encodeFeedCursor(cursor) -> string`
- Produces: `decodeFeedCursor(value) -> cursor`
- Produces: `paginateFeed({ feed, limit, cursor }) -> { items, next_cursor }`

- [ ] **Step 1: Write RED deterministic cursor tests**

Cursor must encode only:

```text
algorithm_ref
snapshot_ref
last_recorded_at
last_global_offset
last_item_id
```

No timestamp-now or hidden aggregate is allowed.

- [ ] **Step 2: Add RED stable pagination tests**

For unchanged visible Feed state:

```text
page1 + cursor -> stable page2
same input -> same cursor
```

For changed visible snapshot:

```text
old cursor -> FEED_SNAPSHOT_CHANGED
```

For only hidden state changes:

```text
snapshot_ref unchanged
old cursor remains valid
```

- [ ] **Step 3: Run and verify RED**

```bash
node --test test/feed-cursor.test.js
```

Expected: FAIL because cursor implementation is absent.

- [ ] **Step 4: Implement base64url canonical-JSON cursor**

Validate algorithm/snapshot equality before selecting items after the cursor's chronological key.

- [ ] **Step 5: Run tests and regression**

```bash
node --test test/feed-cursor.test.js
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add feed/cursor.js test/feed-cursor.test.js
git commit -m "feat: add snapshot-stable Feed pagination"
```

---

### Task 7: Human/Machine Feed Surfaces and Advisory Actions

**Files:**
- Create: `feed/action-hints.js`
- Create: `feed/read-service.js`
- Create: `feed/render-html.js`
- Create: `feed/render-json.js`
- Create: `test/feed-surface.test.js`

**Interfaces:**
- Produces: `availableFeedActions(item, viewerContext) -> string[]`
- Produces: `loadHomeFeedSurface(...)`
- Produces: `loadCommunityFeedSurface(...)`
- Produces: `renderFeedJson(surface) -> string`
- Produces: `renderFeedHtml(surface) -> string`

- [ ] **Step 1: Write RED action-hint tests**

Require hints such as `open_publication` / `reply` / `open_community` to be advisory only. The Feed module must export no canonical mutation command or EventStore append surface.

- [ ] **Step 2: Write RED HTML/JSON parity tests**

Render the same already-filtered Feed object and verify both surfaces contain the same visible item IDs/content and neither contains hidden-source IDs/content.

Renderers must HTML-escape authored content and have no DB/EventStore import.

- [ ] **Step 3: Run and verify RED**

```bash
node --test test/feed-surface.test.js
```

Expected: FAIL because surface modules are absent.

- [ ] **Step 4: Implement surface service and renderers**

`read-service.js` delegates to Home/Community builders + pagination only. Renderers receive plain Feed surfaces and never perform visibility expansion or storage reads.

- [ ] **Step 5: Run tests and regression**

```bash
node --test test/feed-surface.test.js
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add feed/action-hints.js feed/read-service.js feed/render-html.js feed/render-json.js test/feed-surface.test.js
git commit -m "feat: add Trellis Feed human and machine surfaces"
```

---

### Task 8: F1-F12 and Cross-Domain Feed Conformance Seal

**Files:**
- Modify: `foundation/cross-domain-contract.js`
- Modify: `docs/specs/2026-09-02-trellis-foundation-cross-domain-contract-v0.1.md`
- Modify: `package.json`
- Create: `test/feed-conformance.test.js`
- Create: `docs/FEED_CONFORMANCE_v0.1.md`

**Interfaces:**
- Adds `feed: ['X1','X2','X3']` to the machine-readable Foundation inheritance registry.
- Produces executable F1-F12 release gate.

- [ ] **Step 1: Write RED machine-readable inheritance test**

Assert Foundation contract declares:

```js
INHERITORS.feed === ['X1', 'X2', 'X3']
```

- [ ] **Step 2: Write RED end-to-end Feed conformance test**

Execute the full acceptance slice from the spec and assert:

```text
canonical event count unchanged by Feed reads
hidden source relation excludes otherwise-public Publication
reply root excluded
revision changes body but not sort key
withdrawal removes current Feed item
hidden facts do not change Feed semantic output or snapshot
```

- [ ] **Step 3: Add RED destructive rebuild test**

Capture Feed output, delete disposable Relationship/Profile/Publication projections, rebuild them from canonical histories, and require the same Feed output for the same subject/viewer/algorithm.

- [ ] **Step 4: Add RED negative API surface test**

Assert Feed exports contain no:

```text
appendFeedEvent
createCanonicalFeedItem
markSeenCanonical
mutatePublication
mutateRelationship
autoFollowFromDiscovery
```

- [ ] **Step 5: Add RED release syntax-gate test**

Assert `package.json` check script contains:

```text
feed/*.js
```

- [ ] **Step 6: Run conformance and verify RED**

```bash
node --test test/feed-conformance.test.js
```

Expected: behavior may already pass, but machine-readable inheritance and/or syntax gate must fail until implemented.

- [ ] **Step 7: Update Foundation inheritance registry/documentation**

Add Feed as an X1-X3 inheritor and document:

```text
F3/F4/F12 -> X3
F8 -> X2
all canonical Feed inputs -> X1 ceilings
```

Do not change X1-X3 meanings/version.

- [ ] **Step 8: Extend syntax gate**

Add `feed/*.js` to `npm run check`.

- [ ] **Step 9: Write `docs/FEED_CONFORMANCE_v0.1.md`**

Map F1-F12 and inherited X1-X3 to executable tests. State explicit non-goals and the fan-out-on-read baseline.

- [ ] **Step 10: Run the complete gate twice**

```bash
npm test
npm run check
git diff --check publication/v0.1...HEAD

npm test
npm run check
git diff --check publication/v0.1...HEAD
```

Expected both times:

```text
0 test failures
syntax gate pass
diff check clean
```

- [ ] **Step 11: Commit**

```bash
git add foundation/cross-domain-contract.js docs/specs/2026-09-02-trellis-foundation-cross-domain-contract-v0.1.md package.json test/feed-conformance.test.js docs/FEED_CONFORMANCE_v0.1.md
git commit -m "test: seal Trellis Feed v0.1 conformance gate"
```

---

## Definition of Done

Feed v0.1 is complete only when all of the following hold simultaneously:

```text
Home Feed works for subject self and explicit representative viewer
source relations are filtered before candidate generation
Publication roots obey Publication visibility/current disclosure
replies are thread-only roots
revisions do not resurface items
withdrawn Publications leave Current Feed
activity allowlist contains only member_of/collaborates_with activation
hidden social facts produce zero Feed semantic signal
Community Feed obeys Community visibility before candidate generation
chronological ordering is deterministic
cursor/snapshot are derived only from visible Feed inputs
HTML/JSON render the same filtered Feed facts
Feed reads produce zero canonical events
Feed has no canonical mutation API
destructive projection rebuild preserves Feed output
Foundation X1-X3 inheritance registry includes Feed
F1-F12 conformance passes
npm test passes
npm run check passes
git diff --check passes
```

The completion claim must be based on a fresh final-HEAD verification run, not a pre-commit test run.
