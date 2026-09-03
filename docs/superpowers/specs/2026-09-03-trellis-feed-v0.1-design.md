# Trellis Feed v0.1 Design

## Chronological, Viewer-Relative Social Feed Projection

**Date:** 2026-09-03
**Status:** ARCHITECTURE FREEZE / IMPLEMENTATION BASELINE
**Canonical Repo:** `kakon77777-commits/Trellis`
**Depends on:** Foundation v0.1 + Foundation Cross-Domain Contract X1-X3 + Actor Profile v0.1 + Relationship Surface v0.1 + Community Graph v0.1 + Discovery v0.1 + Publication v0.1
**Scope:** Home Feed, Community Feed, Publication feed items, allowlisted social-activity feed items, deterministic chronological ordering, viewer-safe source resolution, cursor/snapshot semantics, HTML/JSON surfaces

---

## 1. Core Position

Feed is not a canonical Trellis domain in v0.1.

There is no canonical `feed_item.created`, `feed_item.rank_changed`, or `feed_item.hidden` event algebra and no authoritative feed table.

$$
\boxed{H_{Feed}\text{ does not exist in v0.1}}
$$

Feed is a derived projection over canonical Publication and social histories:

$$
\boxed{
Feed_{s,v}(t)
=
\Pi_{feed}
\left(
H_{publication},
H_{relationship},
H_{entity},
s,
v,
Policy_t
\right)
}
$$

where $s$ is the Feed subject and $v$ is the viewer.

A Feed cache, if later introduced, is disposable projection state and never authority.

---

## 2. Foundation Cross-Domain Inheritance

Feed explicitly inherits Trellis Foundation Cross-Domain Contract v0.1:

$$
X_1:\ CanonicalVisibilityCeiling
$$

$$
X_2:\ DescriptiveState\not\Rightarrow Authority
$$

$$
X_3:\ ViewerNoninterference
$$

Feed-specific rules F3/F4/F8/F12 are specializations of X2-X3.

Feed does not weaken the contract because it is a derived surface rather than a canonical object domain.

---

## 3. Search, Discovery, Publication, Activity, and Feed Are Distinct

$$
\boxed{
Search\neq Discovery\neq Publication\neq SocialActivity\neq Feed
}
$$

- Search answers a user-specified retrieval intent.
- Discovery returns related Entities.
- Publication is canonical authored social content.
- Social Activity is a derived presentation of allowlisted canonical social events.
- Feed orders viewer-safe Publications and Social Activities for a Feed subject.

Feed does not create new social facts.

---

## 4. Feed Subject and Viewer Are Separate

Feed follows Discovery's subject/viewer separation:

$$
\boxed{FeedSubject\neq Viewer}
$$

`subject_actor_id` answers:

> For which Actor is this personalized Feed being generated?

Viewer context answers:

> Which authenticated/represented Actor or principal is allowed to read the resulting projection?

A representative may read Actor A's Feed without becoming the Feed subject.

Feed read authority does not grant social or Publication mutation authority.

---

## 5. Feed Types v0.1

v0.1 exposes only:

1. **Home Feed** for an Actor subject.
2. **Community Feed** for a Community.

Explicitly deferred:

```text
global feed
trending feed
recommended feed
algorithmic engagement feed
notifications
read/seen state
persistent dismiss/not-interested state
```

---

## 6. Home Feed Source Set

For subject Actor $A$, source resolution is based only on explicit, viewer-visible social semantics.

Actor sources:

```text
A itself
targets of active follows relationships
targets of active subscribes_to relationships
```

Community sources:

```text
Communities for which A has an active viewer-visible member_of relationship
```

Formally:

$$
Sources_{A,v}
=
Self_A
\cup
FollowTargets_{A,v}
\cup
SubscriptionTargets_{A,v}
\cup
MemberCommunities_{A,v}
$$

The source relationship itself must be visible to viewer $v$.

---

## 7. Social Relation Does Not Imply Content Subscription

The following relationships do not automatically become Feed subscriptions:

```text
trusts
collaborates_with
reviews
delegates_to
```

$$
\boxed{SocialRelation\neq ContentSubscription}
$$

Discovery candidates also do not automatically become Feed sources:

$$
\boxed{DiscoveryAffinity\not\Rightarrow FeedSubscription}
$$

An Actor enters another Actor's Home Feed source set only through the explicit `follows` or `subscribes_to` semantics defined above.

---

## 8. Feed Source Relations Must Be Viewer-Visible

This is a strict X3 specialization.

