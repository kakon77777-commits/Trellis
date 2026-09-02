# AI-FB Actor Profile v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an assertion-sourced, viewer-relative Actor Profile surface whose human and machine representations are derived entirely from canonical entity history plus visible relationship state, without creating a mutable second identity truth.

**Architecture:** Extend the existing modular-monolith Foundation with a versioned profile-field registry, canonical `entity.assertion_added` command service, pure assertion fold, disposable profile projections, viewer read policy, and HTML/JSON renderers. Write decisions read canonical entity streams only; profile projection tables are rebuildable caches and are never used as mutation authority.

**Tech Stack:** Node.js >=22.5.0, CommonJS, built-in `node:test`, built-in `node:assert/strict`, `node:sqlite`, existing Foundation EventStore/Authority interfaces, SHA-256 command digests.

**Spec:** `docs/superpowers/specs/2026-09-02-ai-fb-actor-profile-v0.1-design.md`

## Global Constraints

- Foundation invariants I1-I11 remain unchanged.
- Profile is a projection, never identity authority.
- All successful profile writes emit only `entity.assertion_added`; no `profile.updated`, field-specific canonical events, or mutable profile rows.
- Profile assertions have no `scope_ref` in v0.1.
- Field vocabulary evolves through `profile-fields:0.1`, not event-algebra growth.
- Assertion operations are exactly `assert` and `retract`.
- `display_name`, `bio`, `avatar_url`, and `website` are single-valued and require explicit supersession of the current active assertion.
- `alias` and `external_link` are multi-valued and retract individual assertions.
- Assertion visibility is resolved at commit time and immutable for that assertion.
- v0.1 assertion visibility classes are `public`, `participants`, and `private`; `scope_members` is rejected.
- Current disclosure policy may narrow exposure but never widen canonical assertion visibility.
- Runtime/model metadata never determines Actor identity; `MODEL != RESIDENT` remains explicit.
- Verification labels are derived from provenance; profile payloads cannot self-declare `verified`.
- Invisible assertions/relationships cannot influence visible counts, categories, badges, or cache keys.
- HTML and JSON surfaces must be rendered from the same viewer-filtered profile object.
- Actor/entity retirement, runtime retirement, actor merge, reputation, Feed, recommendations, presence, media upload, and AI Board candidate promotion are out of scope.

---

## File Map

```text
schemas/
  profile-fields.v0.1.json
profile/
  field-registry.js
  schemas.js
  fold.js
  service.js
  provenance.js
  read-policy.js
  projector.js
  read-service.js
  render-json.js
  render-html.js
  product-commands.js
db/migrations/
  002_actor_profile.sql
db/sqlite.js
entity/fold.js
authority/policy.js
package.json
test/
  profile-fold.test.js
  profile-service.test.js
  profile-visibility.test.js
  profile-projection.test.js
  profile-parity.test.js
  profile-identity-boundary.test.js
  profile-conformance.test.js
```

---

### Task 1: Profile Field Registry and Pure Assertion Fold

**Files:**
- Create: `schemas/profile-fields.v0.1.json`
- Create: `profile/field-registry.js`
- Create: `profile/schemas.js`
- Create: `profile/fold.js`
- Test: `test/profile-fold.test.js`

**Interfaces:**
- Produces: `getProfileField(fieldRef) -> fieldDefinition`
- Produces: `resolveAssertionVisibility(fieldDefinition, requestedVisibility) -> string`
- Produces: `validateAssertionPayload(payload) -> payload`
- Produces: `foldProfileAssertions(entityEvents) -> ProfileAssertionState`
- `ProfileAssertionState.active_single` maps `field_ref -> assertion`
- `ProfileAssertionState.active_multi` maps `field_ref -> assertion[]`
- `ProfileAssertionState.history` preserves every assertion/retraction record.

- [ ] **Step 1: Write the failing fold tests**

Create tests proving:

```js
assert.equal(state.active_single['profile:display_name:v1'].value, 'Aletheia');
assert.equal(state.active_multi['profile:alias:v1'].length, 2);
assert.throws(() => foldProfileAssertions(eventsWithSilentSingleOverwrite), /PROFILE_SUPERSESSION_REQUIRED/);
assert.throws(() => foldProfileAssertions(eventsChangingVisibilityInPlace), /ASSERTION_IMMUTABLE/);
assert.equal(state.active_multi['profile:alias:v1'].length, 0); // after targeted retracts
```

Also verify a `retract` targeting an unknown assertion fails with `PROFILE_RETRACT_TARGET_NOT_ACTIVE`.

