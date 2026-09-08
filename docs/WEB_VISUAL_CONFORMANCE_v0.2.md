# Trellis Web v0.2 Visual Conformance

**Design:** A′ — Trellis Observatory
**Spec:** `docs/superpowers/specs/2026-09-08-trellis-web-v0.2-visual-system-design.md`
**Plan:** `docs/superpowers/plans/2026-09-08-trellis-web-v0.2-visual-system.md`

Web v0.2 is a presentation-only migration over the existing viewer-safe Trellis read surfaces. W1–W12 remain inherited product contracts; v0.2 adds visual conformance requirements without creating new social truth.

## Visual constitution

- **V1 — Reading before instrumentation:** Home, Actor, Publication and Community keep human-readable content above technical inspection metadata.
- **V2 — Viewer-safe projection before rendering:** renderers consume supplied view models only; presentation code does not query storage or decide visibility.
- **V3 — No visual edge without a domain edge:** semantic edges require an explicit supplied edge/reference object. Structural Spine is decorative and `aria-hidden`.
- **V4 — Progressive verifiability:** Context Lens keeps algorithm/projection/snapshot identifiers inside accessible `<details>` disclosure while preserving machine-surface links.
- **V5 — Graph/list semantic parity:** Actor and Community graph previews use the exact same explicit edge subset for visual and text forms.
- **V6 — Absence of visibility is not proof of absence:** empty/hidden states avoid claims about facts outside the viewer-safe projection.

## W1–W12 inheritance

- W1/W9 HTML/API parity: `test/web-parity.test.js`, `test/web-v0.2-visual-conformance.test.js`.
- W2 backend-authoritative reasons + raw unknown code fallback: `test/web-context-panel.test.js`, `test/web-v0.2-shell-context.test.js`.
- W3/W4/W5 adapter/storage/Authority boundaries: `test/web-boundaries.test.js`, `test/web-v0.2-visual-conformance.test.js`.
- W6 anonymous viewer remains anonymous: `test/web-http-core.test.js`, `test/web-conformance.test.js`.
- W7/W12 visibility before aggregation and hidden-fact noninterference: `test/web-public-feed.test.js`, `test/web-public-directory.test.js`, `test/web-conformance.test.js`.
- W8 no browser-local social truth: `test/web-v0.2-responsive-a11y.test.js`.
- W10 authored content escaping: `test/web-pages.test.js`, `test/web-v0.2-publication.test.js`.
- W11 no fake personalized owner feed/write UI: `test/web-conformance.test.js`, `test/web-v0.2-home.test.js`, `test/web-v0.2-visual-conformance.test.js`.

## VC1–VC14 executable mapping

| VC | Requirement | Executable evidence |
|---|---|---|
| VC1 | Human/API visible facts remain equal | `test/web-conformance.test.js`, `test/web-parity.test.js` |
| VC2 | Context explanation remains backend-authoritative; unknown codes raw | `test/web-context-panel.test.js`, `test/web-v0.2-shell-context.test.js` |
| VC3 | Context Lens uses progressive accessible disclosure | `test/web-v0.2-shell-context.test.js` |
| VC4 | Structural Spine is decorative; semantic edge requires explicit input | `test/web-v0.2-trellis-line.test.js` |
| VC5 | Visual graph and text fallback expose equal preview edge facts | `test/web-v0.2-actor.test.js`, `test/web-v0.2-community.test.js` |
| VC6 | No inferred Actor type/relation direction/importance ranking | `test/web-v0.2-trellis-line.test.js`, `test/web-v0.2-actor.test.js` |
| VC7 | Viewer-relative counts and epistemically bounded absence wording | `test/web-v0.2-discover.test.js`, `test/web-v0.2-community.test.js` |
| VC8 | Publication reference states remain active/withdrawn/unavailable without oracle leakage | `test/web-v0.2-publication.test.js`, `test/web-conformance.test.js` |
| VC9 | Mobile replaces the persistent third Context Lens column with a default-collapsed in-flow disclosure between page lead and page body | `test/web-v0.2-responsive-a11y.test.js` |
| VC10 | Mobile semantic graphs become one-column/adjacency-first | `test/web-v0.2-responsive-a11y.test.js` |
| VC11 | Required Observatory tokens meet contrast targets | `test/web-v0.2-responsive-a11y.test.js` |
| VC12 | Reduced-motion disables nonessential movement; JS stays cache-free | `test/web-v0.2-responsive-a11y.test.js` |
| VC13 | Public surfaces render no fake mutation actions | `test/web-v0.2-home.test.js`, `test/web-v0.2-publication.test.js` |
| VC14 | Community empty graph does not imply global relation absence | `test/web-v0.2-community.test.js` |

## Scope of evidence

These tests prove server-rendered structure, source boundaries, deterministic rendering grammar, CSS token contrast calculations, responsive CSS contracts, W1 semantic parity, and reduced-motion/source rules. They do **not** claim exhaustive empirical compatibility across every browser/OS/assistive-technology combination.
