# Trellis Algorithmic Feed v0.2 Design

## Deterministic Explainable Personalization over Feed v0.1

**Date:** 2026-09-03
**Status:** ARCHITECTURE FREEZE / IMPLEMENTATION TARGET
**Canonical Repo:** `kakon77777-commits/Trellis`
**Base:** Consumption State v0.1 + Foundation Cross-Domain Contract v0.2
**Depends on:** Feed v0.1 + Personal Preference v0.1 + Consumption State v0.1
**Scope:** Home Feed personalization only; deterministic fixed-point scoring; explanation; stable snapshot/cursor; explicit chronological fallback

---

## 1. Core Position

Algorithmic Feed v0.2 is an extension of the existing `feed` derived-projection domain. It does not create a new canonical or operational state domain and it does not create a new candidate universe.

\[
\boxed{
FeedV2_{A,v}
=
RankV2(
HardPreferenceFilter_A(
VisibleCandidatesV1_{A,v}
),
EligibleConsumption_{A,v}
)
}
\]

The fundamental ordering of work is immutable:

```text
v0.1 viewer-visible source graph
→ v0.1 viewer-visible candidate generation
→ owner-only hard Preference filter
→ deterministic v0.2 score
→ total-order comparator
→ snapshot / pagination
```

Algorithmic Feed MUST NOT inspect the full hidden graph and MUST NOT expand the v0.1 candidate set.

\[
\boxed{PersonalizedRanking\neq PersonalizedCandidateExpansion}
\]

---

## 2. Foundation Classification and Inheritance

`feed` remains registered as:

```text
state_class = derived_projection
effective contracts = X1, X2, X3
```

No Foundation registry migration is required for v0.2.

The v0.2 scoring layer is subject to the same Foundation rules as Feed v0.1:

- X1: canonical visibility ceilings remain authoritative over all source facts;
- X2: ranking, score, reason, or Feed presence grants no execution authority;
- X3: facts not legally available to this Feed projection cannot affect candidate set, score, reason, order, snapshot, or cursor.

---

## 3. v0.1 Candidate Set Is the Only Candidate Set

Algorithmic Feed v0.2 SHALL reuse the Feed v0.1 source resolution and candidate collectors.

For subject Actor `A` and viewer `v`:

\[
Sources_{A,v}
=
Self_A
\cup
FollowTargets_{A,v}
\cup
SubscriptionTargets_{A,v}
\cup
MemberCommunities_{A,v}
\]

Every source relationship is filtered by the existing viewer-relative relationship read policy **before** source IDs are extracted.

v0.2 SHALL NOT add candidates from:

```text
Discovery results
Reaction similarity
Notification history
Consumption history
Profile text
Embedding similarity
LLM inference
trusts / reviews / delegates_to
```

A hidden source relationship cannot influence candidate existence even when the source Publication itself is public.

---

## 4. v0.2 Personalizes Home Feed Only

v0.2 applies only to the personalized **Home Feed**.

Community Feed remains on:

```text
trellis-feed:chronological:v1
```

for v0.2.

This avoids silently introducing owner-private Preference or Consumption semantics into a Community-scoped shared surface.

---

## 5. Owner-Private Signals Apply Only to the Actual Owner View

Personal Preference and Consumption are private to their owner/consumer.

v0.2 may consume these signals only when:

```text
viewer_actor_id == subject_actor_id
```

An explicit representative reading Actor A's Feed does not receive A's owner-private Preference or Consumption effects.

\[
\boxed{ReadAs(A)\not\Rightarrow UsePrivatePersonalizationOf(A)}
\]

For a representative view, Algorithmic Feed v0.2 SHALL use the existing chronological Feed v0.1 path rather than a partially private personalized ranking.

This fallback is structural and MUST NOT reveal whether A has any Preference or Consumption rows.

---

## 6. Preference Is a Hard Filter, Not a Score

The existing Personal Preference semantics remain authoritative and are applied after visibility-safe candidate generation and before scoring.

```text
bookmark_publication
→ no ranking effect in v0.2

dismiss_feed_item
→ exact item removed before scoring

not_interested_publication
→ exact Publication removed before scoring

mute_actor
→ affected passive Feed items removed before scoring
```

