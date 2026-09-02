# Trellis Publication v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new append-only Trellis Publication canonical domain with immutable authorship/audience, revision history, withdrawal, reply/quote references, viewer-relative safe reference contexts, and executable X1-X3/O1-O15 conformance.

**Architecture:** Add `stream_type='publication'` to the existing generic canonical EventStore without adding a second event store. Implement a pure Publication fold plus a thin command service that reuses Authority receipts and optimistic/idempotent append semantics. Materialize only disposable `publications_current`; all viewer surfaces filter canonical visibility before computing replies/reference previews, and Feed remains out of scope.

**Tech Stack:** Node.js >=22.5.0, CommonJS, built-in `node:test`, `node:sqlite`, built-in validation helpers, SHA-256 canonical event hash chain.

**Spec:** `docs/superpowers/specs/2026-09-02-trellis-publication-v0.1-design.md` and `docs/specs/2026-09-02-trellis-foundation-cross-domain-contract-v0.1.md`

## Global Constraints

- Publication inherits Foundation X1-X3 without exception.
- Canonical Publication events are append-only: `publication.created`, `publication.revision_added`, `publication.withdrawn` only.
- Publication type is data, not an event family.
- `publication_id`, author, type, scope, visibility, participant audience, reply ref, quote ref, and policy ref are immutable after creation.
- `reply_to_ref` and `quote_of_ref` cannot both be set in v0.1.
- Edit appends a revision; withdrawal appends an event and is terminal for revisions.
- A reply/quote stores only a target reference, never a copied platform-generated target body/preview.
- Reference child audience must be a creation-time subset of the referenced parent's audience; `scope_members` child scope must match parent scope.
- A withdrawn or unreadable referenced target cannot leak stale body, revision count, hidden target ID, or cached excerpt through child surfaces.
- Social membership alone cannot authorize Community-scoped publication; an explicit active `publication:create` capability grant for the Community scope is required in addition to active membership.
- Publication action hints are advisory only; every mutation re-enters the canonical Authority/command path.
- Viewer-visible reply aggregates are computed after viewer visibility filtering.
- AI Board messages never become Publications implicitly.
- Feed, reactions, media storage, moderation engine, notifications, search ranking, and LLM summarization remain out of scope.

---

## File Map

```text
publication/
├── types.js
├── schemas.js
├── fold.js
├── policy.js
├── service.js
├── projector.js
├── read-policy.js
├── references.js
├── read-service.js
├── action-hints.js
├── render-json.js
└── render-html.js

schemas/
└── publication-policy.v0.1.json

docs/
├── PUBLICATION_CONFORMANCE_v0.1.md
└── FOUNDATION_CROSS_DOMAIN_CONFORMANCE_v0.1.md

test/
├── publication-fold.test.js
├── publication-service.test.js
├── publication-reference.test.js
├── publication-rebuild.test.js
├── publication-surface.test.js
├── cross-domain-contract.test.js
└── publication-conformance.test.js
```

### Task 1: Publication Type Registry, Visibility Schema, and Pure Fold

**Files:**
- Create: `schemas/publication-policy.v0.1.json`
- Create: `publication/types.js`
- Create: `publication/schemas.js`
- Create: `publication/fold.js`
- Test: `test/publication-fold.test.js`

**Interfaces:**
- Produces: `resolvePublicationPolicy(type) -> policy`
- Produces: `validatePublicationCreationPayload(payload) -> payload`
- Produces: `foldPublication(events) -> PublicationState`

- [ ] **Step 1: Write failing fold tests** for `created -> revision_added -> withdrawn`, immutable author/type/scope/visibility/audience/reference fields, no revision after withdrawal, no duplicate creation, revision sequence enforcement, and `reply_to_ref`/`quote_of_ref` mutual exclusion.

- [ ] **Step 2: Run** `node --test test/publication-fold.test.js` and verify RED because Publication modules do not exist.

- [ ] **Step 3: Create `schemas/publication-policy.v0.1.json`** with types `post`, `note`, `artifact_announcement`, `link_share`; visibility allowed `public`, `scope_members`, `participants`, `private`; policy ref `trellis-publication-policy:0.1`.

