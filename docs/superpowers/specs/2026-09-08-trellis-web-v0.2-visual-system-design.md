# Trellis Web v0.2 Visual System Design

**Date:** 2026-09-08
**Status:** DESIGN FREEZE CANDIDATE
**Canonical repository:** `kakon77777-commits/Trellis`
**Canonical base:** `main @ 8e2dce74333a5db2cfa9fdeea061db0121cc92e8`
**Design direction:** A' — Trellis Observatory
**Scope:** visual system, rendering grammar, page composition, progressive context disclosure, responsive behavior, accessibility, and visual conformance for Home, Discover, Actor, Publication, and Community.
**Explicitly out of scope:** new domain semantics, new ranking, authentication, write actions, client-side social inference, new graph ontology, new visibility rules, and storage changes.

---

## 0. Decision

Trellis Web v0.2 adopts **Trellis Observatory** as the product visual system.

The visual identity comes from rendering already-authorized social structure clearly:

```text
viewer-safe Trellis projection
-> readable human surface
-> visible structural cues
-> progressive context inspection
```

The system is not a Facebook/X/Reddit clone, not a traditional admin dashboard, and not a neon cyberpunk graph demo.

The design objective is:

$$
\boxed{
\text{Readable Social Surface}
+
\text{Visible Structure}
+
\text{Progressive Verifiability}
}
$$

and not:

$$
\boxed{
\text{Engineering Metadata Dashboard}
}
$$

---

## 1. Authority order

Implementation authority is ordered as follows:

```text
1. Existing Trellis domain semantics and canonical history
2. Existing viewer-safe read services / derived surfaces
3. Trellis Web v0.1 W1-W12 contracts
4. This Web v0.2 Visual System Design
5. Future implementation plan
6. CSS/HTML/JS implementation details
```

If a visual idea conflicts with domain truth, viewer-safe projection semantics, or W1-W12, the visual idea loses.

---

## 2. Non-goals

Web v0.2 Visual System does not add:

- personalized public ranking or recommendation semantics;
- inferred social edges, Actor types, relationship polarity, trust, importance, or affinity;
- client-side visibility or Authority decisions;
- login or authenticated write actions;
- browser-local authoritative graph caches;
- hidden-versus-missing existence oracles;
- force-directed graph simulation as a required dependency;
- animation required to understand semantic structure.

This is a presentation migration.

---

# 3. Visual Constitution

## V1 — Reading before instrumentation

$$
\boxed{
\text{ReadingPriority}
>
\text{StructuralInstrumentation}
>
\text{VerificationMetadata}
}
$$

Content and human-readable identity are primary. Hashes, algorithm refs, projection versions, snapshots, and raw IDs are progressively disclosed.

## V2 — Viewer-safe projection before rendering

$$
\boxed{
\text{RenderInput}
=
\text{ViewerSafeProjection}
}
$$

Web never broadens visibility or queries hidden state to improve a visual.

## V3 — No visual edge without a domain edge

$$
\boxed{
E_{rendered}
\subseteq
E_{viewer\text{-}safe\ projection}
}
$$

Geometry may be inferred. Social relationships may not.

## V4 — Progressive verifiability

$$
\boxed{
\text{HumanConcept}
\rightarrow
\text{PreciseExplanation}
\rightarrow
\text{MachineEvidence}
}
$$

Verification remains first-class but does not dominate the initial reading view.

## V5 — Graph/list semantic parity

$$
\boxed{
\operatorname{Facts}(\text{VisualGraph})
=
\operatorname{Facts}(\text{TextFallback})
}
$$

Any semantic visual graph must have a text/list form representing the same visible edges.

## V6 — Absence of visibility is not proof of absence

$$
\boxed{
\text{NoVisibleEdge}
\not\Rightarrow
\text{NoEdgeExists}
}
$$

Use viewer-relative vocabulary such as `visible members`, `visible relationships`, and `no visible local relationships` when the underlying fact is viewer-relative.

---

# 4. W1-W12 inheritance

Web v0.2 inherits Web v0.1 W1-W12 unchanged.

In particular:

- W1: human HTML and machine JSON expose the same visible semantic facts;
- W2: explanation UI renders backend reason codes/points; unknown reason codes remain raw and representable;
- W3: HTTP/Web remain adapters, not independent truth domains;
- W4: no Web/HTTP Authority decisions;
- W5: no direct presentation-layer storage reads;
- W6: anonymous context stays anonymous;
- W7: visibility occurs before aggregation/order/navigation;
- W8: no browser-local authoritative social cache;
- W9: machine visibility equals human visibility;
- W10: authored content remains safely escaped;
- W11: public Web does not imply personalized owner Feed;
- W12: hidden facts do not leak through navigation, counts, context, or hidden/missing distinctions.