A hard Preference does not become a numeric penalty.

\[
\boxed{ExplicitPreference>ImplicitConsumptionInference}
\]

No amount of Consumption evidence may restore an item removed by an active hard Preference.

---

## 7. Consumption Is Exact-Item Weak Evidence Only

Consumption State v0.1 may affect only the exact current Feed item's novelty component.

It SHALL NOT produce:

```text
topic affinity
author affinity
community affinity
semantic similarity
cross-publication preference
Discovery affinity
Relationship mutation
```

For an eligible current item:

### Publication

```text
no consumption row          → unseen
first_seen, not first_opened → seen
first_opened                 → opened
```

### Social Activity

```text
no consumption row → unseen
first_seen          → seen
```

The row is consulted only after the item has already passed v0.1 viewer visibility and hard Preference filtering.

Historical Consumption for a hidden/non-candidate target cannot affect ranking.

---

## 8. Algorithm Identity

The personalized algorithm is version-pinned:

```text
algorithm_ref = trellis-feed:personalized:v2
projection_version = trellis-feed:0.2
```

Feed v0.1 remains:

```text
algorithm_ref = trellis-feed:chronological:v1
```

The two algorithms are separate replay contracts.

---

## 9. Fixed-Point Score

v0.2 uses only deterministic integer points:

\[
\boxed{
Score(i)=R(i)+S(i)+N(i)\in\mathbb Z
}
\]

where:

- `R` = recency points;
- `S` = one deterministic source-tier component;
- `N` = exact-item novelty component.

No floating-point decay, sampling, temperature, random jitter, model inference, or unspecified runtime rounding is allowed.

---

## 10. Recency Points R

Each request/snapshot uses one trusted `ranking_reference_time`.

Let:

\[
age(i)=\max(0, ranking\_reference\_time-created\_at(i))
\]

using integer milliseconds parsed from the canonical ISO timestamps.

The v2 policy is:

| Age | `recency_points` | Reason label |
|---|---:|---|
| `0 .. 1h` | 6000 | `recent_1h` |
| `>1h .. 6h` | 5000 | `recent_6h` |
| `>6h .. 24h` | 4000 | `recent_24h` |
| `>24h .. 72h` | 3000 | `recent_72h` |
| `>72h .. 7d` | 2000 | `recent_7d` |
| `>7d .. 30d` | 1000 | `recent_30d` |
| `>30d` | 0 | `older_than_30d` |

Recency is monotonic: an older item can never receive more recency points than a newer item under the same reference time.

---

## 11. Source Points S

Exactly one source-tier reason contributes to a Feed item. If multiple visible reasons apply, the highest-precedence reason wins; points are not stacked.

### Publication precedence

| Reason | Points |
|---|---:|
| `self_publication` | 4000 |
| `subscribed_actor` | 3000 |
| `followed_actor` | 2000 |
| `community_source` | 1000 |

A Community-scoped Publication normally receives `community_source`, except a subject-authored Publication keeps the higher `self_publication` tier because self-publications are independently admitted by v0.1.

For an unscoped Publication whose author is both followed and subscribed, `subscribed_actor` wins.

### Social Activity precedence

| Reason | Points |
|---|---:|
| `subject_involved_activity` | 2500 |
| `subscribed_actor_activity` | 2000 |
| `followed_actor_activity` | 1500 |
| `community_activity` | 1000 |

Only relationships already present in the viewer-filtered `source_graph` may establish subscribed/followed source strength.

---

## 12. Novelty Points N

Novelty is an exact-item weak signal.

### Publication

| State | Points | Reason |
|---|---:|---|
| no row | +1000 | `not_seen_before` |
| seen, not opened | -500 | `seen_before` |
| opened | -1500 | `opened_before` |

### Social Activity

| State | Points | Reason |
|---|---:|---|
| no row | +1000 | `not_seen_before` |
| seen | -500 | `seen_before` |

These points mean only resurfacing/novelty treatment for the exact item.

\[
Seen\neq Interested
\]

\[
Opened\neq Endorsement
\]

