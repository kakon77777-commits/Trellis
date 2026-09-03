# Trellis Consumption State v0.1 Design

**Date:** 2026-09-03
**Status:** FROZEN
**Branch:** `consumption/v0.1`
**Base:** `preference/v0.1` (`51af28d2a8e80ab3edfc9acb770f8448f5769c65`)
**Depends on:** Foundation Cross-Domain Contract, Feed v0.1, Publication v0.1, Personal Preference v0.1

## 1. Purpose

Consumption State records a deliberately small amount of owner-private operational memory about what an Actor actually viewed. It exists to support later personalization without turning every UI impression into permanent social history.

The fundamental classification is:

\[
\boxed{ConsumptionState=PrivateOperationalState}
\]

and explicitly not:

\[
ConsumptionState=CanonicalSocialHistory.
\]

v0.1 persists only low-frequency first-observation state. High-frequency telemetry such as dwell time, scrolling, hover, viewport duration, repeated impression logs, device delivery, and click streams is out of scope.

## 2. State classes and Foundation registry migration

Consumption requires Foundation to distinguish state classes instead of treating every registered subsystem as though it had the same persistence semantics.

Foundation Cross-Domain Contract v0.2 SHALL expose a machine-readable registry with the required field:

```text
state_class = canonical | derived_projection | operational
```

and three explicit contract lists:

```text
canonical_contracts
derived_contracts
operational_contracts
```

The registry SHALL classify the currently declared Trellis domains as follows:

```text
profile               derived_projection
relationship_surface  derived_projection
community             canonical
discovery             derived_projection
publication           canonical
feed                  derived_projection
reaction              canonical
notification          canonical
preference            canonical
consumption           operational
```

For all pre-Consumption domains, effective inheritance after migration MUST remain exactly the same as before migration:

\[
\boxed{EffectiveContracts_{before}(d)=EffectiveContracts_{after}(d)=\{X1,X2,X3\}}
\]

for every previously registered domain `d`.

Consumption SHALL declare:

```text
state_class: operational
canonical_contracts: []
derived_contracts: []
operational_contracts: [X2, X3]
```

Consumption SHALL NOT claim X1 because it has no canonical visibility ceiling. Instead, its singleton private audience is stated by K1.

### 2.1 Registry migration invariants

**FR1 — Explicit state class**

Every registry entry has exactly one valid `state_class`.

**FR2 — Class-aligned contract list**

A canonical entry uses `canonical_contracts`, a derived projection uses `derived_contracts`, and an operational entry uses `operational_contracts`. Non-selected lists remain present and empty.

**FR3 — No previous contract loss**

The registry migration MUST update all existing contract tests and MUST prove that every pre-Consumption domain still effectively inherits `X1`, `X2`, and `X3`.

**FR4 — Canonical X1 requirement**

Every `state_class=canonical` entry includes X1.

**FR5 — Operational honesty**

An operational domain may omit X1 only when it defines an explicit domain-local audience/privacy invariant and still inherits X2/X3 where applicable.

**FR6 — Derived projection inheritance**

Every current `derived_projection` entry effectively inherits X1/X2/X3 as projection constraints over its canonical inputs.

The old flat `INHERITORS[domain] = ['X1','X2','X3']` shape SHALL NOT remain the contract under test. Tests that currently import or assert that old shape MUST migrate to the new registry contract rather than silently losing coverage.

## 3. v0.1 durable semantics

v0.1 stores exactly two monotonic semantic transitions per `(consumer, target)` record:

```text
first_seen
first_opened
```

`first_seen` means the consumer has at least once actually had the target presented by an eligible first-party surface according to that surface's visibility criterion.

`first_opened` means the consumer has at least once explicitly entered the Publication detail context.

\[
\boxed{Seen\neq Opened}
\]

No repeated view count, open count, last-N history, or impression event history is stored.

## 4. Consumer identity is the actual viewer

Consumption ownership is bound to the Authority-recognized actual viewer Actor:

\[
\boxed{ConsumptionOwner=ActualViewerActor}
\]

If Actor B is an authorized representative reading Actor A's Feed:

```text
subject_actor_id = actor:A
viewer_actor_id  = actor:B
```

and B actually views a target, any Consumption State created by that observation belongs to B, never A.

