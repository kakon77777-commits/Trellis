# Trellis Storage Runtime v1 Conformance

**Design authority:** `docs/superpowers/specs/2026-09-07-trellis-storage-runtime-v1-d1-design.md`
**External canonical base:** `kakon77777-commits/Trellis @ 9520076a64c4af1c0238c1cc537e7e889f56e26e`
**Sandbox status:** `RELEASE_CANDIDATE_EXTERNAL_D1_REQUIRED`
**Real-D1 runtime gates:** `EXTERNAL_EXECUTION_REQUIRED`

Storage Runtime v1 changes where and how Trellis persists state without changing what Trellis means. The sandbox implementation and SQLite-backed conformance layers are green; final release acceptance remains gated on the repository's real local-Cloudflare-D1 Layer B and Layer C runners.

## Verified sandbox baseline

- Checkpoint 05 / Layer A: full async SQLite suite passed twice.
- Checkpoint 06 / Layer B sandbox: SQLite storage contract passed; full suite `479/479 PASS`.
- Checkpoint 07 / Layer C sandbox: Worker integration harness and production-worker delegation passed; full suite `483/483 PASS`.
- Final SR seal sandbox suite: `489/489 PASS`.
- Real Wrangler execution is not available inside this sandbox and is therefore never represented as a D1 PASS here.

## SR1–SR16 map

| Invariant | Sandbox status | Primary evidence | Final-D1 dependency |
| --- | --- | --- | --- |
| SR1 — Async domain persistence | PASS | async command/read/derived/HTTP tests; AsyncSqlPort | none |
| SR2 — Production persistence is D1 | PASS | `cloudflare/worker.mjs`, `wrangler.toml.template` | Layer C proves runtime path |
| SR3 — SQLite is local/test adapter | PASS | `storage/sqlite-adapter.js`, storage-port tests | none |
| SR4 — One migration source | PASS | `storage/migration-loader.js`, `db/migrations/*.sql`, migration-runtime tests | Layer B applies same files to D1 |
| SR5 — Atomic CAS append | EXTERNAL_D1_REQUIRED | SQLite CAS/concurrency tests + shared EventStore | Layer B D1 contract |
| SR6 — Backend migration preserves canonical semantics | EXTERNAL_D1_REQUIRED | shared domain/EventStore code | Layer B equivalence |
| SR7 — Hash-chain equivalence | EXTERNAL_D1_REQUIRED | SQLite hash-chain contract | Layer B equivalence |
| SR8 — Idempotency equivalence | EXTERNAL_D1_REQUIRED | SQLite race contract | Layer B equivalence |
| SR9 — Projection equivalence | EXTERNAL_D1_REQUIRED | shared projection contract | Layer B equivalence |
| SR10 — Backend results do not leak upward | EXTERNAL_D1_REQUIRED | adapter normalization tests | Layer B real-D1 result shapes |
| SR11 — Runtime startup does not migrate production | PASS | pure `openDatabase()`, explicit migration runner, Worker source | none |
| SR12 — Web/HTTP cannot bypass storage boundary | PASS | Worker composition/boundary tests | none |
| SR13 — No EventStore automatic rebase | PASS | instrumented two-caller race: exactly two CAS batches, loser `VersionConflict` | Layer B confirms same backend semantics |
| SR14 — Semantic retry requires fresh command evaluation | PASS | v1 automatic semantic retry count is zero; EventStore exposes conflict rather than retrying stale drafts | none |
| SR15 — Retry responsibility is backend-invariant | EXTERNAL_D1_REQUIRED | shared EventStore and SQLite contract | Layer B D1 conflict classification |
| SR16 — Infrastructure retry is not semantic retry | PASS | unknown storage failure normalizes to storage invariant; VersionConflict classification is separate | none |

## W1–W12 on the Worker path

`cloudflare/integration-gate-worker.mjs` is test-only. It delegates every ordinary public/machine request to the production `cloudflare/worker.mjs`; only explicit `/__trellis/integration/*` control endpoints are intercepted for test fixture setup/verification.

The Layer C runner requires:

- Worker-process restart over the same persisted local D1 state;
- W1/W9 HTML/JSON semantic parity for Public Feed, Public Directory, Actor, Publication, and Community;
- W6 rejection of client-claimed Actor identity;
- W10 authored script/HTML escaping;
- W11 no personalized owner Feed and `writes_enabled=false`;
- W7/W12 public Feed/Directory hidden-fact noninterference;
- hidden community and nonexistent community share the same 404 response;
- canonical hash chain, command receipt, publication projection, and empty append guard state survive the separate Worker process.

## External release gates

Run from a checkout containing the final Storage Runtime v1 source and a real local Wrangler/D1 runtime. Set the real database UUID; do not substitute the database name for the UUID.

```bash
export TRELLIS_D1_DATABASE_ID='<REAL-D1-UUID>'
npm run test:storage:d1-local
npm run test:storage:worker-d1-local
npm run storage:seal
```

Windows PowerShell equivalent:

```powershell
$env:TRELLIS_D1_DATABASE_ID = '<REAL-D1-UUID>'
npm run test:storage:d1-local
npm run test:storage:worker-d1-local
npm run storage:seal
```

Expected evidence:

```text
validation/STORAGE_RUNTIME_V1_LAYER_B_D1_LOCAL.json
validation/STORAGE_RUNTIME_V1_LAYER_C_D1_LOCAL.json
validation/STORAGE_RUNTIME_V1_GATE.json
```

`npm run storage:seal` exits nonzero while either real-D1 evidence file is missing or structurally failing. It reaches `overall_status = PASS` only when both Layer B and Layer C evidence satisfy the machine evaluator.

## Supporting D1 probes already performed externally

Neo's environment independently confirmed through local D1 simulation that:

1. `INSERT ... ON CONFLICT DO UPDATE ... WHERE` rejects a stale expected-version update rather than overwriting the current row;
2. `INTEGER PRIMARY KEY AUTOINCREMENT` did not reuse a deleted maximum row id in the tested sequence.

These probes are useful supporting evidence, but they do not replace the full Layer B/Layer C repository runners above.

## Release interpretation

Until both external gates pass:

```text
Storage Runtime v1 = sandbox-complete release candidate
                     + real-D1 release gates outstanding
```

After both runner evidence files pass and `npm run storage:seal` produces `overall_status = PASS`, SR1–SR16 may be treated as formally sealed for Storage Runtime v1 under the frozen design.
