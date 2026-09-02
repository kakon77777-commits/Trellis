# Trellis Relationship Surface v0.1 Design

## Viewer-Relative Persistent Social Relationship Surface

**Date:** 2026-09-02  
**Status:** FROZEN DESIGN BASELINE  
**Canonical Repo:** `kakon77777-commits/Trellis`  
**Depends on:** Foundation v0.1 + Actor Profile v0.1  
**Scope:** Relationship detail, relationship actions, history projection, pending relationships, human/machine surfaces.

---

## 1. Core Definition

Actor Profile answers:

> Who is this Actor, as currently visible to me?

Relationship Surface answers:

> What relationship exists between these actors, how did it reach this state, and which social actions may I attempt now?

The surface is a viewer-relative projection:

$$
RelationshipSurface_{r,v}(t)
=
\Pi_{relationship}(H_r,G_t,Policy_t,r,v)
$$

where $r$ is a stable `relationship_id`, $v$ is the viewer / acting-principal context, $H_r$ is the canonical event stream for that relationship, $G_t$ is the materialized current relationship state, and $Policy_t$ is current read/disclosure policy.

The Relationship Surface is never a second source of relationship truth.

## 2. Existing Event Algebra Remains Canonical

v0.1 introduces no new canonical relationship event families. It continues to use Foundation v0.1:

```text
relationship.proposed
relationship.activated
relationship.terminated
relationship.contestation_opened
relationship.contestation_resolved
relationship.evidence_added
relationship.annotation_added
```

The product layer may expose `Propose`, `Activate / Accept`, `Terminate`, `Contest`, `Resolve Contestation`, `Add Evidence`, and `Add Annotation`, but:

$$
\boxed{ProductActionVocabulary\neq CanonicalEventVocabulary}
$$

Every mutation continues through the existing Foundation command path.

## 3. No Relationship UI Ledger

v0.1 does not create a new canonical `relationship_pages`, `relationship_activity_log`, or `social_history` store. Relationship detail is stream-backed:

```text
canonical relationship stream H_r
+
materialized current relationship state G_t
↓
viewer read policy
↓
Relationship Detail Projection
```

`relationships_current` remains disposable projection state.

## 4. Stable Relationship Identity

The canonical key for every relationship page is `relationship_id`. It is not derived from actor display names, URL slugs, or `(A,B,type)` presentation tuples.

If a relationship terminates and the same actors later create a new relationship of the same type, the new relationship receives a new `relationship_id`.

$$
History\neq CurrentActiveEdge
$$

Terminated relationship history remains independently addressable.

## 5. Immutable Social Meaning

The surface must display but never offer direct editing for Foundation-immutable relationship fields:

```text
source_entity_id
target_entity_id
relationship_type
scope_ref
taxonomy_ref
visibility
```

The following remains permanent:

$$
\boxed{Scope\neq Visibility\neq ExecutionAuthority}
$$

To change relationship type, scope, or visibility, the old relationship must terminate and a new relationship must be proposed.

## 6. Relationship Visibility Governs History Visibility

v0.1 does not invent a second per-event visibility system for relationship history. The relationship's canonical visibility is the disclosure ceiling for the relationship and its relationship-surface history.

If a viewer cannot read the relationship:

$$
Readable(r,v)=false
\Rightarrow
VisibleHistory(r,v)=\varnothing
$$

The viewer must not learn history length, evidence count, contestation count, last activity time, hidden actor IDs, or hidden relationship type from that relationship.

## 7. Current Disclosure Policy Can Only Narrow

Effective exposure remains:

$$
EffectiveExposure_t(r)
=
CanonicalVisibility(r)
\cap
CurrentDisclosurePolicy_t(r)
$$

Current policy may suppress a relationship whose canonical visibility is `public`, but it may never widen `private`, `participants`, or another narrower visibility class into public exposure.

This applies to relationship detail, history, evidence and contestation existence, pending relationship lists, and relationship counts/badges.

## 8. Relationship Detail Projection

The machine-readable projection should contain at least:

```json
{
  "relationship_id": "rel:...",
  "source_actor": {"actor_id": "actor:A", "profile_ref": "/actors/actor:A"},
  "target_actor": {"actor_id": "actor:B", "profile_ref": "/actors/actor:B"},
  "relationship_type": "collaborates_with",
  "scope_ref": "project:X",
  "visibility": "participants",
  "lifecycle": "active",
  "termination_reason": null,
  "history": [],
  "evidence": [],
  "contestations": [],
  "annotations": [],
  "available_actions": [],
  "execution_authority": {"implied_by_relationship": false},
  "viewer_scope": "participant",
  "projection_version": "relationship-surface:0.1"
}
```

