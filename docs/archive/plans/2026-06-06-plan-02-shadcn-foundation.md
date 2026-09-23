# Plan 02 — shadcn Sidebar foundation (vendor + tokens + ResizablePanelGroup)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> **Detail is TDD-complete** — execute task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Status:** ✅ DONE (2026-06-06). All tasks complete; `tsc -b` clean, `pnpm test` 467/467,
`pnpm build` green; live vite-preview verified (sidebar restores persisted % across reload — 18%/30%;
Ctrl/Cmd+B collapses→0/expands; new shadcn shell renders, old `CollectionTree` mounts inside).
Commits `d0fd938..a430dac` (8). **Prereq fixed:** plan-01 left the frontend `tsc -b` red (client
`CollectionIpc`/`FolderIpc` literals missing the now-required `expanded` field — masked because
`pnpm test`/vitest doesn't type-check); fixed in `b1fc49d` (Task 0). **v4 note for plan-03:** panel
sizes are driven by the Group `defaultLayout` map (panel-level `defaultSize`/`minSize`/`maxSize` were
ignored — v4 fell back to 50/50); imperative collapse via the `panelRef` prop. 🧹 /clear-чекпойнт перед plan-03.
**Branch:** `claude/quirky-cannon-0d95d6`.
**Spec:** §1, §2 (collisions #1/#2/#8), §3, §9; visibility hotkey per §5 (Ctrl/Cmd+B).
**Predecessor:** plan-01 (backend persistence) — DONE.
**Goal:** Stand up the canonical shadcn `Sidebar` shell and `ResizablePanelGroup` layout **without
yet rewriting the tree** — the current `CollectionTree` stays mounted and working inside the new
shell. Isolates the foundation (tokens, vendored component, layout/resize/visibility bridge) from
the tree rewrite (plan-03) so the app stays green between phases.

**Architecture:** Vendor shadcn `sidebar.tsx`, then edit it (we own the file) to remove the
cmd+B keyboard listener, the `sidebar:state` cookie, the mobile `Sheet`/`useIsMobile` branch, and
the `Skeleton`-dependent `SidebarMenuSkeleton`. Add `--sidebar-*` HSL tokens to `globals.css`.
Wrap the `[sidebar | main]` row in `WorkflowApp` in a `ResizablePanelGroup`; the sidebar
`ResizablePanel` is collapsible and its size persists to `prefs.sidebarPanel` (percent). The shadcn
`Sidebar` inside runs `collapsible="none"` with `--sidebar-width: 100%` so the panel owns width.
Visibility + the Ctrl/Cmd+B hotkey move **up to `WorkflowApp`** (panel collapse via the imperative
`panelRef`); `SidebarShell` becomes presentational.

## Critical environment facts (verified) — the outline's pseudo-code predates these

- **`react-resizable-panels` is v4.11.2** (not the shadcn-era v0/v2 API). The vendored
  `src/components/ui/resizable.tsx` already wraps it: `ResizablePanelGroup`→`Group`,
  `ResizablePanel`→`Panel`, `ResizableHandle`→`Separator`. v4 differences that the outline got wrong:
  - Group orientation prop is **`orientation="horizontal"`**, not `direction`.
  - Group layout callback is **`onLayoutChanged(layout)`** (fires after pointer release) where
    `layout` is a **map `{ [panelId]: percent0to100 }`**, not `onLayout(sizes[])`. Read
    `layout["sidebar"]`, so the sidebar Panel **must** have `id="sidebar"`.
  - **Numeric size props are pixels; percentages are strings.** Use `minSize="12"` / `maxSize="40"` /
    `defaultSize={String(prefs.sidebarPanel)}` (bare-number strings = percent).
  - Imperative collapse/expand is via the **`panelRef` prop** (type `PanelImperativeHandle`,
    methods `collapse()`/`expand()`/`isCollapsed()`/`resize()`/`getSize()`), **not** a React `ref`.
    The vendored `ResizablePanel` spreads `{...props}` so `panelRef` passes through — **do NOT edit
    `resizable.tsx`**. (DOM node is via `elementRef`, also a prop.)
- **`src/test/setup.ts` has no `ResizeObserver` polyfill.** v4's `Group` does
  `new ownerDocument.defaultView.ResizeObserver(...)` on mount → throws in jsdom. Any test that
  renders the panel group (WorkflowApp.test) needs a polyfill (Task 5 adds it to setup.ts).
- **Imports / conventions in this repo:**
  - `cn` is `@/lib/cn` (not `@/lib/utils`).
  - Radix is the **unified `radix-ui` package**: `import { Slot } from "radix-ui"` then `<Slot.Root>`.
  - `@/components/ui/tooltip` exports `TooltipProvider`, `TooltipRoot`, `TooltipTrigger`,
    `TooltipContent`, and a **compact** `Tooltip` wrapper (takes a `content` prop). shadcn's
    `sidebar.tsx` uses `Tooltip` as the Radix root — rewrite those to **`TooltipRoot`**.
  - `button`/`separator`/`tooltip`/`input` exist; **`sheet.tsx`/`skeleton.tsx`/`sidebar.tsx` and
    `src/hooks/use-mobile` do NOT exist** — the trims below remove every dependency on them.
- **Visibility hotkey is Ctrl/Cmd+B** (one modifier OR the other + `b`), per spec §5 line 111. The
  outline's "cmd+ctrl+B" is loose shorthand for the same cross-platform combo; do **not** require
  both modifiers. The only reason it's mentioned is that vendored shadcn ships its own cmd/ctrl+B
  listener (removed in Task 1), which would otherwise double-fire against ours.
- **Test runner:** vitest 2 + @testing-library/react 16, `render(<C/>)` direct, `vi.mock` for deps.

## Build / test commands

- `pnpm test` (all) · `pnpm test src/features/catalog/SidebarShell` · `pnpm test src/lib/use-prefs`
  · `pnpm test src/app/WorkflowApp` · `pnpm lint` · `pnpm build`

## File structure (boundaries)

- **Create** `src/components/ui/sidebar.tsx` (vendored shadcn, then edited — Task 1).
- **Modify** `src/styles/globals.css` — `--sidebar-*` HSL tokens + `@theme inline` color maps (Task 2).
- **Modify** `src/features/catalog/SidebarShell.tsx` — presentational; render inside
  `Sidebar`/`SidebarHeader`/`SidebarContent`; drop the custom resizer, `return null`, the keyboard
  effect, and all `usePrefs`/`sidebarWidth` usage (Task 3).
- **Modify** `src/features/catalog/SidebarShell.test.tsx` — wrap renders in `SidebarProvider`; drop
  the Ctrl/Cmd+B test (moves to WorkflowApp) (Task 3).
- **Modify** `src/lib/use-prefs.ts` + `src/lib/use-prefs.test.ts` — `sidebarWidth:number(px,256)` →
  `sidebarPanel:number(percent,18)` (Task 4).
- **Modify** `src/app/WorkflowApp.tsx` — `SidebarProvider` + `ResizablePanelGroup`; Ctrl/Cmd+B in the
  existing global keydown effect; persist `sidebarPanel`; collapse via `panelRef` (Task 5).
- **Modify** `src/app/WorkflowApp.test.tsx` — keep all existing tests green; add a Ctrl/Cmd+B-toggle
  test (Task 5).
- **Modify** `src/test/setup.ts` — `ResizeObserver` (+`matchMedia`) polyfill (Task 5).
- **Do NOT** create `sheet.tsx` / `skeleton.tsx`; **do NOT** edit `resizable.tsx`.

## Inter-task ordering note

Tasks are ordered so **`pnpm test` + `pnpm lint` + `pnpm build` are green after every task**.
Between Task 3 (SidebarShell now needs a `SidebarProvider`) and Task 5 (WorkflowApp adds the
provider) the *assembled app at runtime* is temporarily incomplete, but no suite exercises that
path: `SidebarShell.test` supplies its own provider, and `WorkflowApp.test` mocks `SidebarShell`.
Full-app runtime is asserted only at Task 6 (Verify). This is expected — not a regression.

## Tasks

- [x] **Task 1: Vendor + edit `src/components/ui/sidebar.tsx`.** No unit test (it's a vendored
  component library file); the gate is `pnpm lint` + `pnpm build` (tsc) clean and the exports below
  present. Two commits for a clean diff:
  - **Commit 1a (raw vendor):** add the canonical shadcn `sidebar.tsx` verbatim. (If the implementer
    cannot fetch it, reproduce the standard shadcn New-York `sidebar.tsx` — `SidebarProvider`,
    `Sidebar`, `SidebarTrigger`, `SidebarRail`, `SidebarInset`, `SidebarInput`, `SidebarHeader`,
    `SidebarFooter`, `SidebarSeparator`, `SidebarContent`, `SidebarGroup`, `SidebarGroupLabel`,
    `SidebarGroupAction`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`,
    `SidebarMenuButton`, `SidebarMenuAction`, `SidebarMenuBadge`, `SidebarMenuSkeleton`,
    `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton`, `useSidebar`.)
  - **Commit 1b (edits — we own the file):**
    - Imports: `cn` from `@/lib/cn`; `Slot` from `radix-ui` used as `<Slot.Root>`; tooltip from
      `@/components/ui/tooltip` importing `TooltipProvider, TooltipRoot, TooltipTrigger,
      TooltipContent` (rewrite the `<Tooltip>` root usage in `SidebarMenuButton` to `<TooltipRoot>`).
    - Remove the `React.useEffect` keyboard listener for `SIDEBAR_KEYBOARD_SHORTCUT` (cmd/ctrl+B)
      in `SidebarProvider`; keep the constant deletion clean (remove the unused constant).
    - Remove the `document.cookie` write for `SIDEBAR_COOKIE_NAME`/`SIDEBAR_COOKIE_MAX_AGE` in
      `setOpen`; delete those constants.
    - Remove the mobile branch: delete the `useIsMobile`/`@/hooks/use-mobile` import, the
      `openMobile`/`setOpenMobile`/`isMobile` context state, the `Sheet`/`SheetContent` import and
      the `if (isMobile) { ... <Sheet> ... }` block in `Sidebar`, and the mobile arm of
      `toggleSidebar`. Drop `isMobile` from the context value and from `SidebarContextProps`; fix the
      one consumer (`SidebarMenuButton` tooltip `hidden`) to `hidden={state !== "collapsed"}`.
    - Remove `SidebarMenuSkeleton` and its `@/components/ui/skeleton` import (avoids creating
      `skeleton.tsx`).
    - Leave intact for plan-03: `SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarHeader`,
      `SidebarGroup`/`SidebarGroupLabel`/`SidebarGroupContent`, `SidebarMenu`/`SidebarMenuItem`/
      `SidebarMenuButton`/`SidebarMenuAction`/`SidebarMenuBadge`, `SidebarMenuSub`/`SidebarMenuSubItem`/
      `SidebarMenuSubButton`, `useSidebar`.
  - Acceptance: `pnpm lint && pnpm build` clean; `grep` confirms no `Sheet`/`Skeleton`/`use-mobile`/
    `SIDEBAR_COOKIE`/`SIDEBAR_KEYBOARD_SHORTCUT` remain in the file.

- [x] **Task 2: `--sidebar-*` tokens in `globals.css`.** No unit test (CSS); gate is `pnpm build`
  clean + the classes resolve. Add **HSL** raw vars to both `:root` and `.dark`, and matching
  `--color-sidebar*` entries to the existing `@theme inline` block so Tailwind v4 emits
  `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, `text-sidebar-accent-foreground`,
  `border-sidebar-border`, `ring-sidebar-ring`, `bg-sidebar-primary`, `text-sidebar-primary-foreground`.
  - `@theme inline` additions (one per token): `--color-sidebar: hsl(var(--sidebar));`
    `--color-sidebar-foreground`, `--color-sidebar-primary`, `--color-sidebar-primary-foreground`,
    `--color-sidebar-accent`, `--color-sidebar-accent-foreground`, `--color-sidebar-border`,
    `--color-sidebar-ring` (each `hsl(var(--sidebar-…))`).
  - `:root` (light): `--sidebar: 0 0% 98%;` `--sidebar-foreground: 0 0% 3.9%;`
    `--sidebar-primary: 0 0% 9%;` `--sidebar-primary-foreground: 0 0% 98%;`
    `--sidebar-accent: 0 0% 96.1%;` `--sidebar-accent-foreground: 0 0% 9%;`
    `--sidebar-border: 0 0% 89.8%;` `--sidebar-ring: 0 0% 3.9%;`
  - `.dark`: `--sidebar: 0 0% 6%;` `--sidebar-foreground: 0 0% 98%;` `--sidebar-primary: 0 0% 98%;`
    `--sidebar-primary-foreground: 0 0% 9%;` `--sidebar-accent: 0 0% 14.9%;`
    `--sidebar-accent-foreground: 0 0% 98%;` `--sidebar-border: 0 0% 14.9%;`
    `--sidebar-ring: 0 0% 83.1%;`
  - (`--sidebar` is a hair off `--background` for subtle separation; the rest mirror the base palette.)

- [x] **Task 3: Make `SidebarShell` presentational; render inside `Sidebar`.** TDD.
  - **RED — `SidebarShell.test.tsx`:** import `SidebarProvider` from `@/components/ui/sidebar`; add a
    `renderShell(props)` helper that wraps `<SidebarShell {...props}/>` in `<SidebarProvider>`. Keep
    the existing assertions (renders collections, `+`/onAddRequest, New-collection→createCollection,
    filter). **Delete** the `"Ctrl/Cmd+B hides the sidebar"` test (visibility now lives in
    WorkflowApp — re-added there in Task 5). Run → fails to compile/render (no provider, old markup).
  - **GREEN — `SidebarShell.tsx`:** render the header controls inside `<SidebarHeader>` and the
    `Collections` label + `SortControl` + `<CollectionTree …>` inside `<SidebarContent>`, all inside
    `<Sidebar collapsible="none" style={{ "--sidebar-width": "100%" } as React.CSSProperties}>` so the
    parent panel owns width. **Remove:** the `usePrefs`/`readPrefs` import and all `prefs`/
    `sidebarWidth`/`MIN_WIDTH`/`MAX_WIDTH` usage; the `if (!prefs.sidebar) return null` guard; the
    `useEffect` Ctrl/Cmd+B handler; the `dragRef`/`onResizePointerDown` resizer and the
    `role="separator"` resize handle; the outer `style={{ width }}` div. Keep `SidebarShellProps` and
    all `CollectionTree` props **unchanged** (no tree rewrite). Keep the `cat.error` banner (place it
    in the footer/after the content). The `+`/new-collection buttons keep their `aria-label`s
    (`new-request`, `new-collection`) and the filter keeps `aria-label="collection-filter"`.
  - Acceptance: `pnpm test src/features/catalog/SidebarShell` green; `pnpm lint`/`pnpm build` clean.

- [x] **Task 4: Migrate prefs `sidebarWidth`→`sidebarPanel`.** TDD.
  - **RED — `use-prefs.test.ts`:** replace the `prefs sidebarWidth` describe block with
    `prefs sidebarPanel`: assert `PREFS_DEFAULTS.sidebarPanel === 18`, that a persisted
    `{ sidebarPanel: 30 }` merges over defaults (`sidebar` stays `true`), and
    `typeof readPrefs().sidebarPanel === "number"`. No remaining reference to `sidebarWidth`.
  - **GREEN — `use-prefs.ts`:** in the `Prefs` interface replace `sidebarWidth: number` with
    `/** Sidebar panel size as a percent of the window (resizable, persisted). [12,40]. */
    sidebarPanel: number;`; in `PREFS_DEFAULTS` replace `sidebarWidth: 256` with `sidebarPanel: 18`.
  - Acceptance: `pnpm test src/lib/use-prefs` green; `grep -r sidebarWidth src/` returns nothing;
    `pnpm lint`/`pnpm build` clean (SidebarShell no longer references it after Task 3).

- [x] **Task 5: `ResizablePanelGroup` layout + Ctrl/Cmd+B in `WorkflowApp`.** TDD.
  - **RED — test infra first:** add to `src/test/setup.ts` a `ResizeObserver` polyfill
    (`class ResizeObserver { observe(){} unobserve(){} disconnect(){} }` →
    `globalThis.ResizeObserver ??= ResizeObserver as never`) and a `window.matchMedia` stub if
    missing. Then in `WorkflowApp.test.tsx` add a test:
    `"Ctrl/Cmd+B toggles sidebar visibility"` — render, read initial `readPrefs().sidebar` (true),
    `await user.keyboard("{Control>}b{/Control}")`, expect `readPrefs().sidebar === false`, toggle
    again → `true`. (Import `readPrefs` from `@/lib/use-prefs`; reset via `localStorage.clear()` +
    `broadcast`-safe setup in `beforeEach` — set `sidebar:true` explicitly to avoid cross-test
    leakage.) Run → fails (no handler yet; possibly ResizeObserver throw fixed by the polyfill).
  - **GREEN — `WorkflowApp.tsx`:**
    - `import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";`
      `import { SidebarProvider } from "@/components/ui/sidebar";`
      `import { usePrefs, readPrefs } from "@/lib/use-prefs";`
      `import type { PanelImperativeHandle } from "react-resizable-panels";`
    - `const [prefs, setPref] = usePrefs();` and
      `const sidebarPanelRef = useRef<PanelImperativeHandle>(null);`
    - In the **existing** global keydown `useEffect`, add a branch:
      `else if (mod && (e.key === "b" || e.key === "B")) { e.preventDefault();
      setPref("sidebar", !readPrefs().sidebar); }` (keep deps `[]`; `setPref` captured once is safe —
      `broadcast` reads module state, not the closure).
    - Add an effect to sync the panel to `prefs.sidebar`:
      `useEffect(() => { const p = sidebarPanelRef.current; if (!p) return;
      if (prefs.sidebar) { if (p.isCollapsed()) p.expand(); }
      else if (!p.isCollapsed()) p.collapse(); }, [prefs.sidebar]);`
    - Replace the `<div className="flex min-h-0 flex-1"> … </div>` row with:
      ```tsx
      <SidebarProvider className="min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          onLayoutChanged={(layout) => {
            const pct = layout["sidebar"];
            if (prefs.sidebar && typeof pct === "number" && pct > 0) setPref("sidebarPanel", pct);
          }}
        >
          <ResizablePanel
            id="sidebar"
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize="0"
            minSize="12"
            maxSize="40"
            defaultSize={String(prefs.sidebarPanel)}
          >
            <SidebarShell onOpenCollection={…} onOpenRequest={openRequest} onAddRequest={addRequest} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="main" minSize="40">
            <div className="min-h-0 flex-1 h-full">{/* existing overview / renderView block */}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarProvider>
      ```
      (`SidebarProvider`'s `className` merges onto its wrapper — `min-h-0 flex-1` overrides its
      default `min-h-svh`; `flex w-full` stay. Verify in preview that the row fills height correctly;
      if `min-h-svh` still wins, wrap the group in a `h-full` div instead.)
  - Acceptance: **all** existing `WorkflowApp.test` tests stay green (SidebarShell is mocked there, so
    the panel renders the stub — ResizeObserver polyfill makes the Group mount); the new toggle test
    passes; `pnpm lint`/`pnpm build` clean.

- [x] **Task 6: Verify (manual + full suites).** `pnpm lint` clean; `pnpm test` green (all suites);
  `pnpm build` green. Then **preview** (`pnpm install` already done in this worktree; `dist/` exists
  after build): app launches; the sidebar renders the **OLD** `CollectionTree` inside the new shell;
  drag the handle to resize and the width **survives reload** (persisted `sidebarPanel`); Ctrl/Cmd+B
  hides/shows the sidebar with no double-toggle (the vendored cmd/ctrl+B listener is gone). Capture a
  screenshot of the resized + collapsed states as proof.

**Done-when:** new shadcn shell + `ResizablePanelGroup` layout in place, the current tree still
functional inside it, all suites green, drag-resize persists, Ctrl/Cmd+B toggles cleanly.
🧹 /clear-чекпойнт перед plan-03.
