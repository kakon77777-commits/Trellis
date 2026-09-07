# Trellis Web v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first public, read-only browser and machine surface for `trellis.evemisslab.com` without introducing a second social truth, fabricated identity, or Web-local authority logic.

**Architecture:** Add two adapter layers in the existing repository: `http/` for transport and `web/` for presentation. New anonymous Public Feed/Public Directory behavior lives in the existing derived `feed/` and discovery-related boundaries; HTTP/Web consume only viewer-safe read-service outputs and never query SQLite or decide Authority independently.

**Tech Stack:** Node.js >= 22.5.0, CommonJS, built-in `node:http`, `node:test`, `node:sqlite`, server-rendered HTML, browser-native JavaScript, plain CSS, no new required runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-07-trellis-web-v0.1-design.md`

## Global Constraints

- Production Web v0.1 is anonymous and read-only; no login, write action, or client-supplied Actor identity is accepted as authentication.
- `web/` and HTTP presentation routes MUST NOT import `node:sqlite`, `db/`, raw projection tables, or Authority decision functions.
- New anonymous collection semantics must live under domain read-service boundaries (`feed/`, discovery-related derived read services), not route files.
- All public aggregation/order/pagination happens only after anonymous-viewer visibility filtering.
- HTML and JSON for the same viewer-safe view model must expose the same semantic visible facts.
- Context Panel explanations render backend Feed v0.2 reason codes/points; Web never infers its own ranking explanation.
- `http` and `web` remain absent from Foundation `CONTRACT_REGISTRY` by design.
- Authored text is escaped; raw authored HTML/script is never executed.
- Existing 406-test baseline must remain green.

---

## File Structure

New/modified responsibilities:

```text
feed/public.js                    anonymous public chronological feed derived read service
discovery/public-directory.js    anonymous Actor/Community directory derived read service
http/app.js                       node:http-compatible request dispatcher factory
http/request-context.js           anonymous context creation + claimed-identity rejection
http/errors.js                    domain/public HTTP status translation
http/routes/public.js             public feed/directory routes only
http/routes/resources.js          Actor/Publication/Community routes only
http/routes/machine.js            schema/well-known/llms/static machine entry points
http/view-models/public.js        route-safe public view-model assembly
web/render/semantic-facts.js      semantic fact markers used by W1 parity tests
web/render/shell.js               shared responsive document shell
web/render/home.js                public Feed page
web/render/explore.js             public directory page
web/render/profile.js             Actor page wrapper around viewer-safe profile
web/render/publication.js         Publication page wrapper around viewer-safe publication
web/render/community.js           Community page + graph/list fallback
web/render/context-panel.js       backend-authoritative explanation/public context renderer
web/public/app.css                design tokens + responsive/accessibility styles
web/public/app.js                 optional progressive enhancement only
```

No Web file owns domain state or persistence.

---

### Task 1: Anonymous Public Chronological Feed

**Files:**
- Create: `feed/public.js`
- Modify: `feed/activity-items.js`
- Test: `test/web-public-feed.test.js`

**Interfaces:**
- Consumes: `loadPublicationSurface({ publicationId, viewerContext:{}, ... })`, existing activity allowlist, `sortFeedItems()`, `paginateFeed()` semantics.
- Produces: `buildPublicFeed({ db, eventStore, disclosurePolicy }) -> { feed_type, algorithm_ref, items, snapshot_ref, projection_version }` and `loadPublicFeed({ ..., limit, cursor }) -> paginated surface`.

- [ ] **Step 1: Write failing tests**

Test anonymous candidate generation and hidden-fact noninterference:

```js
const before = buildPublicFeed({ db, eventStore: store });
assert.deepEqual(before.items.map(x => x.source_ref ?? x.source_event_ref), [/* expected public roots/activity */]);

// Add nonpublic publication/relationship/activity then rebuild ordinary projections.
const after = buildPublicFeed({ db, eventStore: store });
assert.deepEqual(after, before);
```

Also assert replies are excluded as roots, current-withdrawn publications are excluded, and chronological ordering uses `compareFeedItemsDesc`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/web-public-feed.test.js
```

Expected: FAIL because `feed/public.js` / `buildPublicFeed` does not exist.

- [ ] **Step 3: Implement minimal public read service**

Implement only anonymous-viewer candidate generation:

```js
const PUBLIC_FEED_ALGORITHM_REF = 'trellis-feed:public-chronological:v1';

function buildPublicFeed({ db, eventStore, disclosurePolicy }) {
  const viewerContext = {};
  // 1. collect active root publications, load each through loadPublicationSurface(viewerContext={})
  // 2. collect allowlisted activation activities only after canViewRelationship(... viewerContext={})
  // 3. sort with sortFeedItems()
  // 4. hash only final viewer-safe items + projection/algorithm refs
}
```