All returned content is already viewer-filtered.

## 9. Social Relation Never Implies Execution Permission

The surface must preserve Foundation invariant I9:

$$
\boxed{SocialRelation\not\Rightarrow ExecutionAuthority}
$$

This is especially important for `delegates_to`, `trusts`, and `works_for`. Any actual capability grant remains owned by the Authority Domain.

## 10. History Projection

A visible relationship history item should expose safe domain information only: `event_id`, `event_type`, `actor_id`, `occurred_at`, `recorded_at`, safe domain payload, and safe provenance references.

The surface must not dump access tokens, private credentials, private keys, internal security material, or unfiltered authority receipts.

`occurred_at` remains a domain claim; `recorded_at` remains EventStore authority time.

## 11. Authority Receipt Projection

Canonical events may refer to an `authority_receipt_ref`, but the surface does not expose raw receipt internals. It may expose a safe summary such as decision reference, decision, and policy reference. Credential material remains in the Authority Domain.

## 12. Evidence References Are Not Automatically Fetched

`relationship.evidence_added` may contain an `evidence_ref`. v0.1 treats the reference as a reference only. The surface may display or link to it, but does not automatically fetch external evidence, interpret it with an LLM, verify it, or import external credentials.

## 13. Contestation Is Orthogonal to Lifecycle

The relationship surface may show open and resolved contestations, including safe claims, resolutions, and evidence references. But:

$$
Contestation\neq Lifecycle
$$

A relationship may be `active + contested` or `terminated + historical contestation`. The UI must not render `contested` as a replacement lifecycle state.

## 14. Annotation Has No Mutation Authority

Annotations remain contextual history such as notes, migration notes, historical explanations, and correction explanations.

$$
Annotation\not\Rightarrow LifecycleMutation
$$

The relationship surface gives annotations no extra authority.

## 15. Available Actions Are Advisory Only

The surface may calculate actions such as `Activate`, `Terminate`, `Contest`, `Resolve Contestation`, `Add Evidence`, and `Add Annotation` from current lifecycle, relationship policy, and viewer context.

However:

$$
\boxed{AvailableActionHint\neq AuthorizationGrant}
$$

A displayed action is only an affordance. When submitted, Trellis again performs schema validation, canonical stream read, current-state fold, policy/authority evaluation, optimistic concurrency, and canonical append.

## 16. Product Command Adapters

The surface may provide thin adapters for `ProposeRelationship`, `ActivateRelationship`, `TerminateRelationship`, `OpenContestation`, `ResolveContestation`, `AddEvidence`, and `AddAnnotation`.

All adapters call the existing Foundation relationship service. No surface adapter may write `relationships_current` directly.

## 17. Pending Relationship Projection

v0.1 provides viewer-relative incoming and outgoing pending relationship lists:

$$
Pending_{a,v}
=
\Pi_v\{r\in G_t\mid Lifecycle(r)=proposed\}
$$

Visibility filtering occurs before categorization and before aggregation. Hidden proposal counts, hidden proposer IDs, and hidden relationship types do not leak.

## 18. Actor Relationship Index

Trellis may expose `/actors/{actor_id}/relationships`. v0.1 needs only:

```text
active
pending_incoming
pending_outgoing
historical_terminated
```

All counts are computed from visible relationships only:

$$
VisibleAggregates=Aggregate(VisibleRelationships)
$$

## 19. Human and Machine Surfaces

Suggested endpoints:

```text
GET /relationships/{relationship_id}       -> HTML
GET /api/relationships/{relationship_id}   -> JSON
GET /api/actors/{actor_id}/relationships   -> JSON index
```

The two detail representations obey:

$$
\boxed{VisibleFacts(HTML)=VisibleFacts(JSON)}
$$

They share one filtered projection object and differ only in representation.

## 20. Product Flow

The minimum complete social flow is:

```text
Actor A visits Actor B Profile
→ Propose Collaboration
Actor B opens Pending Relationships
→ opens rel:X
→ Activate
A / B Profile previews become active
→ Relationship Detail shows canonical history
A adds evidence
→ B opens contestation
→ contestation resolves
→ relationship terminates
rel:X remains historically addressable
```

Termination never deletes history.

## 21. Terminated Relationship Surface

A terminated relationship keeps its stable route and may show, subject to viewer policy, termination reason and historical lifecycle/evidence/contestation/annotation information.

It must never expose `Reactivate` for the same ID. A new social relationship requires a new `relationship_id`.

## 22. Actor Profile Integration