An expired or absent Consumption row is treated as `unseen`; loss of Consumption State cannot make Feed unavailable.

---

## 13. Reaction and Notification Are Not Ranking Signals

Reaction and Notification remain outside v0.2 scoring.

\[
\boxed{Reaction\not\Rightarrow FeedRanking}
\]

\[
\boxed{Notification\not\Rightarrow FeedRanking}
\]

Reaction decoration remains excluded from Feed Publication items as in Feed v0.1.

---

## 14. AF1 — Personalized Ranking Is a Total Order

The complete v2 order is:

\[
\boxed{
Order_{v2}(i)
=
(
Score(i)\downarrow,
ChronologicalKey_{v1}(i)
)
}
\]

The v1 chronological comparator is reused directly:

```text
1. personalized total_points DESC
2. recorded_at DESC
3. global_offset DESC
4. feed_item_id in the exact v0.1 deterministic direction
```

Implementation MUST call the existing v0.1 comparator for the tie rather than duplicating a second approximation.

---

## 15. AF2 — Equal Personalization Contribution Degenerates to v0.1

Define:

\[
PersonalizationDelta(i)=S(i)+N(i)
\]

If every candidate has the same `PersonalizationDelta`, then monotonic recency plus the v1 tie comparator MUST produce the same item order as Feed v0.1:

\[
\boxed{
\forall i,PersonalizationDelta(i)=c
\Rightarrow
Order_{v2}=Order_{v1}
}
\]

This is a backward-compatibility invariant.

---

## 16. AF3 — Fixed-Point Arithmetic

All score components and totals are integers. A score response has the machine shape:

```json
{
  "recency_points": 4000,
  "source_points": 3000,
  "novelty_points": 1000,
  "total_points": 8000
}
```

No hidden fractional contribution exists.

---

## 17. AF4 — One Ranking Reference Time per Snapshot

The first page obtains a `ranking_reference_time` from a trusted server/service clock.

The client does not supply an arbitrary reference time.

Every item in that snapshot uses the exact same reference instant.

Pagination MUST reuse the reference time pinned into the cursor/snapshot and MUST NOT call `now()` again for page 2.

---

## 18. AF5 — Ranking Reference Time Is Part of Snapshot Identity

The personalized snapshot material includes:

```text
algorithm_ref
projection_version
ranking_reference_time
subject_actor_id
viewer identity/scope
viewer-filtered source_graph
final scored item projections
```

It SHALL NOT hash raw hidden canonical rows, raw Preference tables, or raw Consumption tables.

Only eligible visible effects are represented through the final filtered/scored items.

---

## 19. AF6 — Deterministic Replay Contract

\[
\boxed{
\begin{aligned}
&SameVisibleInputs\\
+&SameEligiblePreferences\\
+&SameEligibleConsumption\\
+&SameAlgorithmVersion\\
+&SameRankingReferenceTime
\end{aligned}
\Rightarrow
\begin{aligned}
&SameScores\\
+&SameReasons\\
+&SameOrdering\\
+&SameSnapshotRef\\
+&SamePaginationBoundaries
\end{aligned}
}
\]

No wall-clock reads are allowed after the ranking reference time has been pinned.

---

## 20. AF7 — Explanations Must Reconcile Exactly to the Score

Each scored item contains explicit score reasons.

Example:

```json
{
  "score": {
    "recency_points": 4000,
    "source_points": 3000,
    "novelty_points": 1000,
    "total_points": 8000
  },
  "ranking_reasons": [
    {"type":"recent_24h","component":"recency","points":4000},
    {"type":"subscribed_actor","component":"source","points":3000},
    {"type":"not_seen_before","component":"novelty","points":1000}
  ]
}
```

The contract is:

\[
\boxed{TotalScore=\sum ReasonPoints}
\]

There are no hidden score components and no explanation reason without a corresponding numeric contribution.

---

## 21. AF8 — Tie-Break Keys Are Not Preference Signals

`recorded_at`, `global_offset`, and `feed_item_id` are deterministic ordering discriminators only.

\[
\boxed{TieBreakKey\neq PreferenceSignal}
\]

The stable ID direction carries no semantic value.