Do not read Preference, Consumption, Reaction decoration, Notification, personalized score, model/provider metadata, or owner identity.

- [ ] **Step 4: Verify GREEN + regression**

```bash
node --test test/web-public-feed.test.js
npm test
```

Expected: targeted PASS; full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add feed/public.js feed/activity-items.js test/web-public-feed.test.js
git commit -m "feat: add anonymous public chronological feed"
```

---

### Task 2: Public Explore Directory

**Files:**
- Create: `discovery/public-directory.js`
- Test: `test/web-public-directory.test.js`

**Interfaces:**
- Consumes: `buildActorProfile({ actorId, viewerContext:{}, ... })`, `buildCommunitySurface({ communityId, viewerContext:{}, ... })`.
- Produces: `buildPublicDirectory({ db, eventStore, disclosurePolicy }) -> { actors, communities, algorithm_ref, snapshot_ref, projection_version }`.

- [ ] **Step 1: Write failing tests**

Require:

```js
assert.equal(directory.actors.some(a => a.actor_id === bareActorWithoutPublicPresentation), false);
assert.equal(directory.communities.some(c => c.community_id === unlistedCommunity), false);
assert.equal(directory.communities.some(c => c.community_id === privateCommunity), false);
```

Add hidden claims/memberships/relationships and assert the directory object and snapshot remain unchanged for anonymous viewer.

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-public-directory.test.js
```

Expected: FAIL because `discovery/public-directory.js` does not exist.

- [ ] **Step 3: Implement minimal directory read service**

Discover candidate IDs from canonical Entity registration only as a traversal mechanism, but include an Actor only after `buildActorProfile(... viewerContext:{})` returns at least one public presentation field. Include a Community only after `buildCommunitySurface(... viewerContext:{})` succeeds and `discoverability === 'public'`.

Deterministic order:

```text
actors: display name value ASC, then actor_id ASC
communities: name value ASC, then community_id ASC
```

Hash only final viewer-safe previews and algorithm/projection refs.

- [ ] **Step 4: Verify GREEN + regression**

```bash
node --test test/web-public-directory.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add discovery/public-directory.js test/web-public-directory.test.js
git commit -m "feat: add anonymous public directory"
```

---

### Task 3: HTTP Adapter Core and Anonymous Identity Guard

**Files:**
- Create: `http/request-context.js`
- Create: `http/errors.js`
- Create: `http/app.js`
- Test: `test/web-http-core.test.js`

**Interfaces:**
- Consumes: injected route handlers and dependency object; no raw DB access in `http/app.js`.
- Produces: `createPublicRequestContext(request)`, `createHttpApp({ services, assets })`, response helpers.

- [ ] **Step 1: Write failing tests**

Use synthetic Request-like objects and assert:

```js
assert.deepEqual(createPublicRequestContext({ headers: {}, url: '/' }), { viewerContext: {} });
assert.throws(
  () => createPublicRequestContext({ headers: { 'x-actor-id': 'actor:A' }, url: '/' }),
  /CLIENT_CLAIMED_ACTOR_ID_NOT_ALLOWED/
);
```

Repeat rejection for query `viewer_actor_id`, `subject_actor_id`, and unsigned identity cookie shapes. Assert only GET/HEAD are accepted in v0.1.

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-http-core.test.js
```

- [ ] **Step 3: Implement minimal HTTP adapter**

`request-context.js` parses URL/headers solely to preserve anonymity or reject claimed identity. `app.js` normalizes method/path, dispatches injected handlers, sets CSP/security headers, and maps 404/400/405/500 without distinguishing hidden vs nonexistent resources.

Do not import `authority/policy`, `db/sqlite`, or domain tables.

- [ ] **Step 4: Verify GREEN + regression**

```bash
node --test test/web-http-core.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add http/request-context.js http/errors.js http/app.js test/web-http-core.test.js
git commit -m "feat: add anonymous HTTP adapter core"
```

---

### Task 4: Resource View Models and API Routes

**Files:**
- Create: `http/view-models/public.js`
- Create: `http/routes/public.js`
- Create: `http/routes/resources.js`
- Test: `test/web-api-routes.test.js`

**Interfaces:**
- Consumes: Public Feed, Public Directory, Actor Profile, Publication Surface, Community Surface read functions via injected service facade.
- Produces JSON routes:
  - `/api/public/feed`
  - `/api/public/directory`
  - `/api/actors/:id`
  - `/api/publications/:id`
  - `/api/communities/:id`

- [ ] **Step 1: Write failing route tests**

For one fixture, require status/body semantics:

```js
const actor = await call('/api/actors/actor:A');
assert.equal(actor.status, 200);
assert.equal(JSON.parse(actor.body).actor_id, 'actor:A');

