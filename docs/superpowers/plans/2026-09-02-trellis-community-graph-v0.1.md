# Trellis Community Graph v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Community as an actor-capable institutional Entity whose membership and local social graph are derived exclusively from Trellis canonical Entity/Relationship histories, with viewer-relative disclosure and Authority-separated governance.

**Architecture:** Extend the existing modular monolith without introducing a Community canonical event algebra. Generalize Entity registration, add a Community-specific assertion registry/service over `entity.assertion_added`, adapt existing `member_of` Relationship commands, teach read policy how to resolve `scope_members` from active membership, and build Community surfaces as disposable projections over canonical histories plus `relationships_current`.

**Tech Stack:** Node.js >=22.5.0, CommonJS, `node:test`, `node:sqlite`, existing EventStore/Relationship/Profile infrastructure.

**Spec:** `docs/superpowers/specs/2026-09-02-trellis-community-graph-v0.1-design.md`

## Global Constraints

- Foundation I1-I11, Profile P1-P10, and Relationship Surface R1-R10 remain unchanged.
- Community is `entity_kind=community`, `actor_capable=true`; Actor-capable never implies autonomous/resident.
- Community creation must not mint social roles or execution authority.
- `ActAs(Community)` is supplied by the Authority boundary through `principalActorId`; Community code must not infer it from `member_of` or future role edges.
- Membership truth is only `member_of` Relationship history; no canonical member list exists.
- Every `member_of(A,C)` created by Community adapters must set `scope_ref=C`.
- Default membership visibility is `public` for public/unlisted communities and `scope_members` for private communities.
- `scope_members` visibility must be resolved from currently active canonical/materialized membership, never from UI flags.
- Community discoverability may narrow exposure but may never widen immutable assertion/relationship visibility.
- Member counts, pagination totals, local graph counts, and action hints must be derived only after viewer visibility filtering.
- Community-local current graph includes only scoped relationships whose endpoints are currently active members.
- Social role/membership never grants execution authority or acting-as authority.
- Community state is distinct from AI Board discussion state.
- Feed, recommendation, Community retirement, moderation capability, role taxonomy, and AI Board promotion remain out of scope.

---

### Task 1: Generalize Entity Registration and Add Community Creation

**Files:**
- Modify: `entity/schemas.js`
- Modify: `entity/service.js`
- Create: `community/service.js`
- Test: `test/community-entity.test.js`

**Interfaces:**
- Produces: `registerEntity(command, { eventStore, authorize })`
- Preserves: `registerActor(command, context)` as adapter
- Produces: `createCommunity(command, context)`

- [ ] Write failing tests proving `registerActor()` still emits `entity_kind=actor`, `createCommunity()` emits `entity_kind=community` and `actor_capable=true`, Community identity is stable and independent of name/runtime, and Community creation emits no role/membership/capability event.
- [ ] Run `node --test test/community-entity.test.js` and confirm RED because `createCommunity`/`registerEntity` do not exist.
- [ ] Implement `validateRegisterEntityCommand()` with explicit `entity_kind`, `actor_capable`, and optional `entity_id`; preserve `validateRegisterActorCommand()` as a compatibility adapter.
- [ ] Refactor `registerActor()` through `registerEntity()` without changing existing event vocabulary or EventStore append contract.
- [ ] Implement `createCommunity()` as a thin adapter selecting `entity_kind='community'`, `actor_capable=true`, and deriving `community:*` IDs when no ID is supplied.
- [ ] Run `node --test test/community-entity.test.js test/actor-identity.test.js test/conformance.test.js` and require GREEN.
- [ ] Commit `feat: generalize entity registration for communities`.

### Task 2: Community Metadata Assertions and Discoverability

**Files:**
- Create: `schemas/community-fields.v0.1.json`
- Create: `community/field-registry.js`
- Create: `community/schemas.js`
- Create: `community/fold.js`
- Create: `community/metadata-service.js`
- Create: `community/product-commands.js`
- Test: `test/community-metadata.test.js`

