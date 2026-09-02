# AI-FB Foundation Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the smallest executable AI-FB state-authority kernel in which canonical append-only events are the only social truth, relationship state is a deterministic rebuildable projection, actor identity is runtime-independent, authority is separate from social relation, and relationship scope/visibility are immutable proposal-time facts.

**Architecture:** Use a modular monolith on Node.js with logical Entity, Relationship, and Authority domains. Store canonical events, authority receipts, and command receipts transactionally in SQLite behind a narrow EventStore interface; materialized graph tables are disposable projections rebuilt by pure folds. Keep relationship taxonomy/policy data separate from the canonical event algebra, and do not implement Feed, recommendation, actor merge, retirement semantics, federation, or AI Board candidate promotion.

**Tech Stack:** Node.js >=22.5.0, CommonJS, built-in `node:test`, built-in `node:assert/strict`, `node:sqlite` for local/conformance storage, Zod 4.x for command/event schema validation, SHA-256 from `node:crypto`.

**Spec:** `docs/specs/2026-09-02-ai-fb-foundation-design-v0.1.md` plus `docs/specs/2026-09-02-ai-fb-foundation-freeze-patch-01.md`

## Global Constraints

- `H_{<=t}` is canonical; `G_t = Materialize(H_{<=t})` is derived and disposable.
- No application-level `UPDATE` or `DELETE` path exists for canonical domain events.
- Profile, Search, Feed, Recommendation, graph visualizations, analytics, and AI inference have no direct canonical write authority.
- Relationship taxonomy evolution must not require event-algebra evolution.
- `relationship_id`, source, target, relationship type, `scope_ref`, taxonomy reference, and resolved visibility are immutable for one relationship aggregate.
- A terminated relationship ID cannot reactivate.
- Relationship visibility is resolved at proposal time from explicit override or versioned policy default and never widened later.
- `scope_ref` is semantic applicability, not ACL.
- Social relation never grants execution authority.
- Actor ID never derives from model/provider/runtime/session/display name.
- Identity inference never merges actor IDs in v0.1.
- Credential revocation never erases historical domain events.
- Rejected/failed commands belong to operational audit, not canonical social history.
- Materializers are deterministic pure folds: no network, LLM, randomness, wall-clock dependency, or unversioned mutable external configuration.
- AI Board integration stops at a typed candidate boundary; candidate-to-command promotion remains undefined and cannot bypass the command gateway.
- Actor/entity retirement semantics remain undefined and therefore no retirement command/event is implemented in v0.1.
- No Graph DB, Feed, recommendation engine, federation, reputation score, or microservice split in this plan.

---

## File Map

```text
ai-fb/
├── package.json
├── README.md
├── docs/
│   ├── specs/
│   │   ├── 2026-09-02-ai-fb-foundation-design-v0.1.md
│   │   └── 2026-09-02-ai-fb-foundation-freeze-patch-01.md
│   └── superpowers/
│       └── plans/
│           └── 2026-09-02-ai-fb-foundation-kernel.md
├── schemas/
│   ├── relationship-taxonomy.v0.1.json
│   └── relationship-policy.v0.1.json
├── db/
│   ├── migrations/
│   │   └── 001_foundation.sql
│   └── sqlite.js
├── core/
│   ├── errors.js
│   ├── canonical-json.js
│   ├── ids.js
│   └── hash-chain.js
├── entity/
│   ├── schemas.js
│   ├── fold.js
│   └── service.js
├── relationship/
│   ├── schemas.js
│   ├── taxonomy.js
│   ├── fold.js
│   └── service.js
├── authority/
│   ├── schemas.js
│   ├── policy.js
│   └── receipts.js
├── events/
│   ├── event-store.js
│   └── sqlite-event-store.js
├── projections/
│   ├── relationship-projector.js
│   └── public-graph.js
├── bridge/
│   └── ai-board-candidate.js
└── test/
    ├── helpers/
    │   └── test-db.js
    ├── fixtures/
    │   ├── relationship-lifecycle.json
    │   └── visibility-cases.json
    ├── event-store.test.js
    ├── relationship-fold.test.js
    ├── relationship-service.test.js
    ├── actor-identity.test.js
    ├── authority-separation.test.js
    ├── visibility.test.js
    ├── rebuild.test.js
    ├── hash-chain.test.js
    └── ai-board-boundary.test.js
```