- [ ] **Step 4: Implement validation rules:** `scope_members` requires `scope_ref`; `participants` requires sorted duplicate-free non-empty `audience_actor_ids`; non-participants normalize audience to `[]`; body must be a string; both reference fields cannot be set together.

- [ ] **Step 5: Implement pure `foldPublication(events)`** with lifecycle `nonexistent|active|withdrawn`, current revision/body, revision history metadata, immutable creation fields, and terminal withdrawal.

- [ ] **Step 6: Run** `node --test test/publication-fold.test.js` and then `npm test`; expected PASS.

- [ ] **Step 7: Commit** `feat: define Publication event algebra and fold`.

---

### Task 2: Publication Authority and Command Service

**Files:**
- Modify: `authority/policy.js`
- Create: `publication/policy.js`
- Create: `publication/service.js`
- Test: `test/publication-service.test.js`

**Interfaces:**
- Produces: `createPublication(command, context)`
- Produces: `revisePublication(command, context)`
- Produces: `withdrawPublication(command, context)`
- Extends Authority actions: `publication.create`, `publication.revise`, `publication.withdraw`

- [ ] **Step 1: Write failing service tests** proving global author self-create works, another actor cannot author as A, active Community membership without explicit capability is denied, active membership plus active `publication:create` grant scoped to the Community is allowed, revision/withdraw require acting as author, command retry deduplicates before semantic preflight, and stale expected version rejects.

- [ ] **Step 2: Run** `node --test test/publication-service.test.js` and verify RED.

- [ ] **Step 3: Implement `publication/policy.js`** helpers for publication policy lookup, Community scope detection, active membership check, and explicit capability-grant lookup.

- [ ] **Step 4: Extend `authority/policy.js`** so `publication.create` allows `principal_actor_id === author_actor_id`; for Community scope it additionally requires active membership and an active scoped `publication:create` capability grant. `publication.revise` and `publication.withdraw` require acting as the immutable author. No social relation alone is sufficient.

- [ ] **Step 5: Implement `publication/service.js`** using the existing idempotency gate pattern: lookup/digest before semantic preflight; `createPublication` emits one `publication.created`; `revisePublication` and `withdrawPublication` fold canonical history before append; all writes use `EventStore.append` with optimistic concurrency and Authority receipt.

- [ ] **Step 6: Run** targeted tests and full `npm test`; expected PASS.

- [ ] **Step 7: Commit** `feat: add authority-gated Publication commands`.

---

### Task 3: Reference Validation and Audience Non-Widening

**Files:**
- Create: `publication/references.js`
- Modify: `publication/service.js`
- Test: `test/publication-reference.test.js`

**Interfaces:**
- Produces: `validatePublicationReferenceCreation({ childDraft, parentState, actorId, db, viewerContext })`
- Produces: `isChildAudienceSubsetOfParent(...) -> boolean`

- [ ] **Step 1: Write failing tests** for: reply stores only `reply_to_ref`; quote stores only `quote_of_ref`; no copied parent body field is accepted; public parent may have narrower child; `scope_members` child must use same scope; participants child set must be subset of parent participants; private parent cannot produce public child; creating a reply/quote requires the child author to be able to read the parent at creation; already-withdrawn parent rejects new built-in reply/quote.

- [ ] **Step 2: Run** `node --test test/publication-reference.test.js` and verify RED.

- [ ] **Step 3: Implement reference audience rules** exactly from the spec, using active Community membership only where needed to prove a participants child is currently within a `scope_members` parent audience.

- [ ] **Step 4: Integrate reference validation into `createPublication` before Authority evaluation and canonical append.** No platform-generated parent preview/body enters the child payload.

- [ ] **Step 5: Run** reference, service, and full tests; expected PASS.

- [ ] **Step 6: Commit** `feat: enforce Publication reference audience boundaries`.

---

### Task 4: Disposable Publication Projection and Rebuild

