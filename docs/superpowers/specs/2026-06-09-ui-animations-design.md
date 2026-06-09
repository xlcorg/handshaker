# UI animations: motion tokens + sliding tab indicator + DnD drop affordance — design

**Date:** 2026-06-09
**Status:** draft (awaiting spec review)
**Branch:** `claude/serene-feistel-e53ca1`

## Problem

The app's current motion is limited to "system" overlays (Radix enter/exit on
dialogs/dropdowns/tooltips, Sonner toasts) and loading indicators (the `.spinner`,
streaming `.pulse-dot`, and `.hs-tab-progress` keyframes in
[globals.css](../../../src/styles/globals.css)). The **domain interactions** that
make a gRPC client feel alive are static, and there is **no
`prefers-reduced-motion` handling anywhere** (verified: 0 matches in `src`), which
is a WCAG 2.3.3 / 2.2.2 gap.

After a visual brainstorm (8 candidates shown as live demos), the user selected a
deliberately small first pass:

- **B** — sliding tab indicator (replace the per-tab opacity fade).
- **E** — drag-and-drop drop affordance, "Claude Desktop"-style: a **tinted fill**
  placeholder slot for reorder plus a **tinted region** when dropping into a
  group. Insertion-slot style **A** (fill, no border) was chosen.

A shared **motion-tokens + reduced-motion foundation** is included as mandatory
baseline so both features (and any future ones) draw from one source of truth.

## Scope

In scope: motion tokens + reduced-motion baseline, feature B, feature E.

Explicitly **out of scope** (the other brainstorm candidates — not chosen this
pass): response-arrival animation, stream-message enter, sidebar-tree accordion,
connection-state transitions, copy→check morph, button-press / skeleton micro-
interactions. They remain documented candidates for a later pass.

## Approach

Pure native + CSS, **no new dependencies** (chosen over `@dnd-kit` and
`@formkit/auto-animate`). The existing HTML5 DnD and `planDrop`
([dnd.ts](../../../src/features/catalog/dnd.ts), test-covered) are kept as-is; only
the *rendering* of the drop hint changes. The tinted-fill slot is the simplest
implementation **and** the desired visual: a placeholder element occupies vertical
space, so neighbours shift apart for free — no FLIP needed.

## Design

### 1. Motion tokens + reduced-motion ([globals.css](../../../src/styles/globals.css))

Add design tokens (desktop-snappy durations; Material-derived easing curves) to
`:root`:

```css
--motion-fast: 120ms;   /* micro: tab indicator, slot appear */
--motion-base: 180ms;   /* standard UI transitions */
--ease-standard: cubic-bezier(.2, 0, 0, 1);  /* movement between states */
--ease-out:      cubic-bezier(0, 0, .2, 1);  /* enter (decelerate) */
--ease-in:       cubic-bezier(.4, 0, 1, 1);  /* exit (accelerate) */
```

