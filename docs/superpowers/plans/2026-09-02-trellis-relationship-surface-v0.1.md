# Trellis Relationship Surface v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a viewer-relative, stream-backed relationship detail/index surface that exposes persistent relationship history and social actions without giving presentation code any canonical mutation authority.

**Architecture:** Reuse `relationships_current`, `EventStore.readStream()`, Profile read-policy primitives, and the existing `relationship/service.js` command path. Add only read/projection and thin product-command modules under `relationship-surface/`; no new canonical event type or canonical history table is created.

**Tech Stack:** Node.js >=22.5.0, CommonJS, built-in `node:test`, built-in `node:assert/strict`, `node:sqlite`, existing Trellis Foundation/Profile modules.

**Spec:** `docs/superpowers/specs/2026-09-02-trellis-relationship-surface-v0.1-design.md`

## Global Constraints

- Foundation I1-I11 and Profile P1-P10 remain unchanged.
- Relationship Surface is projection-only.
- No new canonical relationship event types.
- No direct write to `relationships_current` or Profile projections from surface commands.
- Hidden relationships expose zero history/count/activity signal.
- `available_actions` is advisory only; command execution rechecks authority.
- Social relationship never implies execution capability.
- Terminated relationship IDs remain addressable but cannot reactivate.
- HTML and JSON consume the same viewer-filtered projection object.
- AI Board Candidate -> Command promotion remains absent.

---

### Task 1: Relationship Detail Read Policy and Stream-backed Projection

**Files:**
- Create: `relationship-surface/read-policy.js`
- Create: `relationship-surface/read-service.js`
- Test: `test/relationship-surface-detail.test.js`

**Interfaces:**
- Consumes: `profile/read-policy.canViewRelationship`, `EventStore.readStream`, `foldRelationship`.
- Produces: `loadRelationshipDetail({ relationshipId, viewerContext, eventStore, db, disclosurePolicy }) -> object|null`.
- Produces: `relationshipViewerScope(relationship, viewerContext) -> public|participant|representative`.

- [ ] **Step 1: Write failing detail tests**

Cover real behavior:

```js
test('public relationship is readable anonymously', () => {});
test('participants relationship is unreadable to unrelated actor', () => {});
test('participants relationship is readable to either endpoint or representative', () => {});
test('current disclosure policy may hide public relationship', () => {});
test('terminated visible relationship remains readable', () => {});
```

Assert unreadable lookup returns `null` without history counts or metadata.

- [ ] **Step 2: Run RED**

```bash
node --test test/relationship-surface-detail.test.js
```

Expected: FAIL because `relationship-surface/read-service.js` does not exist.

- [ ] **Step 3: Implement minimal read policy and detail loader**

`loadRelationshipDetail` must:

```text
SELECT relationship by relationship_id
-> canViewRelationship(...)
-> if false return null immediately
-> read canonical stream
-> fold current state
-> return viewer-safe immutable/current fields + raw visible history placeholder
```

Do not query events before the relationship visibility gate.

- [ ] **Step 4: Run GREEN and full regression**

```bash
node --test test/relationship-surface-detail.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add relationship-surface test/relationship-surface-detail.test.js
git commit -m "feat: add viewer-safe relationship detail projection"
```

---

### Task 2: Safe Relationship History, Evidence, Contestation, and Authority Summary

**Files:**
- Create: `relationship-surface/history.js`
- Modify: `relationship-surface/read-service.js`
- Test: `test/relationship-surface-history.test.js`

**Interfaces:**
- Produces: `projectRelationshipHistory({ events, db }) -> HistoryProjection`.
- `HistoryProjection` contains `history`, `evidence`, `contestations`, and `annotations` derived only after relationship-level read authorization.

- [ ] **Step 1: Write failing history tests**

Verify:

```text
evidence_added appears as reference only
contestation open/resolution are represented without changing lifecycle
annotation remains history-only
authority receipt is summarized without credential_refs or secrets
recorded_at/occurred_at/event_id survive projection
unreadable relationship never causes EventStore.readStream to be called
```

Use a counting EventStore wrapper for the last assertion.

- [ ] **Step 2: Run RED**

```bash
node --test test/relationship-surface-history.test.js
```

- [ ] **Step 3: Implement safe history projection**

Allowed authority summary fields:

```js
{
  decision_ref,
  decision,
  policy_ref
}
```

Never return `credential_refs_json` or `receipt_json` wholesale.

- [ ] **Step 4: Run GREEN + regression**

```bash
node --test test/relationship-surface-history.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add relationship-surface test/relationship-surface-history.test.js
git commit -m "feat: project safe persistent relationship history"
```

---

### Task 3: Viewer-relative Relationship Index and Pending Proposals

**Files:**
- Create: `relationship-surface/index-service.js`
- Test: `test/relationship-surface-index.test.js`

**Interfaces:**
- Produces: `buildRelationshipIndex({ actorId, viewerContext, db, disclosurePolicy })`.
- Returns `active`, `pending_incoming`, `pending_outgoing`, `historical_terminated`, plus counts derived strictly from those visible arrays.

- [ ] **Step 1: Write failing index tests**

Create actor fixtures with public and hidden active/proposed/terminated relationships. Verify:

```text
incoming/outgoing categorization
hidden pending proposal absent
hidden terminated relationship absent
counts equal visible array lengths
hidden actor ID/type never appears in serialized index
```

- [ ] **Step 2: Run RED**

