# Trellis Storage Runtime v1 — Async SQL + Cloudflare D1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Every production behavior follows strict RED → observed RED → minimal GREEN → focused regression → full regression → commit. Checkpoint bundles are produced after each stage so verified work survives conversation/runtime loss.

**Goal:** Migrate Trellis persistence from synchronous `node:sqlite` call chains to one backend-neutral asynchronous SQL/runtime contract, with Cloudflare D1 as production persistence and SQLite as the asynchronous dev/test adapter, without changing Trellis domain, authority, visibility, idempotency, hash-chain, projection, Feed, or Web W1–W12 semantics.

**Architecture:** `AsyncSqlPort` is the only SQL boundary above adapters. `SQLiteAsyncAdapter` and `D1Adapter` normalize rows/results into backend-neutral shapes; `AsyncSqlEventStore` is the single EventStore algorithm and performs CAS-guarded atomic append using `stream_heads` and `append_batch_guards`. Persistence-dependent services become async end-to-end; pure folds/hash/renderers remain synchronous. D1-specific binding access exists only at the Cloudflare composition root.

**Tech Stack:** Node.js >= 22.5.0, CommonJS domain modules, `node:test`, `node:sqlite` for local/test, Cloudflare Workers + D1 production, Wrangler only for real local-D1 release gates.

**Spec:** `docs/superpowers/specs/2026-09-07-trellis-storage-runtime-v1-d1-design.md`

## Global Constraints

- External canonical engineering base is `kakon77777-commits/Trellis@9520076a64c4af1c0238c1cc537e7e889f56e26e`.
- Storage migration changes where/how Trellis persists state, not what Trellis means.
- SR1–SR16 and Web W1–W12 remain mandatory.
- `VersionConflict` is a semantic precondition failure; EventStore performs zero automatic semantic rebase/retry.
- Any semantic retry must re-read canonical state and regenerate policy/authority/event drafts.
- SQLite and D1 must expose the same retry responsibility, idempotency semantics, hash chain, and projection facts.
- `D1Result` and `DatabaseSync` row prototypes never leak above adapters.
- Production request startup never applies migrations.
- `env.DB` never enters domain/read/http/web modules directly.
- No hand-written fake D1 is accepted as Layer B evidence.
- Real local D1 gates remain explicitly UNVERIFIED in this sandbox when Wrangler is unavailable.
- Two explicit real-D1 probes are release gates: `ON CONFLICT ... DO UPDATE ... WHERE` CAS behavior and `INTEGER PRIMARY KEY AUTOINCREMENT` monotonic/non-reuse behavior under D1.

---

### Task 0: Rebuild and Seal the Previously Verified Async Storage Foundation

**Files:**
- Create: `storage/port.js`
- Create: `storage/results.js`
- Create: `storage/sqlite-adapter.js`
- Create: `storage/d1-adapter.js`
- Create: `events/async-sql-event-store.js`
- Create: `db/migrations/006_storage_runtime.sql`
- Test: `test/storage-port.test.js`
- Test: `test/d1-adapter.test.js`
- Test: `test/async-event-store.test.js`
- Test: `test/async-event-store-concurrency.test.js`

**Interfaces:**
- `sql.first(statement, params=[]) -> Promise<plain object|null>`
- `sql.all(statement, params=[]) -> Promise<plain object[]>`
- `sql.run(statement, params=[]) -> Promise<NormalizedRunResult>`
- `sql.batch([{sql,params}, ...]) -> Promise<NormalizedRunResult[]>`
- `sql.session({consistency:'primary'}) -> same async SQL contract`
- `AsyncSqlEventStore(sql,{now})` exposes async `lookupIdempotency/readStream/readEvent/verifyHashChain/append`.

