# Trellis Reaction v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an append-only, audience-bounded Reaction canonical domain for explicit Actor responses to Publications without changing Relationship, Discovery, or chronological Feed semantics.

**Architecture:** Reaction is a dedicated canonical stream keyed deterministically by `(actor_id, publication_id)`. It inherits Foundation X1-X3, derives its immutable audience from the target Publication, materializes into disposable `reactions_current`, and decorates viewer-filtered Publication surfaces with visible active Reaction summary and viewer state. Feed v0.1 and Discovery v0.1 remain semantically unchanged.

**Tech Stack:** Node.js >=22.5.0, CommonJS, `node:test`, `node:sqlite`, existing Trellis EventStore/Authority/Publication infrastructure.

**Spec:** `docs/superpowers/specs/2026-09-03-trellis-reaction-v0.1-design.md`

## Global Constraints

- Preserve all existing canonical Entity, Relationship, Publication, Discovery, and Feed event vocabularies.
- Reaction canonical events are only `reaction.created`, `reaction.changed`, `reaction.withdrawn`, and `reaction.restored`.
- One deterministic Reaction stream per `(actor_id, publication_id)` pair.
- Reaction canonical audience equals target Publication canonical audience at creation and never widens.
- Create/change/restore require target Publication active and readable to the reacting Actor; withdraw remains available to the Reaction owner even after target withdrawal/unreadability.
- Reaction is not a Relationship, verification claim, Feed ranking signal, or Discovery affinity signal.
- All reads satisfy viewer noninterference; summaries count only viewer-visible active Reactions.
- `reactions_current` is disposable and fully rebuildable from Reaction canonical streams.
- Continue existing command discipline: idempotency gate before state-dependent semantic preflight.
- No sub-agents; execute inline in this session.

---

## File Structure

Create focused Reaction modules:

```text
reaction/types.js          event/taxonomy constants and policy ref
reaction/schemas.js        canonical payload validation
reaction/fold.js           pure Reaction aggregate fold
reaction/projector.js      reactions_current materialization/rebuild
reaction/service.js        create/change/withdraw/restore commands
reaction/read-policy.js    target-derived Reaction visibility
reaction/read-service.js   viewer-relative list/summary/viewer reaction
reaction/action-hints.js   advisory UI actions only
```

Modify existing boundaries only where required:

```text
db/migrations/001_foundation.sql
  add disposable reactions_current projection table

authority/policy.js
  add reaction.* Authority decisions

foundation/cross-domain-contract.js
  declare reaction inherits X1/X2/X3

publication/read-service.js
  decorate already-filtered active Publication surface with Reaction summary/viewer state

publication/action-hints.js
  no Reaction authority logic; Publication action shape may be extended only through owning surface integration if necessary

package.json
  include reaction/*.js in syntax gate at final seal
```

Tests remain under `test/`.

---

### Task 1: Reaction Event Algebra and Aggregate Fold

**Files:**
- Create: `reaction/types.js`
- Create: `reaction/schemas.js`
- Create: `reaction/fold.js`
- Test: `test/reaction-fold.test.js`

**Interfaces:**
- Consumes: existing `core/errors.InvalidTransitionError`
- Produces: `REACTION_TYPES`, `REACTION_POLICY_REF`, `deriveReactionId(actorId, publicationId)`, payload validators, `foldReaction(events)`

- [ ] **Step 1: Write failing fold tests**

Cover deterministic identity, event algebra, immutable actor/target/audience, change lifecycle, withdraw lifecycle, restore lifecycle, unknown event rejection, and duplicate create rejection. The key assertions must include:

```js
assert.equal(deriveReactionId('actor:B', 'pub:P'), deriveReactionId('actor:B', 'pub:P'));
assert.notEqual(deriveReactionId('actor:B', 'pub:P'), deriveReactionId('actor:C', 'pub:P'));
assert.equal(foldReaction([created]).lifecycle, 'active');
assert.equal(foldReaction([created, changed]).reaction_type, 'love');
assert.equal(foldReaction([created, withdrawn]).reaction_type, null);
assert.equal(foldReaction([created, withdrawn, restored]).reaction_type, 'love');
assert.throws(() => foldReaction([created, withdrawn, changed]), /REACTION_CANNOT_CHANGE/);
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test/reaction-fold.test.js
```

Expected: FAIL because `reaction/*` modules do not exist.

- [ ] **Step 3: Implement minimal event/taxonomy/fold**

`reaction/types.js` must define:

```js
const REACTION_TYPES = Object.freeze(['like','love','celebrate','insightful','curious']);
const REACTION_POLICY_REF = 'trellis-reaction-policy:0.1';
function deriveReactionId(actorId, publicationId) {
  return deriveId('reaction', `${actorId}|${publicationId}`);
}
```

