# Trellis Notification v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a recipient-private Notification operational receipt domain that derives idempotent reply/reaction notifications from canonical source events, revalidates current source eligibility on every inbox read, and supports explicit recipient-only acknowledgment without copying source content.

**Architecture:** Notification candidates are derived from source events, but only `notification.issued` and `notification.acknowledged` are canonical. The processor performs recipient/source eligibility before issuance; the inbox re-evaluates source lifecycle/readability before aggregation. `notifications_current` is disposable, and Feed/Discovery/source domains remain independent.

**Tech Stack:** Node.js CommonJS, `node:test`, `node:sqlite`, existing Trellis SQLiteEventStore, Foundation X1-X3, Publication/Reaction read policy and materializers.

**Spec:** `docs/superpowers/specs/2026-09-03-trellis-notification-v0.1-design.md`

## Global Constraints

- Base branch is `reaction/v0.1`; implementation branch is `notification/v0.1`.
- Canonical Notification events are only `notification.issued` and `notification.acknowledged`.
- Notification v0.1 inherits Foundation `X1`, `X2`, and `X3`.
- Notification canonical visibility is immutable singleton-recipient `private`.
- No canonical Notification event stores Publication body, reply preview, reaction text, or other source-content copies.
- Receipt issuance happens only after current recipient source-eligibility passes.
- Current inbox visibility is re-evaluated independently from historical issuance.
- N6 must independently cover withdrawn/inactive source, policy-hidden source, and membership-loss source.
- Fetch/render is read-only; acknowledgment is explicit and recipient-only.
- Notification state never changes Feed v0.1 ranking/snapshot or Discovery v0.1 affinity/snapshot.
- No queue, external delivery, preference/mute, or consumption telemetry in v0.1.

---

## File Structure

- `notification/types.js` — event/rule/type constants and deterministic Notification ID.
- `notification/schemas.js` — canonical payload validation.
- `notification/fold.js` — pure aggregate fold for issued/acknowledged lifecycle.
- `db/migrations/003_notification.sql` — disposable `notifications_current` projection table/indexes.
- `notification/projector.js` — project/rebuild Notification streams.
- `events/event-store.js`, `events/sqlite-event-store.js` — add exact `readEvent(eventId)` source-event lookup.
- `notification/source-rules.js` — derive reply/reaction candidate metadata and current issuance eligibility.
- `notification/service.js` — idempotent `processSourceEvent()` and recipient-only `acknowledgeNotification()`.
- `notification/read-policy.js` — current source eligibility for historically-issued receipts.
- `notification/read-service.js` — filter-first Inbox projection and unread count.
- `notification/snapshot.js`, `notification/cursor.js` — deterministic current-visible snapshot/pagination.
- `notification/action-hints.js`, `notification/render-html.js`, `notification/render-json.js` — advisory/pure presentation.
- `foundation/cross-domain-contract.js` — machine-readable Notification X1-X3 inheritance.
- `authority/policy.js` — explicit processor capability and recipient-only ack decisions.
- `package.json` — release syntax gate includes `notification/*.js`.
- `docs/NOTIFICATION_CONFORMANCE_v0.1.md` — N1-N13/X1-X3 executable mapping.

---

### Task 1: Notification aggregate algebra and deterministic identity

**Files:**
- Create: `notification/types.js`
- Create: `notification/schemas.js`
- Create: `notification/fold.js`
- Test: `test/notification-fold.test.js`

**Interfaces:**
- Produces: `deriveNotificationId(recipientActorId, sourceEventRef, ruleRef) -> notification_id`
- Produces: `foldNotification(events) -> { notification_id, recipient_actor_id, notification_type, source_event_ref, source_object_ref, source_actor_id, rule_ref, visibility, acknowledged, ... }`

- [ ] **Step 1: Write failing fold/identity tests**

```js
const id1 = deriveNotificationId('actor:A','evt:reply-created','trellis-notification:reply:v1');
const id2 = deriveNotificationId('actor:A','evt:reply-created','trellis-notification:reply:v1');
assert.equal(id1,id2);
assert.throws(() => foldNotification([{ event_type:'notification.acknowledged', payload:{} }]), /NOTIFICATION_MUST_START_ISSUED/);
```

Also assert immutable recipient/source/rule fields, singleton `private` visibility, and one valid `issued -> acknowledged` transition.

- [ ] **Step 2: Run RED**

Run: `node --test test/notification-fold.test.js`
Expected: FAIL because Notification modules do not exist.

- [ ] **Step 3: Implement minimal types/schema/fold**

```js
const REPLY_RULE_REF='trellis-notification:reply:v1';
const REACTION_RULE_REF='trellis-notification:reaction:v1';
function deriveNotificationId(recipient,sourceEvent,rule){
  return deriveId('notification',`${recipient}|${sourceEvent}|${rule}`);
}
```