- [ ] **Step 2: Run RED**

```bash
node --test test/profile-fold.test.js
```

Expected: FAIL because `profile/fold.js` does not exist.

- [ ] **Step 3: Add the versioned field registry**

`schemas/profile-fields.v0.1.json` must define exactly:

```text
profile:display_name:v1  string single max 120  default public
profile:bio:v1           string single max 4000 default public
profile:avatar_url:v1    url    single         default public
profile:website:v1       url    single         default public
profile:alias:v1         string multi  max 120 default participants
profile:external_link:v1 url    multi          default public
```

All fields allow only `public`, `participants`, `private`; all are `self_assertable: true`.

- [ ] **Step 4: Implement registry and validation**

Reject:

```text
unknown field_ref
unknown operation
scope_ref present
verified present
visibility not in field allowed list
value type mismatch
string max_length exceeded
malformed URL for URL fields
```

For `retract`, require `target_assertion_id` and forbid `value`.

- [ ] **Step 5: Implement pure fold**

For `assert`:

```text
single + no active assertion -> activate
single + active assertion + exact supersedes_assertion_id -> deactivate old, activate new
single + active assertion + missing/wrong supersedes -> PROFILE_SUPERSESSION_REQUIRED
multi -> activate independently
```

For `retract`:

```text
target must be active
field_ref must equal target field_ref
retraction removes target from active view but history remains append-only
```

- [ ] **Step 6: Run GREEN**

```bash
node --test test/profile-fold.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add schemas/profile-fields.v0.1.json profile test/profile-fold.test.js
git commit -m "feat: define profile assertion registry and fold"
```

---

### Task 2: Canonical Profile Assertion Command Service

**Files:**
- Create: `profile/service.js`
- Create: `profile/product-commands.js`
- Modify: `authority/policy.js`
- Modify: `entity/fold.js`
- Test: `test/profile-service.test.js`

**Interfaces:**
- Produces: `addEntityAssertion(command, { eventStore, authorize }) -> { assertion_id, receipt }`
- Produces product adapters: `setDisplayName`, `setBio`, `setAvatarUrl`, `setWebsite`, `addAlias`, `removeAlias`, `addExternalLink`, `removeExternalLink`
- Consumes canonical entity stream via `eventStore.readStream('entity', actorId)`.
- Never reads projection tables to decide supersession or authority.

- [ ] **Step 1: Write failing service tests**

Verify:

```text
SetDisplayName emits entity.assertion_added only
second SetDisplayName without correct supersedes assertion rejects
correct supersession succeeds
AddAlias allows two concurrent aliases
RemoveAlias appends a retract assertion and does not delete prior event
requested private visibility is persisted unchanged
scope_ref input rejects
verified input rejects
```

- [ ] **Step 2: Run RED**

```bash
node --test test/profile-service.test.js
```

Expected: FAIL because profile service is missing.

- [ ] **Step 3: Extend authority with entity assertion action**

Add deterministic policy action:

```text
entity.assertion_add
```

Allow only when `principal_actor_id === target_entity_id` for v0.1 self-assertable fields. The policy evaluates supplied canonical context only; it does not read profile projections or relationship trust scores.

- [ ] **Step 4: Implement generic assertion command**

Command shape:

```js
{
  command_id,
  idempotency_key,
  principal_id,
  principal_actor_id,
  actor_id,
  field_ref,
  operation,
  value?,
  requested_visibility?,
  supersedes_assertion_id?,
  target_assertion_id?,
  occurred_at?,
  provenance_refs?
}
```

Service flow:

```text
validate command
read canonical entity stream
fold entity existence
fold profile assertions
resolve field registry and immutable visibility
validate supersession/retraction against canonical stream
request authority receipt
append exactly one entity.assertion_added event
return assertion ID + command receipt
```

- [ ] **Step 5: Implement product adapters**

Each adapter only maps friendly input to `addEntityAssertion`; no adapter writes EventStore directly.

- [ ] **Step 6: Run GREEN plus Foundation regression**

```bash
node --test test/profile-service.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add profile authority/policy.js entity/fold.js test/profile-service.test.js
git commit -m "feat: add canonical actor profile assertion commands"
```

---

### Task 3: Profile Projection Storage and Deterministic Rebuild

**Files:**
- Create: `db/migrations/002_actor_profile.sql`
- Modify: `db/sqlite.js`
- Create: `profile/projector.js`
- Test: `test/profile-projection.test.js`

**Interfaces:**
- Produces: `rebuildActorProfileProjection(db, eventStore) -> void`
- Produces: `projectActorProfile(db, eventStore, actorId) -> void`
- Projection tables are disposable and may be deleted/upserted.

