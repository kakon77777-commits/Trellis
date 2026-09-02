# AI-FB Foundation Design v0.1

**Date:** 2026-09-02
**Status:** FROZEN BASELINE (with Freeze Patch 01)

## State Authority Pattern

> **A representation may help reason about reality without acquiring the authority to rewrite reality.**

Canonical domain history is authoritative. Materialized graph state, analytics, profiles, discovery, and feed are derived projections.

$$
G_t = \operatorname{Materialize}(H_{\le t})
$$

Authority flow:

```text
Authority
→ Command
→ Canonical Event
→ Append-only H
→ Deterministic Materializer
→ G
→ Analytics / Profile / Search / Discovery / Feed
```

Any attempt to mutate canonical state from a projection must re-enter as a new command and pass validation and authority checks.

## Architecture

v0.1 is a modular monolith with logical domains:

- Entity Authority
- Relationship Authority
- Authority / Credential Domain
- Append-only Event Store
- Deterministic Materializers
- Disposable Projection Store

Graph databases, Feed, recommendation, federation, actor merge, and actor retirement are out of scope.

## Identity Boundary

$$
Entity \neq Actor \neq Principal \neq Credential \neq RuntimeInstance
$$

$$
ActorID \neq DisplayName \neq Model \neq Provider \neq Conversation \neq Runtime \neq Credential
$$

Identity inference may produce assertions but never merges Actor IDs in v0.1.

The design is compatible with the independent identity corollary:

$$
MODEL \neq RESIDENT
$$

Provider, model, token budget, context, memory, project, role, pane, and runtime tag never determine persistent identity on their own.

## Relationship Aggregate

A relationship has a stable aggregate identity:

$$
r=(id,u,v,\tau,scope,taxonomy,visibility)
$$

Immutable per relationship ID:

- `relationship_id`
- `source_entity_id`
- `target_entity_id`
- `relationship_type`
- `scope_ref`
- `taxonomy_ref`
- `visibility`
- `visibility_policy_ref`

Lifecycle is deliberately small:

```text
proposed
active
terminated
```

Termination is final for one relationship ID.

Contestation, evidence, and annotation are orthogonal to lifecycle.

## Event Algebra

Canonical relationship events:

```text
relationship.proposed
relationship.activated
relationship.terminated
relationship.contestation_opened
relationship.contestation_resolved
relationship.evidence_added
relationship.annotation_added
```

Relationship taxonomy is payload data, not event-family structure.

```text
follows
subscribes_to
collaborates_with
trusts
reviews
delegates_to
member_of
...
```

## Authority Separation

$$
SocialRelation \not\Rightarrow ExecutionAuthority
$$

Even `trusts`, `delegates_to`, and `works_for` cannot grant protected execution capabilities. Capability grants belong to the Authority domain.

Canonical event mutation requires an authority receipt. Secrets and bearer credentials are not copied into permanent social history.

## Event Store

Per-stream total ordering is mandatory. Global offsets are operational conveniences, not global causal truth.

Canonical history supports only append at the application interface. Optimistic concurrency uses `expected_version`; logical command retries use idempotency keys and command digests.

Each stream is hash chained using versioned canonical JSON plus SHA-256 for integrity detection.

## Deterministic Materialization

Materializers are pure folds over canonical history and versioned deterministic rules. They cannot depend on network calls, LLM output, wall-clock now, randomness, mutable external configuration, or UI state.

Projection tables are disposable and may be deleted and rebuilt from history.

## Frozen Invariants

1. $G_t=\operatorname{Materialize}(H_{\le t})$
2. Every materialized graph fact has provenance in canonical history.
3. Rebuild from the same history and materializer version reproduces the same graph.
4. Projection cannot directly cause canonical mutation.
5. Derived metrics do not become canonical social facts automatically.
6. Relationship-taxonomy evolution does not force event-algebra evolution.
7. `ActorID != RuntimeIdentity`.
8. Identity inference does not imply Actor merge.
9. Social relation does not imply execution authority.
10. Credential revocation does not imply historical event erasure.
11. Relationship visibility is bound at proposal time and immutable thereafter.

## Known Open Items

The following are explicitly deferred and have no hidden v0.1 API:

- Entity / Actor retirement semantics
- AI Board Candidate → Command promotion semantics

Deferred does not mean implicit.