```bash
node --test test/relationship-surface-index.test.js
```

- [ ] **Step 3: Implement filter-before-aggregate index**

Query candidate rows by endpoint, then apply `canViewRelationship` before categorization and counting.

- [ ] **Step 4: Run GREEN + regression**

```bash
node --test test/relationship-surface-index.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add relationship-surface/index-service.js test/relationship-surface-index.test.js
git commit -m "feat: add viewer-relative relationship index"
```

---

### Task 4: Advisory Action Hints and Existing Command-path Adapters

**Files:**
- Create: `relationship-surface/action-hints.js`
- Create: `relationship-surface/product-commands.js`
- Test: `test/relationship-surface-actions.test.js`

**Interfaces:**
- Produces: `availableRelationshipActions({ relationship, viewerContext }) -> string[]`.
- Produces thin adapters: `propose`, `activate`, `terminate`, `openContestation`, `resolveContestation`, `addEvidence`, `addAnnotation` which delegate to `relationship/service.js`.

- [ ] **Step 1: Write failing action tests**

Verify advisory hints for lifecycle/endpoint context, then prove hints do not authorize anything:

```text
B sees activate hint on bilateral pending relation
unrelated viewer sees no mutation hint
terminated relation never advertises activate
stale activate hint followed by already-active canonical state -> existing command path rejects/deduplicates correctly
active delegates_to relationship does not authorize protected.execute
```

Also assert `product-commands.js` exports no DB/EventStore direct-write helper.

- [ ] **Step 2: Run RED**

```bash
node --test test/relationship-surface-actions.test.js
```

- [ ] **Step 3: Implement advisory actions and thin adapters**

No adapter may mutate projections. Each adapter calls the existing relationship service function unchanged.

- [ ] **Step 4: Run GREEN + regression**

```bash
node --test test/relationship-surface-actions.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add relationship-surface test/relationship-surface-actions.test.js
git commit -m "feat: add advisory relationship actions"
```

---

### Task 5: Human/JSON Relationship Surfaces and Profile Detail Links

**Files:**
- Create: `relationship-surface/render-json.js`
- Create: `relationship-surface/render-html.js`
- Modify: `profile/read-service.js`
- Test: `test/relationship-surface-parity.test.js`

**Interfaces:**
- Produces: `renderRelationshipJson(detail) -> string`.
- Produces: `renderRelationshipHtml(detail) -> string`.
- Profile `visible_relationships` gains `detail_ref` only; it still does not absorb relationship history.

- [ ] **Step 1: Write failing parity/security tests**

Verify:

```text
HTML and JSON contain the same visible relationship facts
HTML escapes actor IDs/labels/payload strings
private relationship returns no page projection
hidden evidence reference/event count never appears in HTML source
Profile preview contains /relationships/{id} detail_ref
renderer modules import no EventStore/DB modules
```

- [ ] **Step 2: Run RED**

```bash
node --test test/relationship-surface-parity.test.js
```

- [ ] **Step 3: Implement renderers from one filtered object**

Renderers accept only a prebuilt relationship detail object. They cannot fetch data.

- [ ] **Step 4: Run GREEN + regression**

```bash
node --test test/relationship-surface-parity.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add relationship-surface profile/read-service.js test/relationship-surface-parity.test.js
git commit -m "feat: add human and machine relationship surfaces"
```

---

### Task 6: Relationship Surface R1-R10 Conformance and Rebuild Seal

**Files:**
- Create: `test/relationship-surface-conformance.test.js`
- Create: `docs/RELATIONSHIP_SURFACE_CONFORMANCE_v0.1.md`
- Modify: `package.json`

**Interfaces:**
- Produces executable release gate covering R1-R10 and the accepted vertical slice.

- [ ] **Step 1: Write failing conformance test**

The vertical slice must execute real services:

```text
register A/B
add Profile assertions
propose participants collaborates_with
B sees incoming pending
B activates
A sees active detail
add evidence
open contestation
resolve contestation
terminate
terminated detail still readable to participant
verify hash chain
capture Profile/Index/Detail
DELETE disposable profile/relationship projections
rebuild projections
rebuild Profile/Index/Detail
deepEqual before/after
```

Also assert unavailable public viewer receives no relationship/history aggregate signal.

- [ ] **Step 2: Make syntax gate cover `relationship-surface/*.js`**

Update `npm run check` to include the new directory. The conformance test should fail until this coverage exists.

- [ ] **Step 3: Run focused RED**

```bash
node --test test/relationship-surface-conformance.test.js
```

- [ ] **Step 4: Complete the minimum integration glue**

Only add glue necessary for the vertical slice. Do not add Community, Feed, notifications, AI Board promotion, or a new canonical store.

- [ ] **Step 5: Run complete verification twice**

```bash
npm test
npm run check
npm test
npm run check
git diff --check profile/v0.1...HEAD
```

All must PASS. Working tree must be clean after the final seal commit.

- [ ] **Step 6: Document R1-R10 mapping and commit**

```bash
git add package.json docs test relationship-surface profile/read-service.js
git commit -m "test: seal Relationship Surface v0.1 conformance gate"
```

---

## Definition of Done

Relationship Surface v0.1 is complete only when the real vertical slice proves that relationship detail/index/history can be destroyed as projections and reproduced from Trellis canonical histories, while private/participants visibility produces no aggregate leakage, action hints remain non-authoritative, and all Foundation/Profile tests continue to pass.
