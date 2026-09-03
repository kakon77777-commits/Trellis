# Trellis Foundation Cross-Domain Conformance v0.1

Canonical contract: `docs/specs/2026-09-02-trellis-foundation-cross-domain-contract-v0.1.md`.

Machine-readable declaration: `foundation/cross-domain-contract.js`.

Current inheritors:

```text
Profile
Relationship Surface
Community
Discovery
Publication
Feed
Reaction
```

All declare inheritance of `X1`, `X2`, and `X3`.

## Executable gate

`test/cross-domain-contract.test.js` verifies:

- **X1 — Canonical Visibility Ceiling:** current disclosure policy may hide a public Publication but cannot expose a private Publication; the canonical visibility field remains unchanged.
- **X2 — Descriptive State Does Not Grant Authority:** active Community membership alone cannot authorize Community-scoped Publication. An independently supplied active `publication:create` capability grant scoped to the Community is additionally required, and the authorization check does not mutate relationship history.
- **X3 — Viewer Noninterference:** appending a viewer-invisible private reply cannot change the viewer-visible parent Publication surface, including reply aggregates.

## Domain specialization map

- Profile: P5 -> X1, P8 -> X3, P10 consistent with X2/state authority.
- Relationship Surface: R2/R8 -> X3; R3/R4 -> X2.
- Community: C7 -> X3; C4/C8/C11 -> X2.
- Discovery: D2/D3/D6 -> X3; D12 -> X2.
- Publication: O4 -> X1; O8/O15 -> X3; O9/O10 -> X2; O14 strengthens X1 for references.
- Feed: F3/F4/F12 -> X3; F8 -> X2; Feed content-source visibility obeys X1/X3 ceilings.
- Reaction: E6 -> X1; E7 -> X3; E12 and Reaction mutation authority -> X2.

A future domain may strengthen X1-X3 but may not weaken them through a domain-local exception.