\[
\boxed{ReadAs(A)\not\Rightarrow ConsumedBy(A)}
\]

Model/provider/runtime identity is never sufficient to establish a consumer. The existing rule `MODEL != RESIDENT` remains applicable.

## 5. Owner-private singleton audience

Consumption has no visibility enum, scope enum, participant list, or public/community exposure mode.

\[
\boxed{Audience(consumption)=\{consumer\}}
\]

v0.1 normal read authority is owner-only:

\[
ReadConsumption(A)\Rightarrow principal\_actor=A.
\]

Representative read authority for Feed, Discovery, or Notification does not imply Consumption read authority.

## 6. Recording authority and anti-spoofing

Consumption differs from Personal Preference because recording an observation is performed by a trusted surface adapter, not by requiring the Actor to manually issue a semantic preference command.

A record operation requires an explicit operational capability:

```text
consumption:record
```

The authenticated Authority context MUST bind:

```text
recognized_viewer_actor_id
recorder_principal_id
capability = consumption:record
```

The request may contain a claimed consumer only for consistency checking. It MUST satisfy:

\[
\boxed{RequestedConsumer=AuthorityRecognizedViewer}
\]

A recorder with `consumption:record` cannot arbitrarily select another Actor as the consumer.

## 7. Fetch is not consumption

Returning data from a read API is insufficient evidence of actual consumption.

\[
\boxed{FetchFeed\not\Rightarrow Seen}
\]

\[
\boxed{FetchPublication\not\Rightarrow Opened}
\]

`GET /api/feed/home`, Feed builder calls, Publication prefetch, crawler resolution, background processing, or AI planning MUST NOT mutate Consumption State.

Actual first-party surface instrumentation uses explicit operational writes such as:

```text
recordSeen(...)
recordOpened(...)
```

## 8. Target model and normalization

v0.1 supports:

### 8.1 `first_seen`

Targets:

```text
publication
social_activity
```

Stable normalized identities are:

```text
publication:<publication_id>
social_activity:<canonical_event_id>
```

Feed page number, cursor position, row index, snapshot-local identifiers, and temporary UI object IDs MUST NOT become durable target identity.

### 8.2 `first_opened`

Target:

```text
publication
```

A social activity cannot be `opened` in v0.1.

## 9. Current target eligibility before record

Before recording Consumption State, the service MUST resolve the target and establish current readability for the recognized viewer.

\[
\boxed{RecordableConsumption\Rightarrow CurrentReadableTarget}
\]

For a Publication, the service folds canonical Publication history and applies current viewer visibility/membership policy.

For a social activity, the service resolves the canonical relationship activation event, folds the relationship, checks that its type is an allowed Feed social activity, and applies current relationship visibility/membership policy.

A hidden, withdrawn, nonexistent, invalid, or currently unreadable target MUST NOT create or update Consumption State.

## 10. Operational storage

Consumption State SHALL NOT use the canonical EventStore.

v0.1 introduces an operational table conceptually equivalent to:

```text
consumption_state
  consumer_actor_id
  target_kind
  target_ref
  first_seen_at
  first_opened_at
  last_touched_at
  expires_at
  state_version
  retention_policy_ref
```

Primary identity:

\[
\boxed{(consumer\_actor\_id,target\_kind,target\_ref)}
\]

UPDATE/UPSERT is allowed because the purpose is current operational memory, not reconstructable historical truth.

\[
\boxed{ConsumptionOperationalState\neq CanonicalEventHistory}
\]

No `consumption.created`, `consumption.seen`, or `consumption.opened` canonical event type is introduced in v0.1.

## 11. Server-controlled time

Client requests MUST NOT supply authoritative observation timestamps.

The service/storage clock determines:

```text
first_seen_at
first_opened_at
last_touched_at
expires_at
```

A test may inject a trusted clock dependency for deterministic verification, but arbitrary request timestamps do not control stored time.

## 12. Retention policy

Retention is part of the architecture.

v0.1 policy reference:

```text
trellis-consumption:retention:v1
```

Default policy behavior:

```text
TTL = 90 days after last_touched_at
```

The duration belongs to the versioned retention policy and is not ontology.

Expiry may delete operational rows permanently.

\[
\boxed{Loss(ConsumptionState)\not\Rightarrow Loss(CanonicalSocialState)}
\]