- [ ] **Step 1: Write destructive rebuild RED**

Test:

```text
register actor
assert display name
assert bio private
add alias
supersede display name
capture profile projection rows
DELETE profile projection rows
rebuild solely from canonical entity events
assert deepEqual before/after
```

- [ ] **Step 2: Run RED**

```bash
node --test test/profile-projection.test.js
```

Expected: FAIL because migration/projector is absent.

- [ ] **Step 3: Add migration 002**

Create disposable tables:

```sql
actor_profile_assertions_current(
  assertion_id PRIMARY KEY,
  actor_id,
  field_ref,
  operation,
  value_json,
  visibility,
  provenance_class,
  active,
  supersedes_assertion_id,
  target_assertion_id,
  created_event_id,
  stream_version,
  materializer_version
)

actor_profile_current(
  actor_id PRIMARY KEY,
  projection_json,
  last_event_id,
  stream_version,
  materializer_version
)
```

Do not create an authoritative mutable user/profile table.

- [ ] **Step 4: Update database migration loader**

`openDatabase()` must execute migrations in filename order (`001_*.sql`, `002_*.sql`) so clean databases always reach the current schema.

- [ ] **Step 5: Implement projector**

Projection reads canonical entity stream, folds profile assertions, derives current active records, and UPSERTs projection tables. Projector never emits canonical events.

- [ ] **Step 6: Run GREEN and full regression**

```bash
node --test test/profile-projection.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add db profile/projector.js test/profile-projection.test.js
git commit -m "feat: add rebuildable actor profile projections"
```

---

### Task 4: Viewer Read Policy, Provenance Classes, and No Aggregate Leakage

**Files:**
- Create: `profile/provenance.js`
- Create: `profile/read-policy.js`
- Create: `profile/read-service.js`
- Test: `test/profile-visibility.test.js`
- Test: `test/profile-identity-boundary.test.js`

**Interfaces:**
- Produces: `classifyAssertionProvenance(event, authorityReceipt) -> string`
- Produces: `canViewAssertion(assertion, viewerContext, relationshipStates) -> boolean`
- Produces: `buildActorProfile({ actorId, viewerContext, eventStore, db, disclosurePolicy, runtimeDisclosurePolicy }) -> profile`
- Default runtime disclosure exposes runtime bindings only to self/authorized representative; public runtime exposure requires explicit injected policy.

- [ ] **Step 1: Write visibility RED tests**

Verify:

```text
anonymous sees public assertion only
anonymous does not see participants/private values or counts
self/authorized representative sees public+participants+private
qualified direct relationship participant sees participants but not private
unrelated authenticated actor does not see participants
current disclosure policy may hide public assertion
current disclosure policy cannot expose private assertion
```

- [ ] **Step 2: Write identity-boundary RED tests**

Verify machine profile has distinct sections:

```text
actor_id / entity_kind
presentation
runtime_bindings
social
```

and that model/provider/runtime values never replace `actor_id` or appear as a verification badge.

- [ ] **Step 3: Implement provenance classifier**

Use deterministic evidence only:

```text
provenance ref prefixed external: -> external_attested
principal_id prefixed system: -> system_observed
authority receipt actor_id == profile actor -> self_declared
otherwise -> authority_attested
```

This is a presentation classification, not a canonical field.

- [ ] **Step 4: Implement viewer policy**

Define v0.1 participant qualification exactly as:

```text
viewer is target actor, OR viewer is an explicitly authorized representative, OR
viewer_actor_id is the opposite endpoint of at least one active direct relationship involving target actor and that relationship itself is readable by that viewer.
```

No graph-distance inference beyond direct edge is permitted.

Private assertions: self/authorized representative only.

- [ ] **Step 5: Implement relationship summary and no-leak aggregation**

Filter relationships before grouping/counting. Never compute total hidden counts then redact rows.

- [ ] **Step 6: Implement runtime view**

Default public viewer receives `runtime_bindings: []`. Self/authorized viewer may receive recorded bindings. UI label semantics remain `runtime_bindings`, never `identity` or `current_runtime`.

- [ ] **Step 7: Run GREEN**

```bash
node --test test/profile-visibility.test.js test/profile-identity-boundary.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add profile test/profile-visibility.test.js test/profile-identity-boundary.test.js
git commit -m "feat: add viewer-relative profile read policy"
```

---

### Task 5: Shared JSON and HTML Profile Surfaces

**Files:**
- Create: `profile/render-json.js`
- Create: `profile/render-html.js`
- Test: `test/profile-parity.test.js`