---

## 22. Hard Preference Filter Precedes Scoring

No suppressed item is scored.

This includes:

```text
dismiss_feed_item
not_interested_publication
mute_actor
```

`bookmark_publication` is deliberately not a filter and not a scoring signal in v0.2.

This ordering guarantees that explicit owner directives dominate weak operational observations.

---

## 23. Eligible Consumption Is Read After Candidate Visibility

The scoring layer may query Consumption only for an item that has already survived:

```text
viewer-safe source resolution
→ viewer-safe candidate projection
→ owner hard Preference filter
```

It MUST NOT scan all Consumption rows to discover candidate targets.

\[
\boxed{Consumption\not\rightarrow CandidateExpansion}
\]

---

## 24. Representative Fallback

If `viewer_actor_id != subject_actor_id` but Feed read authority is valid through explicit representation, v0.2 returns the existing chronological Feed v0.1 projection.

It does not partially apply A's private Preference or Consumption.

The fallback response MUST NOT disclose whether private personalization state exists.

The effective `algorithm_ref` for the fallback remains:

```text
trellis-feed:chronological:v1
```

so v1 cursor/snapshot semantics remain intact.

---

## 25. Explicit Chronological Fallback Remains Available

The v0.1 Home Feed builder/read surface remains supported as the canonical fallback path.

Algorithmic Feed v0.2 is additive; it does not delete or rewrite Feed v0.1.

If Consumption State has expired or been deleted, v0.2 remains available and simply treats affected visible items as `unseen`.

An arbitrary scorer/runtime error MUST NOT be silently swallowed as chronological success; operational fallback must be explicit at the caller/product boundary rather than masking implementation defects.

---

## 26. Snapshot and Cursor v2

A v2 cursor carries:

```json
{
  "algorithm_ref": "trellis-feed:personalized:v2",
  "snapshot_ref": "...",
  "ranking_reference_time": "...",
  "last_total_points": 8000,
  "last_recorded_at": "...",
  "last_global_offset": 412,
  "last_item_id": "feed:publication:pub:P"
}
```

A cursor is valid only when:

```text
algorithm_ref matches
snapshot_ref matches
ranking_reference_time matches
last item score/order key matches
```

Visible-state changes that alter filtered/scored items cause:

```text
FEED_SNAPSHOT_CHANGED
```

Hidden-only changes do not.

---

## 27. No Read-Side Mutation

Building, scoring, paginating, or rendering Algorithmic Feed v0.2 MUST NOT write:

```text
canonical_events
command_receipts
preferences_current
consumption_state
notifications_current
```

In particular:

\[
FetchAlgorithmicFeed\not\Rightarrow Seen
\]

Actual Consumption instrumentation remains a separate explicit operational write path.

---

## 28. HTML / JSON and Action Hints

Algorithmic Feed may reuse the existing Feed presentation adapters after scoring/pagination.

Both machine and human surfaces consume the same filtered/scored Feed object.

\[
\boxed{VisibleFacts(HTML)=VisibleFacts(JSON)}
\]

Feed action hints remain advisory and do not derive authority from score, reason, Preference, or Consumption.

---

## 29. Non-Signals

v0.2 explicitly does not use:

```text
Reaction type/count
Notification receipt/ack
bookmark as affinity
Profile bio text
Community size
Discovery score
Trust score
Runtime/model/provider identity
AI Board activity
Dwell/scroll/hover telemetry
```

No semantic embedding or LLM inference is present in v0.2.

---

## 30. Algorithmic Feed Invariants

### AF1

\[
\boxed{RankingOrder=ScoreDESC\circ ChronologicalComparator_{v1}}
\]

### AF2

\[
\boxed{EqualPersonalizationDelta\Rightarrow V2Order=V1Order}
\]

### AF3

\[
\boxed{RankingScore\text{ uses versioned deterministic integer arithmetic}}
\]

### AF4

\[
\boxed{OneSnapshot\Rightarrow OneRankingReferenceTime}
\]

### AF5

\[
\boxed{RankingReferenceTime\subset SnapshotIdentity}
\]

### AF6