const hidden = await call('/api/communities/community:Cprivate');
const missing = await call('/api/communities/community:missing');
assert.equal(hidden.status, 404);
assert.equal(missing.status, 404);
```

Record canonical event count, command receipt count, preference/consumption/notification state before and after GETs and assert unchanged.

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-api-routes.test.js
```

- [ ] **Step 3: Implement route adapters**

Each route calls exactly one injected viewer-safe read/view-model function. Route files may parse IDs/limit/cursor but may not query SQL. Serialize JSON with `application/json; charset=utf-8`. Hidden and missing resource paths both map to 404.

- [ ] **Step 4: Verify GREEN + regression**

```bash
node --test test/web-api-routes.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add http/view-models/public.js http/routes/public.js http/routes/resources.js test/web-api-routes.test.js
git commit -m "feat: expose public Trellis API routes"
```

---

### Task 5: SSR Web Shell and Five Human Surfaces

**Files:**
- Create: `web/render/semantic-facts.js`
- Create: `web/render/shell.js`
- Create: `web/render/home.js`
- Create: `web/render/explore.js`
- Create: `web/render/profile.js`
- Create: `web/render/publication.js`
- Create: `web/render/community.js`
- Create: `web/public/app.css`
- Create: `web/public/app.js`
- Modify: `http/routes/public.js`
- Modify: `http/routes/resources.js`
- Test: `test/web-pages.test.js`

**Interfaces:**
- Consumes: the same route-safe view models used by JSON endpoints.
- Produces human routes `/`, `/discover`, `/actors/:id`, `/publications/:id`, `/communities/:id`.

- [ ] **Step 1: Write failing page tests**

Require semantic landmarks and safe escaping:

```js
assert.match(html, /<nav/);
assert.match(html, /<main/);
assert.match(html, /<aside/);
assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
```

Community graph test must assert text fallback includes every visible edge represented by graph markup.

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-pages.test.js
```

- [ ] **Step 3: Implement SSR renderers and static assets**

Use one shell with navigation, main content, Context Panel `<aside>`, semantic fact markers, safe escaping, responsive layout, focus states, reduced-motion support, CSS design tokens, and no remote scripts/analytics. `web/public/app.js` may only provide progressive UI enhancement such as Context Panel disclosure on narrow screens.

- [ ] **Step 4: Verify GREEN + regression**

```bash
node --test test/web-pages.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add web http/routes test/web-pages.test.js
git commit -m "feat: add Trellis public SSR surfaces"
```

---

### Task 6: Semantic HTML/JSON Parity and Backend-Authoritative Context Panel

**Files:**
- Create: `web/render/context-panel.js`
- Test: `test/web-parity.test.js`
- Test: `test/web-context-panel.test.js`

**Interfaces:**
- Consumes: viewer-safe view models and synthetic Feed v0.2 scored item objects.
- Produces: `semanticFactsFromViewModel(type, value)`, semantic markers in HTML, `renderRankingExplanation(item)`.

- [ ] **Step 1: Write failing parity tests**

For Public Feed, Directory, Actor, Publication, Community:

```js
const jsonFacts = semanticFactsFromViewModel(resourceType, JSON.parse(jsonBody));
const htmlFacts = parseSemanticFactMarkers(htmlBody);
assert.deepEqual(htmlFacts, jsonFacts);
```

No DOM library is required: semantic markers use encoded deterministic `data-semantic-fact` attributes or script-safe JSON metadata generated from the same fact list.

Context Panel:

```js
assert.deepEqual(displayedReasonCodes, backendItem.ranking_reasons.map(r => r.type));
assert.equal(displayedTotal, backendItem.score.total_points);
assert.equal(displayedPointsSum, backendItem.ranking_reasons.reduce((n,r) => n + r.points, 0));
```

Unknown reason code must render raw code.

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-parity.test.js test/web-context-panel.test.js
```

- [ ] **Step 3: Implement semantic facts and explanation renderer**

`context-panel.js` uses a deterministic map from known backend reason codes to labels, but always preserves/emits the raw code and backend points. It never examines relationships/profile data to infer a reason.

- [ ] **Step 4: Verify GREEN + regression**

```bash
node --test test/web-parity.test.js test/web-context-panel.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add web/render/context-panel.js web/render/semantic-facts.js test/web-parity.test.js test/web-context-panel.test.js
git commit -m "test: enforce Web semantic parity and explanations"
```

---

### Task 7: Machine Surfaces, Static Assets, and Boundary Guards

**Files:**
- Create: `http/routes/machine.js`
- Modify: `http/app.js`
- Test: `test/web-machine-surfaces.test.js`
- Test: `test/web-boundaries.test.js`

