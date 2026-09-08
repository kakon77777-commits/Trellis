# Trellis Storage Runtime v1 — Async SQL + Cloudflare D1 Design

**Date:** 2026-09-07
**Status:** ARCHITECTURE FREEZE CANDIDATE
**Production target:** `trellis.evemisslab.com` on Cloudflare Workers + D1
**Canonical engineering base:** `kakon77777-commits/Trellis` `origin/main @ 9520076`
**Local spec worktree note:** restored from the independently verified Web v0.1 delivery whose content matches that canonical base; local Git ancestry/hash is not the remote integration identity.
**Scope:** storage-port migration, full async propagation, D1 production adapter, SQLite async dev/test adapter, EventStore concurrency protocol, projection materialization, migrations, Worker composition root, dual-backend conformance.

---

## 0. Decision

Trellis will not deploy production state to container-local SQLite.

The production persistence contract is:

```text
Cloudflare Worker
        ↓
Async Trellis runtime
        ↓
AsyncSqlPort
        ↓
Cloudflare D1
```

Local development and the fast unit/conformance suite retain SQLite only behind the same asynchronous storage interface:

```text
Async Trellis runtime
        ↓
AsyncSqlPort
        ↓
SQLiteAsyncAdapter
        ↓
node:sqlite DatabaseSync
```

The important distinction is:

```text
SQLite backend stays for local/test.
Synchronous Trellis persistence APIs do not.
```

No domain service may return a value-or-Promise union. Persistence-facing Trellis code is asynchronous after this migration.

---

# 1. Why this is an architecture migration

Current Trellis uses `node:sqlite` `DatabaseSync` directly throughout EventStore, projectors, services, read services, public derived surfaces, and tests. The existing EventStore also depends on an interactive transaction:

```text
BEGIN IMMEDIATE
→ idempotency lookup
→ stream version read
→ authority receipt write
→ canonical event writes
→ command receipt write
→ COMMIT
```

Cloudflare D1's Worker binding is asynchronous. D1's `batch()` supplies atomic transactional execution for a known list of prepared statements, but it is not an interactive transaction callback in which Trellis can perform arbitrary application reads between writes.

Therefore this migration is not:

```text
.get() → .first()
.run() → await .run()
```

alone.

It requires two separate changes:

1. **execution-model migration** — synchronous persistence call chains become `async`/`await` end to end;
2. **concurrency-protocol migration** — EventStore append and projector transaction boundaries are redesigned around D1-compatible atomic batches.

Neither change may alter Trellis's canonical social semantics.

---

# 2. Non-goals

Storage Runtime v1 does **not** introduce:

- login/session identity;
- Web write routes;
- a new social domain;
- ORM adoption;
- TypeScript rewrite;
- ESM rewrite of all domain modules;
- read replication as a performance feature;
- cross-region caching;
- queues/outbox delivery;
- automatic semantic retry after optimistic-concurrency conflict;
- changed event hashes or event payload schema;
- changed Preference/Consumption/Feed semantics;
- direct D1 access from `http/routes`, `http/view-models`, or `web/`.

The migration exists so the already-designed Trellis system can persist safely on D1.

---

# 3. Async SQL Port

A backend-neutral asynchronous storage port becomes the only SQL API visible to persistence-facing Trellis modules.

Suggested boundary:

```text
storage/
├─ port.js
├─ sqlite-adapter.js
├─ d1-adapter.js
├─ results.js
└─ migration-loader.js
```

The v1 interface is conceptually:

```js
await sql.first(statement, params)
await sql.all(statement, params)
await sql.run(statement, params)
await sql.batch([
  { sql: statementA, params: [...] },
  { sql: statementB, params: [...] }
])

const session = sql.session({ consistency: 'primary' })
await session.first(...)
await session.batch(...)
```

`first()` returns a row or `null`.

`all()` returns an array of rows.

`run()` and `batch()` return Trellis-normalized metadata, not backend-specific result objects.

Example normalized run result:

```js
{
  changes: 1,
  last_row_id: 42,
  rows_read: 0,
  rows_written: 1
}
```

