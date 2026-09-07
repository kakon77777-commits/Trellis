# Trellis Web v0.1 Conformance

**Version:** Web v0.1
**Origin:** `https://trellis.evemisslab.com`
**State role:** stateless transport/presentation adapters over viewer-safe Trellis domain read services.

## W-series mapping

- **W1 — HTML/JSON parity:** `test/web-parity.test.js` and real-server parity vectors in `test/web-conformance.test.js` normalize the same five public resources through `semanticFactsFromViewModel()` and require deep equality.
- **W2 — Backend-authoritative explanation:** `test/web-context-panel.test.js` requires raw backend reason codes, points, total score, and raw-code fallback for unknown future reasons.
- **W3 — Stateless adapters:** `test/web-boundaries.test.js` and final conformance assert `http`/`web` are absent from `CONTRACT_REGISTRY`; they own no canonical/operational/derived state domain.
- **W4 — No independent Authority:** source guards prohibit Authority policy imports or `evaluateAuthority` in Web/presentation routes.
- **W5 — No direct presentation storage reads:** route/Web guards prohibit SQLite/raw query access. `http/server.js` is the composition root and may construct DB/EventStore dependencies, but performs no queries or Authority decisions itself.
- **W6 — Anonymous stays anonymous:** `test/web-http-core.test.js` and final conformance reject query/header/unsigned-cookie Actor claims.
- **W7 — visibility before aggregation:** `test/web-public-feed.test.js` and `test/web-public-directory.test.js` prove hidden-only facts do not change collection membership/order/snapshot.
- **W8 — no browser social-truth cache:** source guards prohibit browser persistent stores in Web v0.1; client JS is progressive presentation only.
- **W9 — machine visibility equals human visibility:** W1 parity runs the same viewer-safe resource through human and machine routes.
- **W10 — safe authored content rendering:** `test/web-pages.test.js` and final conformance require authored script/HTML text to remain escaped.
- **W11 — no personalized owner Feed in public v0.1:** `/api/feed/home` is absent and client identity claims are rejected.
- **W12 — no hidden navigation/context signal:** hidden/nonexistent resources share 404 semantics; hidden-only facts leave public Feed/Directory snapshots unchanged.

## Adapter law

> Web does not know more than the domain projection, and does not decide more than the domain command layer.

`http/server.js` is infrastructure composition, not a presentation-policy layer. It may open the configured database and construct the existing EventStore/service facade, but all social visibility and semantics remain in domain read services.