After expiry or deletion, personalization may lose recent-view memory. That loss is intentional and not recoverable from canonical social histories.

## 13. Disposable is not rebuildable

Unlike `relationships_current`, `publications_current`, `reactions_current`, `notifications_current`, or `preferences_current`, `consumption_state` is not a materialized cache of canonical history.

\[
\boxed{Disposable\neq Rebuildable}
\]

Deleting all Consumption State does not trigger a replay from EventStore because no canonical Consumption history exists.

Acceptance MUST explicitly prove that deletion of Consumption State leaves all canonical event streams byte-for-byte/event-count unchanged.

## 14. Monotonic first-observation semantics

The first trusted transition wins:

```text
first_seen_at   set once
first_opened_at set once
```

Subsequent duplicate `seen` or `opened` records MUST NOT modify the corresponding first timestamp.

They MAY update:

```text
last_touched_at
expires_at
state_version
```

according to the retention policy.

An `opened` record MAY establish `first_seen_at` at the same trusted server time if no prior seen record exists, because entering a Publication detail surface necessarily satisfies the weaker v0.1 observation fact that the Publication was seen.

This implication is operational and does not imply interest or endorsement.

## 15. Idempotency and retries

Instrumentation retries are expected.

The state transition is naturally idempotent with respect to first timestamps. Repeating the same semantic observation cannot create duplicate rows or duplicate canonical history.

An optional request idempotency key MAY be accepted, but v0.1 correctness MUST NOT depend on a permanent append-only idempotency receipt ledger. The durable state itself enforces one row per normalized target.

## 16. Owner-only read surface

v0.1 provides private machine-oriented read capability conceptually equivalent to:

```text
GET /api/consumption
```

with filters such as target kind and time range.

There is no public Actor Consumption profile endpoint.

Only the consumer may read their Consumption State in v0.1. Representatives are denied.

Before returning an operational row, the read service MUST re-resolve current target eligibility. If a formerly visible target is now withdrawn, policy-hidden, membership-hidden, or otherwise unreadable, that row remains stored until retention expiry but is omitted from normal read output.

## 17. Hidden target noninterference

A retained Consumption row for a target that is no longer visible must not become a visible personalization signal.

\[
\boxed{HiddenConsumptionTarget\not\Rightarrow VisiblePersonalizationSignal}
\]

Until Algorithmic Feed v0.2 defines an explicit privacy-safe model contract, hidden-target Consumption State MUST NOT affect Feed ranking, Discovery ranking, visible aggregate counts, snapshot refs, cursors, or recommendation explanations.

## 18. Preference dominates consumption inference

Consumption is weak behavioral evidence. Personal Preference is an explicit owner directive.

\[
\boxed{ExplicitPreference>ImplicitConsumptionInference}
\]

In v0.1 this is enforced structurally by not performing any Consumption-based ranking or affinity inference at all.

Future algorithms that consume both sources must define precedence so that an explicit `not_interested_publication`, `dismiss_feed_item`, or `mute_actor` is never silently overridden by a weak observation such as `opened`.

## 19. No semantic escalation

\[
\boxed{Seen\neq Interested}
\]

\[
\boxed{Opened\neq Endorsement}
\]

Neither observation creates or mutates:

```text
Relationship
Reaction
Personal Preference
Publication
Notification receipt
Community membership
Discovery affinity
Trust or verification state
```

\[
\boxed{ConsumptionSignal\not\Rightarrow CanonicalSocialMutation}
\]

## 20. Preference and Consumption remain separate domains

`getPreferences(A)` never returns Consumption rows.

`getConsumption(A)` never returns bookmarks, dismissals, not-interested directives, or mute directives.

They differ in authority, semantics, retention, and persistence class.

## 21. Feed integration boundary

Feed v0.1 remains chronological and MUST NOT use Consumption State for ranking, source generation, candidate existence, ordering, snapshot refs, or cursor boundaries.

Recording or deleting Consumption State alone therefore leaves Feed v0.1 unchanged.

This establishes a clean baseline for a later Algorithmic Feed version.

## 22. Discovery and Notification boundary

Consumption v0.1 does not affect Discovery candidates/ranking or Notification issuance/current inbox eligibility.

No Notification is generated merely because an Actor sees or opens content.

## 23. API shape

Conceptual machine writes:

```text
POST /api/consumption/seen
POST /api/consumption/opened
```