**Interfaces:**
- Produces: `foldCommunityAssertions(entityEvents)`
- Produces: `addCommunityAssertion(command, context)`
- Produces product adapters: `setCommunityName`, `setCommunityDescription`, `setCommunityAvatarUrl`, `setCommunityDiscoverability`
- Produces: `resolveCommunityDiscoverability(entityEvents) -> 'public'|'unlisted'|'private'`

- [ ] Write failing tests for single-value supersession, immutable per-assertion visibility, discoverability values `public|unlisted|private`, invalid profile field refs, and self/actor metadata separation.
- [ ] Verify RED with `node --test test/community-metadata.test.js`.
- [ ] Define Community field registry with `community:name:v1`, `community:description:v1`, `community:avatar_url:v1`, `community:discoverability:v1`.
- [ ] Implement validation and pure fold mirroring Profile semantics but using a distinct registry reference.
- [ ] Implement metadata command service over canonical `entity.assertion_added`; require `principalActorId === community_id` through `entity.assertion_add` Authority evaluation and preserve idempotency-before-preflight ordering.
- [ ] Run `node --test test/community-metadata.test.js test/profile-fold.test.js test/profile-service.test.js` and require GREEN.
- [ ] Commit `feat: add append-only community metadata assertions`.

### Task 3: Membership Product Commands and Community-Side Activation

**Files:**
- Create: `community/membership.js`
- Modify: `relationship-surface/product-commands.js` only if a reusable export is required; do not duplicate Foundation relationship logic.
- Test: `test/community-membership.test.js`

**Interfaces:**
- Produces: `requestMembership(command, context)`
- Produces: `approveMembership(command, context)`
- Produces: `leaveCommunity(command, context)`
- Produces: `removeMember(command, context)`

- [ ] Write failing tests that `requestMembership` sets `relationship_type='member_of'`, `target_entity_id=community_id`, `scope_ref=community_id`; public/unlisted defaults to `public`, private defaults to `scope_members`; caller override must still obey Relationship policy.
- [ ] Write failing tests that approval/removal work only when `context.principalActorId === community_id`; ordinary member/creator Actor context must be denied.
- [ ] Verify RED with `node --test test/community-membership.test.js`.
- [ ] Implement membership adapters by calling existing `proposeRelationship`, `activateRelationship`, and `terminateRelationship`; do not append events directly.
- [ ] Resolve current Community discoverability from canonical Community assertion history before proposal, then supply scope/visibility to Foundation relationship command.
- [ ] Run membership tests plus `test/authority-separation.test.js` and `test/relationship-service.test.js`; require GREEN.
- [ ] Commit `feat: add authority-separated community membership commands`.

### Task 4: Implement `scope_members` Read Policy

**Files:**
- Modify: `profile/read-policy.js`
- Modify: callers to pass membership resolver/read context where necessary
- Create: `community/membership-read.js`
- Test: `test/community-scope-members.test.js`

**Interfaces:**
- Produces: `isActiveCommunityMember(db, communityId, actorId) -> boolean`
- Produces: `scopeMembersReadable(relationship, viewerContext, membershipResolver) -> boolean`
- Extends: `canViewRelationship(relationship, viewerContext, disclosurePolicy, readContext?)`

- [ ] Write failing tests proving `scope_members` is readable by active members of `scope_ref`, by the Community acting context itself, and not by anonymous/non-members/terminated former members.
- [ ] Add a leakage test proving a `scope_members` membership does not become public because another public relationship exists between the same actors.
- [ ] Verify RED.
- [ ] Implement active membership resolution exclusively from `relationships_current` rows with `relationship_type='member_of'`, `target_entity_id=communityId`, `scope_ref=communityId`, `lifecycle='active'`.
- [ ] Extend read policy without changing `public`, `participants`, or `private` semantics.
- [ ] Update Profile/Relationship Surface calls to pass the DB-backed membership read context while preserving previous tests.
- [ ] Run `node --test test/community-scope-members.test.js test/profile-visibility.test.js test/relationship-surface-detail.test.js test/visibility.test.js` and require GREEN.
- [ ] Commit `feat: resolve scope-members visibility from active membership`.

### Task 5: Community Member List and Current Local Graph

**Files:**
- Create: `community/read-policy.js`
- Create: `community/graph.js`
- Test: `test/community-graph.test.js`

