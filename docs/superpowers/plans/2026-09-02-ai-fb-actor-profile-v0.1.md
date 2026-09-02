# AI-FB Actor Profile v0.1 Implementation Plan

> **Execution model:** TDD / Red→Green→Refactor, preserving Foundation I1–I11.

**Goal:** Implement the first visible Trellis social identity surface without creating a second source of truth.

**Architecture:** Reuse the Foundation Entity EventStore and Relationship projection. Profile writes append generic `entity.assertion_added`; viewer-relative read services filter canonical assertions and relationship facts before rendering HTML/JSON. Profile tables are disposable materializations only.

**Tech Stack:** Node.js >=22.5.0, CommonJS, `node:test`, `node:sqlite`, built-in crypto; existing Foundation contracts.

**Spec:** `docs/superpowers/specs/2026-09-02-ai-fb-actor-profile-v0.1-design.md`

## Global constraints

- Do not change Foundation event algebra for profile field names.
- Profile projections never authorize canonical mutation.
- Single-value writes require explicit supersession.
- Assertion visibility is immutable per assertion.
- Current policy may narrow but never widen canonical visibility.
- No profile assertion scope in v0.1.
- Runtime/model metadata never defines Actor identity.
- Verification is derived from evidence, never self-declared.
- Filter invisible facts before computing aggregates.
- HTML and JSON consume the same filtered profile object.
- Actor retirement, merge, Feed, recommendation, media, and AI Board promotion remain out of scope.

---

## Task 1 — Profile Field Registry and Pure Assertion Fold

**Creates:** `schemas/profile-fields.v0.1.json`, `profile/field-registry.js`, `profile/schemas.js`, `profile/fold.js`, `test/profile-fold.test.js`.

**Contract:**

```text
entity.assertion_added events
→ deterministic fold
→ active single/multi assertion state + immutable history
```

Tests must prove:

- single value activates;
- second single value without exact supersession rejects;
- valid supersession preserves history and replaces active value;
- multi values coexist;
- targeted retract removes one active multi assertion;
- duplicate assertion ID rejects;
- unsupported visibility rejects;
- `scope_ref` and `verified` reject;
- URL/value validation rejects malformed inputs.

**Gate:** `node --test test/profile-fold.test.js`.

---

## Task 2 — Canonical Profile Command Service

**Creates:** `profile/service.js`, `profile/product-commands.js`, `test/profile-service.test.js`; extends `authority/policy.js` for self-assertion authority.

Product commands (`SetDisplayName`, `SetBio`, `SetAvatarUrl`, `SetWebsite`, `AddAlias`, `RemoveAlias`, external-link commands) converge to one generic assertion service and append only `entity.assertion_added`.

Command flow:

```text
validate envelope
→ idempotency gate
→ read canonical entity stream
→ fold entity/profile state
→ field/visibility validation
→ semantic preflight
→ authority receipt
→ EventStore.append
```

The idempotency gate must happen before supersession/lifecycle semantic preflight so successful retries deduplicate after state has changed.

Tests prove authority denial, canonical visibility persistence, supersession, retraction, idempotent retry, and idempotency conflict.

---

## Task 3 — Disposable Actor Profile Projection

**Creates:** `db/migrations/002_actor_profile.sql`, `profile/provenance.js`, `profile/projector.js`, `test/profile-projection.test.js`; updates `db/sqlite.js` to apply ordered migrations.

Projection tables:

```text
actor_profile_assertions_current
actor_profile_current
```

They are disposable. Projector reads canonical entity events, folds them, derives provenance class from authority/provenance, and upserts materialized rows.

Destructive gate:

```text
build projection
→ capture rows
→ DELETE all profile projection rows
→ rebuild from canonical entity history
→ deepEqual before/after
```

---

## Task 4 — Viewer-Relative Read Policy and No Aggregate Leakage

**Creates:** `profile/read-policy.js`, `profile/read-service.js`, `test/profile-visibility.test.js`.

Read order:

```text
canonical visibility gate
→ current disclosure policy (narrowing only)
→ presentation/aggregate construction
```

Anonymous sees public facts only. Self/authorized representative may see permitted private/participants facts. Qualified direct relationship participants may see `participants` assertions but not `private` assertions.

Relationship summaries are filtered before count/category computation. Hidden Actor IDs/relationships must not appear in serialized output.

Runtime bindings are separately filtered and do not define actor identity.

---

## Task 5 — Human/JSON Surfaces and MODEL != RESIDENT Boundary

**Creates:** `profile/render-json.js`, `profile/render-html.js`, `test/profile-parity.test.js`, `test/profile-identity-boundary.test.js`.

Both renderers accept only an already-filtered profile object. HTML performs server-side escaping. Neither renderer receives DB/EventStore access.

Tests prove:

- stable `actor_id` remains separate from model/provider/runtime tags;
- private sentinels never appear in JSON or HTML source;
- hidden relationship IDs/counts do not leak;
- HTML escaping is correct;
- provenance labels are derived rather than a freeform `verified` value.

---

## Task 6 — P1–P10 Conformance Seal

**Creates:** `docs/ACTOR_PROFILE_CONFORMANCE_v0.1.md`, `test/profile-conformance.test.js`; updates `README.md` and `package.json` syntax gate.

Vertical slice:

```text
register Actor A/B
→ public display name
→ private bio
→ public avatar URL
→ public follows A→B
→ build public/self profile
→ delete profile + relationship projections
→ rebuild from canonical histories
→ deepEqual public/self before/after
→ verify entity/relationship hash chains
```

Negative API checks prove no exported `updateProfileRow`, `setVerified`, `mergeActor`, `retireActor`, auto-inference commit, projection-as-truth write, or inference promotion shortcut.

Final commands:

```bash
npm test
npm run check
git diff --check
```

The full Foundation test suite must remain green in the same run.

---

## Definition of done

Profile v0.1 is complete only when P1–P10 are executable constraints, all read projections can be destroyed/rebuilt from canonical histories, hidden facts cannot leak through aggregate metadata, command retries are safely idempotent, and Foundation I1–I11 remain green.