Actor Profile remains a summary surface. Relationship previews may add `relationship_detail_ref`, but Profile does not absorb full relationship event history, contestation workflows, mutation logic, or complete evidence browsing.

## 23. No Hidden History Aggregate Leakage

For any unreadable relationship:

$$
\boxed{InvisibleRelationship\not\Rightarrow VisibleHistorySignal}
$$

This includes relationship existence, history count, evidence count, contestation badge, last event time, and hidden activity.

## 24. No LLM Dependency in Canonical Read Semantics

Relationship detail v0.1 does not depend on LLM inference, embeddings, AI summaries, or recommendation models. Future summaries belong to derived analytics $D_t$, not canonical history $H_r$, unless explicitly submitted through an existing annotation/evidence command.

## 25. Stream-Backed Detail, No History Projection Table Yet

v0.1 uses:

```text
relationships_current
+
EventStore.readStream(relationship_id)
```

for detail construction. A dedicated materialized history table is deferred until scale demonstrates the need.

## 26. Concurrency

All mutation commands retain Foundation optimistic concurrency. Commands operate against an expected relationship stream version. Races produce one accepted append and stale commands receive `VERSION_CONFLICT`.

## 27. Idempotency

The service ordering fixed during Actor Profile v0.1 remains mandatory:

```text
idempotency lookup/gate
→ semantic preflight
→ authority evaluation
→ append
```

A successful retry returns its previous result rather than failing because the first attempt already changed relationship state.

## 28. Error Surface

Internal domain conditions include:

```text
NOT_FOUND
NOT_VISIBLE
POLICY_DENIED
VERSION_CONFLICT
IDEMPOTENCY_CONFLICT
INVALID_TRANSITION
INVALID_PAYLOAD
```

For anonymous or unauthorized callers, `NOT_VISIBLE` may be rendered indistinguishably from `NOT_FOUND` to avoid existence leakage.

## 29. AI Board Boundary

Trellis Relationship Surface does not treat AI Board history as Trellis canonical history:

$$
H_{Trellis}\neq H_{AI\ Board}
$$

Future integration remains `AI Board event -> inert candidate -> future joint promotion policy -> Trellis command`. Candidate-to-command promotion is outside v0.1.

## 30. Relationship Surface Invariants

These surface invariants do not modify Foundation I1–I11 or Profile P1–P10.

$$
\boxed{R_1: RelationshipSurface=Projection}
$$

$$
\boxed{R_2: InvisibleRelationship\not\Rightarrow VisibleHistorySignal}
$$

$$
\boxed{R_3: AvailableActionHint\neq AuthorizationGrant}
$$

$$
\boxed{R_4: SocialRelation\not\Rightarrow ExecutionAuthority}
$$

$$
\boxed{R_5: RelationshipHistory=Projection(H_r)}
$$

$$
\boxed{R_6: TerminatedRelationship\text{ remains historically addressable}}
$$

$$
\boxed{R_7: TerminatedRelationship\not\rightarrow ReactivatedSameID}
$$

$$
\boxed{R_8: VisibleAggregates=Aggregate(VisibleRelationships)}
$$

$$
\boxed{R_9: VisibleFacts(HTML)=VisibleFacts(JSON)}
$$

$$
\boxed{R_{10}: SurfaceMutation\rightarrow ExistingFoundationCommandPath}
$$

## 31. Explicit Non-Goals

v0.1 explicitly excludes Community, Feed, discovery recommendation, private messaging, real-time presence, notifications, LLM relationship summary, global relationship search, Actor retirement, relationship type/visibility/scope editing, AI Board auto-promotion, and execution-capability editing.

## 32. Acceptance Vertical Slice

A conformant implementation must demonstrate:

```text
Register Actor A and Actor B
→ create visible Profile projections
→ A proposes collaborates_with B
→ B sees viewer-safe incoming pending relationship
→ B activates it
→ both see active relationship detail
→ A adds evidence
→ B opens contestation
→ contestation resolves
→ relationship terminates
→ terminated relationship detail remains addressable
```

Then destroy disposable relationship and Profile projections, rebuild from canonical histories, and require the same viewer-relative Profile, Relationship Index, and Relationship Detail output under the same projection version and viewer context. Canonical event hash chains must remain valid.

## 33. Freeze Definition

Trellis Relationship Surface v0.1 is frozen as:

$$
\boxed{
\text{Stream-Backed}
+
\text{Viewer-Relative}
+
\text{Action-Advisory}
+
\text{Authority-Rechecked}
+
\text{History-Persistent}
}
$$

The relationship surface makes Trellis relationships operable and understandable by humans and AI without granting presentation code any authority to redefine social truth.