Unavailable metrics may be `null`; domain code must not depend on Cloudflare-only metadata.

### Storage boundary

```text
D1Result          ✗ domain API
DatabaseSync row  ✗ domain API
Normalized row    ✓ domain API
Normalized result ✓ domain API
```

The port may expose a maintenance-only migration execution primitive, but normal domain runtime code must use prepared/bound statements.

---

# 3.1 D1 platform limits are part of implementation planning

Storage Runtime v1 must treat current D1 limits as explicit engineering constraints rather than assuming local SQLite scale characteristics. In particular, the implementation and tests must account for per-query bound-parameter limits, SQL statement-size limits, Worker invocation query/subrequest limits, and total batch/query duration limits.

Therefore:

```text
projector rebuild batch size = bounded
event append batch size = bounded by command/event schema
large IN (...) lists = chunked or redesigned
no unbounded statement fan-out in one Worker request
```

The exact numeric platform limits are deployment configuration facts and must be checked against current Cloudflare documentation during implementation/release verification rather than hard-coded into domain ontology.

---

# 4. Two adapters, one semantic contract

## 4.1 SQLiteAsyncAdapter

`SQLiteAsyncAdapter` may use `DatabaseSync` internally because it is a local implementation detail.

Every public adapter method still returns a Promise.

It is used for:

- fast unit tests;
- fast domain conformance tests;
- local deterministic debugging;
- optional Node-local development.

It is **not** the production persistence backend.

## 4.2 D1Adapter

`D1Adapter` wraps a Cloudflare D1 binding or D1 Session.

Mappings:

```text
first(sql, params)
→ binding.prepare(sql).bind(...params).first()

all(sql, params)
→ binding.prepare(sql).bind(...params).all()

run(sql, params)
→ binding.prepare(sql).bind(...params).run()

batch(statements)
→ binding.batch(statements.map(prepare+bind))
```

All D1-specific response structures are normalized inside the adapter.

## 4.3 No hand-written D1 fake

The fast suite uses the real SQLite engine through the async port.

A separate backend-contract suite must also run against a local Cloudflare D1 binding through the Worker test runtime / Wrangler local D1.

```text
Fast test ≠ fake database.
```

---

# 5. Full async propagation

Every persistence-dependent call chain becomes asynchronous.

```text
AsyncSqlPort
    ↓ await
AsyncSqlEventStore
    ↓ await
Projectors
    ↓ await
Domain services
    ↓ await
Read services
    ↓ await
Derived surfaces
    ↓ await
HTTP view-model adapter
    ↓ await
HTTP routes / Worker fetch
```

Pure folds, policy calculations over already-loaded state, canonical hashing, IDs, and HTML rendering remain synchronous pure functions where possible.

The Web boundary remains:

```text
async data acquisition
→ complete viewer-safe view model
→ pure synchronous renderer
```

This preserves Web W1–W12 rather than moving D1 concerns into rendering.

---

# 6. EventStore v1

The current storage-specific name `SQLiteEventStore` is replaced in production/domain composition by one algorithmic EventStore implementation over `AsyncSqlPort`:

```text
AsyncSqlEventStore
```

Both SQLite and D1 use that same EventStore logic.

Required async methods include at minimum:

```js
await lookupIdempotency(idempotencyKey)
await readStream(streamType, streamId)
await readEvent(eventId)
await verifyHashChain(streamType, streamId)
await append(input)
```

Event object shapes, hash computation, authority receipt semantics, command receipt semantics, and domain-visible errors remain unchanged unless this spec explicitly states otherwise.

---

# 7. Canonical stream heads

D1-compatible optimistic concurrency requires an explicit canonical-stream head row.

Add a migration after the existing schema:

```sql
CREATE TABLE stream_heads (
  stream_type TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  event_hash TEXT,
  last_event_id TEXT,
  append_token TEXT,
  PRIMARY KEY (stream_type, stream_id)
);

CREATE TABLE append_batch_guards (
  append_token TEXT PRIMARY KEY,
  acquired INTEGER NOT NULL CHECK (acquired = 1)
);
```

