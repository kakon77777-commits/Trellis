# Trellis Reaction v0.1 Design

**Date:** 2026-09-03
**Status:** FROZEN DESIGN
**Canonical repo:** `kakon77777-commits/Trellis`
**Branch:** `reaction/v0.1`
**Base:** `feed/v0.1`
**Depends on:** Foundation X1-X3, Publication v0.1, Feed v0.1

## 1. Purpose

Reaction is Trellis' explicit social-response primitive. It records an Actor's explicit response to a Publication without converting that response into a Relationship, verification claim, recommendation score, or feed-ranking signal.

\[
\boxed{Reaction = Actor \xrightarrow{reaction} Publication}
\]

Reaction is distinct from private preference and consumption telemetry:

\[
\boxed{Reaction \neq Preference \neq ConsumptionTelemetry}
\]

Bookmarks, dismissals, not-interested signals, seen/read state, dwell time, and similar data are non-goals for v0.1.

## 2. Canonical domain

Reaction is a new canonical append-only stream type:

```text
stream_type = reaction
```

The canonical history is `H_reaction`. `reactions_current` is only a rebuildable materialized projection.

Reaction does not reuse Entity assertions, Relationship events, or Publication revision events.

## 3. Foundation inheritance

Reaction declares machine-readable inheritance of:

```text
X1 canonical_visibility_ceiling
X2 descriptive_state_does_not_grant_authority
X3 viewer_noninterference
```

Reaction-specific rules below specialize these invariants; they do not redefine them.

## 4. Event algebra and taxonomy

The canonical event algebra is fixed to:

```text
reaction.created
reaction.changed
reaction.withdrawn
reaction.restored
```

Reaction type is payload data, not event type. v0.1 taxonomy:

```text
like
love
celebrate
insightful
curious
```

Adding a reaction type does not require a new canonical event type.

## 5. Aggregate identity

There is exactly one Reaction aggregate for each `(actor_id, publication_id)` pair.

\[
\boxed{\forall(a,p),\; |ReactionAggregate(a,p)| \le 1}
\]

The canonical Reaction ID is deterministically derived from both immutable endpoints:

```text
reaction_id = deriveId('reaction', `${actor_id}|${publication_id}`)
```

The aggregate stream survives withdraw/restore cycles. Withdrawal never creates a new epoch or a second Reaction ID.

Immutable identity fields:

```text
reaction_id
actor_id
publication_id
scope_ref
visibility
audience_actor_ids
reaction_policy_ref
```

`reaction_type` is mutable current state inside that aggregate.

## 6. Lifecycle

Lifecycle states:

```text
nonexistent
active
withdrawn
```

Valid transitions:

```text
nonexistent -> created(type) -> active
active -> changed(type) -> active
active -> withdrawn -> withdrawn
withdrawn -> restored(type) -> active
```

Invalid transitions include duplicate create, change while withdrawn, second withdrawal, and restore while active.

`reaction.restored` carries the newly active `reaction_type` explicitly. Restore does not silently resurrect the last historical type; the caller must state the intended current type.

## 7. Publication-derived audience ceiling

Reaction v0.1 does not support an independent audience choice.

At create time:

```text
scope_ref = target.scope_ref
visibility = target.visibility
audience_actor_ids = target.audience_actor_ids
```

Thus:

\[
\boxed{Audience(reaction)=Audience(publication)}
\]

and therefore satisfies the more general bound:

\[
\boxed{Audience(reaction)\subseteq Audience(publication)}
\]

These canonical audience fields are immutable after creation. Current Publication disclosure policy may narrow effective Reaction exposure but can never widen the Reaction above its canonical ceiling.

## 8. Readability before mutation

Create, change, and restore require the target Publication to be:

1. canonical and present;
2. lifecycle `active`;
3. readable to the reacting Actor under the current Publication read policy.

The readability check uses the reacting Actor as viewer context and reuses Publication membership/disclosure semantics.

A withdrawn Publication denies Reaction create/change/restore.

Reaction withdrawal is different: the Reaction owner may withdraw their own existing active Reaction even if the target Publication has since been withdrawn or is no longer currently readable. This allows retraction of one's own social assertion without revealing target body content.

## 9. Authority

Reaction uses an explicit policy family:

```text
policy:reaction-on-readable-publication:v1
```

For create/change/restore, Authority requires:

```text
principal_actor_id == reaction.actor_id
publication_readable == true
publication_active == true
```