`foldReaction()` must preserve `actor_id`, `publication_id`, `scope_ref`, `visibility`, `audience_actor_ids`, and `reaction_policy_ref` after `reaction.created`; later events may only update `reaction_type`, `lifecycle`, `last_event_id`, and `stream_version`.

- [ ] **Step 4: Run GREEN and regression**

```bash
node --test test/reaction-fold.test.js
npm test
```

Expected: targeted PASS and all pre-existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add reaction test/reaction-fold.test.js
git commit -m "feat: add Reaction aggregate algebra"
```

---

### Task 2: Reaction Projection and Destructive Rebuild

**Files:**
- Modify: `db/migrations/001_foundation.sql`
- Create: `reaction/projector.js`
- Test: `test/reaction-rebuild.test.js`

**Interfaces:**
- Consumes: `foldReaction(events)`, existing `EventStore.readStream()`
- Produces: `projectReactionStream(db, eventStore, reactionId)`, `rebuildReactionProjection(db, eventStore)`

- [ ] **Step 1: Write failing projection tests**

Create canonical Reaction events through the EventStore test fixture, materialize them, assert the `reactions_current` row fields, delete all projection rows, rebuild from `stream_type='reaction'`, and assert exact before/after equality.

Required current row shape:

```js
{
  reaction_id,
  actor_id,
  publication_id,
  scope_ref,
  visibility,
  audience_actor_ids_json,
  reaction_policy_ref,
  lifecycle,
  reaction_type,
  created_event_id,
  last_event_id,
  stream_version,
  materializer_version
}
```

- [ ] **Step 2: Run RED**

```bash
node --test test/reaction-rebuild.test.js
```

Expected: FAIL because `reactions_current` and projector do not exist.

- [ ] **Step 3: Add disposable table and projector**

Add to migration:

```sql
CREATE TABLE reactions_current (
  reaction_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  scope_ref TEXT,
  visibility TEXT NOT NULL,
  audience_actor_ids_json TEXT NOT NULL DEFAULT '[]',
  reaction_policy_ref TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  reaction_type TEXT,
  created_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  materializer_version TEXT NOT NULL,
  UNIQUE(actor_id, publication_id)
);
CREATE INDEX reactions_current_publication_idx
ON reactions_current(publication_id, lifecycle, reaction_id);
```

Implement rebuild with a transaction and only canonical `reaction` streams.

- [ ] **Step 4: Run GREEN and regression**

```bash
node --test test/reaction-rebuild.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add db/migrations/001_foundation.sql reaction/projector.js test/reaction-rebuild.test.js
git commit -m "feat: materialize Reaction projection"
```

---

### Task 3: Reaction Authority and Command Service

**Files:**
- Modify: `authority/policy.js`
- Create: `reaction/service.js`
- Test: `test/reaction-service.test.js`

**Interfaces:**
- Consumes: `deriveReactionId()`, `foldReaction()`, Publication projection/read policy, existing EventStore and Authority receipt path
- Produces: `createReaction()`, `changeReaction()`, `withdrawReaction()`, `restoreReaction()`

- [ ] **Step 1: Write failing service tests**

Tests must cover:

```text
create: target active + readable + principal_actor_id == actor -> allow
create: unreadable target -> deny before append
create: withdrawn target -> deny
create: duplicate actor/publication resolves same stream and cannot create twice
change: owner + active readable target -> allow
change: withdrawn reaction -> invalid transition
withdraw: owner may withdraw even if target later withdrawn/unreadable
restore: same aggregate ID; target must again be active/readable
non-owner mutation -> policy denied
idempotent successful retry -> deduplicated prior result
same idempotency key/different command -> idempotency conflict
stale expected_version -> version conflict
```

Use a private Community Publication to prove membership may make the target readable but does not itself replace Reaction Authority.

- [ ] **Step 2: Run RED**

```bash
node --test test/reaction-service.test.js
```

- [ ] **Step 3: Implement Authority decision and commands**

Add `reactionDecision(request)` to `authority/policy.js`:

```js
create/change/restore:
  principal_actor_id === actor_id &&
  publication_active === true &&
  publication_readable === true

withdraw:
  principal_actor_id === reaction_state.actor_id &&
  reaction_state.lifecycle === 'active'