**Interfaces:**
- Produces: `serializeProfileJson(profile) -> object`
- Produces: `renderProfileHtml(profile) -> string`
- Both consume the exact same `buildActorProfile()` result and perform no additional data lookup.

- [ ] **Step 1: Write parity RED**

Create a public profile containing public display name, private bio, public relationship, and private relationship. Assert:

```text
JSON contains public display name and public relationship only
HTML contains the same public facts
HTML source does not contain private bio value, private relationship ID, or hidden total count
```

- [ ] **Step 2: Run RED**

```bash
node --test test/profile-parity.test.js
```

Expected: FAIL because renderers are missing.

- [ ] **Step 3: Implement JSON serializer**

Return stable shape:

```js
{
  actor_id,
  entity_kind,
  presentation,
  runtime_bindings,
  social,
  viewer_scope,
  projection_version: 'actor-profile:0.1'
}
```

No secret/canonical-history internals beyond explicitly exposed provenance IDs.

- [ ] **Step 4: Implement HTML renderer**

Server-render semantic HTML from the already-filtered profile object. Escape all user-supplied text/attributes. Do not embed an unfiltered hydration blob.

- [ ] **Step 5: Run GREEN**

```bash
node --test test/profile-parity.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add profile/render-json.js profile/render-html.js test/profile-parity.test.js
git commit -m "feat: add human and machine actor profile surfaces"
```

---

### Task 6: Actor Profile v0.1 Conformance Gate

**Files:**
- Create: `test/profile-conformance.test.js`
- Create: `docs/ACTOR_PROFILE_CONFORMANCE_v0.1.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces executable P1-P10 release gate.
- Produces end-to-end visible Product Vertical Slice.

- [ ] **Step 1: Add P1-P10 invariant mapping**

Document exact tests:

```text
P1  Profile projection only -> projection rebuild + API surface negative checks
P2  Displayed canonical claim provenance -> profile visibility/parity tests
P3  Runtime metadata not identity -> profile identity boundary
P4  Inference not profile fact -> exported API negative checks
P5  Assertion visibility immutable -> profile fold/service tests
P6  Single-value update is supersession -> profile fold/service tests
P7  Verification not self-declared -> profile schema tests
P8  No aggregate leakage -> profile visibility/parity tests
P9  HTML/JSON public facts parity -> profile parity test
P10 Renderer cannot write EventStore -> exported API/dependency boundary test
```

- [ ] **Step 2: Write full vertical slice**

Execute:

```text
register A
set public display name
set private bio
set public avatar URL
register B
A follows B with public relationship
build anonymous profile A
assert only public facts
build self profile A
assert private bio visible
capture profile JSON
DELETE profile and relationship projections
rebuild from canonical histories
build same viewer profile
assert deepEqual before/after
verify entity + relationship hash chains
```

- [ ] **Step 3: Add negative exported-surface checks**

Assert no exported production API named or equivalent to:

```text
updateProfileRow
setVerified
mergeActor
retireActor
autoGenerateBioAndCommit
writeProfileProjectionAsTruth
promoteProfileInference
```

- [ ] **Step 4: Update syntax-check paths**

Add `profile/*.js` to `npm run check`.

- [ ] **Step 5: Run full fresh verification twice**

```bash
npm test
npm run check
npm test
npm run check
git diff --check
```

Expected: all tests PASS both times; checks PASS; `git diff --check` emits no output.

- [ ] **Step 6: Commit**

```bash
git add README.md package.json docs/ACTOR_PROFILE_CONFORMANCE_v0.1.md test/profile-conformance.test.js
git commit -m "test: seal Actor Profile v0.1 conformance gate"
```

---

## Deferred Deliverables

The following remain explicitly outside Actor Profile v0.1:

1. Actor/entity retirement semantics.
2. Runtime binding termination/current-runtime semantics.
3. Relationship mutation/detail UI.
4. Community and organization profile editing.
5. Reputation, trust score, recommendations, Feed, presence, messaging.
6. Media upload/proxy/transformation; v0.1 stores only validated avatar URL assertions.
7. Automatic AI profile inference promotion.
8. HTTP server/router integration if the host application does not yet expose one; v0.1 seals the profile representation contract and pure rendering surfaces.

## Definition of Done

Actor Profile v0.1 is complete only when canonical entity history plus relationship history can reproduce the same viewer-relative profile after every profile/relationship projection is destroyed, while P1-P10 remain executable constraints and HTML contains no facts that the equivalent JSON viewer projection does not contain.
