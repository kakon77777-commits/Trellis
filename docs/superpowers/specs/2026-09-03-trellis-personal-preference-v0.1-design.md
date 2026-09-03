# Trellis Personal Preference v0.1 Design

**Date:** 2026-09-03
**Status:** FROZEN
**Branch:** `preference/v0.1`
**Base:** Notification v0.1 hotfix (`21b4a4e9f5d235123e1a451f78138d25c2a57cc1`)
**Depends on:** Foundation X1-X3, Publication v0.1, Feed v0.1, Notification v0.1

## 1. Purpose

Personal Preference records an Actor's explicit private directives about how Trellis should project otherwise-valid social state for that Actor.

It is canonical because the Actor explicitly authored the directive, but it is not social truth and never rewrites its source domains.

\[
\boxed{Preference = PrivateProjectionDirective}
\]

\[
\boxed{Preference \neq Relationship \neq SocialFact \neq ConsumptionTelemetry}
\]

## 2. v0.1 scope

Exactly four preference types are in scope:

- `bookmark_publication`
- `dismiss_feed_item`
- `not_interested_publication`
- `mute_actor`

Explicitly out of scope:

- block / restrict / report
- mute community
- mute notification type
- pin / favorite
- seen / opened / read / dwell / scroll telemetry
- inferred interests or learned preference profiles
- Search ranking changes
- Discovery affinity changes
- Algorithmic Feed ranking

`Mute != Block`. Blocking changes cross-Actor rights and requires a separate safety/relationship design.

## 3. Canonical history and event algebra

Preference has its own canonical history:

\[
H_{preference}
\]

Each preference is a boolean directive with append-only lifecycle:

- `preference.created`
- `preference.withdrawn`
- `preference.restored`

There is no `preference.changed` in v0.1. Preference type and target are aggregate identity. A different type or target is a different aggregate.

Lifecycle:

\[
nonexistent \rightarrow active \rightarrow withdrawn \rightarrow active
\]

Restore uses the same aggregate stream; it does not create a new epoch or ID.

## 4. Deterministic aggregate identity

For normalized target key `k`:

\[
preference\_id = Hash(owner\_actor\_id, preference\_type, k)
\]

Therefore, for one owner/type/target tuple:

\[
\boxed{|PreferenceAggregate(owner,type,target)| \le 1}
\]

Immutable aggregate fields:

- `preference_id`
- `owner_actor_id`
- `preference_type`
- normalized target fields
- `preference_policy_ref`

There is no `visibility`, `scope_ref`, or caller-selected audience field.

## 5. Owner-only audience

Preference is not merely `private` under a visibility enum. Its ontology has a fixed singleton audience:

\[
\boxed{Audience(pref)=\{owner(pref)\}}
\]

No preference schema accepts a visibility override.

The raw Preference surface is owner-only in v0.1. A representative of A may be authorized by another domain to read A's Feed or Inbox, but that does not make the representative a Preference audience member.

Consequently, Preference-derived suppression is applied only when the current viewer is the Preference owner. Representative Feed/Inbox reads remain valid but are not shaped by private Preference state in v0.1.

This avoids leaking a private preference through a representative-visible difference in projection.

## 6. Authority

Preference read and mutation authority are stricter than ordinary representative read authority.

For create/withdraw/restore:

\[
\boxed{principal\_actor\_id = owner\_actor\_id}
\]

Representative status, membership, follows, trust, Reaction, Notification receipt, or any other descriptive state is insufficient.

\[
\boxed{ReadAs(A) \not\Rightarrow SetPreferenceFor(A)}
\]

The Authority policy is `policy:preference-owner:v1`.

## 7. `bookmark_publication`

Target:

```text
publication_id
```

Semantics:

> Save this exact Publication for me.

Creation/restore requires the Publication to be currently active and readable by the owner.

Bookmark is organizational state only:

\[
\boxed{Bookmark(P) \not\Rightarrow Endorse(P)}
\]

\[
\boxed{Bookmark(P) \not\Rightarrow FeedRank(P)}
\]

\[
\boxed{Bookmark(P) \not\Rightarrow DiscoveryAffinity(P)}
\]

A current bookmark list resolves the Publication at read time. If the target is no longer currently readable/active, it is absent from the current bookmark projection while the Preference history remains canonical.

## 8. `dismiss_feed_item`

Target is a stable Feed item key, not a page/snapshot row:

Publication item:

```json
{
  "item_kind": "publication",
  "source_ref": "pub:P1"
}
```

Social activity item:

```json
{
  "item_kind": "social_activity",
  "source_ref": "evt:E1"
}
```

Semantics:

\[
\boxed{DismissFeedItem = ExactFeedItemProjectionSuppression}
\]

It applies to the exact stable Feed item whenever that item appears in a Feed projection for the owner.

It does not mean dislike, distrust, negative affinity, mute, unfollow, or block.

Create/restore requires the target key to resolve to a currently owner-readable valid Feed item source:

- publication item: active readable root Publication;
- social activity item: existing allowlisted `relationship.activated` event whose relationship is currently owner-readable.