```

In the service, derive target audience fields from the Publication row; reject caller-supplied reaction visibility/scope/audience overrides.

Command order:

```text
validate command shape
-> derive reaction ID
-> idempotency gate
-> load/fold reaction state when applicable
-> load target publication
-> target readability/lifecycle semantic preflight
-> Authority
-> EventStore append
-> projectReactionStream
```

For withdraw, target readability/lifecycle is not a precondition after ownership/state validation.

- [ ] **Step 4: Run GREEN and regression**

```bash
node --test test/reaction-service.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add authority/policy.js reaction/service.js test/reaction-service.test.js
git commit -m "feat: add Authority-gated Reaction commands"
```

---

### Task 4: Viewer-Relative Reaction Read, Summary, and X3

**Files:**
- Create: `reaction/read-policy.js`
- Create: `reaction/read-service.js`
- Test: `test/reaction-surface.test.js`

**Interfaces:**
- Consumes: Publication `canViewPublication`, Community membership resolver, `reactions_current`
- Produces: `listVisibleReactions()`, `loadReactionSummary()`, `loadViewerReaction()`

- [ ] **Step 1: Write failing read tests**

Required behavior:

```text
viewer-readable active Publication -> visible active reaction list and type buckets
viewer unreadable Publication -> null/unavailable before reaction rows are surfaced
withdrawn Publication -> summary omitted/current read unavailable
withdrawn Reaction -> excluded from visible list and counts
viewer actor's active Reaction -> returned as viewer_reaction
hidden unrelated Publication + Reaction -> no change to visible Publication summary/list/viewer state
```

Assert no hidden count, no hidden reaction ID, no historical withdrawn type, and no authority receipt fields.

- [ ] **Step 2: Run RED**

```bash
node --test test/reaction-surface.test.js
```

- [ ] **Step 3: Implement target-first visibility**

Read sequence:

```text
load Publication row
-> canViewPublication(publication, viewerContext, disclosurePolicy, membershipResolver)
-> require publication.lifecycle == active for current Reaction surface
-> query active reactions for publication
-> aggregate only returned visible rows
```

Because v0.1 Reaction audience equals Publication audience and has no independent disclosure override, target readability is the primary Reaction visibility gate.

- [ ] **Step 4: Run GREEN and regression**

```bash
node --test test/reaction-surface.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add reaction/read-policy.js reaction/read-service.js test/reaction-surface.test.js
git commit -m "feat: add viewer-safe Reaction reads"
```

---

### Task 5: Publication Surface Integration and Advisory Actions

**Files:**
- Create: `reaction/action-hints.js`
- Modify: `publication/read-service.js`
- Test: `test/reaction-publication-integration.test.js`

**Interfaces:**
- Consumes: Task 4 read functions, current Publication surface object
- Produces: `reaction_summary`, `viewer_reaction`, `reaction_actions` on active readable Publication surfaces

- [ ] **Step 1: Write failing integration tests**

Test:

```text
active public Publication -> reaction summary + viewer reaction decoration
withdrawn Publication -> no reaction summary/viewer reaction
unreadable Publication -> still null before Reaction query
no Reaction -> empty buckets and react hint
active viewer Reaction -> change/withdraw hints
withdrawn viewer Reaction + active readable target -> restore hint
hints explicitly declare no implied execution authority
renderer/storage boundary remains unchanged
```

- [ ] **Step 2: Run RED**

```bash
node --test test/reaction-publication-integration.test.js
```

- [ ] **Step 3: Decorate only after Publication filtering**

`publication/read-service.js` must call Reaction read helpers only after `canViewPublication()` succeeded. Reaction action hints are advisory objects such as:

```js
{ action: 'react', implied_execution_authority: false }
```

No renderer or read service appends Reaction events.

- [ ] **Step 4: Run GREEN and regression**

```bash
node --test test/reaction-publication-integration.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add reaction/action-hints.js publication/read-service.js test/reaction-publication-integration.test.js
git commit -m "feat: integrate Reaction into Publication surface"
```

---

### Task 6: Feed and Discovery Non-Signal Boundaries

**Files:**
- Test: `test/reaction-boundaries.test.js`
- Modify production Feed/Discovery files only if tests expose an actual coupling bug

**Interfaces:**
- Consumes: existing `buildHomeFeed()` / Discovery builders and Reaction commands
- Produces: executable E8-E11 boundary evidence; no new runtime API expected

- [ ] **Step 1: Write failing-or-proving boundary tests**

Construct an unchanged visible social/publication state, compute Feed/Discovery outputs, add/change/withdraw/restore Reaction events, recompute, and assert:

```js
assert.deepEqual(feedAfter.items, feedBefore.items);
assert.equal(feedAfter.snapshot_ref, feedBefore.snapshot_ref);
assert.deepEqual(discoveryAfter.candidates, discoveryBefore.candidates);
```

Also assert Reaction commands create no Relationship stream/event and Reaction type `insightful` never appears as verification/trust state.

If these tests pass immediately, keep them as conformance evidence and make no production changes.

- [ ] **Step 2: Run boundary test**

```bash
node --test test/reaction-boundaries.test.js
```

Expected: PASS if existing Feed/Discovery isolation is already correct; otherwise diagnose the exact coupling before modifying production code.

- [ ] **Step 3: Fix only demonstrated coupling if necessary**

No speculative refactor. Feed remains chronological and Discovery remains visible-graph-based.

- [ ] **Step 4: Run regression**

```bash
npm test
```

- [ ] **Step 5: Commit tests/evidence**

```bash
git add test/reaction-boundaries.test.js feed discovery relationship
# only add production directories if an actual fix was required
git commit -m "test: lock Reaction cross-domain boundaries"
```

---

### Task 7: Foundation X1-X3 Inheritance for Reaction

**Files:**
- Modify: `foundation/cross-domain-contract.js`
- Modify: `docs/FOUNDATION_CROSS_DOMAIN_CONFORMANCE_v0.1.md`
- Test: `test/reaction-cross-domain.test.js`

**Interfaces:**
- Consumes: existing `INHERITORS` registry
- Produces: `reaction: ['X1','X2','X3']` and executable specializations

- [ ] **Step 1: Write RED inheritance test**

Assert the registry has exactly:

```js
assert.deepEqual(INHERITORS.reaction, ['X1','X2','X3']);
```

Also execute one behavior vector per inherited invariant:

```text
X1: Reaction audience cannot be caller-widened beyond Publication
X2: membership/readability does not let another principal mutate B's Reaction
X3: hidden unrelated Reaction facts do not alter a visible Publication's Reaction surface
```

- [ ] **Step 2: Run RED**

```bash
node --test test/reaction-cross-domain.test.js
```

Expected: inheritance assertion FAIL before registry update; behavior tests may already pass.

- [ ] **Step 3: Add inheritance declaration and docs mapping**

Add:

```js
reaction: Object.freeze(['X1','X2','X3'])
```

Document Reaction specializations without duplicating Foundation definitions.

- [ ] **Step 4: Run GREEN and regression**

```bash
node --test test/reaction-cross-domain.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add foundation/cross-domain-contract.js docs/FOUNDATION_CROSS_DOMAIN_CONFORMANCE_v0.1.md test/reaction-cross-domain.test.js
git commit -m "test: inherit Foundation contract in Reaction"
```

---

### Task 8: E1-E12 Conformance and Release Seal

**Files:**
- Create: `test/reaction-conformance.test.js`
- Create: `docs/REACTION_CONFORMANCE_v0.1.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: all prior Reaction modules
- Produces: final executable E1-E12/X1-X3 release gate

