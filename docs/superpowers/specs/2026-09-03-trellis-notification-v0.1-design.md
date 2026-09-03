# Trellis Notification v0.1 Design

**Date:** 2026-09-03
**Status:** FROZEN DESIGN
**Canonical repo:** `kakon77777-commits/Trellis`
**Branch:** `notification/v0.1`
**Base:** `reaction/v0.1`
**Depends on:** Foundation X1-X3, Publication v0.1, Reaction v0.1, Feed v0.1

## 1. Purpose

Notification is Trellis' recipient-private operational inbox primitive. It records that a versioned Notification rule issued a durable receipt for a recipient because an already-canonical source event was eligible at issuance time.

Notification does not become a second copy of the source social fact:

\[
\boxed{NotificationReceipt \neq SourceSocialFact}
\]

Notification v0.1 supports an in-product inbox and explicit acknowledgment. It does not provide email, push, webhook, SMS, device delivery, seen/opened/dwell telemetry, mute preferences, or ranking signals.

## 2. Canonical domain and derived candidate boundary

Notification uses a new append-only canonical stream type:

```text
stream_type = notification
```

The canonical history `H_notification` records operational issuance and acknowledgment only. A Notification candidate is derived from a source canonical event and a versioned rule; the candidate itself is not canonical.

The required flow is:

```text
canonical source event
-> versioned rule derives possible recipient
-> recipient visibility/current-source eligibility check
-> deterministic notification candidate
-> notification.issued
-> rebuildable current projection
-> viewer-relative current inbox
```

A source commit never depends on Notification success:

\[
\boxed{SourceCommit \not\Rightarrow NotificationDeliveryDependency}
\]

A failed Notification processor must not roll back or invalidate Publication, Reaction, Relationship, Community, or other source-domain history.

## 3. Foundation inheritance

Notification declares machine-readable inheritance of:

```text
X1 canonical_visibility_ceiling
X2 descriptive_state_does_not_grant_authority
X3 viewer_noninterference
```

Notification-specific invariants specialize these rules; they do not redefine them.

## 4. Event algebra

The canonical event algebra is fixed to:

```text
notification.issued
notification.acknowledged
```

There is no `seen`, `opened`, `read`, `clicked`, `dismissed`, `muted`, or delivery-channel event in v0.1.

Fetching or rendering an inbox is read-only:

\[
\boxed{FetchNotification \not\Rightarrow AcknowledgeNotification}
\]

## 5. Notification aggregate identity

Each issuance receipt has immutable identity:

```text
notification_id
recipient_actor_id
notification_type
source_event_ref
source_object_ref
source_actor_id
rule_ref
visibility = private
```

The canonical ID is deterministic:

```text
notification_id = deriveId(
  'notification',
  `${recipient_actor_id}|${source_event_ref}|${rule_ref}`
)
```

Therefore the same recipient, source event, and rule version produce at most one Notification aggregate:

\[
\boxed{Recipient+SourceEvent+Rule \Rightarrow AtMostOneReceipt}
\]

Processor retries are idempotent and cannot create duplicate receipts.

## 6. Recipient-private canonical audience

Notification v0.1 has exactly one canonical recipient and no audience override:

\[
\boxed{Audience(notification)=\{recipient\}}
\]

The canonical visibility is always `private` and immutable. This is Notification's X1 specialization.

A Notification receipt does not become public merely because its source Publication is public.

## 7. No source-content copy

`notification.issued` stores source references and rule provenance, never source body or generated preview content.

Forbidden canonical fields include:

```text
cached_publication_body
cached_reply_preview
cached_reaction_text
cached_profile_name
```

Current display context is resolved from the source domain at read time:

\[
\boxed{NotificationContext_{n,v}(t)=\Pi_v(SourceCurrentState,t)}
\]

Thus source edits may update current context but never change Notification issuance order or create a new receipt.

## 8. Rule set v0.1

Notification rules are version-pinned policy, not permanent social ontology.

### 8.1 Reply rule

```text
rule_ref = trellis-notification:reply:v1
notification_type = reply_to_your_publication
source event = publication.created
precondition = source publication has reply_to_ref
recipient = parent publication author
source actor = reply publication author
source object = reply publication
```

