# Trellis Publication v0.1 Design

## Append-Only Publication History, Viewer-Relative References, and Feed-Ready Social Content

**Date:** 2026-09-02
**Status:** ARCHITECTURE FREEZE
**Canonical Repo:** `kakon77777-commits/Trellis`
**Depends on:** Foundation v0.1, Foundation Cross-Domain Contract X1-X3, Actor Profile v0.1, Relationship Surface v0.1, Community Graph v0.1, Discovery v0.1
**Scope:** Publication canonical domain, revisions, withdrawal, replies, quotes, viewer-relative publication surface, visible reply projection

## 1. Why Publication Exists Before Feed

A Feed built only from Relationship and Community events is an activity log, not a Facebook-like social content system. Trellis therefore introduces its own Publication canonical domain before Feed.

AI Board messages remain a separate canonical history:

$$
\boxed{H_{Trellis}\neq H_{AI\ Board}}
$$

An AI Board message is not implicitly a Trellis Publication.

## 2. Canonical Domain

Publication introduces a new logical canonical history:

$$
H=
H_{entity}
\cup H_{relationship}
\cup H_{authority}
\cup H_{publication}
$$

For Publication $p$:

$$
PublicationState_t(p)=Fold(H_p^{\le t})
$$

Any `publications_current`, reply index, HTML, JSON, Feed preparation, or summary is a disposable projection.

## 3. Inherited Foundation Cross-Domain Contract

Publication inherits X1-X3 without exception:

- **X1:** canonical visibility is an immutable creation-time ceiling;
- **X2:** descriptive/social state never grants authority;
- **X3:** viewer-invisible facts cannot influence viewer-visible semantic output.

O-series rules below specialize these inherited laws.

## 4. Event Algebra

v0.1 canonical Publication event algebra is intentionally small:

```text
publication.created
publication.revision_added
publication.withdrawn
```

Publication type is data, not event type:

$$
\boxed{PublicationType\neq PublicationEventType}
$$

Initial Publication types:

```text
post
note
artifact_announcement
link_share
```

Adding future types does not require new canonical event families.

## 5. Publication Aggregate Identity

A Publication aggregate is:

$$
p=(id,author,type,scope,visibility,audience,replyRef,quoteRef)
$$

The following creation-time fields are immutable for one `publication_id`:

```text
publication_id
author_actor_id
publication_type
scope_ref
visibility
audience_actor_ids
reply_to_ref
quote_of_ref
publication_policy_ref
```

`reply_to_ref` and `quote_of_ref` are individually optional, but v0.1 forbids setting both on the same Publication.

## 6. Author Is Immutable

$$
\boxed{Author(p)=Immutable}
$$

Incorrect authorship is corrected by withdrawing the erroneous Publication and creating a new Publication; author identity is never rewritten.

## 7. Publication Visibility

v0.1 supports:

```text
public
scope_members
participants
private
```

The visibility value is resolved before `publication.created` commits and is immutable thereafter, inheriting X1.

### public

Potentially readable by anonymous/public viewers, subject to current disclosure policy.

### scope_members

Requires a non-null `scope_ref`. Viewer readability is determined by the scope's read-membership policy. In v0.1 the supported first-class scope is `community:<id>`.

### participants

Requires an immutable, sorted, duplicate-free `audience_actor_ids` list. The author is implicitly readable even when omitted from that list. `audience_actor_ids` is canonical creation-time data and cannot later be widened.

### private

Readable only by the author actor and principals explicitly authorized to represent/read for that actor under current read policy.

Current disclosure policy may narrow any of these classes but never widen them.

## 8. Scope

`scope_ref = null` means global Trellis publication context.

`scope_ref = community:C` means the Publication is contextually inside Community C.

Scope is immutable for a Publication identity.

A Community-scoped Publication does not create a `community.posts[]` truth. It is still a Publication whose `scope_ref` points to the Community.

## 9. Publication Authority

Publication mutation must pass the Authority boundary at command time.

$$
\boxed{SocialMembership\not\Rightarrow PublicationAuthority}
$$

For global Publications, the acting actor must be the author or an explicitly authorized representative.

For Community-scoped Publications, active Community membership may be a policy precondition, but membership alone is insufficient. A versioned Publication policy must explicitly permit that class of member to publish in that Community scope.

Action hints and read access are never reusable as authority receipts.

## 10. Create Publication

A create command resolves:

```text
publication_id
author_actor_id
publication_type
scope_ref
visibility
audience_actor_ids
reply_to_ref
quote_of_ref
publication_policy_ref
initial body/content
```

Then it performs:

```text
schema validation
-> reference validation
-> audience-bound validation
-> canonical state/policy read
-> Authority evaluation
-> append publication.created
```

No projection row is authoritative.

## 11. Revision Model

The initial body is revision 1 carried by `publication.created`.

Editing appends:

```text
publication.revision_added
```

with:

```text
revision_number
body
supersedes_revision
```

Current content is:

$$
CurrentContent_t(p)=LatestValidRevision(H_p^{\le t})
$$

Therefore:

$$
\boxed{Edit=AppendRevision}
$$

No canonical body update exists.

## 12. Withdrawal

Withdrawal appends:

```text
publication.withdrawn
```

The Publication remains historically addressable to viewers who retain read authority, but current generated surfaces do not expose withdrawn body content.

A withdrawn Publication cannot be revised again.

$$
\boxed{Withdraw\neq Delete}
$$

## 13. Replies Are Publications

A reply is a normal Publication with:

```text
reply_to_ref = publication:P
```

There is no canonical `comments` table/domain.

$$
\boxed{Reply=Publication(reply\_to=P)}
$$

The child stores only the parent reference, never a canonical copy of the parent's body or generated preview.

## 14. Quotes Are Publications

A quote is a normal Publication with:

```text
quote_of_ref = publication:P
```

Its own body is authored content. Any platform-generated target preview is resolved at read time and is never copied into canonical child content.

## 15. Reference Audience Constraint

A built-in reply or quote may not widen the readable audience of its referenced parent at creation time.

$$
\boxed{Audience(child)\subseteq Audience(parent)}
$$

For `scope_members`, v0.1 additionally requires:

$$
\boxed{Scope(child)=Scope(parent)}
$$

For `participants`, the child participant set must be a subset of the parent's effective participant set at creation.

For `private`, a child cannot become public/scope-members/participants.

Reference validation runs before canonical append.

## 16. Viewer-Relative Reference Context

A reply/quote context is resolved from the target's **current viewer-relative state**, not from a cached creation-time body:

$$
\boxed{
ReferenceContext_{child,v}(t)
=
\Pi_v(TargetCurrentState_t)
}
$$

### Target active and readable

The generated context may include a viewer-safe current preview.

### Target withdrawn but still readable

Return only a withdrawn placeholder:

```json
{
  "status": "withdrawn",
  "publication_id": "pub:..."
}
```

No body, old revision, revision count, or cached excerpt is exposed.

### Target unreadable or unavailable

Return only:

```json
{
  "status": "unavailable"
}
```

The viewer-facing surface does not expose the raw hidden target reference or hidden target metadata.

## 17. Author-Written Child Content Is Independent

If a child author manually writes text copied from a parent into the child's own body, that text is canonical child content.

Parent withdrawal cannot retroactively mutate the child's authored body.

$$
\boxed{GeneratedReferencePreview\neq AuthorWrittenChildContent}
$$

Moderation/copyright/governance of manually copied text is outside reference-resolution semantics.

## 18. Reply Projection and X3

Reply trees and reply counts are computed only after viewer visibility filtering:

```text
canonical Publications
-> viewer-visible Publications
-> reply graph
-> visible reply count/tree
```

Never compute the full reply aggregate first and hide rows later.

A hidden reply cannot change:

```text
reply count
pagination total
last reply time
thread badge
preview
reference context
```

for a viewer who cannot see it.

## 19. Publication Surface

Human:

```text
/publications/{publication_id}
```

Machine:

```text
/api/publications/{publication_id}
```

Viewer-safe shape:

```json
{
  "publication_id": "pub:...",
  "author_actor_id": "actor:A",
  "publication_type": "post",
  "scope_ref": "community:C",
  "visibility": "scope_members",
  "lifecycle": "active",
  "content": {
    "revision": 2,
    "body": "..."
  },
  "reference_context": null,
  "visible_replies": [],
  "visible_reply_count": 0,
  "available_actions": [],
  "viewer_scope": "scope_member",
  "projection_version": "publication-surface:0.1"
}
```

HTML and JSON consume the same viewer-filtered object:

$$
\boxed{VisibleFacts(HTML)=VisibleFacts(JSON)}
$$

Renderers have no EventStore write dependency.