\[
\boxed{SameEligibleInputs\Rightarrow SameScoresReasonsOrderSnapshotPagination}
\]

### AF7

\[
\boxed{TotalScore=\sum ExplainableReasonPoints}
\]

### AF8

\[
\boxed{TieBreakKey\neq PreferenceSignal}
\]

### AF9

Let `VisibleCandidatesV1PrePreference` mean the viewer-safe Publication/Activity candidates produced by the v0.1 source graph and collectors before owner Preference suppression. Then:

\[
\boxed{ScoredCandidates_{v2}=HardPreferenceFilter(VisibleCandidatesV1PrePreference)}
\]

v0.2 does not add a candidate source and does not resurrect a hard-filtered item.

### AF10

\[
\boxed{HardPreferenceFilter\text{ occurs before scoring}}
\]

### AF11

\[
\boxed{ConsumptionSignal\text{ is exact-item weak evidence only}}
\]

### AF12

\[
\boxed{Reaction,Notification,Bookmark\not\Rightarrow RankingSignal}
\]

### AF13

\[
\boxed{RepresentativeView\Rightarrow ChronologicalV1Fallback}
\]

### AF14

\[
\boxed{LossOrExpiry(ConsumptionState)\not\Rightarrow Loss(FeedAvailability)}
\]

### AF15

\[
\boxed{AlgorithmicFeedRead\not\rightarrow CanonicalOrOperationalMutation}
\]

### AF16

\[
\boxed{InvisibleOrIneligibleFact\not\Rightarrow RankingSignal}
\]

### AF17

\[
\boxed{CommunityFeed_{v0.2}=CommunityFeed_{chronological:v1}}
\]

---

## 31. Acceptance Vertical Slice

Create:

```text
Actors: A, B, C, X
Community: C1
```

Visible source graph for A:

```text
A subscribes_to B
A follows C
A member_of C1
```

Create Publications with controlled canonical creation times:

```text
Pself  by A
Psub   by B
Pfollow by C
Pcomm  by B in C1
```

and at least one allowlisted social activity.

For self-view `viewer=A`:

1. v0.1 candidate roots and v0.2 pre-preference candidate roots MUST be identical.
2. Add `dismiss_feed_item(Pcomm)`; Pcomm MUST be absent before scoring and have no score record.
3. Mark `Pfollow` seen; its novelty becomes `-500` only for the exact item.
4. Mark `Psub` opened; its novelty becomes `-1500` only for the exact item.
5. `bookmark(Pself)` MUST NOT change any score or order.
6. Reaction create/change/withdraw and Notification issue/ack MUST NOT change any v2 score, reason, order, or snapshot.
7. Add hidden social facts and retained Consumption rows for hidden targets; result MUST remain deep-equal.
8. For two equal-score items, v2 order MUST exactly equal `compareFeedItemsDesc` from v0.1.
9. If all candidates have equal `S+N`, v2 order MUST exactly equal v0.1 order.
10. Page 1 cursor MUST pin `ranking_reference_time`; page 2 reuses it and does not invoke a new clock time.
11. Visible Preference or eligible Consumption changes MUST invalidate the personalized snapshot/cursor.
12. Fetching/scoring/paginating MUST leave canonical event count, command receipt count, Preference rows, and Consumption rows unchanged.

For representative `viewer=B`, subject `A`:

```text
Algorithmic Feed request
→ effective chronological v1 Feed
→ no A Preference / Consumption effects
→ algorithm_ref = trellis-feed:chronological:v1
```

Community Feed remains byte/structure-equivalent to the v0.1 chronological Community Feed for the same state/viewer.

---

## 32. Freeze Definition

Trellis Algorithmic Feed v0.2 is frozen as:

\[
\boxed{
\text{Visible First}
+
\text{Hard Preference First}
+
\text{Consumption Is Weak}
+
\text{Fixed-Point Score}
+
\text{Explainable Reasons}
+
\text{Total Order}
+
\text{Replayable Snapshot}
+
\text{Chronological Fallback}
}
\]

v0.2 deliberately stops before cross-content affinity, semantic embeddings, learned recommendation, engagement optimization, or LLM ranking.
