# Trellis Discovery v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement deterministic, viewer-filtered Actor and Community discovery in Trellis without allowing hidden facts, model inference, ranking metrics, or discovery read authority to become canonical social authority.

**Architecture:** Add a derived `discovery/` layer that first builds a subject/viewer-authorized visible graph snapshot from existing relationship, Profile, and Community projections. Candidate generation, scoring, reasons, pagination, HTML, and JSON operate only on that visible snapshot. Discovery writes no canonical events and owns no mutation service.

**Tech Stack:** Node.js >=22.5.0, CommonJS, built-in `node:test`, `node:sqlite`, existing Trellis viewer-policy/projector modules, SHA-256 from `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-09-02-trellis-discovery-v0.1-design.md`

## Global Constraints

- Discovery is a derived projection only; it exposes no EventStore append path.
- `subject_actor_id` and viewer identity are distinct; v0.1 personalized discovery requires subject self or explicit representative read authority.
- Candidate generation occurs only after viewer visibility filtering.
- Invisible relationships, memberships, Communities, Profile facts, and paths contribute exactly zero candidate existence, score, rank, reason, count, or cursor state.
- Actor scoring uses only visible mutual-neighbor count, visible shared-community count, and visible two-hop path count with weights `3,4,1`.
- Community scoring uses only visible connected-member count, visible path count, and visible membership-overlap count with weights `4,1,3`.
- Runtime/model/provider metadata, bio semantics, LLM/embedding output, trust/reputation, AI Board activity, and engagement are not scoring inputs.
- Tie-breaking is deterministic by stable entity ID ascending.
- Explanations reference only viewer-visible facts.
- Community Discovery includes only `discoverability=public`; `unlisted` and `private` are excluded.
- Discovery candidates are advisory and never auto-create relationships or memberships.
- Cursor pagination binds to `algorithm_ref` and a deterministic hash of visible discovery inputs; hidden changes must not alter that snapshot hash.
- Search and Feed remain outside this plan.

---

### Task 1: Discovery Context and Read Authority

**Files:**
- Create: `discovery/context.js`
- Create: `test/discovery-context.test.js`

**Interfaces:**
- Produces: `authorizeDiscoverySubject(subjectActorId, viewerContext) -> { viewer_scope }`
- Produces: `viewerIdentityKey(viewerContext) -> string`
- Later tasks consume this before any graph enumeration.

- [ ] **Step 1: Write failing authority tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeDiscoverySubject } = require('../discovery/context');

test('subject can request own discovery', () => {
  assert.deepEqual(
    authorizeDiscoverySubject('actor:A', { viewer_actor_id: 'actor:A' }),
    { viewer_scope: 'self' }
  );
});

test('representative can read subject discovery without becoming subject', () => {
  assert.deepEqual(
    authorizeDiscoverySubject('actor:A', {
      viewer_actor_id: 'actor:R',
      represents_actor_ids: ['actor:A']
    }),
    { viewer_scope: 'representative' }
  );
});