Conceptual owner read:

```text
GET /api/consumption
```

The actual modular-monolith v0.1 implementation may expose service functions rather than an HTTP server, but the authority and data contracts are identical.

## 24. Consumption invariants K1-K13

### K1 — Owner-private singleton audience

\[
\boxed{ConsumptionAudience=\{Consumer\}}
\]

### K2 — Actual viewer ownership

\[
\boxed{ConsumptionOwner=ActualViewerActor}
\]

### K3 — Representation does not transfer consumption

\[
\boxed{ReadAs(A)\not\Rightarrow ConsumedBy(A)}
\]

### K4 — Feed fetch is not seen

\[
\boxed{FetchFeed\not\Rightarrow Seen}
\]

### K5 — Publication fetch is not opened

\[
\boxed{FetchPublication\not\Rightarrow Opened}
\]

### K6 — Current readability required for record

\[
\boxed{RecordableConsumption\Rightarrow CurrentReadableTarget}
\]

### K7 — Operational state is not canonical history

\[
\boxed{ConsumptionState\neq CanonicalSocialHistory}
\]

### K8 — Operational loss cannot erase social history

\[
\boxed{Loss(ConsumptionState)\not\Rightarrow Loss(CanonicalSocialState)}
\]

### K9 — Seen is not interest

\[
\boxed{Seen\neq Interested}
\]

### K10 — Opened is not endorsement

\[
\boxed{Opened\neq Endorsement}
\]

### K11 — Hidden target produces no visible personalization signal

\[
\boxed{HiddenConsumptionTarget\not\Rightarrow VisiblePersonalizationSignal}
\]

### K12 — Consumption cannot mutate canonical social state

\[
\boxed{ConsumptionSignal\not\Rightarrow CanonicalSocialMutation}
\]

### K13 — Explicit Preference dominates implicit Consumption inference

\[
\boxed{ExplicitPreference>ImplicitConsumptionInference}
\]

## 25. Acceptance vertical slice

Given Actor A with a Home Feed containing root Publications P1 and P2 plus social activity E1:

1. Build/read A's Feed without sending Consumption instrumentation. `consumption_state` remains empty and canonical event count remains unchanged.
2. Record `seen(publication:P1)` with an Authority-recognized viewer A and a recorder principal holding `consumption:record`. Server clock sets `first_seen_at=t1`; `first_opened_at=null`.
3. Retry seen. `first_seen_at` remains `t1`; one row exists.
4. Record `opened(publication:P1)` at server time `t2`. `first_opened_at=t2`; `first_seen_at=t1` remains unchanged.
5. Record `seen(social_activity:E1)` and verify stable canonical source-event normalization.
6. B reads A's Feed as an authorized representative. If B records seeing P2, the resulting row belongs to B. A cannot be named as consumer merely because A is Feed subject.
7. Attempt to record a currently unreadable/withdrawn Publication or hidden social activity. The operation is denied and no state row is written.
8. Make a previously recorded target unreadable. The operational row remains stored, but normal owner read omits it.
9. Create explicit `not_interested_publication(P1)` and verify Consumption does not override or mutate that Preference.
10. Record or delete Consumption rows and verify Feed v0.1, Discovery v0.1, Notification current inbox, and all canonical event streams remain unchanged.
11. Delete all rows from `consumption_state`. Verify there is no rebuild-from-EventStore path and canonical histories remain identical.
12. Verify retention expiry deletes only eligible operational rows.

## 26. Non-goals

v0.1 does not implement:

```text
dwell time
scroll depth
hover duration
repeat impression log
open count
seen count
notification-open telemetry
device delivery telemetry
cross-actor consumption analytics
public consumption profile
consumption-derived affinity
consumption-derived recommendation ranking
Algorithmic Feed
automatic Preference creation
Block / moderation semantics
```

## 27. Freeze definition

Trellis Consumption State v0.1 is frozen as:

\[
\boxed{
OwnerPrivate
+
ActualViewerBound
+
RetentionBounded
+
LowFrequencyDurable
+
NonCanonical
}
\]

The architectural boundary is intentional:

\[
\boxed{CanonicalDomain\neq OperationalStateDomain\neq DerivedProjection}
\]

and:

\[
\boxed{Disposable\neq Rebuildable.}
\]
