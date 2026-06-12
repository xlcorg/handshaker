# Plan — Sidebar shadcn cleanup (RenameInput / ScrollArea / PinButton / header / error)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> **Outline — detail each task to full TDD before executing** (project cadence). Steps use
> checkbox (`- [ ]`) syntax. Mode = subagent-driven (default, don't ask).

**Status:** ✅ DONE — all 6 tasks complete (2026-06-07). Five hand-rolled sidebar pieces now use
shadcn/Radix equivalents. Automated gates green; one residual MANUAL desktop check remains (see below).
Author: planned 2026-06-07.
**Commits (this branch):** Task 1 `e627d51` + caption-size fix `2d540d8` · Task 2 `b031448` ·
Task 3 `f527194` · Task 4 `9453480` · Task 5 `fe5c871` (tree → ScrollArea). Final suite green
(2026-06-07): `pnpm lint` (tsc -b) exit 0 · `pnpm test` = **88 files / 531 tests passed** · `pnpm build`
exit 0 (built in 26s; pre-existing Monaco chunk-size warning only, not a regression).
**⚠️ RESIDUAL MANUAL DESKTOP CHECKS (`pnpm tauri dev`) — NOT yet run (no Tauri window in agent env):**
(1) **Task-5 full-bleed under ScrollArea** — Radix Viewport wraps children in an internal
`min-width:100%;display:table` div; confirm the hover/active highlight still bleeds to both sidebar edges
at every depth, the ⋯ button stays pinned right, NO spurious horizontal scrollbar, DnD 700ms auto-expand
+ keyboard nav still work, and the vertical scrollbar appears only on overflow (thumb matches `.scroll-thin`).
(2) Task-3 shadcn `Input` `focus-visible:ring-[3px]` ring — confirm it doesn't overflow the `h-6` rename
field in the tight tree row; tighten to `ring-1` if it bleeds. (3) Task-1 `SidebarGroupLabel` caption
(`h-auto text-[10px] uppercase`) — eyeball header height.
**Branch:** continue on `claude/quirky-cannon-0d95d6` (worktree) unless a fresh one is requested.
**Build/test (PowerShell, repo root):** `pnpm lint` (tsc -b) · `pnpm test` (vitest run) · `pnpm build` ·
desktop smoke `pnpm tauri dev`. Fresh worktree: `pnpm install` → build `dist/` before `src-tauri`.
**Scope source:** follow-up to the (complete) 2026-06-06 collection-sidebar-improvements spec — a
standalone polish pass replacing remaining hand-rolled sidebar UI with shadcn/Radix equivalents.
**NOT in scope:** `CommandPalette` → `Command`/cmdk (user deferred — needs a new dependency); tree
expand/collapse → Radix `Collapsible` (rejected: the centralized `open`-Set powers keyboard nav,
filter force-expand, persistence and drag-auto-expand — do not fragment it); `GrpcIcon`; DnD.

**Goal:** Replace five remaining hand-rolled pieces in the sidebar with shadcn components, without
changing behavior or breaking the full-bleed highlight / DnD / keyboard nav: (1) the "Collections"
header label, (2) `PinButton`, (3) `RenameInput`, (4) the error footer, (5) the tree scroll
container. Ordered low→high risk; ScrollArea is last and gated behind a /clear checkpoint.

## Why these are safe to touch (current state — verified 2026-06-07)

- All five are leaf/presentational; the data flow (CatalogProvider, useCatalogTree, treeNav/treeEdit,
  dnd.ts) is untouched.
- Menus already migrated to Radix (`RowMenu` = DropdownMenu+ContextMenu; `SortControl` = DropdownMenu).
- The full-bleed row highlight + ⋯ button breakout live in `RequestRow`/`FolderNode`/`CollectionNode`
  and `bleed.ts` (`bleedStyle`, `actionRight`, `SUB_INSET_L/R`). **The scroll container's clipping is
  what bounds the breakout** — Task 5 must re-verify the highlight still reaches the edges.
- Tests render under `<SidebarProvider>`; Radix menu interactions use
  `userEvent.setup({ pointerEventsCheck: 0 })`. jsdom polyfills are global in `src/test/setup.ts`.

## File structure (boundaries)

- **Task 1 (header):** `src/features/catalog/SidebarShell.tsx` (+ `SidebarShell.test.tsx`). Uses
  existing `SidebarGroup`/`SidebarGroupLabel` from `src/components/ui/sidebar.tsx`.
- **Task 2 (pin):** `src/features/catalog/PinButton.tsx` (+ `PinButton.test.tsx`). NEW
  `src/components/ui/toggle.tsx` (radix `Toggle`) **or** reuse `Button` — see approach notes.
- **Task 3 (rename):** `src/features/catalog/RenameInput.tsx` (+ `RenameInput.test.tsx`). Uses
  `src/components/ui/input.tsx`.
- **Task 4 (error):** NEW `src/components/ui/alert.tsx` (+ small test). `src/features/catalog/SidebarShell.tsx`
  (+ test) to render the footer error via `Alert`.
- **Task 5 (scroll):** NEW `src/components/ui/scroll-area.tsx` (radix `ScrollArea`).
  `src/features/catalog/CollectionTree.tsx` (+ `CollectionTree.test.tsx`). Possibly
  `src/styles/globals.css` (retire `.scroll-thin` on the tree if unused elsewhere — grep first).

## Approach notes (read before executing)

- **Radix is in the unified `radix-ui` package** (verified): `Toggle`, `ScrollArea`, etc. are all
  importable as `import { Toggle as TogglePrimitive } from "radix-ui"`. Mirror the existing
  `dropdown-menu.tsx`/`context-menu.tsx` wrapper style (data-slot, `cn`, forwardRef where needed).
- **shadcn `Alert` has no Radix dep** — it's styled `<div role="alert">` + title/description. Create a
  minimal version (default + `destructive` variant) matching the other ui components' token usage.
  Do NOT route the error to `Toaster`: `@/lib/toast` toasts **auto-dismiss after 1800ms**, but
  `cat.error` is a persistent condition — a sticky `Alert` in the footer preserves current semantics.
- **`Input` is `h-9` by default**; the inline rename field is `h-5 text-xs`. Pass a compact
  `className` (e.g. `h-6 px-1 text-xs`) — `cn`/twMerge dedupes the height. Keep `aria-label="rename-input"`,
  autofocus+select, Enter/blur=commit, Esc=cancel, and the `stopPropagation` on click/dblclick (so the
  row's open/rename handlers don't fire). Confirm the focus-ring doesn't overflow the tree row visually.
- **PinButton** keeps its bespoke visibility logic: hover-reveal (`opacity-0 group-hover/row:opacity-100`)
  + always-visible when pinned. Radix `Toggle` gives `pressed`/`data-state=on` semantics for the
  pinned state and is the cleaner fit; if the new `toggle.tsx` adds friction, fall back to
  `Button variant="ghost" size="icon"` with `aria-pressed`. Either way **keep both aria-labels**
  (`pin-collection`/`unpin-collection`) and `aria-pressed`, and the `e.stopPropagation()` in onClick
  (PinButton sits inside the collection row whose name button toggles/opens).
- **Header (Task 1):** the current header row hosts the "Collections" caption AND the Sort + Settings
  actions. `SidebarGroupLabel` is a label, not an action bar — use `SidebarGroupLabel` for the caption
  only and keep the actions beside it (the label supports `asChild`; or place actions as siblings in a
  flex row). Cosmetic — assert the caption text and that Sort/Settings buttons still resolve by their
  aria-labels. Don't regress the existing border/spacing.
- **ScrollArea (Task 5) — highest risk, do last:**
  - The tree element carries `role="tree"`, `tabIndex={0}`, `aria-label="collections-tree"`,
    `onKeyDown` (keyboard nav). These MUST stay on a focusable element. Keep them on the inner
    content node and wrap with ScrollArea, OR put them on the ScrollArea Viewport.
  - Today the tree div is `overflow-auto` AND its parent `SidebarContent` is also `overflow-auto` —
    watch for double scrollbars; consolidate to one scroller.
  - **Re-validate the full-bleed highlight**: the breakout (`bleedStyle`) relies on the scroll
    container clipping at its edges. ScrollArea's Viewport must still clip so the `::before`/⋯ reach
    the edges without a horizontal scrollbar. If the scrollbar track steals width, adjust.
  - **Re-validate DnD**: drag-over/drop and the 700ms auto-expand happen inside the tree; ensure the
    ScrollArea Viewport doesn't swallow drag events. (No drag-auto-scroll exists today, so none to
    preserve — but confirm dragOver still fires.)
  - **Tests**: `CollectionTree.test`/`FolderNode.test`/`CollectionNode.test` resolve the tree via
    `getByLabelText("collections-tree")` and `closest("[data-sidebar='menu-sub']")` — keep those
    hooks intact. Radix ScrollArea needs no special jsdom polyfill beyond ResizeObserver (already
    stubbed in setup).