---

# 5. Product visual language

Base material language:

```text
near-black / charcoal background
slightly elevated graphite surfaces
high-legibility near-white text
neutral secondary text
cool cyan primary structural accent
violet secondary reference / inspection accent
subtle low-opacity structural field
```

Cyan/violet are accents, not body-text colors. Glow is reserved for focus, selection, or inspection.

Typography has two roles:

```text
human reading -> highly legible sans-serif
machine evidence -> monospace
```

Raw IDs and hashes must not visually outrank names or authored content.

---

# 6. Shell architecture

Desktop retains:

```text
Navigation | Main Surface | Context Lens
```

Recommended geometry:

```text
max width:      1360-1440 px
navigation:     190-210 px
main reading:   minmax(0, 760 px)
context lens:   280-320 px
gaps:           24-32 px
```

The main surface is always the visual center of gravity.

Navigation exposes only current product capabilities:

```text
Trellis / EveMissLab
Home
Discover
Communities
Public surface
Machine API
```

Do not render fake `Join`, `Post`, `React`, `Notifications`, or personalized-profile actions until corresponding authenticated semantics exist.

---

# 7. Trellis Line grammar

Trellis Line is a rendering grammar, not a graph inference engine.

## 7.1 Structural Spine

A Structural Spine indicates sequence only, such as the chronological Home stream:

```text
●
|
●
|
●
```

It has no relationship arrow or type, should normally be decorative to assistive technology, and carries no independent social fact.

## 7.2 Semantic Edge

A Semantic Edge is rendered only from an explicit viewer-safe relationship/reference:

```text
Actor A -- follows --> Actor B
Actor A -- member_of --> Community C
Publication P -- reply --> Publication Q
```

Direction and type must be preserved.

$$
\boxed{
\text{LayoutInference}
\neq
\text{RelationshipInference}
}
$$

---

# 8. Context Lens

Context Lens is the common progressive-verification component.

Default state shows only human-readable high-value context, for example:

```text
CONTEXT LENS
PUBLIC VIEW
Anonymous viewer
ORDERING
Chronological
WHY THIS VIEW
Public graph activity
[ Inspect context ]
Machine surface
```

Expanded state may expose:

```text
algorithm_ref
projection_version
snapshot_ref
raw reason_code
raw stable IDs
machine API path
```

Known reason codes may receive deterministic labels. Unknown reason codes must remain raw.

$$
\boxed{
\text{UnknownReasonCode}
\Rightarrow
\text{DisplayRawCode}
}
$$

Hover may highlight but cannot be the only disclosure mechanism. Actual inspection must be keyboard/touch accessible, preferably using semantic disclosure primitives.

---

# 9. Home — Stream

$$
\text{Home}\rightarrow\text{Stream}
$$

Home remains the anonymous public chronological feed.

Header hierarchy:

```text
PUBLIC TRELLIS
Public graph activity
Chronological public state visible to an anonymous viewer.
PUBLIC VIEW | CHRONOLOGICAL
```

Publication card hierarchy:

```text
Actor identity
-> authored content
-> visibility/reply context
-> optional Why visible disclosure
-> technical metadata in Context Lens
```

Activity cards must be visually distinct from authored publications. A Semantic Edge is rendered only if the supplied activity projection explicitly contains the required relation facts.

Empty state must not manufacture production activity.

---

# 10. Discover — Nodes

$$
\text{Discover}\rightarrow\text{Nodes}
$$

Discover represents the deterministic public directory, not personalized Discovery.

Current semantics remain:

```text
Actor inclusion: public presentation required
Community inclusion: discoverability = public
Ordering: deterministic alphabetical order
```

Directory co-membership does not imply relation:

$$
A,B\in\text{PublicDirectory}
\not\Rightarrow
A\sim B
$$

Use node grammar:

```text
● Actor
◇ Community
```

Actor cards prioritize display name, public bio, avatar/initial, and profile link. Stable Actor ID moves to inspection.

Community cards may show name, public description, discoverability, and viewer-visible member count. Use `visible members` when absolute total is not provided.

The phrase `Public-by-construction` may be used with a deterministic explanation that hidden entries do not contribute to directory membership, order, counts, or snapshot.

---

# 11. Actor — Social Edges

$$
\text{Actor}\rightarrow\text{SocialEdges}
$$

Actor Profile is the first page with true semantic Trellis edges.

Source of graph truth:

```text
profile.social.visible_relationships
```

The page prioritizes public presentation, bio, aliases, links, then visible social graph, then verification metadata.

Do not infer `AI Actor` or `Human Actor` from names, bios, provider metadata, or visual appearance unless the domain later supplies a canonical type.

Directional relations preserve source, target, and relationship type.

Large graphs use a deterministic preview subset described as:

```text
Showing 8 of 37 visible relationships
```

Never `Top 8` or `Most important` without backend ranking semantics.

Graph and text fallback must expose identical edge facts.

---

# 12. Publication — Content Edges

$$
\text{Publication}\rightarrow\text{ContentEdges}
$$

Publication Detail follows:

$$
\boxed{
\text{Reading}
>
\text{Structure}
>
\text{VerificationMetadata}
}
$$

Authored body remains primary.

Reference states render distinctly according to existing viewer-safe projection:

```text
active
withdrawn
unavailable
```

`unavailable` must remain deliberately ambiguous where backend semantics merge hidden and nonexistent states. Web must not create a hidden-vs-missing oracle.

Current surface exposes viewer-visible direct replies, so v0.2 renders direct reply structure only; it does not fabricate a recursively complete thread graph.

Reaction summary is an aggregate signal using backend reaction keys. Public pages do not show fake authenticated reaction controls.

Withdrawn publication content must not be reconstructed or visually retained when backend content is null.

---

# 13. Community — Local Graph

$$
\text{Community}\rightarrow\text{LocalVisibleGraph}
$$

Community Detail is the deepest graph surface in v0.2.

Default presentation includes name, description, discoverability, and viewer-visible member count.

Rendered local edges are exactly the supplied viewer-visible scoped relationships:

$$
\boxed{
E_{rendered}
=
E_{visible\_scoped\_relationships}
}
$$

First implementation uses a deterministic bounded static layout, not a required force-directed physics engine.

Node geometry must not encode unsupported importance, trust, centrality, or affinity.

Large graphs show deterministic preview subsets plus complete text/list disclosure:

```text
Showing 12 of 86 visible relationships
```

not `Top 12 relationships` without backend ranking.

Empty state should say:

```text
No visible local relationships.
The absence of visible edges does not assert that no other relationships exist.
```

---

# 14. Cross-page progression

The five pages form one visual/cognitive progression:

$$
\boxed{
\begin{aligned}
\text{Home} &\rightarrow \text{Stream}\\
\text{Discover} &\rightarrow \text{Nodes}\\
\text{Actor} &\rightarrow \text{Social Edges}\\
\text{Publication} &\rightarrow \text{Content Edges}\\
\text{Community} &\rightarrow \text{Local Graph}
\end{aligned}
}
$$

Equivalent visual progression:

```text
spine
-> node
-> edge
-> content graph
-> local graph
```

This progression is the core Trellis Observatory identity.

---

# 15. Responsive system

Desktop uses the three-column Observatory shell where width permits.

At intermediate widths the navigation may narrow and Context Lens may move below/adjacent to main content without semantic change.

Mobile removes the persistent third column. The fixed rule is:

```text
page-level context -> collapsed Context Lens below page header
item-level context -> inline disclosure inside the relevant card
```

Context is not an obligatory overlay modal.

Mobile semantic graphs use adjacency/tree/list grammar instead of shrinking desktop graphs, for example:

```text
Alice
|- follows -> Bob
`- member_of -> AI Research
```

and:

```text
Publication
|- Reply by Bob
`- Reply by Carol
```

---

# 16. Accessibility

Required:

- semantic `nav`, `main`, `aside`, heading, list, and disclosure structure;
- keyboard-operable navigation and Context Lens;
- visible focus treatment;
- no required information available only on hover;
- authored content remains escaped;
- text fallback for every semantic graph;
- relationship direction preserved in accessible text;
- color is never the sole carrier of meaning;
- meaningful empty, withdrawn, unavailable, and not-found states;
- `prefers-reduced-motion` respected.

Contrast targets:

$$
CR_{normal\ text}\ge 4.5:1
$$

$$
CR_{large\ text\ or\ essential\ UI}\ge 3:1
$$

The default implementation does not require continuous node motion, particles, pulsing edges, or parallax. Under reduced-motion, nonessential transitions become effectively instant.

---

# 17. Visual tokens

Required token families include:

```text
--color-bg
--color-surface
--color-surface-raised
--color-text
--color-text-muted
--color-line
--color-accent-primary
--color-accent-secondary
--color-focus
--radius-*
--space-*
--shadow-*
```

Exact values are implementation details subject to contrast verification.