- [ ] **Step 1: Write full conformance test before release-gate edits**

The vertical slice must execute the spec acceptance flow:

```text
A creates public P1
B like
C insightful
B like -> love
B withdraw
B restore love on same reaction_id
private Community P2
member B reacts
outsider X gets no P2/reaction signal
P2 withdrawn
B may withdraw own Reaction
B cannot create/change/restore while P2 withdrawn
hidden unrelated Publication/Reaction leaves P1 visible Reaction projection identical
delete reactions_current -> rebuild -> Before == After
verify every Reaction stream hash chain
verify no Relationship mutation
verify Feed/Discovery outputs unchanged by Reaction-only changes
```

Assert E1-E12 explicitly or map each invariant to a concrete assertion.

- [ ] **Step 2: Run RED**

```bash
node --test test/reaction-conformance.test.js
npm run check
```

Expected: behavior should be green by this point; `npm run check` must FAIL release discipline because `reaction/*.js` is not yet part of the syntax gate.

- [ ] **Step 3: Add syntax gate and conformance document**

Change `package.json` check script to include:

```text
reaction/*.js
```

Create `docs/REACTION_CONFORMANCE_v0.1.md` mapping E1-E12 and X1-X3 to tests/files.

- [ ] **Step 4: Run two pre-commit release gates**

Run twice:

```bash
npm test
npm run check
git diff --check
```

Both runs must have zero failures.

- [ ] **Step 5: Commit seal**

```bash
git add package.json test/reaction-conformance.test.js docs/REACTION_CONFORMANCE_v0.1.md
git commit -m "test: seal Trellis Reaction v0.1 conformance gate"
```

- [ ] **Step 6: Fresh final-HEAD verification**

After commit, run:

```bash
npm test
npm run check
git diff --check feed/v0.1...HEAD
git status --short
```

Acceptance requires all tests PASS, syntax PASS, diff clean, and empty working tree.

- [ ] **Step 7: Package delivery without merging**

Create:

```text
/mnt/data/Trellis_Reaction_v0.1_2026-09-03.zip
/mnt/data/Trellis_Reaction_v0.1_2026-09-03.git.bundle
/mnt/data/Trellis_Reaction_v0.1_2026-09-03.sha256
```

Do not merge or push without explicit user integration choice.
