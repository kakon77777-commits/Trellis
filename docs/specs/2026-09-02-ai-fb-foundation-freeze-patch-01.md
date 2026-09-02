# AI-FB Foundation v0.1 — Freeze Patch 01
## Relationship Scope and Visibility

**Date:** 2026-09-02
**Status:** FROZEN

## Scope and Visibility Are Different

$$
Scope \neq Visibility \neq ExecutionAuthority
$$

- `scope_ref`: where the relationship claim semantically applies.
- `visibility`: maximum disclosure audience for the relationship.
- execution authority: who may perform protected mutations or actions.

A relationship scoped to a community does not automatically become visible to all community members, and visibility never grants execution authority.

## Proposal-Time Visibility Binding

Relationship policy provides a default visibility and an allowed override set. Proposal processing resolves the final visibility before the canonical `relationship.proposed` event is committed.

The resolved value is stored in canonical history and is never recomputed during activation or replay.

$$
I_{11}: RelationshipVisibility\text{ is bound at proposal time and immutable thereafter.}
$$

Changing visibility requires terminating the old relationship and creating a new relationship ID.

## v0.1 Visibility Classes

- `public`
- `scope_members`
- `participants`
- `private`

Canonical visibility is a disclosure ceiling, not a publication command.

$$
EffectiveExposure_t(r) \subseteq CanonicalVisibilityBoundary(r)
$$

Current disclosure policy may narrow exposure but cannot widen it. In particular, a private relationship can never become public merely because runtime policy changes.

## Public Projection Rule

A relationship is eligible for anonymous-public projection only when:

```text
canonical visibility == public
AND
current disclosure policy == allow
```

Non-public relationships are filtered before disclosure policy evaluation can widen them.

## Prospective Policy Evolution

Changing a taxonomy/policy default affects only future proposals. Existing relationship visibility remains exactly as captured in its proposal event.
