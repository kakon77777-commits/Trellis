# Trellis Notification v0.1 Conformance

**Status:** SEALED RELEASE GATE
**Spec:** `docs/superpowers/specs/2026-09-03-trellis-notification-v0.1-design.md`
**Foundation contract:** `docs/specs/2026-09-02-trellis-foundation-cross-domain-contract-v0.1.md`

## Foundation inheritance

`foundation/cross-domain-contract.js` declares:

```text
notification -> X1, X2, X3
```

- **X1:** every Notification receipt has immutable `visibility=private` and singleton recipient audience.
- **X2:** Notification processor issuance requires explicit `notification:issue` capability; Inbox read/action hints do not grant source-domain mutation authority; Ack is separately recipient-authorized.
- **X3:** source eligibility is checked before issuance, and current Inbox filters source-current eligibility before counts/order/snapshot/cursor.

## N-series executable mapping

| Invariant | Executable coverage |
| --- | --- |
| N1 `NotificationReceipt != SourceSocialFact` | `notification-fold.test.js`, `notification-conformance.test.js`: receipt stores refs/provenance only, no source body/preview copies. |
| N2 `NotificationContext = ViewerRelativeSourceProjection` | `notification-inbox.test.js`, `notification-cursor.test.js`: current Publication/Reaction context is rehydrated at read time. |
| N3 singleton recipient audience | `notification-fold.test.js`, `notification-conformance.test.js`: canonical visibility is fixed `private`; recipient is immutable. |
| N4 issue only after recipient eligibility | `notification-processor.test.js`: policy-hidden source creates zero `notification.issued` events. |
| N5 invisible source -> no current signal | `notification-inbox.test.js`, `notification-conformance.test.js`: policy-hidden source disappears before aggregation. |
| N6 historical issuance != current visibility | `notification-inbox.test.js`, `notification-conformance.test.js`: withdrawn/inactive, current-policy-hidden, and membership-lost are separate cases; receipt history remains. Reaction restore uses activation-epoch matching so an old created receipt cannot reappear. |
| N7 fetch != Ack | `notification-inbox.test.js`, `notification-ack.test.js`: GET/build surface leaves canonical event count unchanged. |
| N8 recipient-only Ack | `notification-ack.test.js`: unrelated and representative actors are denied; source-ineligible receipt returns `NOTIFICATION_NOT_VISIBLE`. |
| N9 recipient+source-event+rule at most one receipt | `notification-processor.test.js`: deterministic ID and retries produce one canonical issuance. |
| N10 rule version pinned | `notification/types.js`, `notification-processor.test.js`: reply/reaction v1 rule refs are canonical payload fields. |
| N11 source commit independent from Notification | `notification-processor.test.js`: processor denial/failure does not roll back the already-canonical source event. |
| N12 source edit does not resurface | `notification-inbox.test.js`, `notification-cursor.test.js`: Reaction change / Publication revision update current context but retain issuance order; changed Reaction creates no new receipt. |
| N13 action hint != authorization | `notification-surface.test.js`, `notification-conformance.test.js`: hints are advisory and no source mutation shortcut is exported. |

## Cross-domain non-signal

`notification-cross-domain.test.js` proves `notification.issued` and `notification.acknowledged` do not change Feed v0.1 or Discovery v0.1 output when source social state is unchanged.

## Projection/rebuild and integrity

- `notification-rebuild.test.js` deletes `notifications_current` and rebuilds byte-equivalent row state from `H_notification`.
- `notification-conformance.test.js` verifies Notification stream hash chains.
- `notifications_current` is projection-only; source domains remain independently canonical.

## Release syntax gate

`npm run check` includes `notification/*.js` so every shipped Notification module is parsed by Node before release.
