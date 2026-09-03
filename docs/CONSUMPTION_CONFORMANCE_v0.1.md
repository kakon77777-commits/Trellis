# Trellis Consumption State v0.1 Conformance

**Spec:** `docs/superpowers/specs/2026-09-03-trellis-consumption-state-v0.1-design.md`
**Implementation plan:** `docs/superpowers/plans/2026-09-03-trellis-consumption-state-v0.1.md`
**State class:** `operational`
**Foundation registry:** `trellis-foundation-cross-domain:0.2`

## Foundation registry migration

| Invariant | Executable evidence |
| --- | --- |
| FR1 — every registered domain has explicit `state_class` | `test/consumption-foundation-registry.test.js`, `test/consumption-conformance.test.js` |
| FR2 — contract lists align with state class | same tests; non-selected lists are asserted empty |
| FR3 — previous effective inheritance is preserved | every pre-Consumption domain is asserted to remain `X1/X2/X3` |
| FR4 — canonical domains include X1 | final conformance enumerates every canonical entry |
| FR5 — operational Consumption omits X1 and uses local K1 + inherited X2/X3 | registry tests plus K1 owner-only read tests |
| FR6 — current derived projections retain X1/X2/X3 | registry tests classify Profile, Relationship Surface, Discovery, and Feed as `derived_projection` |

The old flat `INHERITORS` contract is no longer the tested Foundation API. Existing domain tests were migrated to `CONTRACT_REGISTRY` plus `effectiveContracts()` so the schema migration does not erase prior coverage.

## Consumption K-series

| Invariant | Executable evidence |
| --- | --- |
| K1 — Consumption audience is singleton consumer | `test/consumption-read.test.js`, `test/consumption-conformance.test.js` owner-only surface |
| K2 — Consumption owner is actual viewer | `test/consumption-service.test.js`, `test/consumption-cross-domain.test.js` representative case |
| K3 — `ReadAs(A)` does not imply `ConsumedBy(A)` | same representative case; spoofed consumer is denied |
| K4 — Feed fetch does not imply seen | `test/consumption-cross-domain.test.js`, final conformance |
| K5 — Publication fetch does not imply opened | same tests |
| K6 — record requires current-readable target | service tests cover private, withdrawn, policy-hidden, invalid, and social-activity targets |
| K7 — Consumption is not canonical social history | store/cross-domain/final conformance assert no `stream_type='consumption'` |
| K8 — losing Consumption cannot lose canonical social state | `clearAll()` / expiry tests compare canonical histories before and after |
| K9 — seen is not interest | no ranking/Preference mutation occurs from `seen`; final cross-domain equality tests |
| K10 — opened is not endorsement | no Reaction/Preference/social mutation from `opened`; final conformance |
| K11 — hidden Consumption target produces no visible personalization signal | retained hidden row vs deleted row gives identical Feed/Discovery/Notification outputs |
| K12 — Consumption signal cannot mutate canonical social state | canonical event and command-receipt snapshots remain unchanged after record writes |
| K13 — explicit Preference dominates implicit Consumption inference | explicit `not_interested_publication` suppression remains unchanged after `opened` |

## Operational storage contract

`consumption_state` is a mutable, retention-bounded operational table keyed by:

```text
(consumer_actor_id, target_kind, target_ref)
```

It stores only:

```text
first_seen_at
first_opened_at
last_touched_at
expires_at
state_version
retention_policy_ref
```

It does not store canonical event history and is intentionally not rebuildable from EventStore. `first_seen_at` and `first_opened_at` are monotonic first-observation timestamps; retries may refresh retention metadata but never rewrite first timestamps.

## Authority and spoofing gate

A recorder must hold explicit `consumption:record` capability. The service additionally requires:

```text
requested_consumer_actor_id == recognizedViewerActorId
```

The recorder cannot self-declare a different consumer. Client timestamp fields are rejected; trusted service time controls persisted timestamps.

## Current-read eligibility

Operational rows may remain retained after a source becomes unavailable, but the normal owner-only Consumption surface revalidates target visibility on every read. Withdrawn, policy-hidden, membership-hidden, invalid, or otherwise unreadable targets are omitted without deleting the row before retention expiry.

## Release gate

`npm run check` explicitly includes:

```text
consumption/*.js
```

The final release gate is:

```text
npm test
npm run check
git diff --check preference/v0.1...HEAD
git status --short
```