**Files:**
- Modify: `db/migrations/001_foundation.sql`
- Create: `publication/projector.js`
- Test: `test/publication-rebuild.test.js`

**Interfaces:**
- Adds disposable table: `publications_current`
- Produces: `projectPublicationStream(db, eventStore, publicationId)`
- Produces: `rebuildPublicationProjection(db, eventStore)`

- [ ] **Step 1: Write destructive rebuild RED:** create Publication, revise it, create a reply, withdraw parent, capture `publications_current`, delete the table rows, rebuild only from canonical `publication` streams, and require deep equality.

- [ ] **Step 2: Run** targeted test and verify RED because the projection table/projector do not exist.

- [ ] **Step 3: Extend DDL** with `publications_current` containing immutable creation fields, `audience_actor_ids_json`, lifecycle, current revision/body, reference IDs, stream version, last event ID, and materializer version. Add indexes for author, scope, reply ref, quote ref, visibility/lifecycle.

- [ ] **Step 4: Implement projector/rebuild** as deterministic fold output only; projection tables may UPSERT/DELETE and never append canonical events.

- [ ] **Step 5: Run** rebuild and full tests; expected PASS.

- [ ] **Step 6: Commit** `feat: add rebuildable Publication projection`.

---

### Task 5: Viewer Read Policy, Safe Reference Context, and Reply Aggregates

**Files:**
- Create: `publication/read-policy.js`
- Modify: `publication/references.js`
- Create: `publication/read-service.js`
- Test: `test/publication-surface.test.js`

**Interfaces:**
- Produces: `canViewPublication(publication, viewerContext, disclosurePolicy, membershipResolver)`
- Produces: `resolveReferenceContext({ publication, viewerContext, ... })`
- Produces: `loadPublicationSurface({ publicationId, viewerContext, eventStore, db, disclosurePolicy })`

- [ ] **Step 1: Write RED tests** for `public`, `scope_members`, `participants`, and `private` visibility; current disclosure policy can narrow but not widen; hidden reply does not change visible reply count/last-reply signal; readable withdrawn parent produces `{status:'withdrawn', publication_id}` with no body/revision count; unreadable parent produces only `{status:'unavailable'}` with no hidden target ID; child authored body survives parent withdrawal unchanged.

- [ ] **Step 2: Run** targeted tests and verify RED.

- [ ] **Step 3: Implement viewer policy** using Community membership resolver for `scope_members`, immutable participant list for `participants`, author/representative for `private`, and current disclosure policy only as a narrowing gate.

- [ ] **Step 4: Implement reference-context resolution** from current target state at read time. Never use cached child preview data.

- [ ] **Step 5: Implement visible reply projection** by selecting reply candidates then filtering each reply with `canViewPublication` before constructing `visible_replies` and `visible_reply_count`.

- [ ] **Step 6: Run** targeted and full tests; expected PASS.

- [ ] **Step 7: Commit** `feat: add viewer-safe Publication surfaces and references`.

---

### Task 6: Publication Action Hints and HTML/JSON Parity

**Files:**
- Create: `publication/action-hints.js`
- Create: `publication/render-json.js`
- Create: `publication/render-html.js`
- Modify: `publication/read-service.js`
- Test: `test/publication-render.test.js`

**Interfaces:**
- Produces: `availablePublicationActions({ publication, viewerContext }) -> string[]`
- Produces: `renderPublicationJson(surface) -> string|null`
- Produces: `renderPublicationHtml(surface) -> string`

- [ ] **Step 1: Write RED tests** proving active author sees `revise`/`withdraw`; a readable authenticated viewer may see advisory `reply`/`quote`; withdrawn target does not offer new reply/quote; hints do not bypass command Authority; HTML and JSON expose the same filtered facts; renderers import no DB/EventStore modules and HTML escapes body/IDs.

- [ ] **Step 2: Run** targeted tests and verify RED.

- [ ] **Step 3: Implement advisory action hints** without Authority receipts or storage access.

- [ ] **Step 4: Implement renderers** consuming only the already-filtered surface object.

