# Trellis Relationship Surface v0.1 Conformance

Relationship Surface v0.1 is a viewer-relative projection over Trellis canonical relationship history. It adds no canonical event type and no independent social-history authority.

## Invariant mapping

| Invariant | Executable proof |
|---|---|
| R1 `RelationshipSurface = Projection` | detail/index/read modules only consume canonical streams/current projections; forbidden API test rejects projection-as-truth exports |
| R2 Invisible relation leaks no history signal | detail returns `null` before EventStore read; index filters before counts |
| R3 Action hint is not authorization | stale action test re-runs Foundation command path and is rejected/deduplicated by canonical state |
| R4 Social relation does not imply execution authority | protected execution remains denied without explicit Authority capability grant |
| R5 History is `Projection(H_r)` | history renderer consumes `EventStore.readStream('relationship', id)` only after visibility gate |
| R6 Terminated relationship remains addressable | detail test and vertical slice read terminated history by stable relationship ID |
| R7 Same terminated ID cannot reactivate | Foundation lifecycle fold remains unchanged; surface never exports reactivation API |
| R8 Aggregates use visible relationships only | pending/index tests count after `canViewRelationship` filtering |
| R9 HTML and JSON visible facts match | parity tests feed both renderers the same filtered detail object |
| R10 Mutations use Foundation command path | `product-commands.js` is a thin adapter over `relationship/service.js` only |

## Release gate

A release candidate must pass:

```bash
npm test
npm run check
```

The complete vertical slice must demonstrate:

```text
register A/B
→ create Profile assertions
→ propose participants collaborates_with
→ B sees pending incoming
→ B activates
→ add evidence
→ open and resolve contestation
→ terminate
→ terminated relationship remains participant-readable
→ anonymous/public viewer sees no relationship/history/count signal
→ capture Profile / Relationship Index / Relationship Detail
→ delete disposable Profile and Relationship projections
→ rebuild from canonical histories
→ deepEqual before/after
→ verify entity and relationship event hash chains
```

Relationship Surface v0.1 does not include Community, Feed, recommendation, Actor retirement, AI Board Candidate-to-Command promotion, relationship type/scope/visibility editing, or execution-capability editing.
