# Trellis Community Graph v0.1 Conformance

Community Graph v0.1 is accepted only when the complete repository test suite and syntax gate pass and the following invariants are covered by executable tests.

| Invariant | Executable evidence |
| --- | --- |
| C1 `Community = Entity` | `test/community-entity.test.js`, `test/community-conformance.test.js` |
| C2 `Membership = Relationship` | `test/community-membership.test.js` |
| C3 member list is a visible-membership projection | `test/community-graph.test.js` |
| C4 Community role does not imply execution authority | `test/community-surface.test.js`, negative API surface in `test/community-conformance.test.js` |
| C5 actor-capable does not imply autonomous | `test/community-entity.test.js` |
| C6 Community-scoped relation does not imply global relation | `test/community-graph.test.js`, canonical `scope_ref` assertions |
| C7 invisible membership produces no aggregate signal | `test/community-graph.test.js` |
| C8 Community action hints are not authorization grants | `test/community-surface.test.js` |
| C9 Community state is distinct from discussion state | negative AI Board ownership surface in `test/community-conformance.test.js` |
| C10 Community graph is projected from Trellis canonical histories | destructive rebuild vertical slice in `test/community-conformance.test.js` |
| C11 social relation does not create ActAsCommunity authority | `test/community-membership.test.js`, negative authority surface in `test/community-conformance.test.js` |
| C12 membership scope equals Community ID | `test/community-membership.test.js` |

## Release Gate

The vertical slice must prove all of the following:

```text
Actor A / Actor B registered
Community C registered as actor-capable institutional Entity
Community C metadata appended as Entity assertions
A and B request member_of(A|B, C)
Authority-recognized acting-as C activates both memberships
A and B create collaborates_with(A,B) scoped to C
private Community is unreadable anonymously
active members see viewer-safe member list and local graph
A leaves Community
A membership history remains canonical
A-B scoped collaboration history remains canonical
A-B scoped collaboration no longer appears as current Community edge
```

Then disposable relationship/profile projections are deleted and rebuilt from canonical histories. For the same viewer context and projection versions, Community, Actor Profile, and Relationship Detail outputs must reproduce exactly. Canonical event hash chains must still verify.

## Domain-Separation Gate

Actor Profile projection and Actor Profile read service must refuse Community entities. A Community assertion registry may share the canonical Entity stream without being interpreted as an Actor Profile assertion registry.

## Syntax Gate

`npm run check` must include `community/*.js`.