The recipient must be able to read the active reply Publication at issuance time. Self replies are suppressed.

### 8.2 Reaction rule

```text
rule_ref = trellis-notification:reaction:v1
notification_type = reaction_to_your_publication
source event = reaction.created OR reaction.restored
recipient = target publication author
source actor = reaction actor
source object = reaction aggregate
```

At issuance time the target Publication must be active and readable to the recipient, and the Reaction must be active/currently readable through that target. Self reactions are suppressed.

`reaction.changed` never creates a new Notification. `reaction.withdrawn` never creates a Notification. A later `reaction.restored` is a new explicit social action and may issue a new receipt because it has a new source event ID.

## 9. Write-time recipient eligibility

A canonical Notification receipt may be issued only after the processor proves the proposed recipient can currently observe the source social action.

\[
\boxed{Issue(n,r,t_0) \Rightarrow CurrentSourceEligible_r(Source(n),t_0)}
\]

The processor order is:

```text
load source canonical event
-> derive rule and proposed recipient
-> self-suppression check
-> load current source-domain state
-> current lifecycle check
-> recipient readability/visibility check
-> deterministic notification ID
-> idempotency gate
-> append notification.issued
```

It is forbidden to issue a receipt first and rely on inbox filtering later to hide an ineligible source.

Therefore:

\[
\boxed{NoVisibleSource \Rightarrow NoCanonicalReceipt}
\]

## 10. Issuance eligibility and current inbox eligibility are distinct

Eligibility is evaluated at two different times:

\[
\boxed{IssueEligibility_r(e,t_0) \neq CurrentInboxEligibility_r(n,t)}
\]

A historically valid receipt remains in `H_notification`, but current inbox membership is recomputed against current source state.

Define:

\[
CurrentSourceEligible_r(s,t)
=
Active(s,t)
\land
Readable_r(s,t)
\land
CurrentContextValid_r(s,t)
\]

A current Notification item may be shown only if its source remains currently eligible.

This explicitly covers three separate removal triggers:

1. **source withdrawn/inactive:** `Active = false`;
2. **current disclosure policy hides source:** `Readable = false`;
3. **recipient loses required Community membership or other read context:** `CurrentContextValid/Readable = false`.

These triggers remove the receipt from the current inbox projection without erasing `notification.issued` from canonical history.

\[
\boxed{HistoricalReceipt \neq CurrentInboxMembership}
\]

## 11. Source-specific current eligibility

### 11.1 Reply notification

The source reply Publication must currently be `active` and readable to the recipient. If the reply is withdrawn, current-policy-hidden, or becomes unreadable because the recipient loses required Community membership, the Notification is absent from the current inbox.

The parent Publication may supply current contextual metadata only if its own Publication projection permits that context. Notification never preserves a stale parent preview.

### 11.2 Reaction notification

The source Reaction aggregate must currently be `active`, and the target Publication must currently be `active` and readable to the recipient.

If the Reaction is withdrawn, the existing Notification disappears from the current inbox. If the target Publication is withdrawn or becomes unreadable, the Notification also disappears.

A Reaction receipt is current only when its `source_event_ref` is the activation event for the Reaction's current active epoch: the original `reaction.created` event until withdrawal, or the most recent `reaction.restored` event after restoration. Therefore an old `reaction.created` Notification cannot reappear merely because the same Reaction aggregate is restored later; the restore event may issue its own new receipt.

A `reaction.changed` event does not start a new activation epoch. It can change current reaction context shown by the existing Notification, but cannot issue or resurface the Notification.

## 12. Current inbox filtering and aggregation

The required read order is:

```text
recipient notification receipts
-> current source-domain eligibility check per receipt
-> discard ineligible receipts
-> apply acknowledged/unacknowledged state
-> aggregate/count/order
-> paginate/render
```

Never:

```text
count/order all receipts
-> hide inaccessible receipts afterward
```

Unread count is:

\[
\boxed{UnreadCount_r=Count(CurrentlyVisibleUnacknowledgedNotifications_r)}
\]

An invisible or inactive source contributes nothing to item count, unread count, page boundaries, ordering, last-notification fields, snapshot references, or cursors.

## 13. Acknowledgment authority

Only the canonical recipient may acknowledge a currently visible Notification:

