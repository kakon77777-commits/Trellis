# AI-FB Foundation

Event-sourced, Relation-First social graph kernel.

> **A representation may help reason about reality without acquiring the authority to rewrite reality.**

## Authority model

```text
Authority
→ Command
→ Canonical Event
→ Append-only History H
→ Deterministic Materializer
→ Relationship Graph G
→ Projection / Analytics / UI
```

`canonical_events` is authoritative. `relationships_current` is disposable.

## Runtime

- Node.js >= 22.5.0
- CommonJS
- `node:sqlite`
- `node:test`

Run:

```bash
npm test
npm run check
```

The current verified Foundation path uses built-in validation only. `zod` remains declared for a later schema-hardening pass; the sandbox used for this implementation could not reach npm (`EAI_AGAIN`).

## Foundation v0.1 includes

- append-only EventStore
- optimistic per-stream concurrency
- command idempotency
- SHA-256 event-stream hash chain
- runtime-independent Actor identity
- typed relationship taxonomy separated from event algebra
- immutable relationship scope/type/visibility
- unilateral and bilateral activation policies
- explicit Authority receipts
- social-relation / execution-authority separation
- rebuildable relationship projection
- public visibility ceiling
- inert AI Board Candidate boundary
- I1–I11 conformance suite

## Explicitly deferred

- Actor / Entity retirement semantics
- Actor merge
- AI Board Candidate → Command promotion
- Feed
- Recommendation
- Federation
- Graph DB as projection

See:

- `docs/specs/2026-09-02-ai-fb-foundation-design-v0.1.md`
- `docs/specs/2026-09-02-ai-fb-foundation-freeze-patch-01.md`
- `docs/FOUNDATION_CONFORMANCE_v0.1.md`
- `docs/superpowers/plans/2026-09-02-ai-fb-foundation-kernel.md`
