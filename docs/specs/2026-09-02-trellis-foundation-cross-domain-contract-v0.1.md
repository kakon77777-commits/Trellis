# Trellis Foundation Cross-Domain Contract v0.1

**Date:** 2026-09-02
**Status:** FROZEN CROSS-DOMAIN CONTRACT
**Applies to:** Profile, Relationship Surface, Community, Discovery, Publication, Feed, Reaction, Notification, and future Trellis canonical/derived domains unless a later Foundation contract explicitly supersedes this version.

## 1. Purpose

Trellis has repeatedly converged on the same safety laws across independently designed domains. This document promotes those recurring laws into an inherited Foundation contract so future domains do not need to rediscover them from scratch.

The contract does not replace domain-local invariants. Domain invariants may specialize or strengthen these rules, but may not weaken them without a versioned Foundation contract change.

## 2. X1 — Canonical Visibility Ceiling

For every canonical object or canonical claim that carries a visibility/disclosure field, that field is resolved at creation/proposal/assertion time and is immutable for that object identity.

$$
\boxed{X_1:\ CanonicalVisibility(o)=VisibilityAtCreation(o)}
$$

Current policy may narrow exposure but may never widen the canonical ceiling:

$$
\boxed{EffectiveExposure_t(o)\subseteq CanonicalVisibility(o)}
$$

Consequences:

- `private -> public` cannot occur by projection policy.
- `participants -> public` cannot occur by projection policy.
- a policy default change is prospective only.
- widening disclosure requires a new canonical object/claim identity or a domain-defined replacement flow; historical meaning is never rewritten.

This contract covers relationship visibility, profile/community assertion visibility, publication visibility, and any future canonical domain with a visibility-bearing object.

## 3. X2 — Descriptive State Does Not Grant Authority

Canonical or derived descriptive/social state is not execution or mutation authority.

$$
\boxed{X_2:\ DescriptiveState\not\Rightarrow Authority}
$$

This includes, without limitation:

```text
relationship
membership
role
trust
profile assertion
discovery result
ranking
publication metadata
community status
activity
recommendation
```

A protected mutation or execution must independently pass the Authority boundary at command time.

Examples:

$$
member\_of(A,C)\not\Rightarrow ActAs(A,C)
$$

$$
delegates\_to(A,B)\not\Rightarrow ToolCapability(B)
$$

$$
DiscoveryRead(A)\not\Rightarrow SocialWrite(A)
$$

$$
PublicationActionHint\not\Rightarrow PublicationAuthority
$$

UI affordances, read permissions, social roles, and advisory action hints are never reusable as authorization receipts.

## 4. X3 — Viewer Noninterference

A viewer-visible derived output must not change because of canonical facts that are invisible to that viewer.

Let $H$ and $H'$ be two canonical worlds that differ only in facts invisible to viewer $v$ under the same versioned viewer policy. Then every compliant viewer-visible semantic output $F_v$ must be identical:

$$
\boxed{
X_3:\
\Pi_v(H)=\Pi_v(H')
\Rightarrow
F_v(H)=F_v(H')
}
$$

This is a semantic-output contract. It covers observable application data such as:

```text
entity existence in a result
counts
aggregates
ranking scores
ordering
candidate presence
explanations
history length
last-activity fields
badges
pagination totals
cursor/snapshot references
generated previews
```

It does not claim to solve all physical timing or infrastructure side channels; those remain a separate operational-security concern.

The required computation order is:

```text
canonical state
-> viewer visibility projection
-> candidate/aggregate/history computation
-> presentation
```

Never:

```text
full canonical state
-> compute aggregate/rank/history
-> hide private rows at the end
```

## 5. Inheritance Matrix

The following existing domain rules are specializations of X1-X3 rather than independent competing laws.

### Actor Profile v0.1

- P5 (`AssertionVisibility` immutable per assertion) specializes X1.
- P8 (`InvisibleFact` produces no visible aggregate signal) specializes X3.
- P10 (renderer has no EventStore write path) is consistent with X2 and Foundation state authority.

### Relationship Surface v0.1

- R2 (invisible relationship produces no visible history signal) specializes X3.
- R3 (`AvailableActionHint != AuthorizationGrant`) specializes X2.
- R4 (`SocialRelation != ExecutionAuthority`) specializes X2.
- R8 (visible aggregates count only visible relationships) specializes X3.

### Community Graph v0.1

- C4 (Community role does not grant execution authority) specializes X2.
- C7 (invisible membership produces no visible aggregate signal) specializes X3.
- C8 (`CommunityActionHint != AuthorizationGrant`) specializes X2.
- C11 (social relation does not grant `ActAsCommunity` authority) specializes X2.

### Discovery v0.1

- D2 (candidate generation occurs after viewer visibility projection) is the required X3 computation order.
- D3 (invisible fact produces no Discovery signal) specializes X3.
- D6 (explanations only contain viewer-visible facts) specializes X3.
- D12 (Discovery read authority does not grant social mutation authority) specializes X2.

### Publication v0.1

- O4 (Publication visibility is immutable at creation) specializes X1.
- O8 (invisible Publication produces no visible aggregate signal) specializes X3.
- O9 (social membership does not grant Publication authority) specializes X2.
- O10 (`PublicationActionHint != AuthorizationGrant`) specializes X2.
- O14 (referenced child audience is bounded by referenced parent audience) strengthens X1 for references.
- O15 (withdrawn/invisible target cannot leak stale content) specializes X3.

### Feed v0.1

- F3 (Feed candidate generation occurs after viewer visibility projection) is the required X3 computation order.
- F4 (invisible fact produces no Feed signal) specializes X3.
- F8 (`FeedActionHint != AuthorizationGrant`) specializes X2.
- F12 (content-source relationship must itself be viewer-visible) strengthens X3 for personalized source selection.
- Feed has no canonical visibility-bearing object of its own; every Publication/Relationship/Community input remains bounded by X1.

### Reaction v0.1

- Reaction audience is inherited from the target Publication and remains bounded by X1.
- Reaction mutation authority is independent of readability/membership and specializes X2.
- Invisible Reaction facts cannot change viewer-visible Reaction summaries, Feed v0.1, or Discovery v0.1, specializing X3.

### Notification v0.1

- Notification canonical audience is the immutable singleton recipient `{recipient}`, specializing X1.
- Notification read/receipt state and action hints never grant source-domain mutation authority; acknowledgment is independently recipient-authorized, specializing X2.
- Receipt issuance requires write-time recipient source eligibility, and current Inbox aggregation filters by current source eligibility before counts/order/snapshot, specializing X3.
- Historical issuance does not guarantee current Inbox visibility when the source becomes withdrawn/inactive, policy-hidden, or unreadable after membership loss.

## 6. Contract Precedence

For any domain $D$ inheriting this contract:

$$
DomainRule_D\succeq X_i
$$

means the domain may be stricter than $X_i$, never weaker.

A domain wishing to widen visibility, derive authority from social state, or allow invisible facts to influence visible output requires a new Foundation-level contract version and explicit migration analysis. A domain-local exception is not sufficient.

## 7. Conformance Requirements

Every new Trellis domain must declare which X1-X3 rules apply and include executable tests where applicable.

Minimum cross-domain conformance:

1. **X1 test:** a current policy change may narrow but cannot widen a canonical visibility ceiling.
2. **X2 test:** a descriptive/social fact by itself cannot authorize a protected mutation or execution.
3. **X3 test:** adding or changing viewer-invisible canonical facts cannot change any tested viewer-visible semantic output.

Publication v0.1 is the first domain implemented after this contract becomes Foundation law; its conformance suite therefore also verifies the inherited X1-X3 behavior.

## 8. Freeze Statement

Trellis Foundation Cross-Domain Contract v0.1 is frozen as:

$$
\boxed{
\text{Immutable Visibility Ceiling}
+
\text{Authority Separation}
+
\text{Viewer Noninterference}
}
$$

Future Trellis domains inherit these laws by contract, not by convention.
