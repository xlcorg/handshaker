# Plan 03 — Tree migration onto shadcn primitives (+ DnD re-validation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> **Outline — detail each task to full TDD before executing** (project cadence). Steps use
> checkbox (`- [ ]`) syntax.

**Status:** ✅ DONE (2026-06-06; subagent-driven). All tasks green; tree fully on shadcn
primitives. Commits: `00541cc` (t1) · `308d76c` (t2) · `5c176f2` (t3) · `3957659` (t4) ·
`22cf787` (t5) · `0fb00d5` (review fixups). Gates: `pnpm lint` clean · `pnpm test` 84 files /
477 green · `pnpm build` ✓. **Only follow-up:** manual *visual* eyeball of the running Tauri app
(8px indent / guide-line hover-emphasis) — behavior is fully test-covered; needs the Rust backend
to see real rows, so left for the user. 🧹 /clear-чекпойнт перед plan-04.
**Branch:** `claude/quirky-cannon-0d95d6`.
**Spec:** §1, §2 (collisions #3/#4/#5/#6), §3, §6.
**Predecessor:** plan-02 (shadcn foundation in place; old tree still mounted).

## Decisions (deviations from the outline — resolved against the spec + current code)

1. **Folder name-click → expand-only (idempotent, never collapses); chevron → toggle.
   No folder overview.** The outline's Task 3 said "name opens overview", but there is
   **no folder overview** anywhere (`onOpenFolder` / `CollectionOverview`-for-folders
   does not exist) and spec §6.1 + the §-table (L321) say *folder name and chevron →
   раскрыть (expand)*. We honour Task 3's explicit test intent ("repeat name-click does
   not collapse") via expand-only, and drop the impossible overview call.
2. **Collection name-click → `onOpenCollection` (overview) + ensure-expanded
   (idempotent, never collapses); chevron → toggle.** Matches outline Task 4, spec §6.1,
   and the existing `CollectionNode` test (name ≠ toggle).
3. **New callback `onExpand(id)`** added to `TreeCallbacks`, wired in `CollectionTree`
   to `setOpenId(id, true)` — drives the idempotent expand-on-name-click for (1) and (2).
4. **Keep `RowMenu`** as the ⋯-menu + right-click context-menu provider. It already
   renders a hover-revealed `aria-label="More options"` trigger + right-click +
   floating menu (separators / danger / kbd / viewport-clamp). Converting the trigger
   to a bare `SidebarMenuAction` would **lose right-click + the floating menu** or force
   duplicating that logic across three nodes — a regression. RowMenu fulfils the
   SidebarMenuAction role; pin stays `PinButton`. (Documented deviation from the outline's
   "SidebarMenuAction for ⋯/pin".)
5. **Indent = structural `SidebarMenuSub` nesting** (its `border-l` is the guide line),
   overridden to an ~8px inset, **replacing** the `ROW_INDENT + depth*DEPTH_STEP` inline
   padding (both constants removed). `depth` prop is dropped from the row components.
6. **Active highlight via `isActive`** on the row's `SidebarMenuButton` /
   `SidebarMenuSubButton` → `data-[active=true]:bg-sidebar-accent`. With `asChild`, Slot
   merges `data-active` onto our `<div data-node-id>`, so `rowOf(id)` carries it.

## Testing harness note (applies to every task below)

`Sidebar` and `SidebarMenuButton` call `useSidebar()` **unconditionally** → any test that
mounts `CollectionNode` or `CollectionTree` (which use `SidebarMenuButton`) **must wrap the
render in `<SidebarProvider>`**, or it throws "useSidebar must be used within a
SidebarProvider." `SidebarMenuSubButton` / `SidebarMenuSub` / `SidebarMenuAction` do **not**
need the context, so standalone `RequestRow` / `FolderNode` tests can render bare — but for
uniformity add a local `renderWithSidebar()` helper everywhere.

## Row structure (target DOM)

- **RequestRow** (leaf): `SidebarMenuSubItem > RowMenu > SidebarMenuSubButton asChild
  isActive={active} > <div data-node-id draggable onClick=openRequest onDoubleClick=rename>
  (StreamBadge + name)`. Editing → `RenameInput` (not wrapped in the sub-button).
- **FolderNode**: `SidebarMenuSubItem > RowMenu > <div data-node-id draggable> [ chevron
  <button aria-label="toggle-folder" onClick=onToggle>, SidebarMenuSubButton asChild >
  <button aria-label="expand-folder" onClick=()=>onExpand(id) onDoubleClick=rename>(Folder
  icon + name) ] ` then `{open && <SidebarMenuSub>…children…</SidebarMenuSub>}`.
- **CollectionNode** (top level): `SidebarMenuItem > RowMenu > <div data-node-id> [ chevron
  <button aria-label="toggle-collection" onClick=onToggle>, SidebarMenuButton asChild >
  <button aria-label="open-collection" onClick=()=>{onOpenCollection(id);onExpand(id);}
  onDoubleClick=rename>(name), PinButton ]` then `{open && <SidebarMenuSub>…</SidebarMenuSub>}`.
- **CollectionTree**: `<div role="tree">` → `<SidebarMenu>{collections.map(CollectionNode)}</SidebarMenu>`
  + `ConfirmDeleteDialog`. Two click targets on container rows (chevron vs name) → the row
  is a `<div>`, **not** a single wrapping button; only requests wrap the whole row in one button.
**Goal:** Rewrite the tree presentation onto canonical shadcn menu primitives — `SidebarMenu`,
`SidebarMenuItem`, `SidebarMenuButton` (`asChild`, `isActive`), recursive `SidebarMenuSub`/
`SidebarMenuSubItem`/`SidebarMenuSubButton`, and `SidebarMenuAction` for the ⋯-menu/pin — while
preserving the domain model (`useCatalogTree`) and the DnD planning logic (`dnd.ts`).

**Architecture:** Keep `CollectionTree` as the stateful root (open-set, focus, drag/drop state)
but render rows via shadcn primitives. DnD handlers attach to the `asChild` row element (our
`<div draggable>`), so `zoneFromPointer`/`planDrop` geometry stays per-row. Indentation becomes
8px via the `SidebarMenuSub` indent override; guide lines are the `SidebarMenuSub` left border.
Active highlight uses `isActive`. Click behavior: chevron toggles; name/body opens overview +
expands (collection/folder) or opens the request (leaf).

## File structure (boundaries)

- Modify `src/features/catalog/RequestRow.tsx` — render as `SidebarMenuButton asChild isActive`
  + `SidebarMenuAction` (⋯); keep drag handlers; replace `StreamBadge` mount point (icon comes in
  plan-04). Update `ROW_INDENT`/`DEPTH_STEP` → 8px step (or move indent to `SidebarMenuSub`).
- Modify `src/features/catalog/FolderNode.tsx` — `SidebarMenuItem` + `SidebarMenuButton` (toggle
  on chevron, open-overview+expand on name) + nested `SidebarMenuSub`; ⋯/pin via `SidebarMenuAction`.
- Modify `src/features/catalog/CollectionNode.tsx` — top-level `SidebarMenuItem` + `SidebarGroup`
  framing; collection-row click = open overview + expand (idempotent); chevron = toggle.
- Modify `src/features/catalog/CollectionTree.tsx` — render through the shadcn primitives; keep
  `open`/`focusedId`/drag state; thread `isActive` from `activeItemId`.
- Modify `src/features/catalog/dnd.ts` — unchanged logic; re-validate against new DOM.
- Migrate tests: `CollectionTree.test.tsx`, `CollectionNode`/`FolderNode`/`RequestRow` tests,
  `dnd.test.ts` (logic unchanged), `SidebarShell.test.tsx` queries.

## Tasks (TDD: write/adjust the failing test first, then implement, then green)

- [x] **Task 1: Foundations — `onExpand` callback + indent decision.**
  - **RED:** in `useCatalogTree`/`CollectionTree` test surface, add a test that mounting
    `CollectionTree` exposes an expand-only path: focus a collapsed folder, click its name (after
    Task 3 wires it) — *deferred*; for Task 1 the concrete RED is a type/wiring test: extend the
    `makeCb` fixtures (RequestRow/FolderNode/CollectionNode tests) with `onExpand: vi.fn()` and a
    `CollectionTree` test that, given an `onExpand` is invoked by a child (simulated), updates the
    open-set. Simplest enforceable RED: add `onExpand` to `TreeCallbacks` and assert the type
    compiles + `CollectionTree` passes a function (smoke).
  - **GREEN:** add `onExpand: (id: string) => void` to `TreeCallbacks` (`treeTypes.ts`); in
    `CollectionTree`, wire `onExpand: (id) => setOpenId(id, true)` into the `cb` bag; add `onExpand`
    to every test `makeCb`/`setup` fixture.
  - **Indent decision (no behavior code yet):** confirm the single indent source = `SidebarMenuSub`
    (used by Tasks 3/4). Document the chosen 8px inset class on the `SidebarMenuSub` wrapper
    (e.g. `className="mx-0 px-2 …"` keeping `border-l`); remove `ROW_INDENT`/`DEPTH_STEP` exports in
    Task 2. No standalone test here beyond the structural assertions in Tasks 2–4.

- [x] **Task 2: Rewrite `RequestRow`.**
  - **RED:** update `RequestRow.test.tsx` — (a) clicking the row body (the name text) opens the
    request (existing test still valid since `getByText` lands inside the click div); (b) NEW:
    `rowOf("r1")` (the `[data-node-id]` div) carries `data-slot="sidebar-menu-sub-button"` and,
    when `activeItemId==="r1"`, `data-active="true"`; (c) the ⋯ "More options" button still opens
    the menu and Delete fires `onRequestDeleteItem`; (d) double-click still enters rename. Wrap
    renders in `renderWithSidebar` (harmless here). Remove any reliance on a separate
    `aria-label="open-request"` button (row body is the single click target now).
  - **GREEN:** render per the Row-structure spec above: `SidebarMenuSubItem > RowMenu >
    SidebarMenuSubButton asChild isActive={active} > <div data-node-id data-drop draggable …
    onClick=()=>onOpenRequest onDoubleClick=()=>onEditingChange(id)>` with `StreamBadge` + name
    `<span className="truncate">`. Keep all four DnD handlers + `zoneFromPointer(...,"request")` +
    `data-drop` hint classes. Drop `ROW_INDENT`/`DEPTH_STEP` and the `depth`-based `paddingLeft`
    (indent is structural now) and the `depth` prop. Editing branch renders `RenameInput` directly.

- [x] **Task 3: Rewrite `FolderNode`.**
  - **RED:** rewrite `FolderNode.test.tsx` — (a) chevron (`aria-label="toggle-folder"`) click →
    `onToggle("f1")`; (b) **name click → `onExpand("f1")` and NOT `onToggle`** (replaces the old
    "toggles on name click" test — see Decision 1); (c) repeat name-click never collapses (assert
    only `onExpand` fired, `onToggle` not); (d) collapsed hides children / open shows them now via a
    `[data-sidebar="menu-sub"]` wrapper — assert the child `r1` row is a descendant of
    `[data-sidebar="menu-sub"]`; (e) the menu still offers Add request / Add folder / Rename /
    Delete. `renderWithSidebar`.
  - **GREEN:** render per Row-structure spec: row `<div data-node-id>` with chevron button
    (`onToggle`) + `SidebarMenuSubButton asChild` name button (`onClick=()=>onExpand(folder.id)`,
    `onDoubleClick=rename`, Folder icon + truncate name); children inside `<SidebarMenuSub>` (the
    8px-inset class). Preserve drag/drop handlers, `data-drop` hints (before/after/inside). Recurse
    `FolderNode`/`RequestRow` inside the sub. Drop `depth`-padding.

- [x] **Task 4: Rewrite `CollectionNode`.**
  - **RED:** update `CollectionNode.test.tsx` — (a) name click → `onOpenCollection("c1")` **and**
    `onExpand("c1")`, NOT `onToggle` (extend existing test); (b) repeat name-click never collapses;
    (c) chevron (`aria-label="toggle-collection"`) → `onToggle("c1")`; (d) children render inside a
    `[data-sidebar="menu-sub"]` when open; (e) pin button (`pin-collection`) → `onSetPinned("c1",
    true)`; (f) menu Delete → `onRequestDeleteCollection`; (g) empty hint when open + no items.
    `renderWithSidebar` (required — uses `SidebarMenuButton`).
  - **GREEN:** render per Row-structure spec: `SidebarMenuItem > RowMenu > <div data-node-id> [
    chevron button(onToggle), SidebarMenuButton asChild > name button(onOpenCollection+onExpand,
    dblclick rename), PinButton ]` + `{open && <SidebarMenuSub>children + Empty hint</SidebarMenuSub>}`.
    Preserve the collection drop target (`kind:"collection"`, zone `"inside"`) `onDragOver`/`onDrop`.

- [x] **Task 5: Render `CollectionTree` through primitives + active highlight (#7).**
  - **RED:** `CollectionTree.test.tsx` — (a) NEW: with `activeItemId` set to a visible request id,
    that row's `[data-node-id]` carries `data-active="true"` (others do not); (b) existing arrow-nav
    / filter / confirm-delete tests still pass (wrap `setup` render in `SidebarProvider`).
  - **GREEN:** wrap the collection list in `<SidebarMenu>`; keep `role="tree"`, `tabIndex`,
    `aria-label="collections-tree"`, `onKeyDown`, open/focus/drag state, and the `cb` bag (now incl.
    `onExpand`). `activeItemId` already flows through `cb` → `isActive` on the row buttons.

- [x] **Task 6: DnD re-validation.**
  - Run `pnpm test src/features/catalog/dnd.test.ts` — pure logic unchanged → green (no edits).
  - Update `CollectionTree.test.tsx` DnD cases for the new DOM: keep the `rowOf =
    querySelector('[data-node-id]')` helper + the jsdom `clientY`-via-`createEvent` workaround +
    the `getBoundingClientRect` spy. Assert `data-drop="before|after|inside"` lands on the new row
    `<div>` and drop fires `onMoveItem`/`onMoveItemAcross` with the **same plans** as today
    (r3→after r4 = pos 2; r3→into f1 = pos 0; r3→c2 header = across pos 0; dragover r4 = "before").
    Wrap renders in `SidebarProvider`.

- [x] **Task 7: Migrate remaining sidebar tests.** Sweep `src/features/catalog/*.test.tsx` (incl.
  `SidebarShell.test.tsx`, already mostly text/label-based) for queries tied to the old structure
  (roles, `aria-label`s, class/`paddingLeft` assertions). Add `SidebarProvider` wherever a render
  reaches `SidebarMenuButton`. Target: `pnpm test src/features/catalog` fully green. Log any test
  intentionally dropped (only the old "toggles on name click" folder test, replaced by Task 3).

- [x] **Task 8: Verify** — `pnpm lint` clean; full `pnpm test` green; `pnpm build` green (build also
  feeds `src-tauri`). Manual: tree renders with shadcn rows, ~8px indent + guide lines
  (hover-emphasis on the branch line), active row highlighted via `--sidebar-accent`, chevron
  toggles vs name expands/overview per §6, DnD reorder + cross-collection still works.

**Done-when:** tree fully on shadcn primitives, all suites green, DnD intact. 🧹 /clear-чекпойнт
перед plan-04.