- [ ] Write adapter contract tests first, including explicit null-prototype row normalization and D1 result-shape normalization.
- [ ] Run focused tests and observe RED because `storage/*` does not exist.
- [ ] Implement minimal port/results/SQLite adapter; run focused GREEN.
- [ ] Write D1 binding-shape tests; observe RED; implement translation-only D1 adapter; GREEN.
- [ ] Write migration/CAS EventStore tests including rollback and stale-version classification; observe RED.
- [ ] Implement `006_storage_runtime.sql` and `AsyncSqlEventStore` with one CAS batch: head CAS → guard CHECK → authority receipt → canonical event(s) → command receipt → guard delete.
- [ ] Add concurrency vectors: new-stream race, existing-stream race, same-key/same-digest race, same-key/different-digest race; observe failures before fixes.
- [ ] Run storage-focused suite, then `npm test` and `npm run check`.
- [ ] Commit `feat(storage): add async SQL port and CAS event store`.
- [ ] Produce `checkpoint-00-storage-foundation` bundle/source/evidence/SHA256.

### Task 1: Propagate Async Through Canonical Command/Write Services and Projectors

**Files:**
- Modify command services: `entity/service.js`, `relationship/service.js`, `community/service.js`, `community/membership.js`, `community/metadata-service.js`, `profile/service.js`, `profile/product-commands.js`, `publication/service.js`, `reaction/service.js`, `notification/service.js`, `preference/service.js`, `consumption/service.js`
- Modify projectors: `projections/relationship-projector.js`, `profile/projector.js`, `publication/projector.js`, `reaction/projector.js`, `notification/projector.js`, `preference/projector.js`
- Modify operational store: `consumption/store.js`
- Modify affected tests/helpers under `test/` and `test/helpers/`.

**Interfaces:**
- Every persistence-dependent command returns a Promise.
- Projectors consume `AsyncSqlPort` instead of raw `DatabaseSync` and commit projection writes through bounded atomic `sql.batch()` calls.
- Command services await EventStore reads/appends and await projection materialization.

- [ ] Convert one vertical command test to async and inject async storage/EventStore; observe RED on missing Promise/await semantics.
- [ ] Convert the minimal production call chain to async; focused GREEN.
- [ ] Repeat domain-by-domain, never changing command/event payloads or authority semantics.
- [ ] Add projector atomicity tests before replacing `BEGIN IMMEDIATE` code with `sql.batch()`.
- [ ] Make Consumption operational store async while preserving non-canonical semantics.
- [ ] Run all command/write/projector tests, `npm test`, `npm run check`.
- [ ] Commit `refactor(storage): propagate async through command writes`.
- [ ] Produce `checkpoint-01-command-write` delivery.

### Task 2: Propagate Async Through Read and Policy Services

**Files:**
- Modify: `community/graph.js`, `community/membership-read.js`, `community/read-policy.js`, `community/read-service.js`
- Modify: `profile/provenance.js`, `profile/read-service.js`, `projections/public-graph.js`
- Modify: `publication/read-service.js`, `publication/references.js`, `publication/read-policy.js`
- Modify: `reaction/read-policy.js`, `reaction/read-service.js`
- Modify: `relationship-surface/history.js`, `relationship-surface/index-service.js`, `relationship-surface/read-service.js`
- Modify: `preference/read-service.js`, `preference/feed-policy.js`, `preference/notification-policy.js`
- Modify: `consumption/read-service.js`
- Tests: corresponding existing read/policy suites.

**Interfaces:**
- Persistence-dependent reads/policies are Promise-only.
- Pure policy decisions over already-loaded facts stay synchronous.
- Viewer-safe return objects remain structurally identical.

- [ ] Convert existing read/policy tests to `async` and observe RED where calls are still sync/raw DB.
- [ ] Replace raw SQL reads with awaited `sql.first/all` in the smallest dependency order.
- [ ] Preserve hidden/nonexistent indistinguishability and visibility-before-aggregation.
- [ ] Run focused read/policy tests, then full regression and syntax check.
- [ ] Commit `refactor(storage): propagate async through read policy services`.
- [ ] Produce `checkpoint-02-read-policy` delivery.

### Task 3: Propagate Async Through Feed, Discovery, and Notification Derived Paths