**Interfaces:**
- Produces: `communityViewerScope({ communityId, viewerContext, db, eventStore })`
- Produces: `listVisibleMembers({ communityId, viewerContext, db, disclosurePolicy })`
- Produces: `buildCommunityLocalGraph({ communityId, viewerContext, db, disclosurePolicy })`

- [ ] Write failing tests for public/unlisted/private Community access, member-list filtering before counting, and no hidden-member count/pagination leakage.
- [ ] Write failing test where A/B have `collaborates_with(scope=C)` while active members, then A leaves; canonical relationship remains but current local graph no longer includes the edge.
- [ ] Verify RED.
- [ ] Implement Community discoverability read from canonical metadata assertions; private allows active members and acting-as Community only.
- [ ] Implement member list from active visible `member_of` relationships only; aggregate after filter.
- [ ] Implement local graph from visible scoped relationships whose source and target are both current active members.
- [ ] Run `node --test test/community-graph.test.js test/relationship-surface-index.test.js` and require GREEN.
- [ ] Commit `feat: project community members and local scoped graph`.

### Task 6: Community Human/Machine Surface and Advisory Actions

**Files:**
- Create: `community/read-service.js`
- Create: `community/action-hints.js`
- Create: `community/render-json.js`
- Create: `community/render-html.js`
- Test: `test/community-surface.test.js`

**Interfaces:**
- Produces: `buildCommunitySurface({...})`
- Produces: `availableCommunityActions({...})`
- Produces: `renderCommunityJson(surface)`
- Produces: `renderCommunityHtml(surface)`

- [ ] Write failing tests proving public/member/community viewer scopes, advisory actions (`request_membership`, `leave`, `approve_membership`, `remove_member`), and `CommunityActionHint != AuthorizationGrant`.
- [ ] Add HTML/JSON parity and HTML escaping tests; renderers must consume a pre-filtered surface and import no DB/EventStore.
- [ ] Verify RED.
- [ ] Implement Community read service from Community metadata + visible member list + local graph; no canonical writes.
- [ ] Implement action hints based only on viewer context/current visible state; actual commands still re-run Authority path.
- [ ] Implement JSON/HTML renderers over the same surface object.
- [ ] Run `node --test test/community-surface.test.js` and require GREEN.
- [ ] Commit `feat: add viewer-relative community surfaces`.

### Task 7: C1-C12 Conformance and Rebuild Seal

**Files:**
- Create: `test/community-conformance.test.js`
- Create: `docs/COMMUNITY_GRAPH_CONFORMANCE_v0.1.md`
- Modify: `package.json` syntax gate to include `community/*.js`

**Interfaces:**
- Produces release gate proving C1-C12 and full vertical slice.

- [ ] Write the complete vertical-slice test: register A/B, create private C, set metadata, request/approve A and B memberships, create A-B collaboration scoped to C, verify anonymous NOT_VISIBLE and member-visible Community surface, A leaves, verify local graph edge disappears while relationship history remains.
- [ ] In the same test capture Community/Profile/Relationship surfaces, delete disposable projections, rebuild from canonical histories, and require equality for the same viewer/projection versions where semantically current state is unchanged by the leave step.
- [ ] Add explicit negative-surface assertions: no `grantCommunityAuthority`, no role-derived `ActAs`, no mutable member list, no Feed/AI Board state ownership.
- [ ] Add C1-C12 mapping document.
- [ ] Extend `npm run check` to include `community/*.js` and verify the pre-change syntax-gate test fails before the package update.
- [ ] Run `npm test`, `npm run check`, and `git diff --check`; repeat the full test+check from a clean temporary DB run.
- [ ] Commit `test: seal Community Graph v0.1 conformance gate`.

## Definition of Done

Community Graph v0.1 is complete only when all existing Foundation/Profile/Relationship tests and all new Community tests pass, syntax checks include `community/*.js`, C1-C12 are mapped to executable evidence, private membership has no aggregate leakage, `scope_members` is resolved from active membership, current local graph excludes scoped edges whose endpoints are no longer active members, and deleting/rebuilding disposable projections reproduces the same viewer-relative Community state from canonical histories.
