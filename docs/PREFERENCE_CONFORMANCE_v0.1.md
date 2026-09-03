# Trellis Personal Preference v0.1 Conformance

Canonical design: `docs/superpowers/specs/2026-09-03-trellis-personal-preference-v0.1-design.md`.

Foundation inheritance: `preference -> [X1, X2, X3]` in `foundation/cross-domain-contract.js`.

## Q1-Q13 executable mapping

- **Q1 — Preference is private projection control:** `test/preference-cross-domain.test.js`, `test/preference-conformance.test.js`; service exposes only Preference lifecycle commands and never Relationship/Block APIs.
- **Q2 — One deterministic aggregate per owner/type/target:** `test/preference-fold.test.js`, `test/preference-conformance.test.js`; deterministic ID and immutable `preference_id/owner/type/target` are fold-enforced.
- **Q3 — Owner-only singleton audience:** `test/preference-surface.test.js`, `test/preference-cross-domain.test.js`; no visibility field exists and representative/non-owner raw reads are denied.
- **Q4 — Exact dismiss semantics:** `test/preference-feed-integration.test.js`; exact stable Publication or Social Activity Feed item only.
- **Q5 — Publication-scoped not-interested:** `test/preference-feed-integration.test.js`; exact Publication Feed item disappears while direct Publication remains readable.
- **Q6 — No semantic escalation:** `test/preference-cross-domain.test.js`, `test/preference-conformance.test.js`; Discovery is unchanged and no mute/unfollow/trust mutation is derived.
- **Q7 — Bookmark is not endorsement/ranking:** `test/preference-feed-integration.test.js`, `test/preference-cross-domain.test.js`; Feed and Discovery stay identical after bookmark-only mutation.
- **Q8 — Mute is not block/source mutation:** `test/preference-feed-integration.test.js`, `test/preference-notification-integration.test.js`, `test/preference-conformance.test.js`; only owner passive projections are suppressed.
- **Q9 — Owner-only mutation authority:** `test/preference-service.test.js`, `test/preference-cross-domain.test.js`; representative state never grants create/withdraw/restore.
- **Q10 — Append-only lifecycle:** `test/preference-fold.test.js`, `test/preference-service.test.js`, `test/preference-conformance.test.js`; withdraw/restore append on one stream.
- **Q11 — No canonical source rewrite:** `test/preference-cross-domain.test.js`, `test/preference-conformance.test.js`; non-Preference stream event counts remain unchanged.
- **Q12 — Preference is not consumption telemetry:** `test/preference-conformance.test.js`; no seen/read/dwell/scroll command surface exists.
- **Q13 — Preference filter before owner aggregates:** `test/preference-feed-integration.test.js`, `test/preference-notification-integration.test.js`; suppression occurs before Feed/Inbox snapshot and unread aggregate computation.

## Destructive rebuild and integrity

`test/preference-rebuild.test.js` and `test/preference-conformance.test.js` delete `preferences_current`, replay `H_preference`, require row equality, and verify Preference hash chains.

## Release syntax gate

`npm run check` explicitly includes `preference/*.js`.