Fold `notification.issued` into `acknowledged:false`, allow one `notification.acknowledged`, reject duplicate acknowledgment/invalid starts, and reject any canonical `source_body`/`preview` copy fields.

- [ ] **Step 4: Run GREEN and regression**

Run: `node --test test/notification-fold.test.js && npm test`
Expected: targeted PASS and full suite 0 failures.

- [ ] **Step 5: Commit**

```bash
git add notification/types.js notification/schemas.js notification/fold.js test/notification-fold.test.js
git commit -m "feat: add Notification aggregate algebra"
```

---

### Task 2: Rebuildable Notification projection

**Files:**
- Create: `db/migrations/003_notification.sql`
- Create: `notification/projector.js`
- Test: `test/notification-rebuild.test.js`

**Interfaces:**
- Produces: `projectNotificationStream(db,eventStore,notificationId)`
- Produces: `rebuildNotificationProjection(db,eventStore)`

- [ ] **Step 1: Write failing projection/rebuild test**

```js
const before = db.prepare('SELECT * FROM notifications_current ORDER BY notification_id').all();
db.exec('DELETE FROM notifications_current');
rebuildNotificationProjection(db,store);
assert.deepEqual(db.prepare('SELECT * FROM notifications_current ORDER BY notification_id').all(),before);
```

The test seeds a canonical issued+acknowledged stream directly through EventStore with valid authority receipts.

- [ ] **Step 2: Run RED**

Run: `node --test test/notification-rebuild.test.js`
Expected: FAIL because table/projector are missing.

- [ ] **Step 3: Implement migration/projector**

`notifications_current` must include exactly the state fields frozen in the spec, including issued ordering metadata and acknowledged state. Rebuild scans only `stream_type='notification'`.

- [ ] **Step 4: Run GREEN and regression**

Run: `node --test test/notification-rebuild.test.js && npm test`
Expected: PASS, 0 full-suite failures.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/003_notification.sql notification/projector.js test/notification-rebuild.test.js
git commit -m "feat: add rebuildable Notification projection"
```

---

### Task 3: Source-event lookup, versioned rules, and write-time issuance processor

**Files:**
- Modify: `events/event-store.js`
- Modify: `events/sqlite-event-store.js`
- Modify: `authority/policy.js`
- Create: `notification/source-rules.js`
- Create: `notification/service.js`
- Test: `test/notification-processor.test.js`

**Interfaces:**
- Produces: `eventStore.readEvent(eventId) -> canonicalEvent | null`
- Produces: `processSourceEvent({ eventId, commandId, idempotencyKey }, context) -> { issued: boolean, notification_id?: string, reason?: string }`
- Context requires explicit processor capability grant: `{ principal_id, capability:'notification:issue', scope_ref:null, active:true }`.

- [ ] **Step 1: Write failing processor tests**

Cover:

```js
// reply created -> author gets one receipt
const result=processSourceEvent({eventId:replyCreatedId,commandId:'notify:r1',idempotencyKey:'notify:r1'},processorCtx);
assert.equal(result.issued,true);

// retry -> same receipt, no duplicate
assert.equal(processSourceEvent(sameInput,processorCtx).notification_id,result.notification_id);