## 9. `not_interested_publication`

Target:

```text
publication_id
```

Semantics:

\[
\boxed{NotInterestedPublication = PublicationScopedExplicitNegativePreference}
\]

In v0.1 it suppresses only that exact Publication item from the owner's Feed projection. It does not hide direct Publication access, replies, author Profile, Relationship state, Community state, or Notifications by itself.

It is a stronger semantic signal than `dismiss_feed_item`, but its meaning remains publication-scoped:

\[
NotInterested(P) \not\Rightarrow Mute(Author(P))
\]

\[
NotInterested(P) \not\Rightarrow Unfollow(Author(P))
\]

\[
NotInterested(P) \not\Rightarrow NegativeDiscoveryAffinity
\]

Future Algorithmic Feed may consume this explicit signal only under a separately versioned policy.

## 10. `mute_actor`

Target:

```text
actor_id
```

Semantics:

> Suppress Actor-originated items from my passive projections without changing that Actor's rights or any social relationship.

In v0.1, when the viewer is the owner, an active `mute_actor(B)` suppresses:

### Feed

- root Publication Feed items authored by B;
- Social Activity Feed items whose represented activity directly involves B as an actor endpoint.

This applies to Home Feed and Community Feed.

### Notification Inbox

- current Notification items whose canonical receipt `source_actor_id == B`.

It does not suppress:

- direct Publication URL access;
- Profile access;
- Relationship/Community surfaces;
- Search results;
- Discovery candidates;
- canonical source events;
- another Actor's rights to view or interact.

\[
\boxed{MuteActor \neq BlockActor}
\]

## 11. Projection order

Preference suppression occurs only after the source domain has already established viewer visibility/current eligibility.

Correct:

```text
Canonical source
-> source-domain viewer/current-eligibility projection
-> owner-only Preference projection
-> aggregate / count / sort / snapshot / pagination
```

Forbidden:

```text
all source facts
-> Preference filter
-> visibility filter
```

and forbidden:

```text
visible items
-> aggregate/snapshot
-> Preference filter
```

Thus suppressed items must not affect owner-visible Feed/Inbox counts, ordering, cursors, or snapshot refs.

## 12. Preference privacy and noninterference

Preference data itself is owner-only.

For any non-owner viewer `v`:

\[
\Pi_v(H_{preference}) = \varnothing
\]

A non-owner cannot obtain:

- preference existence;
- preference count;
- preference target;
- preference lifecycle;
- preference timestamps;
- derived `muted=true` / `dismissed=true` flags.

Owner Preference changes must not mutate canonical Publication, Relationship, Community, Reaction, Notification, or Feed histories.

## 13. Current projection

Disposable table:

```text
preferences_current
```

Fields:

```text
preference_id
owner_actor_id
preference_type
target_kind
target_ref
target_item_kind
lifecycle
created_event_id
restored_event_id
withdrawn_event_id
last_event_id
stream_version
materializer_version
```

`target_item_kind` is non-null only for `dismiss_feed_item`.

It is fully rebuildable from `H_preference`.

## 14. Preference surface

Machine surface:

```text
GET /api/preferences
```

Conceptual human surface:

```text
/preferences
```

Both are owner-only.

Returned current active directives are deterministic ordered by:

```text
preference_type ASC,
target_kind ASC,
target_ref ASC,
preference_id ASC
```

Bookmark surface may include current viewer-safe Publication detail references, but never stores copied Publication body in Preference canonical events.

## 15. Feed integration

Owner Home/Community Feed receives an owner-only suppression set after normal Feed candidate generation and visibility filtering.

For Feed item `i`:

```text
dismiss_feed_item(i) active
=> suppress exact i
```

For Publication Feed item `p`:

```text
not_interested_publication(p) active
=> suppress p
```

For item involving muted Actor B:

```text
mute_actor(B) active
=> suppress actor-originated/involved item per section 10
```

Feed chronological ordering among remaining items is unchanged.

Preference changes may change the owner's Feed item set and snapshot ref, but must never change the canonical Feed algorithm, source graph, or underlying canonical source objects.

Representatives do not receive these owner-private suppression effects in v0.1.

## 16. Notification integration

After Notification current-source eligibility is established, the owner's current Inbox applies active `mute_actor` preferences:

```text
notification.source_actor_id == muted_actor_id
=> suppress current item
```

Suppressed Notification receipts remain canonical and retain acknowledgement state.

They do not contribute to owner-visible inbox items, unread count, ordering, cursor, or snapshot.

Representatives do not receive these owner-private suppression effects in v0.1.

`dismiss_feed_item` and `not_interested_publication` do not affect Notification Inbox.

## 17. Discovery and Search boundary

Preference v0.1 does not alter Discovery.

\[
\boxed{Preference \not\Rightarrow DiscoveryAffinity}
\]

Search integration is deferred. Search may later suppress owner-specific results under an explicit Search contract, but v0.1 does not do so.

## 18. Consumption boundary

The following are not Preference events:

- seen
- opened
- read
- dwell
- scroll depth
- hover
- click-through telemetry

\[
\boxed{Preference \neq ConsumptionState}
\]

Reading Feed/Notification/Publication/Preference surfaces must not create Preference events.

## 19. Foundation X1-X3 inheritance

Preference is added to the Foundation machine-readable inheritance registry:

```text
preference: [X1, X2, X3]
```

Specializations:

- **X1:** audience is structurally fixed to `{owner}`; there is no visibility widening operation.
- **X2:** social/descriptive/read state does not grant Preference mutation authority; owner-only mutation is explicit.
- **X3:** private Preference facts do not produce signals to non-owner viewers, and suppressed source items are filtered before owner-visible aggregate/snapshot computation.

## 20. Preference invariants Q1-Q13

### Q1 — Preference is private projection control

\[
\boxed{Preference \neq Relationship \land Preference \neq SocialFact}
\]

### Q2 — One deterministic aggregate per owner/type/target

\[
\boxed{Owner+Type+Target \Rightarrow AtMostOnePreferenceAggregate}
\]

### Q3 — Owner-only singleton audience

\[
\boxed{PreferenceAudience=\{PreferenceOwner\}}
\]

### Q4 — Exact dismiss semantics

\[
\boxed{DismissFeedItem=ExactFeedItemProjectionSuppression}
\]

### Q5 — Explicit publication negative preference

\[
\boxed{NotInterestedPublication=PublicationScopedExplicitNegativePreference}
\]

### Q6 — No semantic escalation

\[
\boxed{PreferenceSignal \not\Rightarrow BroaderSocialOrAffinityFact}
\]

### Q7 — Bookmark is not endorsement or ranking

\[
\boxed{Bookmark \not\Rightarrow Endorsement \lor FeedRanking \lor DiscoveryAffinity}
\]

### Q8 — Mute is not block or source mutation

\[
\boxed{MuteActor \neq BlockActor \land MuteActor \not\Rightarrow SourceMutation}
\]

### Q9 — Owner-only mutation authority

\[
\boxed{PreferenceMutationAuthority=OwnerOnly}
\]

### Q10 — Preference lifecycle is append-only

\[
\boxed{Withdraw/Restore \text{ append events; no in-place canonical update}}
\]

### Q11 — Preference does not rewrite canonical source histories

\[
\boxed{PreferenceMutation \not\Rightarrow CanonicalSourceMutation}
\]

### Q12 — Preference is not consumption telemetry

\[
\boxed{Preference \neq ConsumptionTelemetry}
\]

### Q13 — Owner suppression happens before owner-visible aggregates

\[
\boxed{OwnerVisibleAggregate=Aggregate(PreferenceFilter(VisibleSourceProjection))}
\]

## 21. Acceptance vertical slice

Create Actors A, B, X and public root Publications `P_B`, `P_X`.

A follows B and X. Home Feed initially contains both Publications plus an allowlisted social activity involving B.

### Bookmark

A creates `bookmark_publication(P_B)`.

- Preference current surface contains the bookmark.
- Feed ordering/items do not change because bookmark has no Feed-ranking semantics.
- Publication canonical event count does not change.

### Dismiss

A creates `dismiss_feed_item(feed:activity:E_B)`.

- exact social-activity item disappears from A's Feed;
- B's Publication remains;
- no social/relationship fact changes.

### Not interested

A creates `not_interested_publication(P_X)`.

- exact P_X Publication item disappears from A's Feed;
- X is not muted, unfollowed, or down-ranked in Discovery;
- direct P_X detail remains readable.

### Mute

B creates an eligible Reply/Reaction source that issues a current Notification to A.

A creates `mute_actor(B)`.

- B-authored root Publication items disappear from A's Home/Community Feed;
- social activity items directly involving B disappear;
- current Notification items whose source_actor_id is B disappear;
- underlying Publication/Relationship/Notification receipts remain canonical;
- direct B Publication/Profile remains readable;
- Discovery output is unchanged.

### Owner-only privacy

A's explicit representative R reads A's Feed/Inbox:

- existing representative read authorization still works;
- A's private Preference list is unavailable to R;
- v0.1 Preference suppression is not applied to R's projection of A's Feed/Inbox.

R cannot create, withdraw, or restore A's Preference.

### Lifecycle

A withdraws `mute_actor(B)`:

- same Preference aggregate becomes withdrawn;
- B-originated Feed/Inbox items can reappear if otherwise currently eligible.

A restores the same preference:

- same deterministic Preference ID;
- new `preference.restored` event;
- suppression resumes.

### Destructive rebuild

Delete `preferences_current`, replay `H_preference`, and require before/after equality.

Verify Preference stream hash chains.

## 22. Freeze definition

Personal Preference v0.1 is frozen as:

\[
\boxed{
ExplicitPrivateDirective
+
OwnerSingletonAudience
+
AppendOnlyLifecycle
+
ProjectionControlOnly
+
NoSemanticEscalation
}
\]

The next layer may be Consumption State, but it must remain a separate domain with separate retention and privacy semantics.