For withdraw, Authority requires:

```text
principal_actor_id == reaction.actor_id
reaction_state.lifecycle == active
```

Membership, follow, trust, collaboration, delegation, Discovery score, Feed position, or Publication authorship do not themselves grant Reaction mutation authority.

Readability may depend on membership, but membership is a condition in the target read policy rather than a Reaction capability grant.

## 10. Commands

Product command surface:

```text
createReaction
changeReaction
withdrawReaction
restoreReaction
```

Every command must preserve existing Trellis command discipline:

```text
idempotency gate
-> semantic preflight
-> canonical target/read checks
-> Authority
-> EventStore append
-> projection update
```

Successful idempotent retries return the prior accepted result. Stale expected-version writes remain version conflicts.

## 11. Projection

`reactions_current` is disposable and rebuildable from `H_reaction`.

Columns:

```text
reaction_id
actor_id
publication_id
scope_ref
visibility
audience_actor_ids_json
reaction_policy_ref
lifecycle
reaction_type
created_event_id
last_event_id
stream_version
materializer_version
```

For lifecycle `withdrawn`, `reaction_type` in the current projection is `NULL`. Historical types remain only in canonical events/fold history.

Deleting `reactions_current` and replaying all `stream_type='reaction'` streams must reproduce the same projection.

## 12. Viewer-relative Reaction visibility

A Reaction can be surfaced only when its target Publication is itself viewer-readable under current policy.

Reaction v0.1 has no separate per-Reaction disclosure override. Therefore once the target Publication is viewer-readable, an active Reaction derived from that Publication's canonical audience is viewer-readable too.

If the target is `NOT_VISIBLE`, the Reaction subsystem returns no summary/list signal for that target.

If the target is withdrawn, current Publication surfaces omit Reaction summary/list data even though `H_reaction` remains intact.

## 13. Reaction summary

Publication Surface may be decorated with:

```json
{
  "reaction_summary": {
    "like": 12,
    "love": 3,
    "insightful": 5
  },
  "viewer_reaction": {
    "reaction_id": "reaction:...",
    "type": "insightful",
    "lifecycle": "active"
  }
}
```

Only active viewer-visible Reactions count.

\[
\boxed{ReactionCount_v = Count(VisibleActiveReactions_v)}
\]

Counts and type buckets are computed only after Publication/Reaction visibility resolution. No canonical total is exposed as a fallback.

## 14. Reaction listing

Machine read surface:

```text
GET /api/publications/{publication_id}/reactions
```

The service returns current viewer-visible active Reactions for a viewer-readable active Publication. v0.1 does not expose a public full Reaction event-history page.

The read result may include:

```text
reaction_id
actor_id
reaction_type
```

Current Reaction listing order is deterministic: `actor_id ASC, reaction_id ASC`.

but does not include credentials, authority receipts, hidden Publication content, or historical withdrawn types.

## 15. Publication Surface integration

Publication Surface remains the owning content surface. Reaction code decorates an already viewer-filtered Publication Surface; it does not create a second Publication truth.

If Publication is unreadable: return `null` before Reaction queries.

If Publication is withdrawn: omit `reaction_summary` and `viewer_reaction` from the current surface.

Available Reaction actions are advisory only:

```text
react
change_reaction
withdraw_reaction
restore_reaction
```

\[
\boxed{ReactionActionHint \neq AuthorizationGrant}
\]

Mutation always re-enters Reaction command services and rechecks canonical state and Authority.

## 16. Feed boundary

Feed v0.1 remains deterministic chronological Feed.

Reaction events and Reaction counts are not Feed candidate sources and do not alter Feed sort order, source graph, snapshot, or cursor.
Feed v0.1 therefore requests the viewer-safe Publication projection with `includeReactionDecoration=false`; Reaction remains available on Publication detail surfaces without entering Feed item material or Feed snapshot inputs.

\[
\boxed{Reaction \not\Rightarrow FeedRanking}
\]

## 17. Discovery boundary

Discovery v0.1 does not consume Reaction type, Reaction count, shared Reaction behavior, or Reaction history as affinity signals.

\[
\boxed{Reaction \not\Rightarrow DiscoveryAffinity}
\]

## 18. Relationship and verification boundaries

A Reaction never creates or implies a Trellis Relationship:

\[
\boxed{Reaction \not\Rightarrow RelationshipMutation}
\]