// reaction.changed -> no receipt
assert.deepEqual(processSourceEvent(changeInput,processorCtx),{issued:false,reason:'NO_NOTIFICATION_RULE'});
```

Also test self-reply/self-reaction suppression, reaction `created/restored` issuance, `changed/withdrawn` non-issuance, and N4: unreadable source at processing time creates zero `notification.issued` events.

- [ ] **Step 2: Run RED**

Run: `node --test test/notification-processor.test.js`
Expected: FAIL because `readEvent`, source rules, and processor do not exist.

- [ ] **Step 3: Implement `readEvent` and source rules**

`readEvent` returns the same canonical event shape as `readStream`. Rule derivation returns either `null` or:

```js
{
  notification_type,
  rule_ref,
  recipient_actor_id,
  source_actor_id,
  source_object_ref
}
```

Reply rule loads parent Publication author. Reaction rule loads Reaction/target Publication. Both perform current lifecycle/readability checks for recipient before issuance.

- [ ] **Step 4: Implement explicit processor authority and append**

Add `notification.issue` Authority decision requiring an active explicit `notification:issue` capability grant for the processor principal. Use source actor as Notification event provenance `actor_id`, processor as `principal_id`, and rule/source refs in payload. Append to deterministic Notification stream expected version 0, then project it.

- [ ] **Step 5: Run GREEN and regression**

Run: `node --test test/notification-processor.test.js && npm test`
Expected: PASS and 0 regressions.

- [ ] **Step 6: Commit**

```bash
git add events/event-store.js events/sqlite-event-store.js authority/policy.js notification/source-rules.js notification/service.js test/notification-processor.test.js
git commit -m "feat: issue Notification receipts from eligible source events"
```

---

### Task 4: Current-source revalidation and filter-first Inbox

**Files:**
- Create: `notification/read-policy.js`
- Create: `notification/read-service.js`
- Test: `test/notification-inbox.test.js`

**Interfaces:**
- Produces: `loadCurrentNotificationItem({ row, viewerContext, db, eventStore, disclosurePolicy }) -> item | null`
- Produces: `buildNotificationInbox({ recipientActorId, viewerContext, db, eventStore, disclosurePolicy }) -> inbox`

- [ ] **Step 1: Write failing N5/N6 tests**

Issue valid reply/reaction receipts, then independently assert:

```js
withdrawSource();
assert.equal(inbox().items.some(i=>i.notification_id===id),false);
assert.equal(store.readStream('notification',id)[0].event_type,'notification.issued');
```

Repeat independently for current-policy-hidden and membership-lost cases. Assert hidden/inactive receipts do not change unread count, ordering, or other aggregate signal.

- [ ] **Step 2: Run RED**

Run: `node --test test/notification-inbox.test.js`
Expected: FAIL because current Inbox read policy/service do not exist.

- [ ] **Step 3: Implement source-specific current eligibility**

Reply receipt: source reply Publication must be active/readable to recipient. Reaction receipt: source Reaction must be active and target Publication active/readable. Rehydrate current safe source context at read time; never read cached body from Notification payload.

- [ ] **Step 4: Implement filter-first Inbox assembly**

Query recipient rows, resolve each current item to item/null, discard null first, then compute:

```js
{
  recipient_actor_id,
  items,
  unread_count: items.filter(i=>!i.acknowledged).length,
  projection_version:'trellis-notification-inbox:0.1'
}
```

Sort by issued recorded_at/global_offset/notification_id descending.

- [ ] **Step 5: Run GREEN and regression**

Run: `node --test test/notification-inbox.test.js && npm test`
Expected: PASS and 0 regressions.

- [ ] **Step 6: Commit**

```bash
git add notification/read-policy.js notification/read-service.js test/notification-inbox.test.js
git commit -m "feat: add current-source Notification inbox projection"
```

---

### Task 5: Recipient-only explicit acknowledgment

**Files:**
- Modify: `authority/policy.js`
- Modify: `notification/service.js`
- Test: `test/notification-ack.test.js`

**Interfaces:**
- Produces: `acknowledgeNotification(command, context) -> { notification_id, receipt }`

- [ ] **Step 1: Write failing acknowledgment tests**

```js
const before=canonicalEventCount();
buildNotificationInbox(...);
assert.equal(canonicalEventCount(),before); // fetch is read-only

