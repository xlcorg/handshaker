# Resizable request/response body panes + scrollbar fix — design

**Date:** 2026-06-08
**Status:** draft (awaiting spec review)
**Branch:** `claude/amazing-turing-39471a`

## Problem

Two related issues in the draft Focus view body area
([CallPanel.tsx:78-85](../../../src/features/workflow/CallPanel.tsx)):

1. **Bug.** Resizing the Sidebar makes native browser scrollbars appear inside the
   **request** body pane. They do not appear in the response pane.
2. **Missing feature.** The request and response panes are a fixed 50/50 flex split.
   The user wants to drag-resize them, and to choose left/right vs top/bottom.

## Root cause (bug)

The request pane wraps the Monaco editor in an `overflow-auto` container
([RequestTabs.tsx:32](../../../src/features/workflow/RequestTabs.tsx)). Monaco
manages its own scrollbars and relayouts itself via `automaticLayout: true`
([monaco.ts:164](../../../src/lib/monaco.ts)) using a ResizeObserver. When the
panel width changes (sidebar drag), Monaco's internal layout lags by a frame
behind the shrunken container, so the rendered editor is momentarily wider than
its parent — and the `overflow-auto` parent renders native scrollbars.

This is confirmed by asymmetry: the response pane
([ResponseBody.tsx:10](../../../src/features/response/ResponseBody.tsx),
[ResponsePanel.tsx:28](../../../src/features/response/ResponsePanel.tsx)) has **no**
`overflow-auto` wrapper around its Monaco, and the user reports no scrollbars there.

The outer `overflow-auto` is redundant for Monaco but IS needed for the Metadata
and Auth tabs (plain DOM that overflows vertically). So the fix scopes overflow
per-tab rather than removing it globally.

## Design

### 1. Scrollbar fix

In `RequestTabs`, the shared tab-body container becomes `overflow-hidden`; the
Metadata and Auth tabs get their own `overflow-auto` wrapper. The request (Monaco)
tab sits directly in the `overflow-hidden` container and scrolls itself.

```
<div className="min-h-0 flex-1 overflow-hidden">
  {tab === "request"  ? <BodyEditor … /> : null}
  {tab === "metadata" ? <div className="h-full overflow-auto"><MetadataEditor … /></div> : null}
  {tab === "auth"     ? <div className="h-full overflow-auto"><AuthReadOnly … /></div> : null}
</div>
```

For symmetry under the new resize handle, `ResponseBody`'s Monaco wrapper
([ResponseBody.tsx:10](../../../src/features/response/ResponseBody.tsx)) also gets
`overflow-hidden` (Monaco scrolls itself; no native scrollbar can leak).

### 2. Resizable request/response split

Replace the plain `flex` row in `CallPanel` with a `ResizablePanelGroup` +
`ResizableHandle`, mirroring the sidebar pattern in
[WorkflowApp.tsx:185-228](../../../src/app/WorkflowApp.tsx):

```
<ResizablePanelGroup
  key={orientation}
  orientation={orientation}
  defaultLayout={{ request: prefs.bodyPanel, response: 100 - prefs.bodyPanel }}
  onLayoutChanged={(layout) => {
    const pct = layout["request"];
    if (typeof pct === "number" && pct > 0) setPref("bodyPanel", pct);
  }}
>
  <ResizablePanel id="request" minSize="20%"> <RequestTabs … /> </ResizablePanel>
  <ResizableHandle withHandle />
  <ResizablePanel id="response" minSize="20%"> <ResponseSlot … /> </ResizablePanel>
</ResizablePanelGroup>
```

- **`key={orientation}`** forces a clean remount when the orientation toggles, so
  the group re-reads `defaultLayout` instead of carrying stale internal state.
- **`withHandle`** shows the grip affordance (the sidebar handle is grip-less by
  design; the body divider is a more discoverable, frequently-used control).
- The previous per-child `min-w-0 flex-1 border-r` styling is dropped — the panel
  group + handle replace the border and sizing. The request pane keeps its right
  border only when left/right; rely on the handle (1px `bg-border`) as the divider.

### 3. New persisted pref `bodyPanel`

Add to `Prefs` ([use-prefs.ts:10](../../../src/lib/use-prefs.ts)):

```ts
/** Request body pane size as a percent of the call panel (resizable, persisted).
 *  Clamped to [20, 80] by the ResizablePanel. Shared across split orientations. */
bodyPanel: number;   // default 50
```

A single percent is shared across both orientations (YAGNI — no per-orientation
persistence).

### 4. Wire `prefs.split` → orientation

`prefs.split` is currently dead: set in
[AppearancePane.tsx:52-65](../../../src/features/settings/AppearancePane.tsx) but
read nowhere. The label mapping is `"horizontal"`→"Top / Bottom",
`"vertical"`→"Left / Right". The `react-resizable-panels` fork uses the inverse
convention (`orientation="horizontal"` = side-by-side). So:

```ts
const orientation = prefs.split === "horizontal" ? "vertical" : "horizontal";
```

**Default change.** Today users see left/right, but `PREFS_DEFAULTS.split` is
`"horizontal"` (= top/bottom). To preserve current behavior on first wire-up,
change the default to `"vertical"` (= Left / Right)
([use-prefs.ts:33](../../../src/lib/use-prefs.ts)).

## Components touched

| File | Change |
|------|--------|
| `src/features/workflow/RequestTabs.tsx` | overflow scoped per-tab (bug fix) |
| `src/features/response/ResponseBody.tsx` | `overflow-hidden` on Monaco wrapper |
| `src/features/workflow/CallPanel.tsx` | flex → ResizablePanelGroup; consume `prefs`, `setPref` |
| `src/lib/use-prefs.ts` | add `bodyPanel`; change `split` default to `"vertical"` |

No backend / IPC changes. No new dependencies (`resizable.tsx` already wraps
`react-resizable-panels`).

## Testing

Unit (vitest, jsdom — structure only, jsdom can't measure layout):

- `RequestTabs`: request tab's container is **not** `overflow-auto`; metadata/auth
  tabs render their own scroll wrapper.
- `CallPanel`: renders a resizable panel group with request + response panels and a
  handle; `orientation` reflects `prefs.split` (both values).
- `use-prefs`: `bodyPanel` default = 50; `split` default = `"vertical"`.

Manual (human `pnpm tauri dev` pass — layout/drag behavior can't be asserted in
jsdom):

- Drag sidebar → no scrollbars in request pane (bug gone).
- Drag the request/response divider → both panes resize; position persists across
  reload.
- Toggle Split direction in settings → orientation flips left/right ↔ top/bottom.

## Out of scope

- Per-orientation persisted sizes.
- Collapsing a body pane to zero (min 20% each).
- Removing/redesigning the Split direction setting (we are reviving it).