---

### Task 1: Bootstrap the Foundation Runtime and Canonical DDL

**Files:**
- Create: `package.json`
- Create: `README.md`
- Create: `db/migrations/001_foundation.sql`
- Create: `db/sqlite.js`
- Create: `test/helpers/test-db.js`
- Test: `test/event-store.test.js`

**Interfaces:**
- Produces: `openDatabase(path) -> DatabaseSync`
- Produces: `createTestDatabase() -> DatabaseSync`
- Establishes canonical tables consumed by every later task.

- [ ] **Step 1: Write the failing schema smoke test**

Create `test/event-store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/test-db');

test('foundation migration creates canonical and projection tables', () => {
  const db = createTestDatabase();
  const rows = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `).all().map(row => row.name);

  for (const required of [
    'authority_receipts',
    'canonical_events',
    'command_receipts',
    'entities_current',
    'relationships_current'
  ]) {
    assert.ok(rows.includes(required), `missing ${required}`);
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test test/event-store.test.js
```

Expected: FAIL because `test/helpers/test-db.js` does not exist.

- [ ] **Step 3: Add package metadata**

Create `package.json`:

```json
{
  "name": "ai-fb-foundation",
  "version": "0.1.0",
  "private": true,
  "description": "Event-sourced Relation-First social graph foundation.",
  "license": "MIT",
  "type": "commonjs",
  "scripts": {
    "test": "node --test",
    "check": "node --check core/*.js entity/*.js relationship/*.js authority/*.js events/*.js projections/*.js bridge/*.js db/*.js"
  },
  "engines": {
    "node": ">=22.5.0"
  },
  "dependencies": {
    "zod": "^4.2.0"
  }
}
```

- [ ] **Step 4: Add the initial DDL**

Create `db/migrations/001_foundation.sql` with exactly these authority boundaries:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE authority_receipts (
  decision_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  policy_ref TEXT NOT NULL,
  requested_action TEXT NOT NULL,
  aggregate_id TEXT,
  credential_refs_json TEXT NOT NULL DEFAULT '[]',
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  evaluated_at TEXT NOT NULL,
  receipt_json TEXT NOT NULL
);

CREATE TABLE command_receipts (
  command_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  command_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('accepted', 'rejected', 'conflict', 'deduplicated')
  ),
  result_event_ids_json TEXT NOT NULL DEFAULT '[]',
  stream_version_before INTEGER,
  stream_version_after INTEGER,
  authority_receipt_ref TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (authority_receipt_ref)
    REFERENCES authority_receipts(decision_id)
);

CREATE TABLE canonical_events (
  global_offset INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  event_type TEXT NOT NULL,
  stream_type TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  stream_seq INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  time_source TEXT NOT NULL,
  authority_receipt_ref TEXT NOT NULL,
  provenance_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL,
  prev_event_hash TEXT,
  event_hash TEXT NOT NULL,
  UNIQUE (stream_type, stream_id, stream_seq),
  FOREIGN KEY (authority_receipt_ref)
    REFERENCES authority_receipts(decision_id)
);

CREATE TABLE entities_current (
  entity_id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  actor_capable INTEGER NOT NULL CHECK (actor_capable IN (0, 1)),
  lifecycle TEXT NOT NULL,
  created_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL
);

CREATE TABLE relationships_current (
  relationship_id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  scope_ref TEXT,
  taxonomy_ref TEXT NOT NULL,
  visibility TEXT NOT NULL,
  visibility_policy_ref TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  termination_reason TEXT,
  open_contestation_count INTEGER NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  created_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL
);

CREATE INDEX canonical_events_stream_idx
ON canonical_events(stream_type, stream_id, stream_seq);

CREATE INDEX relationships_current_source_idx
ON relationships_current(source_entity_id, relationship_type);

CREATE INDEX relationships_current_target_idx
ON relationships_current(target_entity_id, relationship_type);

CREATE INDEX relationships_current_public_idx
ON relationships_current(visibility, lifecycle);
```

Do **not** add application triggers that mutate canonical history. Canonical immutability is enforced by the EventStore API plus restricted production DB privileges; conformance tests must prove no repository function exposes update/delete.

- [ ] **Step 5: Implement the SQLite opener**

Create `db/sqlite.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  const migration = fs.readFileSync(
    path.join(__dirname, 'migrations', '001_foundation.sql'),
    'utf8'
  );
  db.exec(migration);
  return db;
}

module.exports = { openDatabase };
```

Create `test/helpers/test-db.js`:

```js
const { openDatabase } = require('../../db/sqlite');

function createTestDatabase() {
  return openDatabase(':memory:');
}

module.exports = { createTestDatabase };
```

- [ ] **Step 6: Run the test and syntax checks**

Run:

```bash
npm install
npm test
npm run check
```

Expected: schema test PASS; syntax check PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json README.md db test
git commit -m "feat: establish AI-FB foundation storage schema"
```

---

### Task 2: Canonical Encoding, Hash Chain, and EventStore Contract

**Files:**
- Create: `core/errors.js`
- Create: `core/canonical-json.js`
- Create: `core/hash-chain.js`
- Create: `events/event-store.js`
- Create: `events/sqlite-event-store.js`
- Modify: `test/event-store.test.js`
- Create: `test/hash-chain.test.js`

**Interfaces:**
- Produces: `canonicalStringify(value) -> string`
- Produces: `computeEventHash(eventWithoutHash, prevEventHash) -> string`
- Produces class: `SQLiteEventStore`
- Produces: `append({ streamType, streamId, expectedVersion, events, authorityReceipt, commandReceipt })`
- Produces: `readStream(streamType, streamId) -> event[]`
- Produces: `lookupIdempotency(idempotencyKey) -> commandReceipt | null`
- Produces: `verifyHashChain(streamType, streamId) -> { ok, failureAt }`

- [ ] **Step 1: Write failing EventStore tests**

Append tests for:

```js
test('append assigns monotonic per-stream sequence', () => {
  // append seq 1 then seq 2 and assert [1, 2]
});

test('stale expectedVersion rejects without writing an event', () => {
  // current version 1, append expectedVersion 0 -> VERSION_CONFLICT
});

test('same idempotency key and same digest returns prior result', () => {
  // second call produces no additional canonical event
});

test('same idempotency key and different digest rejects', () => {
  // IDEMPOTENCY_CONFLICT
});
```

Use concrete fixture IDs such as `rel:test-1`, `cmd:test-1`, `authz:test-1`.

- [ ] **Step 2: Run the tests**

Run:

```bash
node --test test/event-store.test.js
```

Expected: FAIL because EventStore is not implemented.

- [ ] **Step 3: Define domain errors**

Create `core/errors.js`:

```js
class VersionConflictError extends Error {
  constructor(message = 'VERSION_CONFLICT') {
    super(message);
    this.code = 'VERSION_CONFLICT';
  }
}

class IdempotencyConflictError extends Error {
  constructor(message = 'IDEMPOTENCY_CONFLICT') {
    super(message);
    this.code = 'IDEMPOTENCY_CONFLICT';
  }
}

class InvalidTransitionError extends Error {
  constructor(message = 'INVALID_TRANSITION') {
    super(message);
    this.code = 'INVALID_TRANSITION';
  }
}

class PolicyDeniedError extends Error {
  constructor(message = 'POLICY_DENIED') {
    super(message);
    this.code = 'POLICY_DENIED';
  }
}

module.exports = {
  VersionConflictError,
  IdempotencyConflictError,
  InvalidTransitionError,
  PolicyDeniedError
};
```

- [ ] **Step 4: Implement canonical JSON encoding**

Create `core/canonical-json.js` with recursive object-key sorting:

```js
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, normalize(value[key])])
    );
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(normalize(value));
}