`append_batch_guards` is an operational transaction-assertion table. A successful append deletes its guard row before commit; a failed append rolls it back. It never enters canonical history or projections.

Existing canonical streams are backfilled from the latest `canonical_events.stream_seq` / `event_hash` / `event_id` per `(stream_type, stream_id)`.

`append_token` is an operational CAS ownership marker. It is not a social fact and does not enter event hashing.

After migration:

```text
Head(stream)
=
(version, event_hash, last_event_id)
```

`canonical_events` remains canonical history. `stream_heads` is the concurrency/index structure that controls append eligibility.

Deleting and correctly rebuilding `stream_heads` from canonical history must be possible as an administrative repair operation, though it is not a normal request path.

---

# 8. CAS-guarded atomic append batch

D1 `batch()` is the append transaction primitive.

A command append uses one primary-consistent session and follows this protocol.

## 8.1 Preflight

Using a primary-consistent SQL session:

```text
1. lookup idempotency receipt
2. read current stream_head
3. compare expected version/head
4. compute event drafts and hashes in memory
5. generate a unique append_token for this append attempt
```

Preflight is advisory. Correctness does not rely on nobody changing state after it.

## 8.2 Atomic CAS batch

The first statement is a compare-and-swap upsert on `stream_heads`.

Conceptual SQLite/D1-compatible SQL:

```sql
INSERT INTO stream_heads (
  stream_type, stream_id, version, event_hash, last_event_id, append_token
)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(stream_type, stream_id) DO UPDATE SET
  version = excluded.version,
  event_hash = excluded.event_hash,
  last_event_id = excluded.last_event_id,
  append_token = excluded.append_token
WHERE stream_heads.version = ?;
```

For a new stream, expected version is zero and insertion succeeds only if the stream head does not already exist.

For an existing stream, the update changes exactly one row only when the stored version matches `expectedVersion`.

## 8.3 CAS assertion must fail the transaction

A CAS no-op must not merely return `changes = 0` and let the rest of the batch continue conditionally.

The next batch statement converts ownership of the expected `append_token` into a database-enforced assertion:

```sql
INSERT INTO append_batch_guards (append_token, acquired)
VALUES (
  ?,
  CASE WHEN EXISTS (
    SELECT 1 FROM stream_heads
    WHERE stream_type = ?
      AND stream_id = ?
      AND append_token = ?
  ) THEN 1 ELSE 0 END
);
```

`append_batch_guards.acquired` has `CHECK (acquired = 1)`.

Therefore:

```text
CAS acquired
→ acquired = 1
→ guard statement succeeds
→ remaining writes may proceed

CAS missed
→ acquired = 0
→ CHECK constraint fails
→ D1 batch rolls back the entire transaction
```

After the guard statement succeeds, the batch writes in order:

```text
authority receipt
canonical event(s)
command receipt
delete append_batch_guard row
```

Because all statements are inside one D1 batch transaction, no competing append may interleave between the successful CAS and these writes.

If any later statement fails — including event uniqueness, authority receipt uniqueness, command receipt uniqueness, or another database constraint — D1 rolls back the entire sequence including the stream-head CAS.

This is deliberately stronger than relying on every later application INSERT to remember its own `WHERE append_token = ?` predicate.

Required outcome:

```text
append success
→ head + authority + all events + command receipt commit together

append failure / CAS loss
→ none of them commit
```

`append_batch_guards` must be empty after every successful append and after every rolled-back append.

## 8.4 Post-failure classification

A failed batch does not expose raw guard/CHECK errors as Trellis concurrency semantics.

EventStore catches the storage error, then re-reads the command receipt and current stream head on the primary-consistent session:

```text
receipt exists + same digest
→ deduplicated success

receipt exists + different digest
→ IdempotencyConflict

no receipt + head no longer equals expected
→ VersionConflict

none of the above
→ StorageInvariantError / normalized infrastructure failure
```

The CAS guard is the mechanism; the domain-visible error remains backend-neutral.

---

# 9. Idempotency race classification

Before append, a prior receipt is checked.