**Interfaces:**
- Produces `/.well-known/trellis.json`, `/api/schema`, `/llms.txt`, `/assets/app.css`, `/assets/app.js`.

- [ ] **Step 1: Write failing tests**

Machine metadata must contain:

```js
assert.equal(meta.origin, 'https://trellis.evemisslab.com');
assert.equal(meta.writes_enabled, false);
assert.deepEqual(meta.capabilities, [
  'public_feed', 'public_directory', 'actor_profile', 'publication', 'community'
]);
```

Boundary test scans source text under `http/` and `web/` and fails on forbidden imports/patterns:

```text
node:sqlite
../db/
authority/policy
evaluateAuthority
.prepare(
SELECT
INSERT
UPDATE
DELETE FROM
```

Also assert `CONTRACT_REGISTRY.http === undefined` and `.web === undefined`.

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-machine-surfaces.test.js test/web-boundaries.test.js
```

- [ ] **Step 3: Implement machine/static routes**

`/api/schema` lists the v0.1 resources and read-only status. `llms.txt` directs agents to APIs rather than HTML scraping. Static assets are served from fixed known paths only; no arbitrary filesystem path routing.

- [ ] **Step 4: Verify GREEN + regression**

```bash
node --test test/web-machine-surfaces.test.js test/web-boundaries.test.js
npm test
```

- [ ] **Step 5: Commit**

```bash
git add http/routes/machine.js http/app.js test/web-machine-surfaces.test.js test/web-boundaries.test.js
git commit -m "feat: add Trellis machine surfaces and adapter guards"
```

---

### Task 8: W1–W12 Final Conformance, Runnable Server, and Release Gate

**Files:**
- Create: `http/server.js`
- Create: `docs/WEB_CONFORMANCE_v0.1.md`
- Create: `test/web-conformance.test.js`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces a Node-runnable public app entry point and executable W1–W12 release gate.

- [ ] **Step 1: Write failing final conformance test**

The final test must prove:

```text
W1 HTML/JSON semantic parity for all five resources
W2 displayed ranking codes/points == backend reasons/score
W3 http/web absent from CONTRACT_REGISTRY
W4 no independent Authority logic
W5 no direct storage/raw projection reads in adapters
W6 claimed Actor IDs rejected
W7 visibility before aggregate/order/pagination for Public Feed/Directory
W8 no browser social-truth cache contract
W9 machine visibility == human visibility
W10 authored content escaped
W11 public v0.1 does not expose owner-personalized route
W12 hidden facts do not change navigation/context/count/order/snapshot/cursor
```

Also start the server on an ephemeral local port and request all public/machine routes through real `node:http`, asserting GET-only behavior and zero canonical/operational mutation.

- [ ] **Step 2: Verify RED**

```bash
node --test test/web-conformance.test.js
npm run check
```

Expected: conformance and/or syntax gate fail because `http/` / `web/` are not yet fully included in the release gate/server entry point.

- [ ] **Step 3: Implement runnable server and release scripts**

`http/server.js` creates/open dependencies at process start and passes a service facade into `createHttpApp`. Add scripts:

```json
{
  "start:web": "node http/server.js"
}
```

Extend `npm run check` to syntax-check:

```text
http/*.js
http/routes/*.js
http/view-models/*.js
web/render/*.js
web/public/*.js
```

README documents `trellis.evemisslab.com`, `npm run start:web`, public-only v0.1 scope, and the Web→HTTP→Domain boundary.

- [ ] **Step 4: Run two full pre-commit gates**

Run twice:

```bash
npm test
npm run check
git diff --check
```

Expected both rounds: zero failures, clean diff check.

- [ ] **Step 5: Commit final seal**

```bash
git add http web test/web-conformance.test.js docs/WEB_CONFORMANCE_v0.1.md package.json README.md
git commit -m "test: seal Trellis Web v0.1 conformance"
```

- [ ] **Step 6: Fresh final-HEAD verification**

```bash
npm test
npm run check
git diff --check <web-v0.1-base>...HEAD
git status --short
```

Then create reproducible tracked-files-only Source ZIP, complete Git bundle, SHA-256 manifest, and clean-extract verification.

---

## Self-Review Results

- **Spec coverage:** W1–W12, all required routes, Public Feed, Public Directory, machine surfaces, responsive/accessibility shell, graph fallback, safe rendering, no fabricated identity, and zero-mutation GET vertical slice are mapped to Tasks 1–8.
- **Placeholder scan:** all task steps contain concrete implementation and verification instructions.
- **Type/interface consistency:** all route layers consume injected viewer-safe services; no task introduces a second storage or Authority API.
- **Scope:** login/write/authenticated personalized routing remains explicitly deferred to Web v0.2.