acknowledgeNotification({
 command_id:'ack:1',idempotency_key:'ack:1',principal_id:'principal:actor:A',
 notification_id:id,expected_version:1
},recipientCtx);
assert.equal(inbox().unread_count,0);
```

Also assert representative/other Actor denial and `NOT_VISIBLE` if the source became current-ineligible before ack.

- [ ] **Step 2: Run RED**

Run: `node --test test/notification-ack.test.js`
Expected: FAIL because ack command is missing.

- [ ] **Step 3: Implement recipient-only Authority and ack path**

Add `notification.ack` decision requiring `principal_actor_id === recipient_actor_id`. Before Authority append, use the same current-inbox eligibility resolver from Task 4; if invisible return `NOT_VISIBLE`. Append only `notification.acknowledged` and update projection.

- [ ] **Step 4: Run GREEN and regression**

Run: `node --test test/notification-ack.test.js && npm test`
Expected: PASS and 0 regressions.

- [ ] **Step 5: Commit**

```bash
git add authority/policy.js notification/service.js test/notification-ack.test.js
git commit -m "feat: add recipient-only Notification acknowledgment"
```

---

### Task 6: Deterministic snapshot/cursor, HTML/JSON parity, and advisory actions

**Files:**
- Create: `notification/snapshot.js`
- Create: `notification/cursor.js`
- Create: `notification/action-hints.js`
- Create: `notification/render-json.js`
- Create: `notification/render-html.js`
- Modify: `notification/read-service.js`
- Test: `test/notification-cursor.test.js`
- Test: `test/notification-surface.test.js`

**Interfaces:**
- Produces: `computeNotificationSnapshotRef(inbox) -> sha256 hex`
- Produces: `paginateNotifications({ inbox, limit, cursor })`
- Produces: `loadNotificationInboxSurface(...)`

- [ ] **Step 1: Write failing cursor/surface tests**

Assert stable replay, `NOTIFICATION_SNAPSHOT_CHANGED` on visible item/ack/context change, and no cursor invalidation for hidden-only source changes. Assert HTML/JSON contain the same visible IDs/context and renderers have no storage import.

- [ ] **Step 2: Run RED**

Run: `node --test test/notification-cursor.test.js test/notification-surface.test.js`
Expected: FAIL because modules are missing.

- [ ] **Step 3: Implement snapshot/cursor**

Snapshot hashes recipient, current visible items including acknowledgment/current safe source context, algorithm ref, and projection versions only. Cursor stores algorithm ref, snapshot ref, and last issuance chronological key.

- [ ] **Step 4: Implement advisory/presentation surface**

Action hints expose only `open_source`, `reply`, or `open_actor` where applicable and include `execution_authority.implied_by_notification_read=false`. Renderers consume only the already-filtered surface object.

- [ ] **Step 5: Run GREEN and regression**

Run: `node --test test/notification-cursor.test.js test/notification-surface.test.js && npm test`
Expected: PASS and 0 regressions.

- [ ] **Step 6: Commit**

```bash
git add notification/snapshot.js notification/cursor.js notification/action-hints.js notification/render-json.js notification/render-html.js notification/read-service.js test/notification-cursor.test.js test/notification-surface.test.js
git commit -m "feat: add deterministic Notification inbox surfaces"
```

---

### Task 7: Foundation X1-X3 inheritance and cross-domain non-signals

**Files:**
- Modify: `foundation/cross-domain-contract.js`
- Modify: `docs/specs/2026-09-02-trellis-foundation-cross-domain-contract-v0.1.md`
- Create: `test/notification-cross-domain.test.js`

**Interfaces:**
- Produces machine-readable `INHERITORS.notification = ['X1','X2','X3']`.

- [ ] **Step 1: Write failing inheritance/non-signal tests**

```js
assert.deepEqual(INHERITORS.notification,['X1','X2','X3']);
```

Also prove Notification issue/ack changes do not alter Feed ordering/snapshot or Discovery candidate/snapshot when social source state is otherwise unchanged.

- [ ] **Step 2: Run RED**

Run: `node --test test/notification-cross-domain.test.js`
Expected: inheritance registry assertion FAIL while behavior vectors should already pass.

- [ ] **Step 3: Add inheritance declaration/document specialization**

Add Notification to the registry and cross-domain contract matrix. Document X1 singleton private audience, X2 read/receipt not mutation authority, X3 hidden/inactive source no current inbox signal.

- [ ] **Step 4: Run GREEN and regression**

Run: `node --test test/notification-cross-domain.test.js && npm test`
Expected: PASS and 0 regressions.

- [ ] **Step 5: Commit**

```bash
git add foundation/cross-domain-contract.js docs/specs/2026-09-02-trellis-foundation-cross-domain-contract-v0.1.md test/notification-cross-domain.test.js
git commit -m "test: bind Notification to Foundation cross-domain contract"
```

---

### Task 8: N1-N13 conformance and release seal

**Files:**
- Create: `test/notification-conformance.test.js`
- Create: `docs/NOTIFICATION_CONFORMANCE_v0.1.md`
- Modify: `package.json`

**Interfaces:**
- Final release gate for Notification v0.1.

- [ ] **Step 1: Write failing final conformance test**

Build the full spec vertical slice and assert N1-N13, including three separate N6 cases, N4 no-receipt-on-ineligible-source, explicit ack, Reaction changed/no-new-receipt, restore/new-receipt, destructive projection rebuild, Notification hash-chain integrity, and no hidden-source aggregate/snapshot/cursor signal.

Also assert no public Notification API shortcut for queue delivery, preference, seen/open/dwell telemetry, Feed ranking, Discovery affinity, source-domain mutation, or automatic backfill.

- [ ] **Step 2: Run RED**

Run: `node --test test/notification-conformance.test.js`
Expected: behavioral assertions should pass; release syntax gate must fail until `notification/*.js` is included.

- [ ] **Step 3: Add syntax gate and conformance mapping**

Update `npm run check` to include:

```text
notification/*.js
```

Write `docs/NOTIFICATION_CONFORMANCE_v0.1.md` mapping N1-N13 and X1-X3 to exact tests/modules.

- [ ] **Step 4: Run two complete pre-commit gates**

Run twice:

```bash
npm test
npm run check
git diff --check reaction/v0.1...HEAD
git diff --check
```

Expected each run: all tests PASS, syntax PASS, diff clean.

- [ ] **Step 5: Commit final seal**

```bash
git add package.json test/notification-conformance.test.js docs/NOTIFICATION_CONFORMANCE_v0.1.md
git commit -m "test: seal Trellis Notification v0.1 conformance gate"
```

- [ ] **Step 6: Fresh final-HEAD verification**

Run:

```bash
npm test
npm run check
git diff --check reaction/v0.1...HEAD
git status --short
```

Expected: zero failures, zero syntax errors, clean diff, clean working tree.