## 20. Available Actions Are Advisory

Possible hints include:

```text
reply
quote
revise
withdraw
```

But:

$$
\boxed{PublicationActionHint\neq AuthorizationGrant}
$$

Every mutation re-reads canonical state and re-evaluates Authority.

## 21. Projection Storage

v0.1 may maintain disposable:

```text
publications_current
```

for current lifecycle/content/reference metadata and efficient lookup.

It may also derive an in-memory or disposable reply index from `publications_current`.

No projection is a write authority.

Destroying all Publication projections and rebuilding from `H_publication` must reproduce the same viewer-relative outputs under the same policy/projection version.

## 22. AI Board Boundary

$$
\boxed{AI\ Board\ Message\neq Trellis\ Publication}
$$

A future joint integration may reference or promote external discussion into Trellis only through an explicit contract and normal Trellis command/authority path.

Publication v0.1 contains no AI Board auto-import or auto-promotion.

## 23. Feed Boundary

Publication makes a future Feed meaningful:

$$
Feed_v(t)=Rank(VisiblePublications_v\cup VisibleSocialActivities_v)
$$

Publication and social activity remain distinct item classes:

$$
\boxed{Publication\neq Activity}
$$

Feed is outside Publication v0.1.

## 24. Publication Invariants O1-O15

$$
\boxed{O_1:\ PublicationHistory\text{ is canonical}}
$$

$$
\boxed{O_2:\ PublicationType\neq EventType}
$$

$$
\boxed{O_3:\ Author\text{ is immutable}}
$$

$$
\boxed{O_4:\ PublicationVisibility\text{ is creation-time immutable}}
$$

$$
\boxed{O_5:\ Edit=AppendRevision}
$$

$$
\boxed{O_6:\ Withdraw\neq Delete}
$$

$$
\boxed{O_7:\ Reply=Publication}
$$

$$
\boxed{O_8:\ InvisiblePublication\not\Rightarrow VisibleAggregateSignal}
$$

$$
\boxed{O_9:\ SocialMembership\not\Rightarrow PublicationAuthority}
$$

$$
\boxed{O_{10}:\ PublicationActionHint\neq AuthorizationGrant}
$$

$$
\boxed{O_{11}:\ Publication\neq Actor}
$$

$$
\boxed{O_{12}:\ AI\ Board\ Message\neq Trellis\ Publication}
$$

$$
\boxed{
O_{13}:\
ReferenceContext_{p,v}
=
ViewerRelativeProjection(TargetCurrentState)
}
$$

$$
\boxed{
O_{14}:\
ReferencedChildAudience
\subseteq
ReferencedParentAudience
}
$$

$$
\boxed{
O_{15}:\
WithdrawalOrInvisibility(Target)
\not\Rightarrow
StaleTargetContentLeak
}
$$

O4 specializes X1. O8 and O15 specialize X3. O9 and O10 specialize X2. O14 strengthens X1 for reference-bearing Publications.

## 25. Explicit Non-Goals

v0.1 does not implement:

```text
Feed
engagement ranking
likes/reactions
reshare without commentary
persistent hide/dismiss preferences
media upload/storage
polls
notification service
search ranking
AI Board auto-import
LLM summarization
content moderation policy engine
Actor/Community retirement
```

## 26. Acceptance Vertical Slice

A conformant implementation must demonstrate:

```text
Actor A creates public P1
Actor B reads P1 and creates reply P2
A revises P1
A creates private P3
unauthorized C cannot read P3 and cannot infer its revision/reply aggregates

Community C exists
A and B are active members
A creates scope_members P4 in C through an explicit Publication policy
B can read P4
outsider X cannot read P4 or infer its reply aggregate

B replies P5 to P4
P4 is withdrawn
B can still read P5
P5 reference_context becomes withdrawn placeholder with no stale P4 body
outsider still receives no P4/P5 private-scope signal
```

Then destroy all Publication projections and any Feed-preparation/reply indexes, rebuild exclusively from canonical Publication history, and require identical viewer-relative Publication surfaces under the same policy/projection version. Canonical hash chains must remain valid.

## 27. Freeze Definition

Trellis Publication v0.1 is frozen as:

$$
\boxed{
\text{Append-Only Content History}
+
\text{Immutable Authorship/Audience}
+
\text{Viewer-Relative References}
+
\text{Authority-Rechecked Mutation}
+
\text{Feed-Ready but Feed-Independent}
}
$$