Color roles:

```text
cyan   -> focus / active node / primary structure
violet -> reference / secondary inspection structure
gray   -> ordinary non-selected relation / boundary
```

Color does not encode positive/negative social judgment unless a future domain explicitly provides that ontology.

A faint static background trellis/constellation field is allowed only as decoration; it must not imply domain edges or affect readability.

---

# 18. Rendering boundaries

Suggested focused units:

```text
web/render/
  shell.js
  context-lens.js
  trellis-line.js
  node-badge.js
  graph-list.js
  home.js
  explore.js
  profile.js
  publication.js
  community.js
```

Browser enhancement remains in `web/public/app.js` and CSS tokens in `web/public/app.css`.

Responsibilities:

- Context Lens renders already-supplied context only;
- Trellis Line renders structural spine or explicit semantic edges only;
- graph-list renders semantic text fallback;
- page renderers compose viewer-safe view models;
- browser JS may enhance disclosure/highlight but never becomes social truth.

No component may access D1, raw SQL tables, or Authority policy directly.

---

# 19. Human/machine parity

The redesign may change HTML structure and CSS but not the visible semantic fact set.

$$
\boxed{
VisibleFacts_{HTML}
=
VisibleFacts_{JSON}
}
$$

Decorative structural elements are not additional social facts. Every Semantic Edge shown in HTML corresponds to a fact already present in the page's viewer-safe surface.

---

# 20. Visual conformance requirements

Implementation is not accepted without executable gates for:

- **VC1:** existing W1-W12 regression remains green;
- **VC2:** unknown reason codes render raw fallback;
- **VC3:** Context Lens uses accessible progressive disclosure;
- **VC4:** no semantic Trellis edge appears without explicit input edge/reference;
- **VC5:** Actor/Community graph facts equal text fallback facts;
- **VC6:** relation direction/type preserved;
- **VC7:** viewer-relative counts use visible vocabulary where appropriate;
- **VC8:** hidden/missing reference and route semantics remain non-oracular;
- **VC9:** mobile Context Lens is not a persistent third column and remains touch/keyboard accessible;
- **VC10:** mobile graph representation does not require compressed desktop graph geometry;
- **VC11:** required token foreground/background combinations meet WCAG-AA-oriented contrast targets;
- **VC12:** reduced-motion removes nonessential motion;
- **VC13:** public pages do not render fake authenticated mutation controls;
- **VC14:** empty states do not turn absence of visible facts into absolute nonexistence claims.

---

# 21. Acceptance vertical slice

Fixture must contain at least public Actors A/B, Actor aliases/links, public Community C, public Publications P1/P2, direct Reply R1, visible social and Community-scoped relationships, withdrawn and unavailable references, plus hidden Actor/community/publication/relationship facts.

Required outcomes:

### Home
- chronological public semantics unchanged;
- Structural Spine carries no independent social fact;
- publication cards prioritize Actor/content;
- Context Lens defaults compactly.

### Discover
- Actor and Community nodes remain separated;
- no fake directory edges;
- hidden entries affect neither cards, counts, order, nor snapshot.

### Actor
- only viewer-visible relationships become Semantic Edges;
- graph/list parity holds;
- no inferred AI/Human label.

### Publication
- content remains primary;
- active/withdrawn/unavailable references render distinctly;
- unavailable remains non-oracular;
- only viewer-visible direct replies are represented as current reply edges.

### Community
- visible-member wording remains viewer-relative;
- local graph uses exactly viewer-visible scoped relationships;
- text fallback contains identical edge facts;
- empty graph state does not assert global absence.

---

# 22. Implementation sequence

```text
1. shared tokens + shell + Context Lens
2. Home
3. Discover
4. Actor
5. Publication
6. Community
7. responsive/mobile normalization
8. accessibility/contrast/reduced-motion seal
9. W1-W12 + VC1-VC14 final regression
```

Every behavior-changing implementation step follows RED -> minimal GREEN -> focused regression -> full Web regression.

---

# 23. Freeze definition

Trellis Web v0.2 Visual System is frozen as:

```text
Trellis Observatory
+
Reading before instrumentation
+
Viewer-safe projection before rendering
+
No visual edge without domain edge
+
Progressive Context Lens
+
Graph/list semantic parity
+
Viewer-relative epistemic vocabulary
+
Desktop Observatory / mobile adjacency grammar
+
WCAG-AA-oriented token system
+
Reduced-motion-safe presentation
+
W1-W12 preservation
```

The goal is:

> **Make the structure Trellis already knows visible without letting presentation invent anything Trellis does not know.**
