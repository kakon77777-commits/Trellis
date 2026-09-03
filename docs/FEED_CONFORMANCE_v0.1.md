# Trellis Feed v0.1 Conformance Gate

**Date:** 2026-09-03
**Status:** RELEASE GATE
**Spec:** `docs/superpowers/specs/2026-09-03-trellis-feed-v0.1-design.md`
**Foundation contract:** X1-X3

Feed v0.1 is a fan-out-on-read derived projection. It has no canonical Feed event stream and no authoritative Feed table.

## Inherited Foundation Contract

Machine-readable inheritance must declare:

```text
feed -> X1, X2, X3
```

Feed specializations:

- F3/F4/F12 specialize X3 Viewer Noninterference.
- F8 specializes X2 Authority Separation.
- All canonical input visibility remains bounded by X1.

## F1-F12 Mapping

| Invariant | Executable evidence |
|---|---|
| F1 `Feed = DerivedProjection` | `feed-conformance.test.js` verifies reads append zero canonical events and no mutation exports exist. |
| F2 `Publication != SocialActivity` | Publication and Activity collectors emit distinct `item_type` values and independent source refs. |
| F3 Candidate generation after visibility projection | `feed-source-graph.test.js`, `feed-activities.test.js`, and `feed-home.test.js` filter source relations before candidates. |
| F4 Invisible fact produces no Feed signal | `feed-home.test.js` and `feed-conformance.test.js` require deep equality after hidden-only changes. |
| F5 Discovery affinity does not imply Feed subscription | Feed source graph only accepts `follows`, `subscribes_to`, `member_of`; no Discovery module is consulted. |
| F6 Edit does not resurface | `feed-publications.test.js` keeps `publication.created` sort metadata across revision. |
| F7 Withdrawn Publication absent from Current Feed | `feed-publications.test.js` and conformance acceptance flow. |
| F8 Feed action hint is not authorization | `feed-surface.test.js` exposes navigation/product hints only; no canonical command is exported. |
| F9 Same visible state + same algorithm gives same order | `feed-cursor.test.js`, `feed-home.test.js`. |
| F10 Feed cache is not canonical state | v0.1 creates no Feed storage table; Feed is recomputed fan-out-on-read. |
| F11 Feed Subject != Viewer | `feed-context.test.js` tests self and representative viewers without subject substitution. |
| F12 Content source relation must itself be viewer-visible | `feed-source-graph.test.js` and full acceptance vector deny a source relationship through current disclosure policy. |

## Social Activity Allowlist

Only:

```text
member_of relationship.activated -> community_joined
collaborates_with relationship.activated -> collaboration_started
```

No follow, termination, contestation, evidence, profile edit, or Publication revision event becomes an activity item in v0.1.

## Deterministic Ordering

Algorithm:

```text
trellis-feed:chronological:v1
```

Descending key:

```text
recorded_at
global_offset
stable feed_item_id
```

Publication revisions alter current rendered content but not the creation-time sort key.

## Snapshot / Cursor Gate

Feed snapshot and cursor contain only viewer-visible semantic inputs plus subject/viewer/algorithm/projection identity. Hidden-only changes must not alter snapshot or invalidate a cursor.

Visible snapshot changes cause:

```text
FEED_SNAPSHOT_CHANGED
```

## Projection Rebuild Gate

The conformance suite destroys disposable Relationship, Actor Profile, and Publication projections, rebuilds them from canonical histories, then requires identical Feed output for the same subject/viewer/algorithm.

## Explicit Non-Goals

Feed v0.1 does not implement:

```text
canonical Feed events
persistent Feed table
fan-out-on-write
engagement ranking
ML/LLM ranking
reactions/likes
notifications
read/seen state
persistent dismissals
AI Board message ingestion
```

## Release Command

A release candidate is valid only when all pass on final HEAD:

```bash
npm test
npm run check
git diff --check publication/v0.1...HEAD
git status --short
```

The test suite must report zero failures and the working tree must be clean.