test('unrelated viewer cannot request personalized discovery for public actor', () => {
  assert.throws(
    () => authorizeDiscoverySubject('actor:A', { viewer_actor_id: 'actor:Z' }),
    /DISCOVERY_NOT_AUTHORIZED/
  );
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test/discovery-context.test.js
```

Expected: FAIL because `discovery/context.js` does not exist.

- [ ] **Step 3: Implement minimal context authorization**

`authorizeDiscoverySubject` must allow only self or `represents_actor_ids` membership. Do not inspect social relationships to infer representative authority.

- [ ] **Step 4: Verify GREEN and full regression**

```bash
node --test test/discovery-context.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add discovery/context.js test/discovery-context.test.js
git commit -m "feat: add subject-viewer discovery authority boundary"
```

---

### Task 2: Viewer-Visible Discovery Snapshot

**Files:**
- Create: `discovery/visible-graph.js`
- Create: `test/discovery-visible-graph.test.js`

**Interfaces:**
- Consumes: `profile/read-policy.canViewRelationship`, `community/membership-read.createMembershipResolver`, `community/fold.resolveCommunityDiscoverability`, `buildActorProfile`, `buildCommunitySurface`.
- Produces: `buildDiscoverySnapshot({ subjectActorId, viewerContext, db, eventStore, disclosurePolicy }) -> DiscoverySnapshot`
- `DiscoverySnapshot` contains only visible actors, active visible relationships, visible active memberships, public discoverable communities, and a deterministic `snapshot_ref`.

- [ ] **Step 1: Write RED privacy tests**

Create fixtures with:

```text
A-X public
X-B public
A-Y private hidden from discovery viewer
A member_of C1 visible
B member_of C1 visible
Y member_of Cprivate hidden/private
```

Assert the snapshot contains A/X/B and C1 but contains neither hidden edge A-Y nor hidden Community/member facts.

Add a second assertion: append a new relationship invisible to the viewer, rebuild the snapshot, and require identical `snapshot_ref`.

- [ ] **Step 2: Run RED**

```bash
node --test test/discovery-visible-graph.test.js
```

Expected: FAIL because the snapshot builder is missing.

- [ ] **Step 3: Implement visible-first snapshot construction**

Algorithm:

```text
1 authorize subject/viewer
2 enumerate registered actor/community entity streams from canonical_events
3 read current active relationships_current
4 apply existing canViewRelationship before graph insertion
5 resolve public Community discoverability from canonical Community entity history
6 include viewer-safe Actor/Profile and Community presentation only after visibility passes
7 canonicalStringify sorted visible inputs
8 snapshot_ref = sha256(visible inputs)
```

Do not include hidden entity IDs in the hashed material.

- [ ] **Step 4: Verify hidden facts have zero snapshot influence**

```bash
node --test test/discovery-visible-graph.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add discovery/visible-graph.js test/discovery-visible-graph.test.js
git commit -m "feat: build viewer-filtered discovery graph snapshots"
```

---

### Task 3: Deterministic Actor Discovery

**Files:**
- Create: `discovery/actor-discovery.js`
- Create: `test/discovery-actors.test.js`

**Interfaces:**
- Consumes: `DiscoverySnapshot` from Task 2.
- Produces: `discoverActors(snapshot, { limit? }) -> DiscoveryCandidate[]`
- `algorithm_ref`: `trellis-discovery:actor-graph:v1`

- [ ] **Step 1: Write RED scoring tests**

Use a visible graph where B is reachable from subject A by:

```text
A-X-B visible two-hop
A member_of C1
B member_of C1
```

Require B score components:

```js
{
  mutual_visible_actors: 1,
  shared_visible_communities: 1,
  visible_two_hop_paths: 1,
  score: 8
}
```

because `3*1 + 4*1 + 1*1 = 8`.

Also test:

```text
self excluded
already directly related Actor excluded
hidden-only Actor excluded
same-score candidates ordered by actor_id ascending
```

- [ ] **Step 2: Run RED**

```bash
node --test test/discovery-actors.test.js
```

Expected: FAIL because Actor discovery is missing.

- [ ] **Step 3: Implement candidate generation and explanations**

Every candidate must include:

```js
{
  entity_type: 'actor',
  actor_id,
  score,
  score_components,
  reasons,
  profile,
  algorithm_ref: 'trellis-discovery:actor-graph:v1'
}
```

Reasons may include only visible `mutual_visible_actor`, `shared_visible_community`, and `visible_two_hop_path` references.

- [ ] **Step 4: Verify GREEN and hidden-path invariance**

Add a hidden A-H-B path and assert B's score/reasons do not change.

```bash
node --test test/discovery-actors.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add discovery/actor-discovery.js test/discovery-actors.test.js
git commit -m "feat: add deterministic explainable Actor discovery"
```

---

### Task 4: Deterministic Community Discovery

**Files:**
- Create: `discovery/community-discovery.js`
- Create: `test/discovery-communities.test.js`

**Interfaces:**
- Consumes: `DiscoverySnapshot`.
- Produces: `discoverCommunities(snapshot, { limit? }) -> DiscoveryCandidate[]`
- `algorithm_ref`: `trellis-discovery:community-graph:v1`

- [ ] **Step 1: Write RED community tests**

Fixture:

```text
subject A visibly connected to X
X active visible member_of C2
A active member_of C1
B visible member in C1 and C2
Cprivate discoverability=private
Cunlisted discoverability=unlisted
```

Require C2 candidate and visible scoring components. Require Cprivate/Cunlisted exclusion. Require communities where A is already active member or has pending membership to be excluded.

- [ ] **Step 2: Run RED**

```bash
node --test test/discovery-communities.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement Community candidate scoring**

Use only visible data:

```text
connected_visible_members * 4
visible_paths * 1
visible_membership_overlap * 3
```

Attach only viewer-safe Community presentation and visible reasons.

- [ ] **Step 4: Verify GREEN and private-membership invariance**

Add a hidden member to C2 and require identical candidate score, reasons, and visible member count.

```bash
node --test test/discovery-communities.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add discovery/community-discovery.js test/discovery-communities.test.js
git commit -m "feat: add deterministic explainable Community discovery"
```

---

### Task 5: Stable Cursor Pagination and Snapshot Mismatch

**Files:**
- Create: `discovery/cursor.js`
- Create: `test/discovery-cursor.test.js`

**Interfaces:**
- Produces: `encodeCursor({ algorithm_ref, snapshot_ref, last_score, last_entity_id }) -> string`
- Produces: `decodeCursor(cursor) -> object`
- Produces: `paginateCandidates(candidates, { limit, cursor, algorithmRef, snapshotRef }) -> { candidates, next_cursor }`

- [ ] **Step 1: Write RED cursor tests**

Verify:

```text
page 1 followed by page 2 has no duplicates
same state returns stable cursor sequence
cursor from different algorithm_ref throws DISCOVERY_CURSOR_MISMATCH
cursor from different snapshot_ref throws DISCOVERY_SNAPSHOT_CHANGED
hidden fact change that leaves snapshot_ref unchanged does not invalidate cursor
```

- [ ] **Step 2: Run RED**

```bash
node --test test/discovery-cursor.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement deterministic base64url JSON cursor**

Cursor payload contains only:

```json
{
  "algorithm_ref": "...",
  "snapshot_ref": "...",
  "last_score": 8,
  "last_entity_id": "actor:B"
}
```

Do not include hidden counts or wall-clock time.

- [ ] **Step 4: Verify GREEN**

```bash
node --test test/discovery-cursor.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add discovery/cursor.js test/discovery-cursor.test.js
git commit -m "feat: add snapshot-bound Discovery cursors"
```

---

### Task 6: Discovery Read Service and HTML/JSON Parity

**Files:**
- Create: `discovery/read-service.js`
- Create: `discovery/render-json.js`
- Create: `discovery/render-html.js`
- Create: `test/discovery-surface.test.js`

**Interfaces:**
- Produces: `buildDiscoverySurface({ subjectActorId, viewerContext, db, eventStore, disclosurePolicy, actorLimit, actorCursor, communityLimit, communityCursor })`
- Produces: `renderDiscoveryJson(surface) -> string`
- Produces: `renderDiscoveryHtml(surface) -> string`

- [ ] **Step 1: Write RED surface tests**

Verify response contains:

```js
{
  subject_actor_id: 'actor:A',
  viewer_scope: 'self',
  snapshot_ref,
  actor_discovery: {
    algorithm_ref: 'trellis-discovery:actor-graph:v1',
    candidates: []
  },
  community_discovery: {
    algorithm_ref: 'trellis-discovery:community-graph:v1',
    candidates: []
  },
  execution_authority: {
    implied_by_discovery_read: false
  },
  projection_version: 'discovery-surface:0.1'
}
```

Representative viewer must preserve `subject_actor_id=A` and report `viewer_scope=representative`.

Renderers must accept the already-filtered surface only and must not import DB/EventStore modules.

- [ ] **Step 2: Run RED**

```bash
node --test test/discovery-surface.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement read orchestration and safe renderers**

HTML copy must say `Related Actors` / `Related Communities`; never `trusted`, `recommended as safe`, or equivalent endorsement language.

- [ ] **Step 4: Verify HTML/JSON parity and escaping**

Ensure hidden IDs/reasons are absent from both serialized surfaces and HTML escapes presentation strings.

```bash
node --test test/discovery-surface.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add discovery/read-service.js discovery/render-json.js discovery/render-html.js test/discovery-surface.test.js
git commit -m "feat: add viewer-relative Discovery surfaces"
```

---

### Task 7: D1-D12 Conformance Seal

**Files:**
- Create: `test/discovery-conformance.test.js`
- Create: `docs/DISCOVERY_CONFORMANCE_v0.1.md`
- Modify: `package.json`

**Interfaces:**
- Produces executable D1-D12 release gate.
- `npm run check` must include `discovery/*.js`.

- [ ] **Step 1: Write complete RED vertical slice**

Create Actors A/B/X/Y and Communities C1/C2/Cprivate. Establish:

```text
A-X visible
X-B visible
A/B visible members of C1
X visible member of C2
Y connected only through hidden facts
Cprivate private
```

Assert:

```text
B discovered for A with visible reasons
Y absent
C2 discovered
Cprivate absent
representative viewer computes for A, not representative
no Discovery module exports canonical mutation functions
```

- [ ] **Step 2: Add hidden-fact invariance test**

Capture complete Discovery surface. Append hidden relationship and hidden/private membership facts, rebuild ordinary Trellis projections, then require deep equality of Discovery candidate sets, scores, reasons, and `snapshot_ref`.

- [ ] **Step 3: Add deterministic recompute test**

Run Discovery twice from the same canonical/projection state and require identical output byte-for-byte after `JSON.parse` deep equality.

- [ ] **Step 4: Add release syntax RED**

Assert `package.json.scripts.check` contains `discovery/*.js`; expect failure before editing `package.json`.

- [ ] **Step 5: Update syntax gate and conformance documentation**

Map D1-D12 explicitly to test names in `docs/DISCOVERY_CONFORMANCE_v0.1.md`.

- [ ] **Step 6: Run full verification twice**

```bash
npm test
npm run check
git diff --check community/v0.1...HEAD

npm test
npm run check
```

Expected: all tests PASS, no syntax errors, no whitespace errors.

- [ ] **Step 7: Commit**

```bash
git add package.json test/discovery-conformance.test.js docs/DISCOVERY_CONFORMANCE_v0.1.md
git commit -m "test: seal Trellis Discovery v0.1 conformance gate"
```

---

## Definition of Done

Discovery v0.1 is complete only when D1-D12 are executable constraints and the acceptance slice proves:

$$
HiddenFacts_{s,v}\text{ changed}
\land
VisibleFacts_{s,v}\text{ unchanged}
\Rightarrow
Discovery_{s,v}\text{ unchanged}
$$

for candidate existence, score, ordering, reasons, aggregate counts, and snapshot reference.

The feature is not complete merely because candidate lists look plausible. The release condition is deterministic, explainable ranking over viewer-visible facts only, with no canonical write authority and no hidden-graph influence.