Suppose `follows(A,B)` exists but is invisible to viewer $v$. Even if B's Publication is public, B must not become a source of A's Feed for $v$.

$$
\boxed{
ContentSourceRelation\text{ must itself be viewer-visible}
}
$$

Otherwise the presence of B's post in A's Feed would reveal A's hidden social relation.

The same rule applies to Community membership: an invisible `member_of(A,C)` relationship cannot make Community C a Feed source for viewer $v$.

---

## 9. Publication Candidates for Home Feed

A Publication may be a Home Feed root item only if it is readable by viewer $v$ and one of the following applies:

### Subject self-publication

```text
author_actor_id = subject_actor_id
```

No self-follow relationship is needed.

### Followed/subscribed Actor publication

```text
author_actor_id in visible actor sources
scope_ref = null
```

### Community-scoped publication

```text
scope_ref = community:C
C in visible subject Community sources
```

The Publication's own visibility and current disclosure policy remain authoritative ceilings.

---

## 10. Replies Are Thread-Only in Home Feed v0.1

A Publication with:

```text
reply_to_ref != null
```

is excluded as a root Home Feed item.

$$
\boxed{
reply\_to\_ref\neq null
\Rightarrow
NotHomeFeedRoot
}
$$

Replies remain visible through Publication thread surfaces.

A quote Publication with `reply_to_ref = null` may be a Feed root item because it is a distinct authored Publication.

---

## 11. Revision Does Not Resurface a Publication

Feed displays the current viewer-safe Publication state but orders the item by the canonical `publication.created` event.

$$
FeedItem(p,t)
=
CurrentVisiblePublication(p,t)
+
CreationOrder(p)
$$

A revision updates the visible body but does not change chronological placement:

$$
\boxed{Edit\not\Rightarrow FeedResurface}
$$

The Feed sort key never uses the latest revision time.

---

## 12. Withdrawn Publications Leave the Current Feed

A withdrawn Publication remains historically addressable through the Publication domain but does not appear in current Feed candidate sets:

$$
\boxed{WithdrawnPublication\notin CurrentFeed}
$$

Feed disappearance is not historical deletion.

---

## 13. Publication Reference Context Inherits O13-O15

Feed never caches a stale reply/quote target body independently.

A Publication item uses the current viewer-relative Publication surface.

If a quoted target is withdrawn, generated reference context is the Publication domain's withdrawn placeholder.

If a target is unreadable, generated reference context is the Publication domain's unavailable placeholder.

$$
\boxed{
FeedReferenceContext
=
PublicationReferenceContext
}
$$

No Feed-specific copy of target content is stored.

---

## 14. Social Activity Is a Derived Projection

Social Activity Feed items are not canonical objects.

An activity identity is derived from its source event:

```text
feed:activity:{source_event_id}
```

No `social_activity.created` canonical event is introduced.

$$
\boxed{Publication\neq SocialActivity}
$$

---

## 15. Social Activity Allowlist v0.1

Only these canonical social events are projected into Feed activity items:

```text
member_of relationship.activated
collaborates_with relationship.activated
```

Presentation meanings:

```text
community_joined
collaboration_started
```

Not included in v0.1:

```text
follow created
trust changes
relationship termination
contestation
evidence
profile changes
publication revision
publication withdrawal
```

The allowlist prevents Feed from degenerating into an EventStore debugger.

---

## 16. Activity Visibility Is Derived from the Underlying Social Fact

An activity item is eligible only when the underlying current/historical social fact is viewer-readable under the applicable visibility and current disclosure policy.

A hidden/private Community membership activation cannot yield any visible activity item, count, ordering change, snapshot change, or cursor boundary change for an unauthorized viewer.

$$
\boxed{
InvisibleSocialFact
\not\Rightarrow
VisibleActivitySignal
}
$$

---

## 17. Chronological Feed Algorithm v0.1

v0.1 does not use recommendation or engagement ranking.

The algorithm reference is:

```text
trellis-feed:chronological:v1
```

Ordering key, descending:

$$
K(i)
=
(recorded\_at_i,global\_offset_i,stable\_item\_id_i)
$$

For Publication items, ordering metadata comes from the canonical `publication.created` event.

For Social Activity items, ordering metadata comes from the allowlisted canonical source event.

No random value, wall-clock read-time, model output, engagement metric, Discovery score, Trust score, Community size, provider, or runtime metadata participates in ordering.

---

## 18. Feed Item Publication Projection

A Publication Feed item contains:

```json
{
  "feed_item_id": "feed:publication:pub:123",
  "item_type": "publication",
  "source_ref": "pub:123",
  "sort": {
    "recorded_at": "...",
    "global_offset": 123
  },
  "publication": {
    "...": "viewer-safe Publication surface"
  }
}
```

The embedded Publication data comes from the Publication read service/surface, not from raw `publications_current` rows exposed directly to the caller.

---

## 19. Social Activity Projection Shape

Example Community join activity:

```json
{
  "feed_item_id": "feed:activity:evt:456",
  "item_type": "social_activity",
  "source_event_ref": "evt:456",
  "sort": {
    "recorded_at": "...",
    "global_offset": 456
  },
  "activity": {
    "type": "community_joined",
    "actor_id": "actor:A",
    "community_id": "community:C"
  }
}
```

All referenced IDs and presentation fields must already be viewer-readable.

---

## 20. Home Feed Social Activities

Home Feed activity candidates are limited to allowlisted activities whose visible social context is relevant to the subject's visible source graph.

v0.1 admits:

- visible Community join events for a visible Community source;
- visible collaboration-started events involving the subject or a visible followed/subscribed Actor source.

Activity relevance never uses hidden relationships or Discovery ranking.

---

## 21. Community Feed

Community Feed for Community $C$ includes viewer-readable:

### Publications

```text
scope_ref = C
reply_to_ref = null
lifecycle = active
```

### Activities

```text
member_of(A,C) activated
collaborates_with(A,B,scope=C) activated
```

Community surface/discoverability/read policy must authorize the viewer before candidate generation.

$$
\boxed{CommunityFeed\neq CommunityState}
$$

---

## 22. Community Feed Does Not Create Another Community Timeline Truth

There is no authoritative `community_feed_items` table in v0.1.

Community Feed is fan-out-on-read from viewer-visible Trellis state.

Deleting any optional future Community Feed cache cannot mutate Community membership, local graph, Publications, or canonical events.

---

## 23. Feed Action Hints Are Advisory Only

Feed may expose UI affordances such as:

```text
open_publication
reply
follow
join_community
```

but:

$$
\boxed{FeedActionHint\neq AuthorizationGrant}
$$

Executing any action returns to the owning domain's normal command path and performs a fresh canonical-state and Authority check.

Feed has no direct EventStore append interface.

---

## 24. Viewer Noninterference for Feed

Feed inherits X3 in a strong semantic form.

Let $H$ and $H'$ differ only in facts invisible to viewer $v$. Then for the same subject $s$, policy versions, and Feed algorithm:

$$
\boxed{
Feed_{s,v}(H)=Feed_{s,v}(H')
}
$$

Equality covers:

```text
candidate existence
item count
item content
ordering
activity presence
snapshot_ref
cursor fields
pagination boundaries
```

This is a semantic-output contract, not a claim to solve all infrastructure timing side channels.

---

## 25. Feed Snapshot

Each Feed query computes a deterministic `snapshot_ref` over only viewer-visible Feed inputs plus:

```text
feed subject
viewer identity/representation context
algorithm_ref
relevant projection versions
```

Hidden canonical facts are not included.

Therefore adding a hidden relationship, hidden membership, hidden Publication, or hidden activity source must not change the snapshot.

---

## 26. Feed Cursor

Cursor payload:

```json
{
  "algorithm_ref": "trellis-feed:chronological:v1",
  "snapshot_ref": "...",
  "last_recorded_at": "...",
  "last_global_offset": 412,
  "last_item_id": "feed:publication:pub:123"
}
```

Cursor contains no current wall-clock timestamp and no hidden aggregate.

If the viewer-visible Feed snapshot changes between pages, the service returns:

```text
FEED_SNAPSHOT_CHANGED
```

and the client restarts pagination.

---

## 27. Fan-Out-on-Read

v0.1 uses:

```text
subject/viewer
-> resolve viewer-visible source graph
-> resolve viewer-visible Publication roots
-> resolve viewer-visible allowlisted activities
-> deterministic sort
-> paginate
-> render
```

It does not fan-out canonical Publication creation into per-user Feed rows.

This is a correctness-first baseline, not a scale claim.

---

## 28. Feed Cache

No persistent Feed cache is required in v0.1.

If an in-memory/session cache is used, it is disposable and keyed by at least:

```text
subject
viewer identity/representation context
algorithm_ref
snapshot_ref
```

$$
\boxed{FeedCache\neq CanonicalState}
$$

---

## 29. Read/Seen/Dismiss State Is Out of Scope

v0.1 does not persist:

```text
seen
read
opened
dismissed
not interested
hide this item
```

Those require a future Preference/Interaction authority design.

Feed must not silently write them into canonical Publication or social histories.

---

## 30. APIs

Home Feed machine surface:

```text
GET /api/feed/home
```

Logical inputs:

```text
subject_actor_id
viewer_context
limit
cursor
```

Community Feed machine surface:

```text
GET /api/communities/{community_id}/feed
```

Human surfaces:

```text
/feed
/communities/{community_id}/feed
```

In the current library-first implementation these are renderer/service contracts rather than a requirement to introduce a web framework.

---

## 31. HTML / JSON Semantic Parity

Human and machine surfaces consume the same already-filtered Feed object.

$$
\boxed{VisibleFacts(HTML)=VisibleFacts(JSON)}
$$

Renderers must not query DB/EventStore or expand visibility independently.

---

## 32. AI Board Boundary

AI Board messages are not Trellis Feed sources.

$$
\boxed{AI\ Board\ Message\neq FeedItemSource}
$$

A Trellis Publication may reference an AI Board discussion in a future integration, but Feed source authority remains the Trellis Publication or allowlisted Trellis social event.

AI Board canonical history is never scanned directly by Feed v0.1.

---

## 33. Feed Invariants F1-F12

### F1

$$
\boxed{Feed=DerivedProjection}
$$

### F2

$$
\boxed{Publication\neq SocialActivity}
$$

### F3

$$
\boxed{FeedCandidateGeneration\text{ occurs after ViewerVisibilityProjection}}
$$

### F4

$$
\boxed{InvisibleFact\not\Rightarrow FeedSignal}
$$

### F5

$$
\boxed{DiscoveryAffinity\not\Rightarrow FeedSubscription}
$$

### F6

$$
\boxed{Edit\not\Rightarrow FeedResurface}
$$

### F7

$$
\boxed{WithdrawnPublication\notin CurrentFeed}
$$

### F8

$$
\boxed{FeedActionHint\neq AuthorizationGrant}
$$

### F9

$$
\boxed{SameVisibleState+SameAlgorithm\Rightarrow SameFeedOrder}
$$

### F10

$$
\boxed{FeedCache\neq CanonicalState}
$$

### F11

$$
\boxed{FeedSubject\neq Viewer}
$$

### F12

$$
\boxed{ContentSourceRelation\text{ must itself be viewer-visible}}
$$

F3/F4/F12 specialize X3. F8 specializes X2. Feed carries no canonical visibility-bearing object of its own, but all input objects remain bounded by X1.

---

## 34. Explicit Non-Goals

Feed v0.1 explicitly excludes:

```text
engagement ranking
personalized ML ranking
LLM ranking
embedding ranking
trending/global feed
reactions/likes
notifications
read/seen state
persistent dismissals
precomputed per-user fan-out tables
private messaging
AI Board message ingestion
new canonical Feed events
```

---

## 35. Acceptance Vertical Slice

Create:

```text
Actors: A, B, X
Community: C
```

Visible social state for viewer A:

```text
A follows B        public
A follows X        canonical relationship exists; current disclosure policy denies it to this viewer
A member_of C      viewer-visible
```

Publications:

```text
B creates root P1
X creates root P2
A creates root P3
B replies P4 to P1
B creates community-scoped P5 in C
```

A's Home Feed must contain:

```text
P1
P3
P5
```

and must not contain:

```text
P2  -- denied follow(A,X) cannot become a source signal for this viewer
P4  -- reply is thread-only
```

Then B revises P1:

```text
Feed shows current revised P1 body
Feed sort position for P1 remains creation-time position
```

Then B withdraws P1:

```text
P1 disappears from Current Feed
Publication detail/history remains addressable
```

Add viewer-invisible facts:

```text
hidden relationship
private membership
private Publication
hidden allowlisted activity source
```

Require Feed semantic identity before/after for A:

```text
items
ordering
counts
snapshot_ref
cursor boundaries
```

Finally destroy all disposable Relationship/Profile/Community/Publication projections, rebuild from canonical histories, and require the same Feed output under the same viewer context, algorithm, and projection versions.

Canonical event count must not change as a consequence of Feed reads.

---

## 36. Freeze Definition

Trellis Feed v0.1 is frozen as:

$$
\boxed{
\text{Viewer-Filtered First}
+
\text{Explicit-Source}
+
\text{Chronological}
+
\text{Deterministic}
+
\text{Projection-Only}
}
$$

Feed does not define the social world. It presents a chronological, viewer-safe projection of Trellis Publications and a deliberately small allowlist of social activities from a social world whose canonical authority remains elsewhere.
