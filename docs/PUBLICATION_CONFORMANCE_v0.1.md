# Trellis Publication v0.1 Conformance

Canonical design: `docs/superpowers/specs/2026-09-02-trellis-publication-v0.1-design.md`.
Inherited Foundation contract: `docs/specs/2026-09-02-trellis-foundation-cross-domain-contract-v0.1.md`.

## Executable gates

Primary tests:

```text
test/publication-fold.test.js
test/publication-service.test.js
test/publication-reference.test.js
test/publication-rebuild.test.js
test/publication-surface.test.js
test/publication-render.test.js
test/cross-domain-contract.test.js
test/publication-conformance.test.js
```

## O1-O15 mapping

- **O1 PublicationHistory is canonical:** EventStore stream is the only canonical Publication truth; destructive projection rebuild test proves current rows are disposable.
- **O2 PublicationType != EventType:** type registry is data while event algebra remains `created`, `revision_added`, `withdrawn`.
- **O3 Author immutable:** fold rejects author changes; no author-change API exists.
- **O4 Visibility creation-time immutable:** fold rejects visibility changes and X1 conformance proves current policy cannot widen private state.
- **O5 Edit = AppendRevision:** revision tests enforce contiguous append-only revision numbers and supersession.
- **O6 Withdraw != Delete:** withdrawal is an appended terminal lifecycle event; canonical stream remains addressable and hash-valid.
- **O7 Reply = Publication:** reply is a Publication carrying `reply_to_ref`; there is no comment domain/table.
- **O8 InvisiblePublication produces no visible aggregate signal:** hidden-reply tests prove reply counts and parent surfaces remain unchanged.
- **O9 SocialMembership does not grant PublicationAuthority:** Community Publication requires active membership plus explicit scoped `publication:create` capability.
- **O10 PublicationActionHint != AuthorizationGrant:** render/action modules have no storage authority and command services re-evaluate Authority.
- **O11 Publication != Actor:** Publication never enters Entity/Actor registration or acting-principal identity.
- **O12 AI Board Message != Trellis Publication:** no auto-import/promotion API exists.
- **O13 ReferenceContext is viewer-relative current projection:** reference surfaces resolve target state at read time.
- **O14 Referenced child audience is subset of parent audience:** creation tests enforce public/narrower, participants subset, scope-members same-scope, and private non-widening rules.
- **O15 Withdrawal/invisibility cannot leak stale target content:** withdrawn reference shows placeholder only; unreadable target returns `unavailable` without hidden target ID/body.

## X1-X3 inheritance

Publication inherits all Foundation Cross-Domain Contract rules. `test/cross-domain-contract.test.js` is part of the Publication release gate.

## Release gate

Publication v0.1 is releasable only when:

```text
npm test
npm run check
git diff --check discovery/v0.1...HEAD
```

all pass on the final HEAD, and the working tree is clean.
