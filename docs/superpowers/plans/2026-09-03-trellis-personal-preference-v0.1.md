# Trellis Personal Preference v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an append-only owner-private Personal Preference domain for bookmarks, exact Feed dismissal, publication-scoped not-interested, and actor mute, then consume those directives in owner-only Feed/Notification projections without rewriting source histories.

**Architecture:** Preference is a new canonical stream with deterministic `(owner,type,target)` identity and `created/withdrawn/restored` lifecycle. `preferences_current` is disposable. Raw Preference read/mutation is owner-only; Feed/Notification consume active preferences only when `viewer_actor_id === owner`, after source-domain visibility/current-eligibility filtering and before aggregates/snapshot/cursor computation.

**Tech Stack:** Node.js CommonJS, `node:test`, `node:sqlite`, existing Trellis EventStore/Authority/materializer conventions. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-03-trellis-personal-preference-v0.1-design.md`

## Global Constraints

- Base commit: Notification v0.1 hotfix `21b4a4e9f5d235123e1a451f78138d25c2a57cc1`.
- Node engine remains `>=22.5.0`.
- Canonical events are append-only; no UPDATE of canonical history.
- Preference schema has no visibility/scope/audience override; audience is structurally `{owner}`.
- Only owner principal actor may read or mutate raw Preference state in v0.1; representatives may not.
- Preference changes must never mutate Publication, Relationship, Community, Reaction, Notification, Feed, or Discovery canonical histories.
- Preference suppression runs after source-domain visibility/current-eligibility and before owner-visible aggregate/snapshot/cursor computation.
- Representatives reading owner Feed/Inbox do not receive Preference-derived suppression in v0.1.
- Feed stays chronological; Preference does not introduce ranking.
- Discovery remains byte-for-byte unaffected by Preference-only changes.

---

### Task 1: Preference event algebra, target normalization, deterministic identity, and pure fold

**Files:**
- Create: `preference/types.js`
- Create: `preference/schemas.js`
- Create: `preference/fold.js`
- Test: `test/preference-fold.test.js`

**Interfaces:**
- Produces `PREFERENCE_TYPES`, `PREFERENCE_POLICY_REF`, `normalizePreferenceTarget(type,target)`, `derivePreferenceId(ownerActorId,type,target)`, and `foldPreference(events)`.
- `foldPreference([])` returns `lifecycle:'nonexistent'`.
- Active/withdrawn restore remains one stream and immutable identity.

- [ ] **Step 1: Write failing tests** asserting:

```js
const target={publication_id:'pub:P'};
const id=derivePreferenceId('actor:A','bookmark_publication',target);
assert.equal(id,derivePreferenceId('actor:A','bookmark_publication',target));
assert.notEqual(id,derivePreferenceId('actor:A','not_interested_publication',target));
```

and fold transitions:

```js
created -> active
created + withdrawn -> withdrawn
created + withdrawn + restored -> active
```

with immutable owner/type/target and rejection of `visibility`, `scope_ref`, or `audience_actor_ids` in created payload.

- [ ] **Step 2: Run RED**

Run: `node --test test/preference-fold.test.js`

Expected: FAIL because `../preference/types` / `fold` do not exist.

- [ ] **Step 3: Implement minimal pure domain code**

Use target normalization exactly as:

```js
bookmark_publication       -> {target_kind:'publication',target_ref:publication_id,target_item_kind:null}
not_interested_publication -> {target_kind:'publication',target_ref:publication_id,target_item_kind:null}
mute_actor                 -> {target_kind:'actor',target_ref:actor_id,target_item_kind:null}
dismiss_feed_item          -> {target_kind:'feed_item',target_ref:source_ref,target_item_kind:item_kind}
```

Allowed dismiss `item_kind` values are `publication` and `social_activity`.

Derive ID from canonical seed:

```js
`${ownerActorId}|${type}|${target_kind}|${target_item_kind ?? ''}|${target_ref}`
```

Fold only `preference.created`, `preference.withdrawn`, `preference.restored`.

- [ ] **Step 4: Run GREEN and regression**

Run:

```bash
node --test test/preference-fold.test.js
npm test
```

Expected: targeted PASS; full suite 0 failures.

- [ ] **Step 5: Commit**

```bash
git add preference test/preference-fold.test.js
git commit -m "feat: add Personal Preference event algebra"
```

---

### Task 2: Rebuildable `preferences_current` projection

**Files:**
- Create: `db/migrations/004_preference.sql`
- Create: `preference/projector.js`
- Test: `test/preference-rebuild.test.js`

**Interfaces:**
- Produces `projectPreferenceStream(db,eventStore,preferenceId)` and `rebuildPreferenceProjection(db,eventStore)`.
- Table contains the fields frozen in spec section 13.

- [ ] **Step 1: Write failing destructive-rebuild test** creating a synthetic Preference stream through EventStore, projecting it, copying the row, deleting all rows, rebuilding, and requiring deep equality.

- [ ] **Step 2: Run RED**

Run: `node --test test/preference-rebuild.test.js`

Expected: FAIL because migration/projector do not exist.

- [ ] **Step 3: Implement migration/projector** using the same replace-from-fold materializer pattern as Reaction/Notification. `materializer_version='preference-current:0.1'`.

- [ ] **Step 4: Run GREEN + full regression**

```bash
node --test test/preference-rebuild.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add db/migrations/004_preference.sql preference/projector.js test/preference-rebuild.test.js
git commit -m "feat: add rebuildable Preference projection"
```

---

### Task 3: Owner-only Preference command service and target validation

**Files:**
- Create: `preference/service.js`
- Modify: `authority/policy.js`
- Test: `test/preference-service.test.js`

**Interfaces:**
- Produces `createPreference(command,context)`, `withdrawPreference(command,context)`, `restorePreference(command,context)`.
- Adds Authority actions `preference.create`, `preference.withdraw`, `preference.restore` under `policy:preference-owner:v1`.

- [ ] **Step 1: Write failing service tests** covering:
  - owner create succeeds;
  - representative create/withdraw/restore is denied;
  - deterministic duplicate create rejects `PREFERENCE_ALREADY_EXISTS` after idempotency gate;
  - successful retry deduplicates;
  - withdraw/restore use same ID;
  - bookmark/not-interested creation requires active owner-readable Publication;
  - mute target requires an active Actor entity;
  - dismiss publication target requires active readable root Publication;
  - dismiss social activity target requires existing allowlisted `relationship.activated` event and currently owner-readable relationship;
  - restore revalidates target eligibility;
  - commands cannot supply `visibility`, `scope_ref`, or audience fields.

- [ ] **Step 2: Run RED**

Run: `node --test test/preference-service.test.js`

Expected: FAIL because service/Authority action is absent.

- [ ] **Step 3: Implement minimal service** following Reaction's order:

```text
normalize/derive ID
-> idempotency gate
-> require active owner actor
-> load current aggregate
-> target eligibility check (create/restore)
-> evaluate owner-only Authority
-> append canonical event
-> projectPreferenceStream
```

`withdrawPreference` does not require target to remain currently visible; owner may retract their own directive even after target state changes.

- [ ] **Step 4: Run GREEN + full regression**.

- [ ] **Step 5: Commit**.

---

### Task 4: Owner-only Preference read surface and bookmark projection

**Files:**
- Create: `preference/read-service.js`
- Create: `preference/render-json.js`
- Create: `preference/render-html.js`
- Test: `test/preference-surface.test.js`

**Interfaces:**
- Produces `loadPreferenceSurface({ownerActorId,viewerContext,...})`, `loadActivePreferenceSet(...)`, and owner-current bookmark entries.

- [ ] **Step 1: Write RED tests** asserting:
  - owner can read active directives;
  - representative and unrelated viewer get `PREFERENCE_NOT_AUTHORIZED`;
  - withdrawn directives are absent from active list but remain canonical;
  - active bookmark whose Publication becomes unreadable/withdrawn is absent from current bookmark projection;
  - list order is `preference_type,target_kind,target_ref,preference_id` ascending;
  - HTML and JSON derive from the exact same owner-filtered object;
  - GET/read does not append canonical events.

- [ ] **Step 2: Run RED**.

- [ ] **Step 3: Implement owner-only read layer**. Do not expose a visibility field. For bookmarks, resolve Publication at read time and return only safe identity/detail refs, not copied body in Preference canonical data.

- [ ] **Step 4: Run GREEN + full regression**.

- [ ] **Step 5: Commit**.

---

### Task 5: Apply owner Preference suppression to Home and Community Feed

**Files:**
- Create: `preference/feed-policy.js`
- Modify: `feed/home.js`
- Modify: `feed/community.js`
- Test: `test/preference-feed-integration.test.js`

**Interfaces:**
- Produces `applyOwnerFeedPreferences({ownerActorId,viewerContext,items,db})`.
- It returns unchanged items unless `viewerContext.viewer_actor_id === ownerActorId`.

- [ ] **Step 1: Write RED integration tests** covering:
  - bookmark does not change Feed items/order/snapshot;
  - dismiss exact publication item suppresses only that item;
  - dismiss exact social activity suppresses only that activity;
  - not-interested suppresses exact Publication item but leaves direct Publication detail readable and Discovery unchanged;
  - mute suppresses B-authored root Publication and activity directly involving B in Home and Community Feed;
  - mute does not delete follow/relationship/publication source state;
  - withdraw preference makes otherwise-eligible item reappear; restore suppresses again;
  - owner suppression is applied before snapshot computation, so suppressed items do not affect owner snapshot/cursor/count;
  - representative reading A's Feed receives the existing unsuppressed base projection and cannot infer A's private Preference through Preference decoration.

- [ ] **Step 2: Run RED**.

- [ ] **Step 3: Implement at the builder boundary**:

```text
build source-domain visible candidate items
-> applyOwnerFeedPreferences
-> chronological sort
-> compute snapshot
```

Do not alter `buildFeedSourceGraph()` or source canonical histories. Community Feed uses the same policy over its already-visible items.

- [ ] **Step 4: Run GREEN + full regression**.

- [ ] **Step 5: Commit**.

---

### Task 6: Apply owner `mute_actor` to Notification Inbox after source eligibility

**Files:**
- Create: `preference/notification-policy.js`
- Modify: `notification/read-service.js`
- Test: `test/preference-notification-integration.test.js`

**Interfaces:**
- Produces `applyOwnerNotificationPreferences({ownerActorId,viewerContext,items,db})`.

- [ ] **Step 1: Write RED tests** asserting:
  - active mute suppresses only current notification items with `source_actor_id` equal to muted actor;
  - canonical `notification.issued` receipt and ack state remain unchanged;
  - suppressed notification contributes nothing to owner `unread_count`, order, cursor, or snapshot;
  - withdraw/restore of mute unsuppresses/resuppresses currently eligible receipt;
  - dismiss/not-interested/bookmark do not alter Inbox;
  - representative Inbox read remains the existing unsuppressed recipient-current projection because Preference audience is owner-only.

- [ ] **Step 2: Run RED**.

- [ ] **Step 3: Implement ordering**:

```text
notification receipt rows
-> current source eligibility (N5/N6)
-> owner-only mute filter
-> unread count/order/snapshot/pagination
```

Never apply Preference before Notification source eligibility.

- [ ] **Step 4: Run GREEN + full regression**.

- [ ] **Step 5: Commit**.

---

### Task 7: Foundation X1-X3 inheritance and cross-domain non-signal gates

**Files:**
- Modify: `foundation/cross-domain-contract.js`
- Modify: `docs/FOUNDATION_CROSS_DOMAIN_CONFORMANCE_v0.1.md`
- Test: `test/preference-cross-domain.test.js`

**Interfaces:**
- Adds `preference: ['X1','X2','X3']` to `INHERITORS`.

- [ ] **Step 1: Write RED tests** requiring:
  - registry declaration exists;
  - non-owner cannot read raw Preference or any count/existence flag;
  - representative read authority does not grant Preference mutation;
  - Preference-only mutation leaves Discovery candidates/snapshot identical;
  - bookmark-only mutation leaves Feed identical;
  - preference command leaves source-domain canonical event counts unchanged except `stream_type='preference'`.

- [ ] **Step 2: Run RED**. Ideal result: behavior vectors already pass and only registry assertion fails.

- [ ] **Step 3: Add registry/document specialization** without duplicating Foundation safety logic.

- [ ] **Step 4: Run GREEN + full regression**.

- [ ] **Step 5: Commit**.

---

### Task 8: Q1-Q13 executable conformance and release seal

**Files:**
- Create: `test/preference-conformance.test.js`
- Create: `docs/PREFERENCE_CONFORMANCE_v0.1.md`
- Modify: `package.json`

**Interfaces:**
- Release syntax gate must include `preference/*.js`.

- [ ] **Step 1: Write final RED conformance test** executing the spec vertical slice end-to-end:
  - bookmark, dismiss activity, not-interested Publication, mute actor;
  - owner vs representative privacy;
  - Feed and Notification suppression ordering;
  - direct source visibility remains intact;
  - Discovery unchanged;
  - withdraw/restore same deterministic Preference ID;
  - delete/rebuild `preferences_current` equality;
  - Preference hash-chain verification;
  - no Preference API that blocks, unfollows, mutates Relationship, ranks Feed, or writes Consumption telemetry;
  - canonical source event counts unchanged by Preference commands.

Also assert `npm run check` source string contains `preference/*.js`; this is expected RED before package update.

- [ ] **Step 2: Run RED** and require any failure beyond syntax-gate omission to be fixed before sealing.

- [ ] **Step 3: Add `preference/*.js` to `npm run check` and write Q1-Q13 mapping** in `docs/PREFERENCE_CONFORMANCE_v0.1.md`.

- [ ] **Step 4: Run two full pre-commit gates**:

```bash
npm test
npm run check
git diff --check notification/v0.1...HEAD
git diff --check
```

Both runs must report zero failures.

- [ ] **Step 5: Commit seal**

```bash
git add package.json test/preference-conformance.test.js docs/PREFERENCE_CONFORMANCE_v0.1.md
git commit -m "test: seal Personal Preference v0.1 conformance"
```

- [ ] **Step 6: Fresh final-HEAD verification**

Run again on committed HEAD:

```bash
npm test
npm run check
git diff --check notification/v0.1...HEAD
git status --short
```

Completion requires 0 test failures, syntax exit 0, diff check clean, and empty working tree.