A Reaction is not evidence that a Publication is true, safe, trusted, endorsed, or verified:

\[
\boxed{Reaction \neq Verification}
\]

Reaction labels such as `insightful` remain social responses, not epistemic certificates.

## 19. Preference and telemetry boundaries

Excluded from Reaction taxonomy:

```text
bookmark
save
pin_for_me
dismiss
not_interested
hide_from_feed
seen
opened
read
dwell
```

Private preferences and consumption telemetry require separate future authority, visibility, retention, and canonicality decisions.

## 20. Notification boundary

Reaction events may later become Notification candidates, but Reaction does not create an inbox or delivery state in v0.1.

\[
Reaction \neq Notification
\]

## 21. E-series invariants

### E1
\[
\boxed{Reaction \neq Relationship}
\]

### E2
\[
\boxed{ReactionType \neq ReactionEventType}
\]

### E3
\[
\boxed{OneReactionAggregatePerActorPublication}
\]

### E4
\[
\boxed{ReactionActor\text{ is immutable}}
\]

### E5
\[
\boxed{ReactionTarget\text{ is immutable}}
\]

### E6
\[
\boxed{ReactionAudience\subseteq PublicationAudience}
\]

v0.1 specialization: equality at creation.

### E7
\[
\boxed{ReactionCount_v=Count(VisibleActiveReactions_v)}
\]

### E8
\[
\boxed{Reaction\not\Rightarrow RelationshipMutation}
\]

### E9
\[
\boxed{Reaction\not\Rightarrow FeedRanking}
\]

### E10
\[
\boxed{Reaction\not\Rightarrow DiscoveryAffinity}
\]

### E11
\[
\boxed{Reaction\neq Verification}
\]

### E12
\[
\boxed{ReactionActionHint\neq AuthorizationGrant}
\]

## 22. X1-X3 specializations

Reaction inherits the Foundation cross-domain contract.

**X1:** Reaction canonical audience equals the target Publication canonical audience at Reaction creation and never widens afterward. Current Publication disclosure may only narrow effective exposure.

**X2:** Publication readability and social membership are descriptive conditions, not mutation grants. Reaction mutation requires an independent Authority decision with the reacting Actor as principal Actor.

**X3:** If two canonical worlds differ only in Reaction/Publication facts invisible to viewer `v`, every Reaction-derived output visible to `v` remains identical: summary buckets, visible Reaction list, viewer Reaction state, action hints, and owning Publication decoration.

## 23. Acceptance vertical slice

1. Actor A creates public Publication P1.
2. B reads P1 and creates `like`.
3. C reads P1 and creates `insightful`.
4. Public P1 surface reports `like=1`, `insightful=1`.
5. B changes `like -> love`; aggregate ID is unchanged and summary becomes `love=1`, `insightful=1`.
6. B withdraws; B's same aggregate becomes `withdrawn`, current type becomes null, and `love` drops to zero.
7. B restores the same aggregate explicitly as `love`; target active/readable/Authority are rechecked.
8. Create private Community Publication P2 with `scope_members` visibility.
9. Active member B may react after P2 is readable to B.
10. Outsider X gets `NOT_VISIBLE` for P2 and no Reaction summary/list signal.
11. P2 is withdrawn. Its current surface omits Reaction summary. B may still withdraw B's own active Reaction, but cannot create/change/restore while P2 is withdrawn.
12. Add an unrelated hidden Publication and hidden Reaction; P1's viewer-visible Reaction projection remains byte-for-byte identical.
13. Delete `reactions_current`, rebuild only from canonical Reaction streams, and verify `Before == After`.
14. Verify all Reaction stream hash chains.
15. Verify Reaction operations do not alter Feed order/snapshot and do not mutate Relationship streams.

## 24. Non-goals

v0.1 does not implement bookmarks, saves, seen/read receipts, dwell telemetry, not-interested/dismiss state, algorithmic Feed ranking, Reaction-derived Discovery, notifications, Reaction moderation, reaction-history UI, anonymous reactions, or independent Reaction privacy controls.

## 25. Freeze definition

Trellis Reaction v0.1 is frozen as:

\[
\boxed{
ExplicitSocial
+ PublicationTargeted
+ DeterministicAggregateIdentity
+ AudienceBounded
+ ViewerFiltered
+ AuthorityRechecked
+ AppendOnlyLifecycle
}
\]