```text
same idempotency key + same digest
→ deduplicated success

same idempotency key + different digest
→ IdempotencyConflict
```

A concurrent duplicate may race after preflight.

If the atomic batch fails on the command-receipt uniqueness constraint, or the CAS loses, EventStore re-reads the idempotency receipt on the primary-consistent session before classifying the result.

```text
receipt now exists + same digest
→ deduplicated success

receipt now exists + different digest
→ IdempotencyConflict

no receipt + stream head moved
→ VersionConflict
```

SQLite and D1 must expose exactly the same domain-visible classifications.

---

# 10. VersionConflict is not an infrastructure retry

A stream version conflict is a semantic precondition failure, not a network retry condition.

The EventStore must never silently rebase an existing event draft onto a newer stream head.

```text
expected head = N
actual head   = N+1

EventStore
→ VersionConflict
```

Forbidden:

```text
EventStore
→ reread N+1
→ replace expectedVersion
→ append old drafts automatically
```

Why: the original event drafts may have been produced from semantic state and Authority assumptions that are no longer true.

Examples include:

- relationship activation after concurrent termination;
- publication revision after withdrawal;
- reaction restore after target state changes;
- preference restore after target eligibility changes;
- notification acknowledgment after current-inbox eligibility changes.

---

# 11. Semantic retry responsibility

If a domain ever chooses to retry after `VersionConflict`, retry means:

```text
re-read canonical aggregate
→ re-fold state
→ re-run semantic preflight
→ re-run current policy / Authority
→ regenerate event drafts
→ attempt append against newly observed version
```

Therefore:

```text
Retry(Command)
≠
Retry(AppendDrafts)
```

## v1 default

```text
automatic semantic retry count = 0
```

Interactive callers receive the conflict.

## Existing idempotency-digest compatibility

Current Trellis command digests hash the full command object; commands that carry `expected_version` therefore include it in their digest.

Storage Runtime v1 does **not** silently redesign this ontology.

Consequently, v1 does not retry a VersionConflict under the same idempotency key with a changed expected version.

If a future domain explicitly opts into semantic retries before command-intent hashing is redesigned, each re-evaluated attempt must use a new `command_id` / `idempotency_key` and carry explicit provenance such as:

```text
retry_of_command_id
intent_ref
```

A future command-intent abstraction may change that rule only through its own formal design.

---

# 12. Infrastructure retries are separate

Transient infrastructure problems are not VersionConflict.

Examples:

- transient D1 unavailability;
- network interruption;
- response lost after a successful committed batch.

Infrastructure retry policy may use idempotency receipts to recover safely.

It must never reinterpret a semantic VersionConflict as a transient failure.

```text
TransientInfrastructureRetry
≠
SemanticConflictRetry
```

---

# 13. Projector migration

Several current projectors use interactive `BEGIN IMMEDIATE` transactions for rebuilds or per-stream rewrites.

D1 v1 projectors use a different pattern.

## 13.1 Per-stream projection

```text
await canonical stream read
→ pure fold in memory
→ construct all projection mutation statements
→ await one atomic batch
```

A projector may not perform asynchronous application logic between mutation statements inside a supposed transaction.

## 13.2 Full rebuild

A rebuild is:

```text
read required canonical stream IDs
→ read/fold canonical streams asynchronously
→ construct replacement state
→ write in bounded atomic batches
```

For small v1 datasets a projection's clear-and-repopulate may be one batch if it remains under D1 limits.

For larger datasets, rebuild must use deterministic bounded chunks plus an explicit rebuild-generation strategy before being treated as production-safe. Storage Runtime v1 does not silently claim that arbitrarily large multi-batch rebuilds are globally atomic.

This distinction must be documented per projector.

## 13.3 Incremental projection remains normal request path

Canonical command success should project the changed aggregate using the async projector path.

The canonical EventStore remains authoritative if projection update later fails; projection recovery is rebuildable from canonical history, consistent with existing Trellis invariants.

---

# 14. Read services and derived surfaces

Every direct SQL read becomes an awaited AsyncSqlPort call.

This includes, among others:

- Entity/Actor/Profile reads;
- Relationship Surface;
- Community Graph;
- Discovery;
- Publication;
- Feed v1/v2;
- Reaction;
- Notification;
- Personal Preference;
- Consumption State;
- Public Feed/Public Directory;
- HTTP view-model composition.

No domain gains new visibility or Authority rules because of the async migration.

`await` is an execution detail, not a social semantic signal.

---

# 15. Consumption remains operational

Consumption State remains the existing retention-bounded operational table.

Moving to D1 does not convert it into canonical history.

```text
consumption_state
→ D1 operational table
→ TTL/purge semantics unchanged
```

There is still no `H_consumption` canonical event stream.

---

# 16. D1 Sessions and consistency

Command-side preflight and post-conflict classification use a D1 session created with primary-first consistency:

```text
DB.withSession("first-primary")
```

The SQL port exposes this as a backend-neutral primary session.

The SQLite adapter returns an equivalent local session facade over the same database.

Storage Runtime v1 does not enable read replicas as a product optimization. If read replication is enabled later, request/session bookmark propagation must receive its own consistency tests.

Correctness is prioritized over read-latency optimization in v1.

---

# 17. Migrations

The existing `db/migrations/*.sql` files remain the single schema source used by both local SQLite and D1.

Production migration executor:

```text
wrangler d1 migrations apply <database>
```

Wrangler configuration points its D1 binding to:

```text
migrations_dir = "db/migrations"
```

Wrangler/D1 maintains applied migration history in `d1_migrations` (or an explicitly configured equivalent).

## 17.1 Production startup does not migrate

Forbidden:

```text
Worker fetch / cold start
→ exec migration SQL
```

The Worker assumes the target schema version has already been deployed.

## 17.2 Local SQLite tests

The local adapter/test harness loads the same ordered SQL files into the local SQLite database.

```text
MigrationSource(SQLite)
=
MigrationSource(D1)
```

## 17.3 D1 compatibility review

Every existing migration must be exercised against local D1 during this migration. Any D1-incompatible pragma or SQL construct must be handled through an explicit portable migration design, not silently skipped only in production.

---

# 18. Cloudflare production composition root

Add a Cloudflare-specific composition root, for example:

```text
cloudflare/
└─ worker.mjs
```

Conceptual flow:

```js
export default {
  async fetch(request, env) {
    const sql = createD1Adapter(env.DB);
    const eventStore = new AsyncSqlEventStore(sql);
    const response = await dispatchRequest(request, buildDependencies({ sql, eventStore }));
    return toWorkerResponse(response);
  }
};
```

`env.DB` must not be passed directly into domain read services or HTTP routes.

The only permitted path is:

```text
Cloudflare binding
→ D1Adapter
→ AsyncSqlPort
→ Trellis runtime
```

---

# 19. Node local composition root

`http/server.js` remains useful for local/dev compatibility but becomes asynchronous-storage composition:

```text
Node HTTP server
→ SQLiteAsyncAdapter
→ AsyncSqlEventStore
→ same HTTP app/routes
```

Production deployment no longer depends on a writable local SQLite path.

---

# 20. Web boundary remains unchanged

Web v0.1 W5 is strengthened, not weakened.

Forbidden:

```text
web/* → D1
http/routes/* → env.DB
http/view-models/* → D1 binding
```

The Cloudflare composition root may know about `env.DB`.

Presentation code may not.

```text
Web
→ HTTP adapter
→ viewer-safe domain service
→ AsyncSqlPort
→ D1
```

---

# 21. Worker compatibility

The production Worker must be tested in the Cloudflare Workers runtime with the project's declared compatibility date / Node compatibility settings.

Storage Runtime v1 does not require rewriting every CommonJS domain module merely to adopt D1. If Worker bundling requires interop wrappers, those belong at the composition/build boundary.

No runtime compatibility assumption is accepted solely because Node-local tests pass.

---

# 22. Testing strategy

The migration has three mandatory test layers.

## Layer A — Full async SQLite suite

All existing tests are migrated to `async`/`await` and run against `SQLiteAsyncAdapter`.

