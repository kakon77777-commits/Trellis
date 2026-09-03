# Trellis Consumption State v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-private, actual-viewer-bound, retention-bounded Consumption State without creating canonical Consumption history, while migrating Foundation's cross-domain registry to explicitly distinguish canonical, derived-projection, and operational state classes.

**Architecture:** Consumption uses a dedicated mutable SQLite operational table keyed by `(consumer_actor_id,target_kind,target_ref)`. Trusted surface adapters record only monotonic `first_seen` / `first_opened` state after Authority binds the actual viewer and current target eligibility is verified. Foundation registry migration is atomic: all existing domains move from flat `INHERITORS` to a state-classed registry with unchanged effective X1/X2/X3 inheritance; Consumption is operational and inherits X2/X3 while K1 supplies its singleton audience rule.

**Tech Stack:** Node.js CommonJS, Node `node:test`, `node:sqlite` / `DatabaseSync`, existing Trellis Authority/read-policy modules, no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-03-trellis-consumption-state-v0.1-design.md`

## Global Constraints

- Base branch is `preference/v0.1` at `51af28d2a8e80ab3edfc9acb770f8448f5769c65`.
- Consumption State MUST NOT append canonical events or command receipts.
- `consumption_state` is operational, retention-bounded, disposable, and intentionally not rebuildable from EventStore.
- Normal Consumption read is consumer-owner-only; representatives are denied.
- Recorder requests require explicit `consumption:record` capability and `requested_consumer_actor_id === recognized_viewer_actor_id`.
- Fetching Feed or Publication MUST NOT implicitly record seen/opened state.
- Record target eligibility is checked before any operational row is written.
- Feed v0.1, Discovery v0.1, Notification v0.1, and Personal Preference v0.1 semantics remain unchanged by Consumption-only state changes.
- Client-provided observation timestamps are non-authoritative; trusted server/service clock supplies all stored timestamps.
- Retention policy ref is `trellis-consumption:retention:v1`; v0.1 default TTL is 90 days from `last_touched_at`.
- `Seen != Interested`; `Opened != Endorsement`; Consumption MUST NOT create canonical Preference or social mutations.

---

## File map

Create:

- `db/migrations/005_consumption.sql` — mutable operational state table and indexes.
- `consumption/types.js` — target normalization, observation kinds, retention constants.
- `consumption/store.js` — operational UPSERT/list/expiry primitives; no EventStore dependency.
- `consumption/eligibility.js` — current readable target resolution for Publication and Feed social activity.
- `consumption/service.js` — Authority-bound `recordSeen()` / `recordOpened()` orchestration and server-clock semantics.
- `consumption/read-service.js` — owner-only current-eligible operational read projection.
- `test/consumption-foundation-registry.test.js` — Foundation v0.2 registry migration and continuity.
- `test/consumption-store.test.js` — state table monotonic/retention behavior.
- `test/consumption-service.test.js` — recorder Authority, actual-viewer binding, eligibility, server clock.
- `test/consumption-read.test.js` — owner-only read and current target omission.
- `test/consumption-cross-domain.test.js` — Fetch non-mutation and Feed/Discovery/Notification/Preference non-signal.
- `test/consumption-conformance.test.js` — K1-K13 + FR1-FR6 release gate.
- `docs/CONSUMPTION_CONFORMANCE_v0.1.md` — invariant-to-test mapping.

Modify:

- `foundation/cross-domain-contract.js` — migrate to v0.2 state-class registry.
- `authority/policy.js` — add `consumption.record` explicit-capability decision.
- Existing contract tests importing `INHERITORS` — migrate every assertion to the new registry API.
- `package.json` — add `consumption/*.js` to syntax gate at final seal.

---

### Task 1: Migrate Foundation cross-domain registry atomically

**Files:**
- Modify: `foundation/cross-domain-contract.js`
- Modify: `test/cross-domain-contract.test.js`
- Modify: `test/feed-conformance.test.js`
- Modify: `test/reaction-cross-domain.test.js`
- Modify: `test/reaction-conformance.test.js`
- Modify: `test/notification-cross-domain.test.js`
- Modify: `test/notification-conformance.test.js`
- Modify: `test/preference-cross-domain.test.js`
- Create: `test/consumption-foundation-registry.test.js`

**Interfaces:**
- Produces `CONTRACT_REF = 'trellis-foundation-cross-domain:0.2'`.
- Produces `STATE_CLASSES = ['canonical','derived_projection','operational']`.
- Produces `CONTRACT_REGISTRY[domain] = { state_class, canonical_contracts, derived_contracts, operational_contracts }`.
- Produces `effectiveContracts(domain)` returning the selected class-specific contract array.
- Removes test reliance on the old flat `INHERITORS` contract.

- [ ] **Step 1: Write the migration RED tests**

Add tests that first expect the new API and therefore fail against the old flat registry:

```js
const {
  CONTRACT_REF,
  CONTRACT_REGISTRY,
  effectiveContracts
} = require('../foundation/cross-domain-contract');

assert.equal(CONTRACT_REF, 'trellis-foundation-cross-domain:0.2');
assert.deepEqual(CONTRACT_REGISTRY.consumption, {
  state_class: 'operational',
  canonical_contracts: [],
  derived_contracts: [],
  operational_contracts: ['X2','X3']
});

for (const domain of [
  'profile','relationship_surface','community','discovery','publication',
  'feed','reaction','notification','preference'
]) {
  assert.deepEqual(effectiveContracts(domain), ['X1','X2','X3']);
}
```

Also assert exact state classes:

```js
assert.equal(CONTRACT_REGISTRY.profile.state_class, 'derived_projection');
assert.equal(CONTRACT_REGISTRY.relationship_surface.state_class, 'derived_projection');
assert.equal(CONTRACT_REGISTRY.community.state_class, 'canonical');
assert.equal(CONTRACT_REGISTRY.discovery.state_class, 'derived_projection');
assert.equal(CONTRACT_REGISTRY.publication.state_class, 'canonical');
assert.equal(CONTRACT_REGISTRY.feed.state_class, 'derived_projection');
assert.equal(CONTRACT_REGISTRY.reaction.state_class, 'canonical');
assert.equal(CONTRACT_REGISTRY.notification.state_class, 'canonical');
assert.equal(CONTRACT_REGISTRY.preference.state_class, 'canonical');
assert.equal(CONTRACT_REGISTRY.consumption.state_class, 'operational');
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test/consumption-foundation-registry.test.js test/cross-domain-contract.test.js test/feed-conformance.test.js test/reaction-cross-domain.test.js test/reaction-conformance.test.js test/notification-cross-domain.test.js test/notification-conformance.test.js test/preference-cross-domain.test.js
```

Expected: FAIL because `CONTRACT_REGISTRY` / `effectiveContracts` do not exist and old tests still assert `INHERITORS`.

- [ ] **Step 3: Implement the v0.2 registry**

Use a shape equivalent to:

```js
const CONTRACT_REF = 'trellis-foundation-cross-domain:0.2';
const STATE_CLASSES = Object.freeze(['canonical','derived_projection','operational']);
const INVARIANTS = Object.freeze({
  X1: 'canonical_visibility_ceiling',
  X2: 'descriptive_state_does_not_grant_authority',
  X3: 'viewer_noninterference'
});

function entry(stateClass, contracts) {
  return Object.freeze({
    state_class: stateClass,
    canonical_contracts: Object.freeze(stateClass === 'canonical' ? [...contracts] : []),
    derived_contracts: Object.freeze(stateClass === 'derived_projection' ? [...contracts] : []),
    operational_contracts: Object.freeze(stateClass === 'operational' ? [...contracts] : [])
  });
}

const CONTRACT_REGISTRY = Object.freeze({
  profile: entry('derived_projection',['X1','X2','X3']),
  relationship_surface: entry('derived_projection',['X1','X2','X3']),
  community: entry('canonical',['X1','X2','X3']),
  discovery: entry('derived_projection',['X1','X2','X3']),
  publication: entry('canonical',['X1','X2','X3']),
  feed: entry('derived_projection',['X1','X2','X3']),
  reaction: entry('canonical',['X1','X2','X3']),
  notification: entry('canonical',['X1','X2','X3']),
  preference: entry('canonical',['X1','X2','X3']),
  consumption: entry('operational',['X2','X3'])
});

function effectiveContracts(domain) {
  const value = CONTRACT_REGISTRY[domain];
  if (!value) return [];
  if (value.state_class === 'canonical') return [...value.canonical_contracts];
  if (value.state_class === 'derived_projection') return [...value.derived_contracts];
  return [...value.operational_contracts];
}
```

Export only the new registry API used by migrated tests.

- [ ] **Step 4: Migrate every existing contract assertion**

Replace all imports/assertions such as:

```js
const { INHERITORS } = require('../foundation/cross-domain-contract');
assert.deepEqual(INHERITORS.preference,['X1','X2','X3']);
```

with:

```js
const { CONTRACT_REGISTRY, effectiveContracts } = require('../foundation/cross-domain-contract');
assert.equal(CONTRACT_REGISTRY.preference.state_class,'canonical');
assert.deepEqual(effectiveContracts('preference'),['X1','X2','X3']);
```

Do this for every existing domain test that referenced `INHERITORS`.

- [ ] **Step 5: Run GREEN and full regression**

```bash
node --test test/consumption-foundation-registry.test.js test/cross-domain-contract.test.js test/feed-conformance.test.js test/reaction-cross-domain.test.js test/reaction-conformance.test.js test/notification-cross-domain.test.js test/notification-conformance.test.js test/preference-cross-domain.test.js
npm test
```

Expected: all tests PASS; every pre-Consumption domain still effectively inherits X1/X2/X3.

- [ ] **Step 6: Commit**

```bash
git add foundation/cross-domain-contract.js test/cross-domain-contract.test.js test/feed-conformance.test.js test/reaction-cross-domain.test.js test/reaction-conformance.test.js test/notification-cross-domain.test.js test/notification-conformance.test.js test/preference-cross-domain.test.js test/consumption-foundation-registry.test.js
git commit -m "refactor: classify Trellis state contracts"
```

---

### Task 2: Add retention-bounded operational Consumption storage

**Files:**
- Create: `db/migrations/005_consumption.sql`
- Create: `consumption/types.js`
- Create: `consumption/store.js`
- Create: `test/consumption-store.test.js`

**Interfaces:**
- `normalizeConsumptionTarget(observation, target)` returns `{ target_kind, target_ref }`.
- `ConsumptionStore.get(consumerActorId,targetKind,targetRef)`.
- `ConsumptionStore.recordSeen(...)` and `recordOpened(...)` preserve first timestamps and update retention metadata.
- `ConsumptionStore.listForConsumer(consumerActorId)`.
- `ConsumptionStore.deleteExpired(nowIso)` deletes only expired operational rows.
- No method reads or writes canonical EventStore.

- [ ] **Step 1: Write RED tests for schema and monotonic state**

Cover:

```js
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n,0);

store.recordSeen({ consumerActorId:'actor:A', targetKind:'publication', targetRef:'pub:P', now:'2026-09-03T10:00:00Z' });
store.recordSeen({ consumerActorId:'actor:A', targetKind:'publication', targetRef:'pub:P', now:'2026-09-03T11:00:00Z' });
const row=store.get('actor:A','publication','pub:P');
assert.equal(row.first_seen_at,'2026-09-03T10:00:00Z');
assert.equal(row.last_touched_at,'2026-09-03T11:00:00Z');
assert.equal(row.first_opened_at,null);
```

Then:

```js
store.recordOpened({ ..., now:'2026-09-03T12:00:00Z' });
assert.equal(row.first_seen_at,'2026-09-03T10:00:00Z');
assert.equal(row.first_opened_at,'2026-09-03T12:00:00Z');
```

Also cover opened-first establishing both first timestamps at the trusted time.

- [ ] **Step 2: Run RED**

```bash
node --test test/consumption-store.test.js
```

Expected: FAIL because the table/modules do not exist.

- [ ] **Step 3: Add migration and store**

Migration columns:

```sql
CREATE TABLE consumption_state (
  consumer_actor_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  first_seen_at TEXT,
  first_opened_at TEXT,
  last_touched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  retention_policy_ref TEXT NOT NULL,
  PRIMARY KEY (consumer_actor_id,target_kind,target_ref)
);
CREATE INDEX consumption_state_expiry_idx ON consumption_state(expires_at);
CREATE INDEX consumption_state_consumer_idx ON consumption_state(consumer_actor_id,last_touched_at,target_kind,target_ref);
```

Use `RETENTION_POLICY_REF='trellis-consumption:retention:v1'` and `DEFAULT_RETENTION_DAYS=90` in `consumption/types.js`.

`ConsumptionStore` performs SQL UPSERTs. Repeated seen/opened does not replace a non-null first timestamp. `state_version` increments on accepted touches.

- [ ] **Step 4: Add expiry tests**

Create expired and unexpired rows, run `deleteExpired(nowIso)`, and assert only expired rows are removed. Assert there is no `stream_type='consumption'` canonical event.

- [ ] **Step 5: Run GREEN and regression**

```bash
node --test test/consumption-store.test.js
npm test
```

- [ ] **Step 6: Commit**

```bash
git add db/migrations/005_consumption.sql consumption/types.js consumption/store.js test/consumption-store.test.js
git commit -m "feat: add retention-bounded consumption state"
```

---

### Task 3: Record seen/opened with actual-viewer Authority and current target eligibility

**Files:**
- Create: `consumption/eligibility.js`
- Create: `consumption/service.js`
- Modify: `authority/policy.js`
- Create: `test/consumption-service.test.js`

**Interfaces:**
- `resolveConsumptionTarget({ observation, target, viewerActorId, db, eventStore, disclosurePolicy })` returns normalized current-readable target metadata or throws a domain error.
- `recordSeen(command,context)`.
- `recordOpened(command,context)`.
- Context requires `recognizedViewerActorId`, `principalActorId`, `capabilityGrants`, `now` or injected trusted clock.

- [ ] **Step 1: Write RED tests for recorder Authority and anti-spoofing**

Use a recorder grant:

```js
const grant={
  active:true,
  principal_id:'principal:surface',
  capability:'consumption:record',
  scope_ref:null
};
```

Assert:

```js
recordSeen({
  command_id:'consume:1',
  principal_id:'principal:surface',
  requested_consumer_actor_id:'actor:A',
  target:{ publication_id:'pub:P' }
}, {
  recognizedViewerActorId:'actor:A',
  capabilityGrants:[grant], ...
});
```

passes, while requested A + recognized B is denied even when the recorder capability exists.

Assert a representative reading A's Feed cannot cause A Consumption merely by setting `requested_consumer_actor_id='actor:A'` when recognized viewer is B.

- [ ] **Step 2: Write RED tests for eligibility**

Cover:

- active readable public Publication → record allowed;
- withdrawn Publication → denied;
- current-policy-hidden Publication → denied;
- hidden relationship activation social activity → denied;
- valid visible allowlisted Feed social activity → `seen` allowed;
- `opened` on social activity → denied;
- nonexistent target → denied.

- [ ] **Step 3: Run RED**

```bash
node --test test/consumption-service.test.js
```

- [ ] **Step 4: Add Authority decision**

In `authority/policy.js`, add a Consumption branch equivalent to:

```js
function consumptionDecision(request) {
  if (request.requested_action !== 'consumption.record') return false;
  return Boolean(
    request.actor_id &&
    request.recognized_viewer_actor_id === request.actor_id &&
    hasExplicitCapability({ ...request, capability:'consumption:record', scope_ref:null }) &&
    request.target_readable === true
  );
}
```

The service must pass `actor_id=requested_consumer_actor_id`, never derive consumer from Feed subject.

- [ ] **Step 5: Implement target resolver and service**

Publication eligibility uses canonical `foldPublication()` + `canViewPublication()` + membership resolver.

Social activity eligibility uses `eventStore.readEvent(eventId)`, requires `relationship.activated`, folds the relationship, requires `ACTIVITY_TYPES[relationship_type]`, and applies `canViewRelationship()`.

Service obtains its timestamp only from a trusted injected clock such as `context.now()` or `new Date().toISOString()`. Ignore/reject request fields named `occurred_at`, `first_seen_at`, `first_opened_at`, or `recorded_at`.

- [ ] **Step 6: Run GREEN and regression**

```bash
node --test test/consumption-service.test.js
npm test
```

- [ ] **Step 7: Commit**

```bash
git add authority/policy.js consumption/eligibility.js consumption/service.js test/consumption-service.test.js
git commit -m "feat: record actual-viewer consumption state"
```

---

### Task 4: Add owner-only current-eligible Consumption read and retention cleanup

**Files:**
- Create: `consumption/read-service.js`
- Extend: `test/consumption-read.test.js`

**Interfaces:**
- `loadConsumptionSurface({ consumerActorId, viewerContext, db, eventStore, disclosurePolicy })`.
- `purgeExpiredConsumption({ db, now })` delegates to operational store and returns deleted count.

- [ ] **Step 1: Write RED tests for owner-only read**

Assert:

```js
loadConsumptionSurface({consumerActorId:'actor:A',viewerContext:{viewer_actor_id:'actor:A'},...})
```

returns A's eligible rows, while actor B and representative R both receive `CONSUMPTION_NOT_AUTHORIZED`.

- [ ] **Step 2: Write RED tests for current eligibility on read**

Record P while readable. Then separately test:

- Publication withdrawn;
- current disclosure policy hides Publication;
- required Community membership is lost.

The row stays in `consumption_state`, but normal owner surface omits it.

- [ ] **Step 3: Implement owner-only read**

Read rows from `ConsumptionStore.listForConsumer()` and run the same current target resolver in read-only mode. Never delete a row merely because it is currently hidden; retention cleanup is separate.

Return only normalized fields:

```js
{
  consumer_actor_id,
  target_kind,
  target_ref,
  first_seen_at,
  first_opened_at,
  last_touched_at,
  expires_at,
  retention_policy_ref
}
```

- [ ] **Step 4: Add retention cleanup test**

Call purge at a trusted server time and verify expired rows disappear while canonical event counts are unchanged.

- [ ] **Step 5: Run GREEN and regression**

```bash
node --test test/consumption-read.test.js
npm test
```

- [ ] **Step 6: Commit**

```bash
git add consumption/read-service.js test/consumption-read.test.js
git commit -m "feat: add private consumption read surface"
```

---

### Task 5: Prove Feed/Publication fetches do not mutate Consumption and representation binds actual viewer

**Files:**
- Create: `test/consumption-cross-domain.test.js`
- Do not modify Feed/Publication production modules unless a failing test exposes an actual side effect.

**Interfaces:**
- Existing `buildHomeFeed()` and `loadPublicationSurface()` remain pure reads with respect to `consumption_state`.

- [ ] **Step 1: Write RED/behavior tests**

Create A's Feed with P1/P2/E1. Count rows before and after:

```js
const before=db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n;
buildHomeFeed(...);
loadPublicationSurface(...);
const after=db.prepare('SELECT COUNT(*) AS n FROM consumption_state').get().n;
assert.equal(after,before);
```

This may already pass; if so, keep it as a conformance test and do not invent production work.

Also exercise B reading A's Feed as representative, then call Consumption service with recognized viewer B and target P2. Assert only `(actor:B, publication, pub:P2)` is written.

- [ ] **Step 2: Verify no source mutation**

Capture canonical event counts by stream type before/after Consumption writes. Assert all counts are identical and no `stream_type='consumption'` exists.

- [ ] **Step 3: Verify Feed/Discovery/Notification v0.1 non-signal**

Build owner-visible Feed/Discovery/Notification baseline, add visible Consumption rows, and assert outputs remain deep-equal because v0.1 algorithms do not consume Consumption State.

- [ ] **Step 4: Run tests and regression**

```bash
node --test test/consumption-cross-domain.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add test/consumption-cross-domain.test.js
git commit -m "test: seal consumption cross-domain boundaries"
```

---

### Task 6: Prove Preference precedence and hidden-target noninterference structurally

**Files:**
- Extend: `test/consumption-cross-domain.test.js`
- Optionally create: `consumption/policy.js` only if a reusable no-ranking boundary needs code; do not add ranking behavior.

**Interfaces:**
- No Consumption-based ranking function is introduced.
- Existing Preference suppression remains the only owner-specific Feed suppression in v0.1.

- [ ] **Step 1: Add explicit Preference-vs-Consumption test**

Create `not_interested_publication(P1)`, then record `opened(P1)`. Assert Feed remains suppressed exactly as it was from Preference alone and Preference projection/history is unchanged.

- [ ] **Step 2: Add hidden-target non-signal test**

Record P2 while visible, then make P2 current-policy hidden. Assert the retained operational row does not alter visible Feed/Discovery/Notification outputs or snapshot refs.

- [ ] **Step 3: Add deletion non-signal test**

Delete all `consumption_state` rows. Assert the same canonical and derived social outputs remain unchanged except the private Consumption surface itself.

- [ ] **Step 4: Run tests and regression**

```bash
node --test test/consumption-cross-domain.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add test/consumption-cross-domain.test.js
git commit -m "test: enforce weak consumption semantics"
```

---

### Task 7: Add K1-K13 and FR1-FR6 executable conformance

**Files:**
- Create: `test/consumption-conformance.test.js`
- Create: `docs/CONSUMPTION_CONFORMANCE_v0.1.md`
- Modify: `package.json`

**Interfaces:**
- This task introduces no new runtime behavior except any minimal fix revealed by a failing conformance test.

- [ ] **Step 1: Write final conformance RED**

The conformance test MUST cover:

```text
FR1 explicit state_class
FR2 class-aligned contract lists
FR3 no previous contract loss
FR4 canonical domains include X1
FR5 operational consumption omits X1 and has K1 + X2/X3
FR6 derived projections retain X1/X2/X3

K1 singleton consumer audience
K2 consumer equals Authority-recognized actual viewer
K3 representative read-as does not transfer consumption
K4 Feed fetch does not mark seen
K5 Publication fetch does not mark opened
K6 current readable target required before record
K7 no canonical Consumption history
K8 deleting Consumption does not delete canonical social state
K9 seen is not interest
K10 opened is not endorsement
K11 hidden retained target creates no visible personalization signal
K12 Consumption cannot mutate canonical social state
K13 explicit Preference remains dominant over opened/seen observations
```

Also assert the current release syntax command includes `consumption/*.js`; this should be the deliberate release-discipline RED if runtime behavior is already complete.

- [ ] **Step 2: Run RED**

```bash
node --test test/consumption-conformance.test.js
npm run check
```

Expected: behavior tests pass except any real invariant gap; syntax coverage initially fails the explicit coverage assertion until `package.json` includes `consumption/*.js`.

- [ ] **Step 3: Fix only discovered invariant gaps**

If an invariant fails, investigate root cause before changing code. Do not weaken the invariant to match accidental behavior.

- [ ] **Step 4: Add syntax gate and conformance mapping**

Update `package.json` check script to include:

```text
consumption/*.js
```

Create `docs/CONSUMPTION_CONFORMANCE_v0.1.md` mapping FR1-FR6 and K1-K13 to exact tests/modules.

- [ ] **Step 5: Run two complete pre-commit gates**

Run twice:

```bash
npm test
npm run check
git diff --check preference/v0.1...HEAD
git diff --check
```

Expected each time: zero test failures, syntax PASS, no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add package.json test/consumption-conformance.test.js docs/CONSUMPTION_CONFORMANCE_v0.1.md
git add consumption foundation authority db/migrations test
git commit -m "test: seal Consumption State v0.1 conformance"
```

---

### Task 8: Final verification and reproducible delivery

**Files:**
- No source edits expected.
- Generate delivery artifacts outside the Git worktree.

**Interfaces:**
- Final branch remains `consumption/v0.1`.
- Base remains `preference/v0.1`.

- [ ] **Step 1: Fresh final HEAD verification**

```bash
npm test
npm run check
git diff --check preference/v0.1...HEAD
git status --short
```

Completion requires zero failures and a clean working tree.

- [ ] **Step 2: Verify operational/canonical separation directly**

Run a conformance probe that records Consumption State and asserts:

```sql
SELECT COUNT(*) FROM canonical_events WHERE stream_type='consumption';
```

returns `0`.

Delete `consumption_state` and verify canonical event counts by stream remain unchanged.

- [ ] **Step 3: Build reproducible source ZIP**

Use only `git ls-files` from final HEAD, fixed ZIP timestamps, no `.git/`, `node_modules`, runtime DB, `.env`, or worktree metadata.

- [ ] **Step 4: Build complete Git bundle**

```bash
git bundle create /mnt/data/Trellis_Consumption_State_v0.1_2026-09-03.git.bundle consumption/v0.1
```

Verify the bundle contains final HEAD and complete ancestry.

- [ ] **Step 5: Verify clean extracted ZIP**

Extract to a fresh directory and run:

```bash
npm test
npm run check
```

Expected: same passing suite and syntax gate as the worktree.

- [ ] **Step 6: Generate SHA-256 manifest**

Hash the Source ZIP and Git bundle into:

```text
/mnt/data/Trellis_Consumption_State_v0.1_2026-09-03.sha256
```

- [ ] **Step 7: Preserve branch without merge/push**

Do not merge to `preference/v0.1` and do not push unless the user explicitly chooses an integration option after delivery.
