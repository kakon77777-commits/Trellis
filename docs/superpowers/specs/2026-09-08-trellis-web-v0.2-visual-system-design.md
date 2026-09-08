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

The system is not a conventional social-network clone and not a neon cyberpunk graph demo. Its visual identity comes from rendering already-authorized social structure clearly:

```text
viewer-safe Trellis projection
-> readable human surface
-> visible structural cues
-> progressive context inspection
```

The visual system must make Trellis feel like a place where users can **observe content, nodes, relations, references, and local graphs without confusing rendering with social truth**.

The central design equation is:

$$
\boxed{
\text{Readable Social Surface}
+
\text{Visible Structure}
+
\text{Progressive Verifiability}
}
$$

and never:

$$
\boxed{
\text{Engineering Metadata Dashboard}
}
$$

---

## 1. Authority Order

Implementation authority is ordered as follows:

```text
1. Existing Trellis domain semantics and canonical history
2. Existing viewer-safe read services / derived surfaces
3. Trellis Web v0.1 W1-W12 contracts
4. This Web v0.2 Visual System Design
5. Future implementation plan
6. CSS/HTML/JS implementation details
```

If a visual idea conflicts with viewer-safe projection semantics, W1-W12, or domain truth, the visual idea loses.

---

## 2. Non-goals

Web v0.2 Visual System does not add:

- personalized public ranking;
- recommendation semantics;
- inferred social edges;
- inferred Actor type;
- inferred relationship polarity;
- client-side visibility decisions;
- client-side authority decisions;
- login or authenticated write actions;
- browser-local authoritative graph caches;
- hidden-versus-missing existence oracles;
- force-directed graph simulation as a required dependency;
- animation that carries semantic meaning unavailable without motion.

The migration is presentation-only.

---

# 3. Visual Constitution

The following invariants are frozen for Web v0.2.

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

Content and identity remain primary. Hashes, algorithm references, projection versions, and raw identifiers are available through progressive inspection instead of dominating the first view.

## V2 — Viewer-safe projection before rendering

$$
\boxed{
\text{RenderInput}
=
\text{ViewerSafeProjection}
}
$$

The Web layer never broadens visibility and never queries hidden state to improve a visual.

## V3 — No visual edge without a domain edge

$$
\boxed{
E_{rendered}
\subseteq
E_{viewer\text{-}safe\ projection}
}
$$

A layout may position nodes. It may not infer social relationships from geometric proximity, names, activity co-occurrence, model metadata, or UI convenience.

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

Verification exists, but it is disclosed progressively through Context Lens rather than displayed as a permanent engineering wall.

## V5 — Graph/list semantic parity

$$
\boxed{
\operatorname{Facts}(\text{VisualGraph})
=
\operatorname{Facts}(\text{TextFallback})
}
$$

Any visible graph representation must have a text/list representation containing the same visible edges.

## V6 — Absence of visibility is not proof of absence

$$
\boxed{
\text{NoVisibleEdge}
\not\Rightarrow
\text{NoEdgeExists}
}
$$

The interface must use phrases such as `visible members`, `visible relationships`, and `no visible local relationships` where the underlying fact is viewer-relative.

---

# 4. Inherited W-series constraints

Web v0.2 inherits Web v0.1 W1-W12 unchanged.

Visual implementation must preserve at minimum:

- **W1:** human HTML and machine JSON expose the same visible semantic facts;
- **W2:** ranking/context explanations render backend reasons; unknown reason codes remain raw and representable;
- **W3:** HTTP/Web remain adapters, not independent state domains;
- **W4:** no Web/HTTP Authority decisions;
- **W5:** no direct presentation-layer storage reads;
- **W6:** anonymous context remains anonymous;
- **W7:** visibility filtering occurs before aggregation/order/navigation;
- **W8:** no browser-local authoritative social cache;
- **W9:** machine visibility equals human visibility;
- **W10:** authored content remains safely escaped;
- **W11:** public Web does not imply personalized owner Feed;
- **W12:** hidden facts do not leak through navigation, counts, context, or hidden/missing distinctions.

The visual system strengthens these contracts; it does not reinterpret them.

---

# 5. Product visual direction

## 5.1 Observatory, not clone

The interface should feel like an **observatory for relation-first social structure**.

It must avoid:

```text
Facebook/X clone
Reddit clone
traditional admin dashboard
neon cyberpunk graph demo
science-fiction HUD overload
```

