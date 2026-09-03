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


## State-class classification rule

The Foundation registry classifies the **domain boundary**, not whether a module has a dedicated event namespace or a dedicated `authority/policy.js` decision branch.

A domain is `canonical` when its command boundary **creates or owns an independently addressable canonical aggregate identity** whose existence/lifecycle or canonical facts are recorded in Trellis canonical histories and may be referenced by other canonical facts. A canonical domain MAY reuse a lower-level generic event algebra or Authority policy; bespoke event names are not required.

A domain is `derived_projection` when it creates no independent canonical aggregate identity/state of its own and its output can be reconstructed entirely from canonical aggregates owned elsewhere. Deleting the projection loses no independently addressable canonical identity or fact.

An `operational` domain owns mutable or retention-bounded state that is neither canonical social history nor necessarily rebuildable from canonical history.

This rule explains the otherwise easy-to-misread classifications:

- **Community is `canonical`.** `createCommunity()` creates the stable canonical Entity aggregate `community:C` through `entity.registered(entity_kind=community)`. Community metadata is appended to that same Entity history with `entity.assertion_added`; membership and scoped social facts reference the Community identity through canonical Relationship history. Other domains directly use `community:C` as `scope_ref` or relationship target. Reusing Entity/Relationship event vocabularies and generic Authority policies does not make the Community identity derived.
- **Profile is `derived_projection`.** An Actor identity exists independently in Entity history. Profile creates no separate `profile:*` canonical aggregate identity; it projects viewer-safe profile state from already-canonical Entity assertions and social facts.
- **Relationship Surface is `derived_projection`.** The stable `relationship_id` belongs to the underlying canonical Relationship aggregate, created by the Relationship domain. `relationship_surface` merely projects that existing aggregate and does not create or own the relationship identity.

The `community` registry entry therefore refers to the Community **institutional-entity domain**, including `createCommunity()` and canonical Community metadata commands, not merely the Community Graph/Surface read projection. If a future registry adds a separate `community_surface` entry, that surface entry should be classified `derived_projection`.

In compact form:

\[
\boxed{CanonicalDomain \Rightarrow OwnsOrCreatesCanonicalAggregateIdentity}
\]

\[
\boxed{DerivedProjection \Rightarrow NoIndependentCanonicalAggregateIdentity}
\]

Referenceability is supporting evidence, not by itself sufficient: `relationship_surface` can expose a stable `relationship_id`, but that identity is owned by the underlying Relationship aggregate, not by the surface. Ownership/creation of the canonical aggregate is the decisive distinction. Dedicated event names or a dedicated Authority branch are implementation organization choices, not state-class criteria.

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