\[
\boxed{AckAuthority(n)=RecipientOnly}
\]

Representative read authority does not grant acknowledgment authority in v0.1.

The acknowledgment command order is:

```text
load notification aggregate
-> verify principal_actor_id == recipient_actor_id
-> verify notification is currently visible in recipient inbox
-> idempotency gate
-> append notification.acknowledged
```

An already acknowledged Notification returns its accepted idempotent result for the same command key and rejects conflicting stale writes under normal EventStore rules.

If the receipt is no longer current-inbox-visible, the public ack path returns `NOT_VISIBLE` rather than acting as a notification-ID existence oracle.

## 14. Projection

`notifications_current` is a disposable materialized projection with fields:

```text
notification_id
recipient_actor_id
notification_type
source_event_ref
source_object_ref
source_actor_id
rule_ref
visibility
acknowledged
issued_event_id
acknowledged_event_id
issued_recorded_at
issued_global_offset
stream_version
```

It must be fully rebuildable from `H_notification`.

Deleting `notifications_current` cannot alter source social domains or canonical Notification history.

## 15. Inbox ordering

Current inbox ordering is deterministic descending issuance order:

\[
K(n)=(issued\_recorded\_at,issued\_global\_offset,notification\_id)
\]

Source edits, Reaction changes, Publication revisions, or changed context do not resurface the Notification:

\[
\boxed{SourceEdit \not\Rightarrow NotificationResurface}
\]

## 16. Snapshot and cursor

Inbox snapshot input contains only recipient-visible current Notification items plus acknowledgment state, source-derived current safe context, rule refs, algorithm/projection versions, and recipient identity.

It must not hash hidden/inactive source facts or raw canonical totals.

Algorithm reference:

```text
trellis-notification-inbox:v1
```

Cursor shape:

```text
algorithm_ref
snapshot_ref
last_issued_recorded_at
last_issued_global_offset
last_notification_id
```

If current visible inbox state changes, a stale cursor returns:

```text
NOTIFICATION_SNAPSHOT_CHANGED
```

A hidden-only source change leaves items, unread count, ordering, snapshot, and cursor validity unchanged.

## 17. Inbox surface

Machine surface:

```text
GET /api/notifications
POST /api/notifications/{notification_id}/ack
```

Human surface:

```text
/notifications
```

HTML and JSON render the same already-filtered inbox object:

\[
\boxed{VisibleFacts(HTML)=VisibleFacts(JSON)}
\]

Renderers do not import EventStore/database modules and cannot acknowledge Notification state.

## 18. Action hints

Inbox items may expose advisory navigation/product actions such as:

```text
open_source
reply
open_actor
```

These are presentation hints only:

\[
\boxed{NotificationActionHint \neq AuthorizationGrant}
\]

Any source-domain mutation re-enters the owning Publication, Reaction, Relationship, or Community command path and performs its own Authority check.

## 19. Cross-domain non-signals

Notification state does not affect Feed or Discovery v0.1:

\[
\boxed{Notification \not\Rightarrow FeedRanking}
\]

\[
\boxed{Notification \not\Rightarrow DiscoveryAffinity}
\]

Acknowledgment does not alter Publication, Reaction, Relationship, Community, Feed ordering, or Discovery ranking.

## 20. Processor and delivery transport

v0.1 exposes an idempotent semantic processor:

```text
processSourceEvent(event_id)
```

No queue is required for v0.1. A future outbox/queue may call the same processor contract without changing Notification semantics.

No historical backfill is automatic when a new rule version is introduced:

\[
\boxed{NewRule \not\Rightarrow HistoricalNotificationFlood}
\]

Backfill requires a separately specified explicit operation.

## 21. Non-goals

Notification v0.1 does not implement:

```text
email/push/webhook/SMS delivery
mobile device tokens
seen/open/read/click/dwell telemetry
mute/snooze/dismiss/not-interested preferences
notification-type preferences
representative acknowledgment
historical audit UI
rule backfill
queue/outbox infrastructure
notification-driven Feed ranking
notification-driven Discovery affinity
```

## 22. Notification invariants N1-N13

### N1 — Receipt is not source truth

\[
\boxed{NotificationReceipt \neq SourceSocialFact}
\]