## 5.2 Material language

Base palette:

```text
near-black / charcoal background
slightly elevated graphite surfaces
high-legibility near-white text
neutral secondary text
cool cyan primary structural accent
violet secondary reference / inspection accent
subtle low-opacity structural field
```

Cyan and violet are accent colors, not body-text colors.

Glow is reserved for focus, selected structure, or transient inspection states.

## 5.3 Typography

The interface uses two typographic roles:

```text
Human reading text -> system sans-serif / highly legible sans
Identifiers and machine evidence -> monospace
```

Raw IDs, hashes, projection versions, and algorithm refs must never visually outrank human-readable names or authored content.

---

# 6. Shell architecture

Desktop retains a three-column shell:

```text
Navigation | Main Surface | Context Lens
```

Recommended desktop geometry:

```text
max overall width: 1360-1440 px
navigation:        190-210 px
main reading:      minmax(0, 760 px)
context lens:      280-320 px
gaps:              24-32 px
```

The main surface is always the visual center of gravity.

The Context Lens must not be brighter, denser, or more animated than the content surface.

---

# 7. Navigation

Desktop navigation:

```text
T
Trellis
EveMissLab

Home
Discover
Communities

----------------
Public surface
Machine API
```

The visual system does not render unavailable future actions such as:

```text
My Trellis
Notifications
Profile
Join
React
Post
```

until corresponding authenticated product semantics exist.

Mobile navigation remains a compact bottom navigation pattern for the current public routes.

---

# 8. Trellis Line rendering grammar

Trellis Line is a rendering grammar, not an inference engine.

It has two distinct modes.

## 8.1 Structural Spine

A Structural Spine indicates sequence or visual continuity only.

Example on Home:

```text
●
|
●
|
●
```

It means items occupy one chronological observation stream. It does not assert social relationships between adjacent cards.

Requirements:

- no relationship arrow;
- no relationship label;
- `aria-hidden="true"` unless it conveys independently meaningful accessible content;
- removal of the spine must not change semantic facts.

## 8.2 Semantic Edge

A Semantic Edge is rendered only when a viewer-safe projection explicitly supplies the relationship/reference.

Examples:

```text
Actor A -- follows --> Actor B
Actor A -- member_of --> Community C
Publication P -- reply --> Publication Q
```

Requirements:

- direction preserved where domain semantics are directional;
- relationship/reference type comes from the projection;
- no visual edge added from proximity or similarity;
- graph and text fallback expose equal facts.

## 8.3 Geometry is not ontology

$$
\boxed{
\text{LayoutInference}
\neq
\text{RelationshipInference}
}
$$

The Web layer may decide where a node appears on screen. It may not decide that two nodes are socially related because they appear near each other.

---

# 9. Context Lens

Context Lens is the common progressive-verification component.

## 9.1 Default state

The first view contains only high-value human-readable context, for example:

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

## 9.2 Expanded state

Expanded inspection may expose:

```text
algorithm_ref
projection_version
snapshot_ref
raw reason_code
raw stable IDs
machine API path
```

## 9.3 W2 reason-code rule

Known reason codes may receive deterministic display labels, but the raw code remains available in inspection.

Unknown reason codes must be rendered as raw codes.

Forbidden:

```text
unknown backend code
-> LLM-generated friendly explanation
```

Required:

$$
\boxed{
\text{UnknownReasonCode}
\Rightarrow
\text{DisplayRawCode}
}
$$

## 9.4 Interaction

Hover may highlight. It may never be the only mechanism that reveals required information.

Actual disclosure must be keyboard/touch accessible, using a semantic disclosure pattern such as `<details>/<summary>` or an equivalent implementation.

---

# 10. Home — Stream

Home represents the current anonymous public chronological observation stream.

Conceptual progression role:

$$
\text{Home}\rightarrow\text{Stream}
$$

## 10.1 Header

Preferred information hierarchy:

```text
PUBLIC TRELLIS
Public graph activity
Chronological public state visible to an anonymous viewer.

PUBLIC VIEW | CHRONOLOGICAL
```

The header does not resemble a marketing hero.

## 10.2 Publication card

Priority:

```text
Actor identity
-> content
-> visible context
-> verification metadata
```

Example:

```text
● Actor A                         12:42
|
| Publication
|
| Authored body...
|
`- PUBLIC | 4 replies | Why visible?
```

Raw publication IDs are not primary headings.

## 10.3 Activity card

Activity cards are visually distinct from authored publications.

If the existing activity projection contains enough explicit relation data, the card may render a Semantic Edge. Otherwise it renders the supplied fields without inventing graph structure.

## 10.4 Empty state

The empty state must not fabricate production content.

Preferred message:

```text
No public activity yet.
Nothing is synthesized to make the network appear active.
```

---

# 11. Discover — Nodes

Discover represents the deterministic public node index.

$$
\text{Discover}\rightarrow\text{Nodes}
$$

Current semantics remain:

```text
Actors: public presentation required
Communities: discoverability = public
Ordering: deterministic alphabetical order
```

## 11.1 No fake edge

Directory co-membership does not imply relation.

$$
A,B\in\text{PublicDirectory}
\not\Rightarrow
A\sim B
$$

Discover therefore uses node grammar, not inter-card graph edges.

Recommended node grammar:

```text
● Actor
◇ Community
```

## 11.2 Actor card

Default card may show:

```text
avatar or initial fallback
display name
public bio excerpt
Actor label
profile link
```

Stable Actor ID is inspection-level information.

## 11.3 Community card

Default card may show:

```text
Community name
description
public discoverability
visible member count
community link
```

Use `visible members`, not an unqualified absolute-member claim where only viewer-visible count exists.

## 11.4 Public-by-construction vocabulary

The UI may use the human-readable term:

```text
Public-by-construction
```

with an explanation that hidden entries do not contribute to directory membership, order, counts, or snapshot.

The explanation is descriptive rendering of existing semantics, not a new policy.

---

# 12. Actor — Social Edges

Actor Profile is the first page where Trellis Line becomes a true semantic relationship graph.

$$
\text{Actor}\rightarrow\text{SocialEdges}
$$

## 12.1 Hero

Priority:

```text
human-readable Actor presentation
-> public bio / aliases / links
-> visible social graph
-> raw Actor ID / projection metadata
```

No AI-generated avatar or inferred Actor type is permitted.

If the domain does not provide canonical `actor_kind`, the Web layer displays `Actor`, not an inferred `AI Actor` or `Human Actor` label.

## 12.2 Visible Trellis

Source of truth:

```text
profile.social.visible_relationships
```

Every graph edge comes from this set.

## 12.3 Direction

Directional relations must preserve direction visually and textually.

Preferred form:

```text
Alice -- follows --> Bob
```

An unlabeled symmetric-looking line must not erase directional semantics.

## 12.4 Preview density

Large visible graphs use a deterministic preview subset.

The interface may say:

```text
Showing 8 of 37 visible relationships
```

It must not say `Top 8` or `Most important` without backend ranking semantics.

## 12.5 Text fallback

The fallback contains the same edge facts:

```text
follows: Alice -> Bob
member_of: Alice -> AI Research
```

---

# 13. Publication — Content Edges

Publication Detail prioritizes reading while exposing reference and reply structure.

$$
\text{Publication}\rightarrow\text{ContentEdges}
$$

## 13.1 Reading first

Authored body remains the primary page content.

Publication ID, projection version, and revision metadata move to Context Lens / inspection unless needed for user understanding.

## 13.2 Reference context

The current viewer-safe reference states are rendered distinctly:

```text
active
withdrawn
unavailable
```

`unavailable` remains deliberately ambiguous between non-visible and nonexistent where the backend makes that distinction non-observable.

The Web layer must not create a hidden-vs-missing oracle.

## 13.3 Replies

Current surface exposes viewer-visible direct replies.

Therefore v0.2 renders a direct reply structure, not a fabricated recursively complete thread graph.

A reply page may in turn expose its own direct replies.

## 13.4 Reaction summary

Reaction summary is rendered as an aggregate signal using backend reaction keys.

The public page does not render fake interactive reaction controls when authenticated mutation semantics do not exist.

## 13.5 Withdrawn state

When the backend returns withdrawn lifecycle and no active content, the page must not retain or reconstruct old body content.

Viewer-visible replies may remain visible if the backend surface returns them.

---

# 14. Community — Local Graph

Community Detail is the deepest structural Observatory surface in this version.

$$
\text{Community}\rightarrow\text{LocalVisibleGraph}
$$

## 14.1 Hero

Default presentation:

```text
Community name
description
discoverability
visible member count
```

Raw community ID belongs to inspection.

## 14.2 Visible members

Use viewer-relative vocabulary:

```text
18 visible members
```

not an absolute claim when only visible membership is known.

## 14.3 Local Trellis source

Rendered edges are exactly the viewer-visible scoped relationships supplied by the Community surface.

$$
\boxed{
E_{rendered}
=
E_{visible\_scoped\_relationships}
}
$$

## 14.4 Layout

v0.2 does not require a force-directed physics engine.

Preferred first implementation is deterministic, bounded, and static in layout.

Node placement must not encode unsupported notions of importance, trust, affinity, or centrality.

## 14.5 Density

Large graphs show a deterministic preview subset plus a complete text/list disclosure.

Allowed:

```text
Showing 12 of 86 visible relationships
```

Forbidden without backend ranking:

```text
Top 12 relationships
Most relevant connections
```

## 14.6 Empty graph state

Preferred semantic wording:

```text
No visible local relationships.
The absence of visible edges does not assert that no other relationships exist.
```

---

# 15. Cross-page structural progression

The five public pages form one coherent cognitive progression:

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

Equivalent rendering progression:

```text
spine
-> node
-> edge
-> content graph
-> local graph
```

This progression is the visual identity of Trellis Observatory.

---

# 16. Responsive system

## 16.1 Desktop

Desktop uses the three-column shell where width permits.

## 16.2 Intermediate width

At intermediate widths, navigation may narrow and Context Lens may move below or beside the main content without changing semantics.

## 16.3 Mobile

Mobile removes the persistent third column.

The fixed design decision is:

```text
page-level context -> collapsed Context Lens disclosure below page header
item-level context -> inline disclosure inside the relevant card
```

Context is not placed in an obligatory overlay modal.

## 16.4 Mobile graph representation

Mobile defaults to adjacency/tree/list grammar instead of shrinking desktop graphs.

Examples:

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

This preserves readability and semantic direction on narrow screens.

---

# 17. Accessibility contract

Web v0.2 must preserve and strengthen the existing accessibility contract.

Required:

- semantic `nav`, `main`, `aside`, headings, lists, and disclosure controls;
- keyboard-operable navigation and Context Lens;
- visible focus state;
- no information available only on hover;
- authored text remains escaped;
- text graph fallback for every semantic visual graph;
- relation direction preserved in accessible text;
- reduced-motion support;
- meaningful empty, withdrawn, unavailable, and not-found states;
- color is never the sole carrier of semantic meaning.

## 17.1 Contrast

Target minimums:

$$
CR_{normal\ text}\ge 4.5:1
$$

$$
CR_{large\ text\ or\ essential\ UI}\ge 3:1
$$

Functional small text, muted labels, pills, links, and focus indicators must be tested against their actual background tokens.

## 17.2 Reduced motion

The first implementation should not require continuous graph motion.

Allowed nonessential transitions:

```text
focus highlight
edge highlight
disclosure state
card hover
```

Under `prefers-reduced-motion: reduce`, these become instant or effectively motionless.

Forbidden as required semantics:

```text
continuous node floating
particle streams
connection pulses
parallax needed to understand structure
```

---

# 18. Visual tokens

Implementation should consolidate tokens rather than scatter literal values.

Required token families:

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
--radius-sm
--radius-md
--radius-lg
--space-*
--shadow-*
```