**Files:**
- Modify Feed SQL-bearing modules: `feed/activity-items.js`, `feed/community.js`, `feed/public.js`, `feed/publication-items.js`, `feed/source-graph.js`
- Modify orchestration: `feed/read-service.js`, `feed/personalized-read-service.js`, `feed/home.js`, `feed/personalized-home.js`, related async callers.
- Modify Discovery SQL-bearing modules: `discovery/public-directory.js`, `discovery/visible-graph.js`, `discovery/read-service.js`, `discovery/actor-discovery.js`, `discovery/community-discovery.js` as required by call chains.
- Modify Notification derived read/orchestration paths as required after Tasks 1–2.
- Tests: existing Feed v0.1/v0.2, Discovery, Notification suites.

**Interfaces:**
- Async data acquisition → complete viewer-safe view model; ranking/folding/comparator/rendering remain pure synchronous where possible.
- Feed/Discovery/Notification semantic facts remain byte/structure equivalent for identical canonical state.

- [ ] Turn representative derived-path tests async and observe RED.
- [ ] Migrate one path at a time, preserving Feed v1/v2 comparator, snapshot, reason-code, and hidden-fact noninterference semantics.
- [ ] Run all Feed/Discovery/Notification tests and full regression.
- [ ] Commit `refactor(storage): migrate derived surfaces to async SQL`.
- [ ] Produce `checkpoint-03-derived-paths` delivery.

### Task 4: HTTP/Web Async Composition and Cloudflare Worker Entry

**Files:**
- Modify: `http/app.js`, `http/routes/*.js`, `http/view-models/*.js`, `http/server.js`, `test/helpers/web-system.js`
- Create: `runtime/build-dependencies.js` (only if needed to keep Node/Worker composition symmetric)
- Create: `cloudflare/worker.mjs`
- Test: existing Web W1–W12 suites plus `test/cloudflare-worker-composition.test.js`.

**Interfaces:**
- `dispatchRequest` / route handlers await viewer-safe service calls.
- Node root: `SQLiteAsyncAdapter -> AsyncSqlEventStore -> same HTTP app`.
- Worker root: `env.DB -> D1Adapter -> AsyncSqlEventStore -> same HTTP app`.
- Render functions remain synchronous after async view-model acquisition.

- [ ] Write Worker composition/boundary test first and observe RED because Worker root does not exist.
- [ ] Make HTTP dispatch/view-model acquisition Promise-based and keep renderer pure.
- [ ] Implement Node async composition and Worker D1 composition without direct D1 access below root.
- [ ] Re-run W1–W12 and real Node HTTP tests.
- [ ] Commit `feat(storage): add async web and Cloudflare composition roots`.
- [ ] Produce `checkpoint-04-http-worker` delivery.

### Task 5: Shared Migration Runner, Wrangler Configuration, and Layer A Closure

**Files:**
- Create: `storage/migration-loader.js`
- Modify: `db/sqlite.js` to become compatibility/composition helper only or replace with async local opener as dictated by tests.
- Create: `scripts/migrate-sqlite.js` or equivalent maintenance-only runner.
- Create: `wrangler.toml` (or current supported Wrangler config format verified against current Cloudflare docs).
- Modify: `package.json` scripts.
- Tests: `test/migration-source.test.js`, full Layer A suite.

**Interfaces:**
- One ordered `db/migrations/*.sql` source for SQLite and D1.
- Worker request startup never executes migrations.
- Wrangler D1 migration config points at `db/migrations`.

- [ ] Write shared-migration-source/startup-nonmigration tests; observe RED.
- [ ] Implement migration loader/local runner and config with no domain-time migration primitive.
- [ ] Run every migration through SQLiteAsyncAdapter.
- [ ] Run full Layer A (`npm test`, `npm run check`, `git diff --check`) twice from final stage HEAD.
- [ ] Commit `feat(storage): add shared migration and deployment configuration`.
- [ ] Produce `checkpoint-05-layer-a` delivery.

### Task 6: Layer B Storage Contract Suite

**Files:**
- Create: `test/storage-contract/contract-suite.js`
- Create: `test/storage-contract/sqlite.test.js`
- Create: `test/storage-contract/d1-local.test.mjs` or Worker-test-runtime equivalent.
- Create: `scripts/run-d1-contract-local.*` if required for Neo's local shell.

