# Trellis Reaction v0.1 Conformance

Canonical design: `docs/superpowers/specs/2026-09-03-trellis-reaction-v0.1-design.md`.

Foundation inheritance: `reaction -> X1, X2, X3` in `foundation/cross-domain-contract.js`.

## Executable gates

- `test/reaction-fold.test.js` — deterministic aggregate identity, event algebra, immutable endpoints/audience, withdraw/restore lifecycle.
- `test/reaction-rebuild.test.js` — disposable `reactions_current` and destructive replay from canonical Reaction streams.
- `test/reaction-service.test.js` — active/readable Publication preconditions, independent Authority, idempotency, stale-version rejection, target-derived audience, owner withdrawal after target withdrawal.
- `test/reaction-surface.test.js` — target-first visibility, active-only counts, withdrawn viewer state, deterministic listing, X3 hidden-fact noninterference.
- `test/reaction-publication-integration.test.js` — Publication detail decoration and advisory-only Reaction actions.
- `test/reaction-boundaries.test.js` — Reaction does not mutate Relationships and does not alter Feed v0.1 items/snapshot or Discovery v0.1 candidates/snapshot.
- `test/reaction-cross-domain.test.js` — X1-X3 inherited contract specializations.
- `test/reaction-conformance.test.js` — full E1-E12 vertical slice, private Community target, target withdrawal behavior, rebuild/hash-chain, negative API surface, syntax release gate.

## E-series mapping

- **E1 — Reaction != Relationship:** `reaction-boundaries.test.js` and `reaction-conformance.test.js` verify Reaction commands append no Relationship events.
- **E2 — ReactionType != ReactionEventType:** `reaction-fold.test.js` verifies fixed event algebra with mutable taxonomy payload.
- **E3 — OneReactionAggregatePerActorPublication:** deterministic `deriveReactionId(actor, publication)` and duplicate-create rejection in fold/service tests.
- **E4 — ReactionActor immutable:** fold rejects actor changes; service derives aggregate identity from actor + target.
- **E5 — ReactionTarget immutable:** fold rejects publication changes; service derives aggregate identity from actor + target.
- **E6 — ReactionAudience subset of PublicationAudience:** v0.1 specializes to equality; service rejects caller audience/scope/visibility overrides and copies target canonical audience.
- **E7 — ReactionCount_v = Count(VisibleActiveReactions_v):** target-first Reaction read tests exclude withdrawn/unreadable state before aggregation.
- **E8 — Reaction does not imply RelationshipMutation:** boundary/conformance tests compare Relationship history before/after Reaction lifecycle.
- **E9 — Reaction does not imply FeedRanking:** Feed explicitly requests `includeReactionDecoration:false`; Reaction lifecycle leaves Feed items and snapshot unchanged.
- **E10 — Reaction does not imply DiscoveryAffinity:** Discovery candidates and snapshot remain unchanged across Reaction lifecycle changes.
- **E11 — Reaction != Verification:** Reaction taxonomy remains social response data and creates no verification/trust canonical event.
- **E12 — ReactionActionHint != AuthorizationGrant:** Publication Reaction actions are advisory objects with `implied_execution_authority:false`; all mutations re-enter Reaction service + Authority.

## Foundation specialization

- **X1:** Reaction canonical audience is copied from target Publication at creation, caller override is forbidden, and later policy may only narrow effective exposure through Publication readability.
- **X2:** target readability/membership is descriptive state; mutation still requires principal actor equality and a fresh Reaction Authority decision.
- **X3:** invisible Publication/Reaction facts cannot alter visible Reaction summary/list/viewer-state outputs. Feed/Discovery boundaries similarly ignore Reaction-only changes in v0.1.

## Release discipline

`package.json` must include `reaction/*.js` in `npm run check`. Final release requires full tests, syntax gate, `git diff --check feed/v0.1...HEAD`, and a clean working tree.