Exact values are implementation details subject to contrast verification.

Color semantics:

```text
cyan   -> focus / active node / primary structure
violet -> reference / secondary inspection structure
gray   -> ordinary non-selected relation / boundary
```

Colors do not encode positive/negative social judgment unless a future domain explicitly provides that ontology.

---

# 19. Background structural field

A faint static trellis/constellation field may appear in low-information background space.

It must:

- remain decorative;
- have low opacity;
- never imply domain edges;
- never interfere with text contrast;
- remain understandable when removed;
- avoid continuous motion in the default implementation.

Decorative background structure must be hidden from assistive semantic navigation.

---

# 20. Rendering component boundaries

Suggested focused rendering units:

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

Potential browser enhancement units:

```text
web/public/
  app.css
  app.js
```

Responsibilities:

- `context-lens.js`: progressive display of already-supplied context;
- `trellis-line.js`: pure structural/semantic edge rendering from explicit inputs;
- `graph-list.js`: text fallback with semantic parity;
- page renderers: page composition only;
- browser JS: disclosure/highlight enhancement only, never social truth.

No component may read D1, SQL tables, or Authority policy directly.

---

# 21. Human/machine parity

The visual redesign may change HTML structure and CSS but must not expand or narrow the semantic facts exposed relative to the corresponding machine surface.