- [ ] **Step 5: Run** targeted and full tests; expected PASS.

- [ ] **Step 6: Commit** `feat: add Publication human and machine surfaces`.

---

### Task 7: Foundation X1-X3 Cross-Domain Conformance

**Files:**
- Create: `test/cross-domain-contract.test.js`
- Create: `docs/FOUNDATION_CROSS_DOMAIN_CONFORMANCE_v0.1.md`

**Interfaces:**
- Produces executable X1-X3 release gate inherited by Publication and documented for Profile/Relationship/Community/Discovery.

- [ ] **Step 1: Add X1 RED/verification vector:** a private Publication remains invisible even when current disclosure callback returns allow; a public Publication may be narrowed to invisible by current policy; no canonical visibility field changes.

- [ ] **Step 2: Add X2 vector:** active `member_of` alone cannot authorize Community Publication; explicit scoped Publication capability plus membership can. Verify no social edge is written/changed by the authorization check.

- [ ] **Step 3: Add X3 vector:** capture a public Publication surface, append a viewer-invisible private reply, rebuild Publication projection, and require the public surface semantic object (including reply count/reference signals) to remain deep-equal.

- [ ] **Step 4: Document inheritance matrix** mapping Profile P5/P8, Relationship R2/R3/R4/R8, Community C4/C7/C8/C11, Discovery D2/D3/D6/D12, and Publication O4/O8/O9/O10/O14/O15 to X1-X3.

- [ ] **Step 5: Run** `node --test test/cross-domain-contract.test.js` and full `npm test`; expected PASS.

- [ ] **Step 6: Commit** `test: enforce Trellis cross-domain Foundation contract`.

---

### Task 8: Publication O1-O15 Conformance and Release Seal

**Files:**
- Create: `test/publication-conformance.test.js`
- Create: `docs/PUBLICATION_CONFORMANCE_v0.1.md`
- Modify: `package.json`

**Interfaces:**
- Produces final Publication v0.1 release gate and syntax coverage for `publication/*.js`.

- [ ] **Step 1: Build the complete vertical-slice test:** public P1, reply P2, revision of P1, private P3 hidden from C, private Community with A/B active members, explicit scoped Publication capability, scope-members P4, B reply P5, P4 withdrawal, P5 reference context becomes withdrawn placeholder, outsider receives no P4/P5 signals.

- [ ] **Step 2: Assert O1-O15 negative surfaces:** exported APIs contain no `updatePublication`, `deletePublication`, `changeAuthor`, `changeVisibility`, `copyReferencePreviewIntoCanonical`, `autoImportAiBoardMessage`, or Feed mutation API.

- [ ] **Step 3: Destructive rebuild:** capture viewer-relative Publication surfaces, `DELETE FROM publications_current`, rebuild from canonical Publication history, and require deep equality plus valid Publication stream hash chains.

- [ ] **Step 4: Add release-discipline RED:** require `package.json` `check` script to include `publication/*.js`; verify test fails before script change.

- [ ] **Step 5: Update syntax gate** to include `publication/*.js`.

- [ ] **Step 6: Write `docs/PUBLICATION_CONFORMANCE_v0.1.md`** mapping O1-O15 and X1-X3 to executable tests.

- [ ] **Step 7: Run two clean verification rounds:** `npm test`, `npm run check`, `git diff --check discovery/v0.1...HEAD`; both rounds must pass.

- [ ] **Step 8: Commit** `test: seal Trellis Publication v0.1 conformance gate`.

---

## Definition of Done

Publication v0.1 is complete only when:

```text
all Publication tests PASS
all pre-existing 151 tests still PASS
X1-X3 cross-domain contract PASS
O1-O15 Publication contract PASS
npm run check PASS and includes publication/*.js
git diff --check discovery/v0.1...HEAD is clean
working tree is clean
```

The decisive semantic test is that viewer-visible outputs are invariant under changes to viewer-invisible Publication facts, and that withdrawing or hiding a referenced parent cannot leak stale target content through an already-existing child Publication.
