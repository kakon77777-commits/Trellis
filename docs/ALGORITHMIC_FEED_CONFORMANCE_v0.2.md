# Trellis Algorithmic Feed v0.2 Conformance

**Spec:** `docs/superpowers/specs/2026-09-03-trellis-algorithmic-feed-v0.2-design.md`
**Implementation plan:** `docs/superpowers/plans/2026-09-03-trellis-algorithmic-feed-v0.2.md`
**State class:** `derived_projection`
**Foundation registry:** `trellis-foundation-cross-domain:0.2`
**Algorithm:** `trellis-feed:personalized:v2`
**Projection:** `trellis-feed:0.2`

## Architecture boundary

Algorithmic Feed v0.2 does not create a new candidate universe. Its input is the exact Feed v0.1 viewer-safe source graph and existing Publication / Social Activity collectors. Owner Preference hard filtering occurs before any score is computed. Exact-item Consumption is consulted only for candidates that survived both visibility and Preference filtering.

```text
Feed v0.1 viewer-safe source graph
→ Feed v0.1 visible candidate collectors
→ owner-only hard Preference filter
→ exact-item eligible Consumption lookup
→ deterministic integer score
→ score DESC
→ Feed v0.1 chronological comparator
→ v2 snapshot / cursor
```

Representative reads bypass owner-private personalization and delegate to the existing chronological v1 path. Community Feed remains chronological v1.

## AF-series executable mapping

| Invariant | Executable evidence |
| --- | --- |
| AF1 — score DESC then exact v1 chronological comparator | `test/algorithmic-feed-score.test.js`, `test/algorithmic-feed-conformance.test.js` |
| AF2 — equal `S+N` degenerates to v1 order | `test/algorithmic-feed-cross-domain.test.js`, final conformance |
| AF3 — versioned deterministic integer arithmetic | `test/algorithmic-feed-score.test.js`, `test/algorithmic-feed-home.test.js`, final conformance |
| AF4 — one ranking reference time per snapshot | `test/algorithmic-feed-cursor.test.js`, `test/algorithmic-feed-surface.test.js` |
| AF5 — ranking reference time is part of snapshot/cursor identity | `test/algorithmic-feed-cursor.test.js` |
| AF6 — same eligible inputs + same time replay identically | `test/algorithmic-feed-cross-domain.test.js`, final conformance |
| AF7 — score equals sum of reason points | score/home/final conformance tests |
| AF8 — chronological tie-break fields are ordering discriminators, not score reasons | score/final conformance tests |
| AF9 — scored candidates equal hard-filtered v1 visible pre-Preference candidates | `test/algorithmic-feed-home.test.js`, final conformance |
| AF10 — hard Preference suppression occurs before scoring | same tests; suppressed items have no score records |
| AF11 — Consumption is exact-item weak evidence only | `test/algorithmic-feed-consumption.test.js`, home/final conformance |
| AF12 — Reaction, Notification, bookmark are non-signals | `test/algorithmic-feed-cross-domain.test.js`, home tests |
| AF13 — representative reads fall back to chronological v1 | `test/algorithmic-feed-surface.test.js`, cross-domain/final conformance |
| AF14 — Consumption loss or expiry cannot remove Feed availability | cross-domain test plus expired-row final conformance |
| AF15 — reads do not mutate canonical or operational state | surface/final conformance state-count tests |
| AF16 — invisible or ineligible facts produce no ranking signal | cross-domain hidden source + hidden Consumption tests; inherited X3 |
| AF17 — Community Feed remains chronological v1 | `test/algorithmic-feed-cross-domain.test.js` and existing Community Feed tests |

## Deterministic scoring policy

v0.2 uses only integer points:

```text
Score = recency_points + source_points + novelty_points
```

Recency is bucketed against one trusted `ranking_reference_time`. Source strength is a single highest-precedence reason derived only from the viewer-filtered v1 `source_graph`. Novelty is an exact-item Consumption signal.

No floating-point decay, randomness, model inference, embedding similarity, Reaction count/type, Notification state, bookmark affinity, Profile text, Discovery score, Trust score, or runtime/provider identity participates in the score.

Every scored item carries exactly three machine-checkable ranking reasons:

```text
recency
source
novelty
```

and:

```text
total_points == sum(ranking_reasons[*].points)
```

## Retention boundary

Consumption State is operational and retention-bounded. v0.2 does not rely on a purge job having already deleted expired rows. `consumptionForFeedItem()` evaluates `expires_at` against the snapshot's pinned `ranking_reference_time`; an expired-but-not-purged row is treated exactly like an absent row (`not_seen_before`).

This is the AF14/K-series bridge:

```text
expired Consumption row
→ no exact-item Consumption contribution
→ Feed remains available
→ item is treated as unseen
```

## Server-controlled ranking time

The public personalized read service rejects both:

```text
rankingReferenceTime
ranking_reference_time
```

as caller-supplied inputs. Page 1 obtains time from the trusted service clock. Page 2 decodes and reuses the time already pinned in the v2 cursor; it does not call `now()` again.

## Snapshot and pagination

The v2 snapshot hashes only eligible viewer-relative material:

```text
algorithm_ref
projection_version
ranking_reference_time
subject/viewer identity and scope
viewer-filtered source_graph
final scored item projections
```

It does not hash raw hidden graph rows, raw Preference tables, or raw Consumption tables.

A v2 cursor carries:

```text
algorithm_ref
snapshot_ref
ranking_reference_time
last_total_points
last_recorded_at
last_global_offset
last_item_id
```

The last item match therefore covers the personalized score and the complete Feed v0.1 chronological total-order key.

## Foundation inheritance

The existing `feed` registry entry is unchanged:

```text
state_class = derived_projection
effective contracts = X1, X2, X3
```

Algorithmic Feed v0.2 remains a derived projection and does not create canonical or operational authority.

## Explicit non-signals

The following changes are executable-tested to leave v2 score, reasons, order, and snapshot unchanged when all eligible Feed inputs are otherwise unchanged:

```text
Reaction create/change/withdraw
Notification issue/ack
bookmark_publication
hidden source relationship
Consumption for a hidden/noncandidate target
owner-private Preference/Consumption during representative read
```

Loss of eligible Consumption may change exact-item novelty from seen/opened to unseen, but it cannot make Feed unavailable or expand the candidate universe.

## Release gate

`feed/*.js` already covers all v2 modules in `npm run check`.

Final release verification:

```text
npm test
npm run check
git diff --check consumption/v0.1...HEAD
git status --short
```