Global reduced-motion reset, with essential status feedback re-enabled:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
  /* Essential status feedback stays animated (not decorative) */
  .spinner   { animation-duration: .8s  !important; animation-iteration-count: infinite !important; }
  .pulse-dot { animation-duration: 1.4s !important; animation-iteration-count: infinite !important; }
}
```

B and E consume the tokens via `transition`, so under reduced-motion they collapse
to instant (tab indicator jumps; slot appears without reflow animation) — the
correct accessible behaviour.

Rationale (sources): durations kept ≤180ms because desktop UI should be snappier
than mobile and anything >400ms feels slow ([Material — duration & easing](https://m3.material.io/styles/motion/easing-and-duration),
[NN/g](https://www.nngroup.com/articles/animation-duration/)); easing split into
standard/enter/exit per Material; reduced-motion is the WCAG-cited technique
([W3C C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)). Only compositor-
friendly properties (`transform`, `opacity`) are animated for movement — important
because Tauri renders on WebView2 (Win) vs WKWebView (mac) and layout/paint
animations diverge across engines.

### 2. B — sliding tab indicator ([underline-tabs.tsx](../../../src/components/ui/underline-tabs.tsx))

Single self-contained component change. Today each tab renders its own
`<span>` underline toggled by `opacity`. Replace with **one** shared bar that is a
sibling of the buttons inside the `role="tablist"` container (made `relative`):

- Refs to each tab button (or the active one). On active-value change / mount /
  container resize, read the active button's `offsetLeft` + `offsetWidth` and store
  in state.
- Bar positioned `absolute` at the strip's bottom, moved via
  `transform: translateX(left)` and `width`, transitioned with
  `--motion-fast` + `--ease-standard`.
- Recompute via `useLayoutEffect` (no flash) + a `ResizeObserver` on the strip.
- First measurement applies position **without** transition (no "fly-in" on mount).
- Roles (`tablist` / `tab`) and `aria-selected` preserved.

Consumers ([RequestTabs.tsx](../../../src/features/workflow/RequestTabs.tsx),
[ResponsePanel.tsx](../../../src/features/response/ResponsePanel.tsx)) are
unchanged — same `UnderlineTabs` API.

### 3. E — DnD drop affordance (catalog)

`dnd.ts` / `planDrop` logic and the `dropHint` state in
[CollectionTree.tsx](../../../src/features/catalog/CollectionTree.tsx) are
**unchanged**. Only hint rendering changes. The dragged row keeps its existing
`opacity-50` "ghost" state.

- **New `DropSlot.tsx`** — a small reusable component rendering the tinted-fill
  placeholder (style A): `background: hsl(212 70% 50% / .14)`, rounded, row-height,
  respecting the row indentation/bleed. Appears via a `max-height`/`opacity`
  transition using `--motion-fast` / `--ease-out`. Optional muted "Drop here" label.
- **before / after** ([RequestRow.tsx](../../../src/features/catalog/RequestRow.tsx),
  [FolderNode.tsx](../../../src/features/catalog/FolderNode.tsx)): replace the
  current 2px inset-shadow line (`hint === "before"/"after"` →
  `shadow-[inset_0_±2px_…]`) with a `DropSlot` rendered before/after the hinted
  row. The slot's height pushes neighbours apart (the "расступание").
- **inside** ([FolderNode.tsx](../../../src/features/catalog/FolderNode.tsx),
  [CollectionNode.tsx](../../../src/features/catalog/CollectionNode.tsx)): when
  `dropHint.zone === "inside"`, tint the whole container region
  (`background: hsl(212 70% 50% / .12)` + a faint inset ring) to read as "drop into
  this group", Claude-Desktop-style.

Data flow is unchanged: `dropHint` already flows `CollectionTree → cb → rows`; we
re-render it differently and add the inside-tint branch. `onDrop`/`planDrop`
untouched.

### Error handling

Animations have no failure modes. B guards the measurement when refs are null
(no-op until laid out). E renders nothing extra when `dropHint` is null.

## Testing (TDD, subagent-driven)

- **B:** jsdom has no layout (`offsetWidth === 0`), so pixel position is not
  asserted. Test that exactly one indicator element renders and tracks the active
  tab (`aria-selected`); keep `RequestTabs` / `ResponsePanel` usage tests green.
- **E:** assert `DropSlot` renders at the insertion point when `dropHint` is
  `before`/`after`, and that the container gets the tint affordance when
  `inside`. `planDrop` tests
  ([dnd.test.ts](../../../src/features/catalog/dnd.test.ts)) are untouched; update
  the existing DnD component tests
  ([RequestRow.test.tsx](../../../src/features/catalog/RequestRow.test.tsx),
  [FolderNode.test.tsx](../../../src/features/catalog/FolderNode.test.tsx),
  [CollectionTree.test.tsx](../../../src/features/catalog/CollectionTree.test.tsx))
  that assert the old inset-shadow hint.
- **reduced-motion** and cross-engine appearance (WebView2 vs WKWebView): manual
  verification via `pnpm tauri dev`. The macOS/WKWebView pass is deferred, in line
  with the project's other deferred mac checks.

## Implementation order

1. Foundation — tokens + reduced-motion in `globals.css`.
2. B — `underline-tabs.tsx` (self-contained; low risk).
3. E — `DropSlot.tsx`, then `RequestRow` / `FolderNode` (before/after), then
   `FolderNode` / `CollectionNode` (inside tint); update affected tests.

## Out of scope / deferred

- The six unselected brainstorm candidates (response arrival, stream enter, tree
  accordion, connection states, copy→check, micro-interactions).
- A `prefers-reduced-motion`-aware automated test (jsdom can't evaluate the media
  query) — covered by manual verification.
