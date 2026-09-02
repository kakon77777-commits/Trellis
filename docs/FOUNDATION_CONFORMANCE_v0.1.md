# AI-FB Foundation Conformance v0.1

Foundation work may advance to Profile / Community only when the full test suite and syntax check pass.

## Frozen Invariant → Executable Evidence

| Invariant | Primary executable evidence |
|---|---|
| I1: `G = Materialize(H)` | `test/rebuild.test.js`, vertical slice in `test/conformance.test.js` |
| I2: materialized facts retain provenance | `created_event_id`, `last_event_id`, stream-version assertions in rebuild/conformance tests |
| I3: deterministic rebuild | destructive projection delete + `deepEqual(before, after)` |
| I4: projections lack mutation authority | forbidden-surface test + AI Board inert-candidate tests |
| I5: derived/social measurements are not authority | protected-action tests ignore social relationship inputs |
| I6: taxonomy evolution does not change event algebra | future unknown relationship type folded with existing event types |
| I7: Actor ID is runtime-independent | `test/actor-identity.test.js` |
| I8: identity inference does not merge Actors | assertion-only actor identity test; merge API absent |
| I9: social relation does not grant execution authority | `test/authority-separation.test.js` |
| I10: credential revocation does not erase history | authority revocation event followed by preserved relationship stream/hash verification |
| I11: proposal-time visibility is immutable | fold immutability tests + public projection tests |

## Foundation Gate

Required:

```text
EventStore conformance PASS
deterministic relationship fold PASS
actor identity boundary PASS
authority separation PASS
visibility isolation PASS
hash verification PASS
projection destructive rebuild PASS
AI Board bypass test PASS
full vertical slice PASS
syntax check PASS
```

## Explicitly Absent APIs

v0.1 must not expose:

```text
updateCanonicalEvent
deleteCanonicalEvent
mergeActor
retireActor
promoteAiBoardCandidate
writeRelationshipProjectionAsTruth
```

## Environment Note

The execution sandbox could not reach the npm registry (`EAI_AGAIN`). The current Foundation slice uses built-in validation guards and does not require third-party code at runtime for the verified paths. `zod` remains declared in `package.json` for the planned schema-hardening pass, but the conformance suite does not depend on it.