**Mandatory vectors:** normalization; missing rows; failed-batch rollback; CAS win/loss; concurrent different commands; idempotency same/different digest races; hash-chain identity; global ordering assumptions; projection equality; Consumption behavior; no backend result leakage; explicit `ON CONFLICT ... WHERE` probe; explicit AUTOINCREMENT monotonic/non-reuse probe.

- [ ] Author one reusable backend contract function and make SQLite half pass.
- [ ] Author real-D1 invocation harness without a fake binding.
- [ ] In this sandbox, mark D1 vectors SKIPPED/BLOCKED only because Wrangler/runtime is unavailable; never mark PASS.
- [ ] Package exact Neo-machine commands and expected evidence output.
- [ ] Commit `test(storage): add dual-backend contract suite`.
- [ ] Produce `checkpoint-06-layer-b-handoff` with explicit gate ledger.

### Task 7: Layer C Worker Integration Harness

**Files:**
- Create/update Cloudflare integration tests/harness under `test/cloudflare/`.
- Update deployment scripts/docs only as required by executable tests.

**Required real-D1 vertical slice:** boot Worker after real migrations; hit `/`, `/api/schema`, `/.well-known/trellis.json`, public Feed/Directory; execute at least one canonical command through service composition; verify persistence across separate request context; verify hash chain/receipt; verify W1–W12.

- [ ] Write executable Layer C harness/tests.
- [ ] Run all Node-local portions possible in sandbox.
- [ ] Leave real Worker+D1 execution explicitly BLOCKED pending Neo-machine Wrangler runtime.
- [ ] Commit `test(storage): add real Worker D1 integration gate`.
- [ ] Produce `checkpoint-07-layer-c-handoff`.

### Task 8: SR1–SR16 Seal and Reproducible Delivery

**Files:**
- Create: `docs/STORAGE_RUNTIME_V1_CONFORMANCE.md`
- Create: `validation/STORAGE_RUNTIME_V1_GATE.json` or equivalent machine-readable gate ledger.
- Generate artifacts outside worktree: git bundle, patches, source ZIP, base-to-head diff, evidence logs, SHA256 manifest.

- [ ] Map every SR1–SR16 invariant to executable evidence and status.
- [ ] Require all sandbox-verifiable gates GREEN.
- [ ] Do not call final release accepted while real D1 Layer B/Layer C gates remain unexecuted.
- [ ] Run verification-before-completion: full suite, syntax, diff check, clean worktree, clean-extracted source suite, bundle verify, archive integrity, SHA256.
- [ ] Commit `test(storage): seal Storage Runtime v1 sandbox gates`.
- [ ] Produce one final continuation ZIP containing source, git bundle, patches, diff, evidence, spec, plan, gate ledger, and SHA256SUMS.

---

## Checkpoint Order

```text
00 async storage foundation
→ 01 command/write
→ 02 read/policy
→ 03 derived Feed/Discovery/Notification
→ 04 HTTP/Web/Worker composition
→ 05 shared migrations + Layer A
→ 06 Layer B handoff
→ 07 Layer C handoff
→ 08 SR1–SR16 seal / final delivery
```

Every checkpoint is independently restorable. No later stage may rewrite an earlier semantic contract merely to satisfy D1.

## Self-Review

- **Spec coverage:** Tasks 0–8 cover async port/adapters, CAS EventStore, projections, full async propagation, primary consistency, shared migrations, Node/Worker composition, Layer A/B/C, concurrency vectors, real D1 probes, SR1–SR16, and W1–W12.
- **No hidden retry:** No task introduces EventStore rebase or stale-draft resubmission.
- **Backend neutrality:** D1-specific shapes/binding remain adapter/root concerns only.
- **Release honesty:** Wrangler/D1-only vectors remain explicit external release gates until actually run.
- **Checkpoint durability:** Each stage ends with commit plus portable delivery artifacts.

**Execution mode:** Inline execution in this conversation, as explicitly requested by Neo.K; do not pause for a plan-selection question.
