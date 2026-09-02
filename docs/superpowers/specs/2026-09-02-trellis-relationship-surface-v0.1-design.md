# Trellis Relationship Surface v0.1 Design

**Date:** 2026-09-02
**Status:** FROZEN BASELINE
**Canonical repo:** `kakon77777-commits/Trellis`
**Depends on:** Foundation v0.1 + Actor Profile v0.1

## Core contract

The Relationship Surface is a viewer-relative projection of one canonical relationship stream plus current materialized state:

$$
RelationshipSurface_{r,v}(t)=\Pi_{relationship}(H_r,G_t,Policy_t,r,v).
$$

It never becomes a second relationship authority. All writes continue through the existing Foundation relationship command service and append-only EventStore.

## Canonical event algebra

No new relationship event types are introduced. v0.1 uses only:

- `relationship.proposed`
- `relationship.activated`
- `relationship.terminated`
- `relationship.contestation_opened`
- `relationship.contestation_resolved`
- `relationship.evidence_added`
- `relationship.annotation_added`

Product action names are adapters, not canonical event vocabulary.

## Stable relationship identity

`relationship_id` is the stable page/address key. Relationship type, source, target, scope, taxonomy, and visibility remain immutable Foundation facts. A terminated relationship remains historically addressable and cannot reactivate under the same ID.

## Read visibility

Relationship visibility governs the disclosure ceiling for the entire relationship detail/history surface. If a viewer cannot read the relationship, they learn nothing about its history, evidence count, contestations, annotations, last activity, or event count.

Current disclosure policy may narrow exposure but never widen canonical visibility.

## Detail shape

A viewer-safe machine projection contains:

- relationship ID
- source/target actor references
- immutable relationship type/scope/visibility
- lifecycle and termination reason
- viewer-safe history
- viewer-safe evidence/contestations/annotations
- advisory `available_actions`
- `execution_authority.implied_by_relationship = false`
- viewer scope and projection version

Authority receipts are exposed only through safe summaries; secrets and credential material never cross the read boundary.

## Evidence and contestation

Evidence references are displayed as references only; v0.1 does not automatically fetch or interpret external resources. Contestation remains orthogonal to lifecycle. Annotation remains contextual history and never mutates lifecycle.

## Available actions

`available_actions` is advisory UI/read-model data only:

$$
AvailableActionHint\neq AuthorizationGrant.
$$

Every actual command re-runs canonical validation, current stream fold, authority evaluation, optimistic concurrency, and append logic. A stale page can never authorize a write.

## Pending and relationship index

Viewer-relative actor relationship index categories:

- `active`
- `pending_incoming`
- `pending_outgoing`
- `historical_terminated`

All lists and counts are computed only after visibility filtering. Hidden relationships produce no aggregate signal.

## Human and machine surfaces

The same filtered projection feeds HTML and JSON. Public facts must remain semantically identical across representations.

## AI Board boundary

Trellis and AI Board retain separate canonical histories. AI Board candidate-to-command promotion remains deferred. Relationship Surface must not import AI Board ledger events as Trellis relationship history.

## Frozen surface invariants

- R1: Relationship Surface is projection only.
- R2: Invisible relationship implies no visible history signal.
- R3: Available action hint is not authorization grant.
- R4: Social relation does not imply execution authority.
- R5: Relationship history is a projection of `H_r`.
- R6: Terminated relationships remain historically addressable.
- R7: Terminated relationship IDs cannot reactivate.
- R8: Visible aggregates are computed only from visible relationships.
- R9: Visible HTML facts equal visible JSON facts.
- R10: Surface mutations use the existing Foundation command path.

## Non-goals

Community, Feed, recommendation, private messaging, presence, notifications, LLM relationship summary, global relationship search, Actor retirement, relationship type/visibility/scope editing, AI Board auto-promotion, and execution capability editing are out of scope.

## Acceptance vertical slice

Register Actors A/B, create Profiles, propose `collaborates_with`, show B a viewer-safe incoming proposal, activate it, render active detail, add evidence, open/resolve contestation, terminate the relationship, and keep the terminated detail addressable. Delete disposable Profile and relationship projections, rebuild from canonical history, and require equivalent Profile, relationship index, and relationship detail output for the same viewer context/projection version. Event hash chains must remain valid.
