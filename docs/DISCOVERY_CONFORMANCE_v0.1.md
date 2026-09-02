# Trellis Discovery v0.1 Conformance Gate

Discovery v0.1 is a derived, viewer-filtered, deterministic and explainable Entity-discovery layer. It has no canonical social mutation authority.

## Frozen invariants and executable coverage

| Invariant | Requirement | Executable evidence |
|---|---|---|
| D1 | `Discovery = DerivedProjection` | `D1-D12 vertical slice...` asserts canonical event count is unchanged by Discovery reads. |
| D2 | Candidate generation occurs after viewer visibility projection | `discovery-visible-graph.test.js` plus hidden-fact conformance test. |
| D3 | Invisible facts produce zero Discovery signal | `hidden Trellis facts have zero Discovery influence including snapshot ref`. |
| D4 | Discovery score is not a canonical social fact | Discovery modules expose no canonical append path; reads do not change `canonical_events`. |
| D5 | Discovery candidate is not endorsement | Surface uses `Related Actors` / `Related Communities` and exposes `implied_by_discovery_read=false`. |
| D6 | Explanations reference viewer-visible facts only | `assertReasonsVisible()` verifies every Actor, Community and relationship reference exists in the visible snapshot. |
| D7 | Same state + subject + viewer + algorithm gives same ranking | deterministic recompute test and cursor stability tests. |
| D8 | Runtime/model metadata is not Discovery affinity | runtime/model mutation of candidate presentation does not change score or reasons. |
| D9 | Discovery cannot automatically mutate social state | production-module negative export/import test. |
| D10 | Community discoverability bounds Community Discovery | `discovery-communities.test.js` excludes unlisted/private communities. |
| D11 | Discovery subject is distinct from viewer | `discovery-context.test.js` and representative vertical slice keep `subject_actor_id` unchanged. |
| D12 | Discovery read authority does not imply social mutation authority | context authorization is read-only and Discovery exposes no Foundation mutation command. |

## Required release verification

```bash
npm test
npm run check
git diff --check community/v0.1...HEAD
```

The full suite must pass twice from the final candidate tree before release sealing.

## Hidden-fact invariance

For the same subject, viewer and algorithm version:

$$
HiddenFacts_{s,v}\text{ changed}
\land
VisibleFacts_{s,v}\text{ unchanged}
\Rightarrow
Discovery_{s,v}\text{ unchanged}
$$

This equality covers candidate existence, scores, ordering, explanations, visible aggregate values and `snapshot_ref`.

## Non-goals preserved

The conformance gate does not introduce Search, Feed, LLM/embedding ranking, trust/reputation scoring, persistent dismissals, blocking semantics, AI Board ranking signals, or automatic relationship/membership creation.