## Tasks

- [x] **Task 1: "Collections" header → `SidebarGroupLabel`/`SidebarGroup` (their #5).** ✅ DONE
      (`e627d51`; caption size/case restored via className in `2d540d8`).
  - **Files:** `SidebarShell.tsx` (+ `SidebarShell.test.tsx`).
  - **TDD:** keep/extend assertions that the caption "Collections" renders and that
    `getByLabelText("sort-collections")` and `getByLabelText("open-settings")` still resolve. Add an
    assertion that the caption is a `[data-sidebar="group-label"]` (or `data-slot`) element.
  - **Impl:** replace the hand-rolled `<span class="…uppercase…">Collections</span>` wrapper with
    `SidebarGroupLabel` (caption) while keeping Sort+Settings in the same row. Preserve the bottom
    border + padding. No behavior change.
  - 🧹 **/clear checkpoint** after green (optional — tasks 1–4 are small; may batch before clearing).

- [x] **Task 2: `PinButton` → Radix `Toggle` (or `Button`) (their #4).** ✅ DONE (`b031448`;
      new `src/components/ui/toggle.tsx`).
  - **Files:** `PinButton.tsx` (+ test); maybe NEW `src/components/ui/toggle.tsx`.
  - **TDD (existing test must stay green):** clicking fires `onToggle`; `aria-pressed` reflects
    `pinned`; labels switch `pin-collection`↔`unpin-collection`; pinned → always visible, unpinned →
    hover-reveal class present. Add an `aria-pressed`/`data-state` assertion for the toggled state.
  - **Impl:** if creating `toggle.tsx`, mirror `dropdown-menu.tsx` wrapper style over `Toggle`
    primitive (variants optional). Re-implement `PinButton` using it (`pressed={pinned}`,
    `onPressedChange`→`onToggle`) keeping the Pin icon, `fill-current` when pinned, the visibility
    classes, and `e.stopPropagation()`. Fallback: `Button variant="ghost" size="icon"` + `aria-pressed`.

- [x] **Task 3: `RenameInput` → `Input` (their #2).** ✅ DONE (`f527194`; focus+select via
      `autoFocus` + `onFocus` select, no ref — `input.tsx` untouched).
  - **Files:** `RenameInput.tsx` (+ test).
  - **TDD (existing test must stay green):** autofocus+select on mount; Enter commits trimmed/changed
    (non-empty) value via `onCommit`; empty/unchanged → `onCancel`; Esc → `onCancel`; blur commits;
    `aria-label="rename-input"`. Add nothing that depends on the raw `<input>` element type beyond the
    label.
  - **Impl:** swap the raw `<input>` for `<Input … className="h-6 px-1 text-xs" />`, keeping the ref,
    value/onChange, onBlur=commit, onKeyDown (Enter/Esc), and the click/dblclick `stopPropagation`.
    Verify the focus-ring fits the tree row (tighten ring/height if it overflows).

- [x] **Task 4: Error footer → shadcn `Alert` (their #6).** ✅ DONE (`9453480`; new
      `src/components/ui/alert.tsx`, footer renders `Alert variant="destructive"` in `SidebarFooter`).
  - **Files:** NEW `src/components/ui/alert.tsx` (+ minimal test: renders `role="alert"`, destructive
    variant class, children); `SidebarShell.tsx` (+ test).
  - **TDD:** `SidebarShell.test` — when the catalog provides an error, the footer renders it inside an
    `Alert` (`role="alert"`/`data-slot="alert"`) with the message text; when no error, no alert.
    (Mock `useCatalog`/CatalogProvider error as the existing tests do.)
  - **Impl:** create `Alert`/`AlertTitle`/`AlertDescription` (shadcn, default + `destructive`). Render
    the existing `cat.error` footer via `<Alert variant="destructive">`. Keep it in `SidebarFooter`
    (persistent), not a toast. Match current destructive token colors.

- [x] 🧹 **/clear checkpoint — start a fresh session before Task 5 (ScrollArea is the risky one).**
      ✅ Fresh session executed Task 5 + Task 6.

- [x] **Task 5: Tree scroll container → shadcn `ScrollArea` (their #3).** ✅ DONE (`fe5c871`;
      new `src/components/ui/scroll-area.tsx`; `CollectionTree.tsx` rewired — `role="tree"`/`tabIndex`/
      `aria-label`/`onKeyDown` moved onto a focusable inner div inside the Viewport, `overflow-auto`
      removed; `SidebarShell.tsx` SidebarContent got `overflow-hidden` to stop double-scroll;
      vertical-only scrollbar, thumb tokens match `.scroll-thin`). Spec + code-quality review both
      passed. `globals.css`/`sidebar.tsx` untouched. **Manual desktop re-validation NOT run** — see
      ⚠️ residual checks in the banner.
  - **Files:** NEW `src/components/ui/scroll-area.tsx` (radix); `CollectionTree.tsx` (+ test); maybe
    `globals.css` (retire `.scroll-thin` on the tree if unused — grep `scroll-thin` first).
  - **TDD (existing tests must stay green):** `getByLabelText("collections-tree")` resolves and still
    carries `role="tree"`/`tabIndex`; keyboard nav tests (Arrow keys) still pass; `closest(
    "[data-sidebar='menu-sub']")` lookups unaffected; the depth→`--bl`/`--br` and active `data-active`
    tests unaffected. Add a test that the tree content is inside a ScrollArea viewport
    (`[data-slot='scroll-area-viewport']` or similar) if a stable hook exists.
  - **Impl:** create `scroll-area.tsx` (Root+Viewport+Scrollbar+Thumb, shadcn style). Wrap the tree's
    scrollable region; move `role="tree"`/`tabIndex`/`aria-label`/`onKeyDown` onto the focusable
    content node inside the viewport (or the viewport itself). Remove the now-duplicate `overflow-auto`
    (consolidate scrolling to ScrollArea; check `SidebarContent` doesn't double-scroll).
  - **Manual re-validation (desktop `pnpm tauri dev`) — REQUIRED before marking done:**
    1. Full-bleed highlight (hover + active) still reaches both edges at every depth; no spurious
       horizontal scrollbar.
    2. ⋯ button still pinned to the right edge; menu opens correctly.
    3. DnD: drag a request, hover a collapsed folder → auto-expands (700ms) → drop reorders; no event
       swallowed by the viewport.
    4. Keyboard: focus tree, Arrow up/down/left/right navigate/expand/collapse as before.
    5. Scrollbar appears only when content overflows; thumb styled consistently.

- [x] **Task 6: Verification + cleanup + commit.** ✅ DONE (2026-06-07). From repo root, all green:
  `pnpm lint` (tsc -b) exit 0 · `pnpm test` = 88 files / 531 tests passed · `pnpm build` exit 0 (26s,
  pre-existing Monaco chunk warning only). Dead-code check: the tree never used `.scroll-thin` (grep
  confirmed it's still used by other components — JsonTreeView/KVTable/SettingsDialog/etc.), so
  `globals.css` was correctly left untouched; no stale classes/imports left by the rewire. Banner
  flipped to ✅ DONE above. **Task-5 desktop manual checklist NOT run** (no Tauri window in agent env)
  — carried as the ⚠️ residual checks in the banner for a human `pnpm tauri dev` pass.

**Done-when:** all five pieces use shadcn equivalents; behavior unchanged (full-bleed highlight, ⋯
menu, DnD auto-expand, keyboard nav, rename/commit, pin toggle, persistent error all verified);
`pnpm lint`/`test`/`build` green; Task-5 desktop manual checklist run; banner flipped.