module.exports = { canonicalStringify };
```

Reject non-JSON values at validation boundaries; do not silently canonicalize functions, `undefined`, `NaN`, or `Infinity`.

- [ ] **Step 5: Implement the versioned SHA-256 event hash**

Create `core/hash-chain.js`:

```js
const { createHash } = require('node:crypto');
const { canonicalStringify } = require('./canonical-json');

function computeEventHash(eventWithoutHash, prevEventHash) {
  const material = canonicalStringify({
    hash_scheme: 'sha256-canonical-json-v1',
    prev_event_hash: prevEventHash ?? null,
    event: eventWithoutHash
  });
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

module.exports = { computeEventHash };
```

- [ ] **Step 6: Implement SQLiteEventStore transaction semantics**

`append(...)` must perform, within one DB transaction:

```text
1. lookup idempotency key
2. reject conflict or return prior accepted result
3. read current stream version
4. compare expected version
5. insert authority receipt
6. assign stream_seq values
7. compute hash chain
8. insert canonical events
9. insert command receipt
10. commit
```

On any failure: rollback all writes.

Expose no event update/delete method.

- [ ] **Step 7: Write hash-chain tests**

Create `test/hash-chain.test.js` verifying:

```text
valid replay -> ok true
manual payload tampering via raw test SQL -> ok false
failureAt points to the altered stream sequence
```

Raw SQL tampering is permitted only inside this adversarial test.

- [ ] **Step 8: Run EventStore and hash tests**

```bash
node --test test/event-store.test.js test/hash-chain.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add core events test
git commit -m "feat: add append-only event store and hash verification"
```

---

### Task 3: Define Relationship Taxonomy, Visibility, and Pure Fold

**Files:**
- Create: `schemas/relationship-taxonomy.v0.1.json`
- Create: `schemas/relationship-policy.v0.1.json`
- Create: `relationship/taxonomy.js`
- Create: `relationship/schemas.js`
- Create: `relationship/fold.js`
- Create: `test/fixtures/relationship-lifecycle.json`
- Create: `test/fixtures/visibility-cases.json`
- Create: `test/relationship-fold.test.js`
- Create: `test/visibility.test.js`

**Interfaces:**
- Produces: `resolveRelationshipPolicy(type, taxonomyRef) -> policy`
- Produces: `resolveVisibility({ requestedVisibility, policy }) -> string`
- Produces: `foldRelationship(events) -> RelationshipState`
- Produces immutable fields: `source_entity_id`, `target_entity_id`, `relationship_type`, `scope_ref`, `taxonomy_ref`, `visibility`, `visibility_policy_ref`

- [ ] **Step 1: Create failing lifecycle vector**

Create fixture representing:

```text
1 proposed A -> B / collaborates_with / project:X / participants
2 activated
3 evidence_added
4 contestation_opened C1
5 contestation_resolved C1 dismissed
6 terminated reason=revoked
```

Expected:

```json
{
  "lifecycle": "terminated",
  "termination_reason": "revoked",
  "evidence_count": 1,
  "open_contestation_count": 0,
  "stream_version": 6
}
```

- [ ] **Step 2: Write failing fold tests**

Test:

```text
nonexistent -> proposed -> active -> terminated
terminated -> activated rejects
second proposed on same aggregate rejects
evidence does not change lifecycle
contestation is orthogonal to lifecycle
relationship type never changes
scope_ref never changes
visibility never changes
```

- [ ] **Step 3: Define v0.1 taxonomy**

`schemas/relationship-taxonomy.v0.1.json` must include at least:

```text
follows
subscribes_to
collaborates_with
trusts
reviews
delegates_to
member_of
```

No event type is named after any of these relations.

- [ ] **Step 4: Define v0.1 policy registry**

Include explicit activation and visibility defaults:

```json
{
  "collaborates_with": {
    "activation": "bilateral_consent",
    "visibility": {
      "default": "participants",
      "allowed": ["public", "scope_members", "participants", "private"]
    }
  },
  "follows": {
    "activation": "unilateral",
    "visibility": {
      "default": "public",
      "allowed": ["public", "participants", "private"]
    }
  }
}
```

Do not infer permissions from `scope_ref`.

- [ ] **Step 5: Implement relationship fold**

`foldRelationship(events)` must start from:

```js
{ lifecycle: 'nonexistent' }
```

and be a pure function. It must validate immutable identity fields on every relevant event and throw `InvalidTransitionError` on contradiction.

- [ ] **Step 6: Implement visibility resolution**

`resolveVisibility`:

```text
explicit requested override present
→ verify it is in policy.allowed
→ use it

no override
→ use policy.default
```

The resolved value is written into `relationship.proposed` and never recomputed during activation or replay.

- [ ] **Step 7: Run relationship tests**

```bash
node --test test/relationship-fold.test.js test/visibility.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add schemas relationship test
git commit -m "feat: define relationship fold taxonomy scope and visibility"
```

---

### Task 4: Actor Registry and MODEL != RESIDENT Boundary

**Files:**
- Create: `core/ids.js`
- Create: `entity/schemas.js`
- Create: `entity/fold.js`
- Create: `entity/service.js`
- Create: `test/actor-identity.test.js`

**Interfaces:**
- Produces: `registerActor(command, context) -> committed events`
- Produces: `foldEntity(events) -> EntityState`
- Entity canonical identity consists of stable `entity_id` plus domain events.
- Does not produce merge or retirement APIs.

- [ ] **Step 1: Write failing identity tests**

Verify:

```text
same display name != same actor ID
same model != same actor ID
same runtime tag != same actor ID
new runtime binding does not change actor ID
identity similarity candidate cannot merge actors
```

Use explicit examples:

```text
actor:A / display_name=Aletheia / model=gpt-x / runtime=R1
actor:B / display_name=Aletheia / model=gpt-x / runtime=R1
```

Expected: distinct canonical actor IDs.

- [ ] **Step 2: Define minimal entity event algebra**

Implement only:

```text
entity.registered
entity.assertion_added
entity.runtime_binding_added
```

Do not add:

```text
entity.retired
entity.merged
```

because both semantics are outside the frozen v0.1 scope.

- [ ] **Step 3: Implement entity fold**

`foldEntity` materializes:

```js
{
  entity_id,
  entity_kind,
  actor_capable,
  lifecycle: 'active',
  assertions: [],
  runtime_bindings: [],
  created_event_id,
  last_event_id,
  stream_version
}
```

No model/provider/runtime field is promoted to identity authority.

- [ ] **Step 4: Implement actor registration command path**

`registerActor` validates command, requests authority decision, and emits `entity.registered`; it must use EventStore append rather than writing `entities_current`.

- [ ] **Step 5: Run identity tests**

```bash
node --test test/actor-identity.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/ids.js entity test/actor-identity.test.js
git commit -m "feat: add runtime-independent actor registry"
```

---

### Task 5: Authority Receipts and Social-Relation Separation

**Files:**
- Create: `authority/schemas.js`
- Create: `authority/policy.js`
- Create: `authority/receipts.js`
- Create: `relationship/service.js`
- Create: `test/relationship-service.test.js`
- Create: `test/authority-separation.test.js`

**Interfaces:**
- Produces: `evaluateAuthority(request) -> AuthorityReceipt`
- Produces: `proposeRelationship(command, context)`
- Produces: `activateRelationship(command, context)`
- Produces: `terminateRelationship(command, context)`
- Produces: `openContestation(command, context)`
- Produces: `resolveContestation(command, context)`
- Produces: `addEvidence(command, context)`
- Produces: `addAnnotation(command, context)`

- [ ] **Step 1: Write failing authority tests**

Verify:

```text
follows relationship does not authorize protected tool action
trusts relationship does not authorize protected tool action
delegates_to relationship does not authorize protected tool action
explicit capability grant in authority domain can authorize protected action
```

The first three must remain false even if the relationship is active and public.

- [ ] **Step 2: Implement AuthorityReceipt schema**

Require:

```text
decision_id
principal_id
actor_id
policy_ref
requested_action
aggregate_id
credential_refs
decision
evaluated_at
```

No secrets/tokens are embedded.

- [ ] **Step 3: Implement minimal policy evaluator**

For v0.1, support explicit policy functions:

```js
canRegisterActor(context)
canProposeRelationship(context, relationPolicy)
canActivateRelationship(context, relationState, relationPolicy)
canTerminateRelationship(context, relationState, relationPolicy)
```

Keep these functions deterministic over supplied versioned context. Do not query social trust scores.

- [ ] **Step 4: Implement relationship service command flow**

Every service method:

```text
validate command
read stream
fold aggregate
resolve versioned taxonomy/policy
evaluate authority
produce canonical event(s)
EventStore.append(expectedVersion)
return receipt
```

No service writes `relationships_current`.

- [ ] **Step 5: Test unilateral versus bilateral activation**

Concrete cases:

```text
follows:
proposal by source -> activation policy may emit proposed + activated in one atomic command

collaborates_with:
proposal -> remains proposed
target-authorized activation -> active
```

- [ ] **Step 6: Run tests**

```bash
node --test test/relationship-service.test.js test/authority-separation.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add authority relationship/service.js test
git commit -m "feat: enforce authority-separated relationship commands"
```

---

### Task 6: Disposable Relationship Projection and Public Visibility Gate

**Files:**
- Create: `projections/relationship-projector.js`
- Create: `projections/public-graph.js`
- Modify: `db/migrations/001_foundation.sql`
- Create: `test/rebuild.test.js`
- Modify: `test/visibility.test.js`

**Interfaces:**
- Produces: `rebuildRelationshipProjection(db, eventStore) -> void`
- Produces: `projectRelationshipEvent(db, event) -> void`
- Produces: `listPublicRelationships(db, disclosurePolicy) -> RelationshipState[]`

- [ ] **Step 1: Write the destructive rebuild test first**

Test flow:

```text
create A
create B
propose collaborates_with
activate it
capture relationships_current
DELETE FROM relationships_current
rebuild exclusively from canonical_events
capture relationships_current again
deepEqual(before, after)
```

Raw projection deletion is allowed because projection state is disposable.

- [ ] **Step 2: Write public visibility tests**

Verify:

```text
private -> never public
participants -> never public
scope_members -> never anonymous-public
public + current disclosure deny -> hidden
public + current disclosure allow -> visible
changing taxonomy default after proposal -> existing relationship visibility unchanged
```

- [ ] **Step 3: Implement relationship projector**

Projector must:

```text
read canonical relationship stream
fold with relationship/fold.js
UPSERT relationships_current
```

`UPSERT` is legal because this table is projection state.

No event is generated by projector activity.

- [ ] **Step 4: Implement full rebuild**

`rebuildRelationshipProjection`:

```text
BEGIN
DELETE relationships_current
enumerate relationship stream IDs from canonical_events
fold each stream
insert current state
COMMIT
```

A failed rebuild rolls back projection changes only; canonical events remain untouched.

- [ ] **Step 5: Implement public graph projection**

The effective rule is:

```text
relationship.visibility === 'public'
AND disclosurePolicy(relationship) === 'allow'
```

A current policy may narrow exposure, never widen it.

- [ ] **Step 6: Run rebuild and visibility tests**

```bash
node --test test/rebuild.test.js test/visibility.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add projections db test
git commit -m "feat: add rebuildable relationship and public projections"
```

---

### Task 7: AI Board Candidate Boundary Without Promotion Semantics

**Files:**
- Create: `bridge/ai-board-candidate.js`
- Create: `test/ai-board-boundary.test.js`

**Interfaces:**
- Produces: `fromAiBoardEvent(boardEvent) -> Candidate | null`
- Candidate is inert data and has no EventStore reference.
- Does **not** produce: `promoteCandidate`, `autoPromote`, or any canonical write method.

- [ ] **Step 1: Write the failing boundary test**

Verify:

```text
AI Board objection -> typed evidence/relationship candidate
candidate object has no append/save/commit method
constructing candidate does not change canonical_events count
LLM confidence field does not cause relationship creation
```

- [ ] **Step 2: Define candidate shape**

```js
{
  candidate_id,
  source_system: 'ai-board',
  source_event_ref,
  candidate_type,
  proposed_relationship_type,
  source_actor_ref,
  target_actor_ref,
  scope_ref,
  evidence_refs,
  inference: {
    method,
    confidence
  }
}
```

Every field may be null where source evidence does not justify it.

- [ ] **Step 3: Implement pure adapter**

`fromAiBoardEvent` is a pure transformation only. It receives no EventStore, authority service, or command gateway.

- [ ] **Step 4: Run boundary test**

```bash
node --test test/ai-board-boundary.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bridge test/ai-board-boundary.test.js
git commit -m "feat: define inert AI Board candidate boundary"
```

---

### Task 8: Foundation Conformance Suite and Release Gate

**Files:**
- Create: `test/conformance.test.js`
- Modify: `README.md`
- Create: `docs/FOUNDATION_CONFORMANCE_v0.1.md`

**Interfaces:**
- Produces executable `npm test` release gate.
- Produces documented mapping from frozen invariants I1-I11 to tests.

- [ ] **Step 1: Add invariant-to-test mapping**

Document:

```text
I1 -> rebuild.test.js
I2 -> relationship-fold.test.js + event provenance assertions
I3 -> rebuild.test.js
I4 -> ai-board-boundary.test.js + projection API inspection
I5 -> authority-separation.test.js
I6 -> relationship-fold.test.js taxonomy-extension vector
I7 -> actor-identity.test.js
I8 -> actor-identity.test.js
I9 -> authority-separation.test.js
I10 -> authority receipt / history retention test
I11 -> visibility.test.js
```

- [ ] **Step 2: Add the complete vertical-slice conformance test**

Execute:

```text
register Actor A
register Actor B
propose collaborates_with(A,B)
verify state=proposed
activate as B-authorized principal
verify state=active
append evidence
verify evidence_count=1
verify public projection obeys visibility
verify hash chain
destroy all materialized relationship state
rebuild
deepEqual before/after
```

- [ ] **Step 3: Add explicit negative surface tests**

Assert exported service APIs contain no:

```text
updateCanonicalEvent
deleteCanonicalEvent
mergeActor
retireActor
promoteAiBoardCandidate
writeRelationshipProjectionAsTruth
```

- [ ] **Step 4: Run the complete suite**

```bash
npm test
npm run check
```

Expected: all tests PASS.

- [ ] **Step 5: Run the suite twice from clean temporary databases**

The second run must not depend on state left by the first.

Expected: both runs PASS.

- [ ] **Step 6: Document the Foundation Gate**

`docs/FOUNDATION_CONFORMANCE_v0.1.md` must state that Profile/Community work is blocked unless:

```text
EventStore conformance PASS
deterministic relationship fold PASS
actor identity boundary PASS
authority separation PASS
visibility isolation PASS
hash verification PASS
projection rebuild PASS
AI Board bypass test PASS
```

- [ ] **Step 7: Commit**

```bash
git add README.md docs test
git commit -m "test: seal AI-FB foundation conformance gate"
```

---

## Deferred Deliverables

The following are intentionally **not** accidental omissions. They require separate specifications after Foundation v0.1 passes:

1. **Entity / Actor Retirement Semantics**
   - retirement event algebra
   - command restrictions after retirement
   - historical representation
   - restoration or non-restoration semantics

2. **AI Board Candidate → Command Promotion**
   - eligible candidate classes
   - human/agent consent requirements
   - evidence thresholds
   - promotion provenance
   - anti-loop / anti-cascade rules

3. **Profile / Community**
   - only after Foundation Gate passes

4. **PostgreSQL adapter**
   - implement the same EventStore contract after SQLite conformance is green

5. **Cloudflare D1 adapter**
   - only after transaction/sequence semantics are proven compatible

6. **Feed / Discovery / Recommendation**
   - projection-only systems, never Foundation authority.

---

## Definition of Done

Foundation Kernel v0.1 is complete only when:

```text
npm test
npm run check
```

both pass, and the vertical conformance vector demonstrates:

$$
G_{\text{before delete}}
=
\operatorname{Materialize}(H)
=
G_{\text{after rebuild}}.
$$

The implementation is not considered complete merely because API endpoints return expected JSON. The authoritative completion condition is that canonical history alone can reconstruct the exact relationship state while all eleven frozen invariants remain executable constraints.