### N2 — Context is viewer-relative current source projection

\[
\boxed{NotificationContext=ViewerRelativeSourceProjection}
\]

### N3 — Singleton recipient audience

\[
\boxed{Audience(notification)=\{recipient\}}
\]

### N4 — Issue only after recipient source-eligibility check

\[
\boxed{Issue \Rightarrow RecipientVisibilityAndCurrentEligibilityCheck}
\]

### N5 — Invisible source produces no current signal

\[
\boxed{InvisibleSource \not\Rightarrow CurrentNotificationSignal}
\]

### N6 — Historical issuance does not guarantee current visibility

\[
\boxed{IssuedHistorically \not\Rightarrow VisibleCurrently}
\]

Executable N6 coverage must test separately:

```text
issued -> source withdrawn/inactive -> absent from current inbox
issued -> source current-policy-hidden -> absent from current inbox
issued -> required membership lost -> absent from current inbox
```

In all three cases, the historical `notification.issued` event remains canonical.

### N7 — Fetch is read-only

\[
\boxed{FetchNotification \not\Rightarrow Ack}
\]

### N8 — Recipient-only acknowledgment

\[
\boxed{AckAuthority=RecipientOnly}
\]

### N9 — At-most-one receipt per recipient/source-event/rule

\[
\boxed{Recipient+SourceEvent+Rule \Rightarrow AtMostOneReceipt}
\]

### N10 — Rule is version-pinned

\[
\boxed{NotificationRule\text{ is version-pinned}}
\]

### N11 — Source commit is independent of Notification processing

\[
\boxed{SourceCommit \not\Rightarrow NotificationDeliveryDependency}
\]

### N12 — Source edit does not resurface Notification

\[
\boxed{SourceEdit \not\Rightarrow NotificationResurface}
\]

### N13 — Action hint is not authorization

\[
\boxed{NotificationActionHint \neq AuthorizationGrant}
\]

## 23. Acceptance vertical slice

Create Actors `A`, `B`, `C`.

1. `A` creates active public Publication `P1`.
2. `B` creates active reply `P2 -> P1`.
3. Process `P2`'s `publication.created` event:
   - recipient = `A`;
   - current-source eligibility passes;
   - issue `N1` using `trellis-notification:reply:v1`.
4. `C` reacts `insightful` to `P1`.
5. Process `reaction.created`:
   - issue `N2` to `A` using `trellis-notification:reaction:v1`.
6. `A` fetches Inbox:

```text
N2
N1
unread_count = 2
```

Canonical event count must not change merely because Inbox was fetched.

7. `A` acknowledges `N1`; current unread count becomes `1`.
8. `C` changes Reaction `insightful -> love`:
   - no new Notification;
   - `N2` keeps original issuance sort key;
   - current safe Reaction context may show `love`.
9. `C` withdraws Reaction:
   - `N2` disappears from current Inbox;
   - historical `notification.issued` for `N2` remains.
10. `C` restores Reaction as `love`:
    - process `reaction.restored`;
    - issue new receipt `N3` because source event is new.

N6 independent cases:

- withdraw an issued reply source -> its Notification disappears, receipt history remains;
- narrow current disclosure so the issued reply is unreadable to `A` -> Notification disappears, receipt history remains;
- create an issued private-Community reply, then remove `A`'s membership required to read it -> Notification disappears, receipt history remains.

Write-time N4 case:

- create a source action that proposed recipient `A` cannot read at processing time;
- `processSourceEvent` must create **no `notification.issued` event at all**.

Finally:

```text
DELETE notifications_current
-> replay H_notification
```

Before/after materialized Notification state must be identical.

Adding or changing source facts invisible to `A` must leave current Inbox items, unread count, ordering, cursor boundaries, and `snapshot_ref` identical.

## 24. Freeze statement

Trellis Notification v0.1 is frozen as:

\[
\boxed{
\text{Derived Candidate}
+
\text{Operational Receipt}
+
\text{No Content Copy}
+
\text{Recipient-Filtered First}
+
\text{Current-Source Revalidation}
+
\text{Explicit Ack}
}
\]

Notification preserves historical evidence that a rule issued a receipt while refusing to turn that historical receipt into permanent current-inbox visibility or a duplicate copy of social truth.