$$
\boxed{
VisibleFacts_{HTML}
=
VisibleFacts_{JSON}
}
$$

Decorative structural elements are not additional social facts.

A Semantic Edge shown in HTML must correspond to a fact already present in the page's viewer-safe data/model surface.

---

# 22. Visual conformance requirements

Implementation is not accepted without executable tests for the following.

## VC1 — W1-W12 regression

All existing Web v0.1 conformance tests remain green.

## VC2 — Unknown reason raw fallback

Unknown backend reason code is rendered as its raw code and not replaced with invented explanation text.

## VC3 — Context progressive disclosure

Default HTML exposes human-readable context while technical metadata is contained in an accessible inspection disclosure.

## VC4 — No Web-inferred edge

Trellis Line semantic edge rendering consumes only explicit relation/reference inputs. Tests must prove no edge appears when no input edge exists.

## VC5 — Graph/list parity

For Actor/Community semantic graphs, normalized visible edge facts from the visual graph and text fallback are equal.

## VC6 — Direction preservation

Directional relationships preserve source, target, and relation type in both graph and fallback text.

## VC7 — Viewer-relative vocabulary

Visible member/relation counts are labeled as visible where an absolute total is not provided.

## VC8 — Hidden/missing indistinguishability

Publication unavailable reference and hidden/nonexistent route semantics remain non-oracular.

## VC9 — Mobile Context Lens

At narrow viewport structure, page-level Context Lens is rendered as a default-collapsed, keyboard/touch-accessible in-flow disclosure immediately after the page lead/header and before the page body. The persistent desktop Context Lens column is hidden at the mobile breakpoint.

## VC10 — Mobile graph fallback

Mobile structural representation remains readable without requiring a horizontally compressed desktop graph.

## VC11 — Contrast

Automated or deterministic token checks plus focused review must prove required foreground/background combinations meet the target WCAG AA ratios.

## VC12 — Reduced motion

`prefers-reduced-motion` disables or removes nonessential transitions/animations.

## VC13 — No fake actions

Public pages do not render mutation controls for unavailable authenticated capabilities.

## VC14 — Empty-state epistemic wording

Empty graph/member states do not turn absence of visible facts into an absolute nonexistence claim.

---

# 23. Acceptance vertical slice

Use a fixture containing at least:

```text
Public Actor A
Public Actor B
Actor with public aliases/links
Public Community C
Public root Publication P1
Public root Publication P2
Reply R1 to P1
A visible social relationship
A visible Community-scoped relationship
A withdrawn reference target
An unavailable reference target
Hidden Actor/community/publication/relationship facts
```

Required visible outcome:

### Home

- chronological public stream remains unchanged semantically;
- Structural Spine carries no independent social facts;
- publication cards prioritize Actor/content;
- Context Lens defaults to compact public/ordering context.

### Discover

- Actor and Community nodes remain separated;
- no fake directory edges;
- hidden entries affect neither cards, counts, order, nor snapshot.

### Actor

- only viewer-visible relationships become Semantic Edges;
- graph/list parity holds;
- no inferred AI/Human Actor label.

### Publication

- content remains primary;
- active/withdrawn/unavailable references render distinctly;
- unavailable remains non-oracular;
- only direct viewer-visible replies are rendered as current reply edges.

### Community

- visible members use viewer-relative wording;
- local graph uses exactly viewer-visible scoped relationships;
- text fallback contains identical edge facts;
- empty graph wording does not assert global absence.

---

# 24. Implementation sequencing

The visual implementation should proceed in this order:

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

Each page should be implemented with RED -> minimal GREEN -> focused regression -> full Web regression before moving on.

---

# 25. Freeze definition

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
Desktop observatory / mobile adjacency grammar
+
WCAG-AA-oriented token system
+
Reduced-motion-safe presentation
+
W1-W12 preservation
```

The goal is not to make Trellis visually complicated.

The goal is:

> **Make the structure Trellis already knows visible without letting presentation invent anything Trellis does not know.**