Goal:

```text
all pre-migration Trellis invariants remain green
```

This remains the fast everyday suite.

## Layer B — Dual-backend Storage Contract Suite

The same contract vectors run against:

```text
SQLiteAsyncAdapter
D1Adapter(local Cloudflare D1)
```

Mandatory vectors include:

- `first/all/run/batch` normalization;
- null/missing-row semantics;
- transaction rollback on failed batch statement;
- stream-head CAS win/loss;
- two different commands racing on one stream: exactly one append succeeds;
- duplicate idempotency race: same digest deduplicates;
- duplicate idempotency race: different digest conflicts;
- hash-chain identity across backends;
- event ordering/global offset expectations that Trellis actually relies upon;
- projection state equality after identical canonical histories;
- Consumption operational behavior;
- normalized errors/results do not leak backend-specific object shapes.

## Layer C — Cloudflare Worker integration

Using local Worker/D1 runtime after applying real migrations:

- boot Worker;
- hit `/`;
- hit `/api/schema`;
- hit `/.well-known/trellis.json`;
- hit public Feed/Directory;
- run at least one canonical command vertical slice through service composition;
- verify D1 persistence survives a separate request context;
- verify hash chain and command receipt;
- verify Web W1–W12 still hold on the Worker path.

A browser-page 200 response alone is not sufficient evidence for this migration.

---

# 23. Concurrency conformance vectors

## 23.1 Different commands, same stream/version

Setup:

```text
stream head = N
Command A evaluated at N
Command B evaluated at N
```

Execute their append attempts concurrently.

Required result on both SQLite and D1:

```text
exactly one accepted
exactly one VersionConflict
```

Never:

```text
both accepted
```

## 23.2 Same command/idempotency, duplicate submit

Required:

```text
one canonical append
both callers observe accepted/deduplicated semantic success
```

## 23.3 Same idempotency key, different command digest

Required:

```text
one may commit
other returns IdempotencyConflict
no partial second append
```

## 23.4 EventStore must not semantic-retry

Instrument/read the append path and prove a losing CAS performs no second CAS using a rewritten expected version.

## 23.5 Domain opt-in retry is fresh evaluation

Storage Runtime v1 has no automatic semantic retry.

A future test fixture may demonstrate the contract by explicitly invoking the domain command again as a **new command attempt** after re-reading current state.

---

# 24. Hash-chain compatibility

Storage backend migration must not alter canonical event hashing.

For identical canonical drafts, timestamps, stream order, authority receipt references, and previous hashes:

```text
SQLite event_hash
=
D1 event_hash
```

The CAS `append_token` and `stream_heads` table must never enter canonical hash material.

Existing `verifyHashChain()` behavior becomes async but semantically unchanged.

---

# 25. Global offset semantics

Current canonical events use SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` as `global_offset`.

Storage Runtime v1 must test that D1 preserves every ordering property actually used by Feed/Notification/Discovery/public surfaces.

If D1's behavior differs in a way that makes `global_offset` unsuitable as a cross-backend deterministic tiebreaker, the migration must stop and design a portable canonical ordering primitive before deployment.

The spec does not permit silently changing downstream sort behavior per backend.

---

# 26. Deployment sequence

Production rollout order:

```text
1. create/bind D1 database
2. apply db/migrations through Wrangler
3. verify schema/migration state
4. deploy Worker with D1 binding
5. run read-only smoke
6. run controlled canonical write smoke
7. verify canonical events / receipts / hash chain
8. attach trellis.evemisslab.com route
9. only then admit real product data
```

Never:

```text
launch on ephemeral SQLite
→ accumulate real data
→ migrate later
```

---

# 27. Failure model

The migration must distinguish at least:

```text
VersionConflict
IdempotencyConflict
PolicyDenied
InvalidTransition
StorageTransientError
StorageConstraintError
Migration/schema mismatch
```

Backend-specific D1 error messages do not become public/domain error codes without normalization.

An infrastructure error must never be mislabeled `VersionConflict` merely to trigger retries.

---

# 28. Storage Runtime invariants

## SR1 — Async domain persistence

```text
DomainPersistenceAPI = Async
```

No persistence-dependent Trellis service exposes sync-or-Promise dual behavior.

## SR2 — Production persistence is D1

```text
ProductionPersistence = Cloudflare D1
```

Container-local SQLite is not production authority.

## SR3 — SQLite is local/test adapter

```text
SQLite = Dev/Test Adapter
```

Its public Trellis storage contract is still asynchronous.

## SR4 — One migration source

```text
MigrationSource(SQLite) = MigrationSource(D1)
```

The repository SQL migration files are the shared source.

## SR5 — Atomic CAS append

```text
EventAppend = CASGuard + AtomicBatch
```

No partial canonical append survives failure.

## SR6 — Backend migration preserves canonical semantics

```text
BackendChange
not-implies
CanonicalEventSemanticChange
```

## SR7 — Hash-chain equivalence

```text
SameCanonicalInputs
→ SameEventHashChain
```

across SQLite and D1.

## SR8 — Idempotency equivalence

```text
IdempotencySemantics(SQLite)
=
IdempotencySemantics(D1)
```

## SR9 — Projection equivalence

```text
ProjectionResult(SQLite)
=
ProjectionResult(D1)
```

for identical canonical histories and viewer contexts.

## SR10 — Backend results do not leak upward

```text
D1Result / DatabaseSync result
not-in
DomainAPI
```

## SR11 — Runtime startup does not migrate production

```text
ProductionRequestStartup
not-implies
SchemaMigration
```

## SR12 — Web/HTTP cannot bypass storage boundary

```text
Web/HTTP presentation
not-direct-to
D1
```

## SR13 — No EventStore automatic rebase

```text
VersionConflict
→ NoAutomaticEventStoreRebase
```

## SR14 — Semantic retry requires fresh command evaluation

```text
SemanticRetry
=
FreshCanonicalRead
+ FreshFold
+ FreshPolicy/Authority
+ FreshEventDrafts
```

not retrying stale append drafts.

## SR15 — Retry responsibility is backend-invariant

```text
RetryResponsibility(SQLite)
=
RetryResponsibility(D1)
```

Both adapters surface the same conflict semantics to the command layer.

## SR16 — Infrastructure retry is not semantic retry

```text
TransientInfrastructureRetry
!=
SemanticVersionConflictRetry
```

---

# 29. Acceptance vertical slice

Apply all migrations to both SQLiteAsyncAdapter and local D1.

Create the same starting canonical state.

```text
Actor A
Actor B
Community C
Publication P
```

Run equivalent commands against both backends.

Verify:

```text
canonical event payloads equal
stream sequences equal
event hashes equal
command receipts semantically equal
materialized projections equal
public HTML/JSON semantic facts equal
```

Then race two different Publication revisions from the same expected stream version.

Required:

```text
SQLite:
  one accepted
  one VersionConflict

D1:
  one accepted
  one VersionConflict
```

The losing EventStore attempt must execute no automatic semantic retry.

Submit the winning logical command again with the same idempotency key/digest.

Required on both:

```text
deduplicated success
no duplicate canonical event
```

Attempt same idempotency key with a changed command.

Required:

```text
IdempotencyConflict
```

Force an event insert failure inside an append batch.

Required:

```text
stream_head unchanged
authority receipt absent
partial canonical events absent
command receipt absent
```

Delete/rebuild a normal projection on both backends and require viewer-safe equality.

Finally boot the Cloudflare Worker against local D1 and require the Web v0.1 public vertical slice to return the same semantic facts as the SQLite-backed local reference fixture.

---

# 30. Freeze definition

Trellis Storage Runtime v1 is frozen as:

```text
Async Everywhere Above Storage
+ D1 Production
+ SQLite Async Dev/Test
+ Shared SQL Migrations
+ CAS-Guarded Atomic Event Append
+ No Hidden Semantic Retry
+ Backend-Invariant Domain Semantics
```

The goal is not merely to make the code run on Cloudflare.

The goal is:

> Change where and how Trellis persists state without changing what Trellis means.
