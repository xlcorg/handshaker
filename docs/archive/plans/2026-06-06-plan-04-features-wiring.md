# Plan 04 — Features + persistence wiring + verification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> **Outline — detail each task to full TDD before executing** (project cadence). Steps use
> checkbox (`- [ ]`) syntax.

**Status:** ✅ DONE (2026-06-06; subagent-driven, all tasks shipped + verified). Suites green:
`pnpm lint` (tsc -b) clean · `pnpm test` 519 passed · `pnpm build` OK · `cargo test -p handshaker-core`
OK · `cargo test -p handshaker` 39 passed. Manual-only checks (restart persistence, 8px/guide-line
visuals, real-browser DnD) are unit-covered for logic; flag for a human smoke-run. Minor test-hygiene
follow-ups (resetPrefs brittleness, `closest("div.flex")` selectors, SidebarShell async-effect `act()`
noise) spun off via spawn_task — out of scope here.
**Spec:** §3 (gRPC icon), §4 (sort icon), §5/§6 (clicks/active), §7 (wire persistence), §8 (auto-expand), §10 (verification).
**Predecessor:** plan-03 (tree on shadcn primitives); plan-01 (backend IPC available).
**Goal:** Land the remaining user-facing features and wire the backend persistence end-to-end:
configurable gRPC icon, icon-based sort control, restore expansion / sort / active request on
launch, persist them on change, and add Postman-style auto-expand on drag. Then run full e2e
verification of all 10 spec points.

## File structure (boundaries)

- Modify `src/lib/use-prefs.ts` (+ test) — `grpcIcon` pref.
- Create `src/features/catalog/GrpcIcon.tsx` (+ test) — 4 variants.
- Modify `src/features/settings/AppearancePane.tsx` — `gRPC icon` `ToggleGroup` row.
- Modify `src/features/catalog/RequestRow.tsx` — mount `GrpcIcon` (replace `StreamBadge`).
- Modify `src/features/catalog/SortControl.tsx` (+ test) — `ArrowUpDown` + `DropdownMenu`.
- Modify `src/features/catalog/useCatalogTree.ts` (+ test) — initialize open-set from `expanded`
  flags; `setExpanded(collectionId, itemId|null, expanded)` → `ipc.collectionSetExpanded`.
- Modify `src/features/catalog/CollectionTree.tsx` — call `setExpanded` on toggle/auto-expand
  instead of (or alongside) local `open` state; seed `open` from persisted flags.
- Modify `src/features/catalog/SidebarShell.tsx` — read/write `sortKey` via `ipc.appSettings*`.
- Modify `src/app/WorkflowApp.tsx` — on mount, restore sort + reopen active request via
  `appSettingsGet`; on open-request, `appSettingsSet({ active_request })`.
- Modify `src/features/catalog/dnd.ts` / `CollectionTree.tsx` — auto-expand timer on drag-hover.

## Approach notes (resolved during detailing — read before executing)

- **`app_settings_set` REPLACES the whole `UiStateIpc`** (verified: `src-tauri/src/commands/ui_state.rs`
  doc-comment "Replaces the entire persisted UI state — callers send the complete object, not a
  partial patch."). Sort (SidebarShell) and active-request (WorkflowApp) are written by **two**
  components; naive independent writes would clobber each other. **Resolution:** a tiny shared
  read-modify-write cache module `src/features/catalog/uiState.ts` holds the last-known `UiStateIpc`;
  both components load through it and patch through it (merge into cache → send full object). This is
  the single source of truth for persisted UI state on the frontend.
- **cmd+B is NOT changed.** The existing test `WorkflowApp.test.tsx` ("Ctrl/Cmd+B toggles sidebar
  visibility") asserts `mod+B` toggles, and the vendored `sidebar.tsx`'s own cmd+B was already cut in
  plan-02. Spec verification "#6 cmd+ctrl+B, no cmd+B conflict" is satisfied by the provider shortcut
  removal; the app-level `mod+B` (Ctrl on Win / Cmd on Mac) stays. Do not touch the keyboard handler.
- **Backend + IPC already shipped (plan-01):** `ipc.collectionSetExpanded`, `ipc.appSettingsGet`,
  `ipc.appSettingsSet`, `CollectionIpc.expanded`, `FolderIpc.expanded`, `UiStateIpc { sort_key,
  active_request }`, `ActiveRequestRefIpc { collection_id, item_id }`. No backend work in this plan.
- **Tree primitives already on shadcn (plan-03):** chevron=toggle, folder-name=expand,
  collection-name=overview+expand; `RequestRow` highlights via `isActive`→`data-active`; tests render
  under `<SidebarProvider>`. `cb.onToggle`/`cb.onExpand` are the expand entry points.
- **DropdownMenu pattern:** `src/components/ui/dropdown-menu.tsx` exists. For deterministic jsdom
  testing of a radix dropdown, prefer the same lightweight pattern the tree already uses, **or**
  verify open-on-click works with `fireEvent.click` (radix opens its content synchronously enough for
  `getByText`). Mirror whichever the implementer confirms green; keep `aria-label="sort-collections"`
  on the trigger so existing selectors keep working where possible.

## Tasks

- [x] **Task 1: `grpcIcon` pref (#3, spec §4).**
  - **Files:** `src/lib/use-prefs.ts`, `src/lib/use-prefs.test.ts`.
  - **TDD — test first (`use-prefs.test.ts`):** add a `describe("grpcIcon pref")` with:
    (a) `expect(PREFS_DEFAULTS.grpcIcon).toBe("solid")`;
    (b) merge-over-default: `localStorage.setItem("handshaker.prefs.v1", JSON.stringify({ grpcIcon: "circle" }))`
    then assert the merge shape `{ ...PREFS_DEFAULTS, grpcIcon: "circle" }` keeps other defaults
    (mirror the existing `sidebarPanel` merge test style — `readPrefs()` reflects the module snapshot,
    so assert the merge object + `typeof readPrefs().grpcIcon === "string"`).
  - **Impl:** export `type GrpcIconStyle = "solid" | "letter" | "outline" | "circle";`; add
    `grpcIcon: GrpcIconStyle` to `Prefs` (after `requestTimeoutMs`) and `grpcIcon: "solid"` to
    `PREFS_DEFAULTS`. Backward-safe via the existing `{ ...PREFS_DEFAULTS, ...parsed }` merge in `read()`.

- [x] **Task 2: `GrpcIcon` component (#3, spec §4).**
  - **Files:** `src/features/catalog/GrpcIcon.tsx` (NEW), `src/features/catalog/GrpcIcon.test.tsx` (NEW).
  - **TDD — test first:** for each of the 4 variants render `<GrpcIcon variant={v} />` and assert the
    root has `aria-label="grpc"` and `data-variant={v}` (`screen.getByLabelText("grpc")`); assert the
    four renders produce four distinct `data-variant` values.
  - **Impl:** `export interface GrpcIconProps { variant: GrpcIconStyle; className?: string }`. Render a
    16px (`size-4`) inline element with `aria-label="grpc"`, `data-variant={variant}`, blue accent, and
    a literal `g` glyph. Variant visuals (blue = a tailwind blue, e.g. `text-blue-500`/`bg-blue-500`):
    `solid` = filled rounded blue square, white `g`; `letter` = blue `g` only (no box); `outline` =
    blue border box, blue `g`; `circle` = filled blue circle, white `g`. Keep it a presentational
    component (no prefs read inside — caller supplies `variant`). Import `GrpcIconStyle` from `use-prefs`.

- [x] **Task 3: AppearancePane toggle + mount in RequestRow; drop `StreamBadge` (#3, spec §4/§6.2).**
  - **Files:** `src/features/settings/AppearancePane.tsx`, `src/features/catalog/RequestRow.tsx`,
    `src/features/catalog/RequestRow.test.tsx`, `src/features/settings/AppearancePane.test.tsx` (NEW).
  - **TDD — tests first:**
    - `RequestRow.test.tsx`: add "renders the gRPC icon (default solid)" — render a row, assert
      `screen.getByLabelText("grpc")` has `data-variant="solid"`. (Remove the old `StreamBadge`/`un`
      placeholder; there is no existing `stream-type` assertion to update.)
    - `AppearancePane.test.tsx` (NEW): render `<AppearancePane />`; find the "gRPC icon" row's
      ToggleGroup; click the `outline` option; assert `readPrefs().grpcIcon === "outline"`
      (clear `localStorage` in `beforeEach`). Then add a **live-reactivity** test: render
      `<AppearancePane />` and a `<RequestRow>` (under `<SidebarProvider>`) in one tree; click the
      `circle` toggle; assert the row's `getByLabelText("grpc")` now has `data-variant="circle"`
      (proves prefs are reactive and the row re-renders).
  - **Impl:** in `AppearancePane`, add a `SettingsRow title="gRPC icon"` under the Appearance group
    with `<ToggleGroup value={prefs.grpcIcon} onValueChange={(v) => setPref("grpcIcon", v as GrpcIconStyle)}
    options={["solid","letter","outline","circle"]} />`. In `RequestRow`, delete `StreamBadge` and
    render `<GrpcIcon variant={usePrefs()[0].grpcIcon} />` in both the editing and non-editing branches
    (where `StreamBadge` was). Keep layout/`gap-2`.

- [x] **Task 4: Sort icon (#8, spec §5).**
  - **Files:** `src/features/catalog/SortControl.tsx`, `src/features/catalog/SortControl.test.tsx`.
  - **TDD — rewrite test first:** open the control (click its trigger), pick "Recent", expect
    `onChange("recent")`. Assert the active option is marked (check icon / `aria-checked` / a
    `data-active`/`data-state=checked` on the current item). The trigger keeps
    `aria-label="sort-collections"`.
  - **Impl:** replace the native `<select>` with an `ArrowUpDown` (lucide) icon button as the
    `DropdownMenuTrigger` (`aria-label="sort-collections"`), and a `DropdownMenuContent` listing the
    four options (`alpha`=Name / `created`=Created / `recent`=Recent / `frequency`=Frequency). Use
    `DropdownMenuRadioGroup`+`DropdownMenuRadioItem` (value=`value`, onValueChange=`onChange`) so the
    active one shows its indicator. **Keep the `value`/`onChange` props unchanged** so `SidebarShell`
    is untouched. Confirm the radix dropdown opens deterministically in jsdom via `fireEvent.click`;
    if flaky, fall back to a `DropdownMenu` `modal={false}` or the lightweight menu pattern — but the
    public props must not change.

- [x] **Task 5: Wire expansion persistence (#5, spec §7.1).**
  - **Files:** `src/features/catalog/useCatalogTree.ts` (+ `.test.ts`), `src/features/catalog/treeEdit.ts`,
    `src/features/catalog/treeNav.ts` (+ `treeNav.test.ts` if present), `src/features/catalog/CollectionTree.tsx`
    (+ `.test.tsx`), `src/features/catalog/SidebarShell.tsx`.
  - **TDD — tests first:**
    - `treeEdit.test`/unit (or inline in `useCatalogTree.test`): `setNodeExpanded(tree, collectionId,
      itemId|null, expanded)` flips the collection flag when `itemId===null` and the folder flag (deep)
      otherwise; pure (no mutation).
    - `treeNav.test`: `expandedIds(collections)` returns ids of collections/folders whose
      `expanded===true` (recursive).
    - `useCatalogTree.test.ts`: add `collectionSetExpanded: vi.fn()` to the `ipc` mock; new test:
      `setExpanded("c1", "f1", true)` flips the flag locally **and** calls
      `ipc.collectionSetExpanded("c1","f1",true)`; and a rollback test (rejects → flag reverts + error).
    - `CollectionTree.test.tsx`:
      (a) "seeds open-state from persisted expanded flags": render with a collection `expanded:true`
      containing a folder `expanded:true` containing `req("r1")`; assert `getByText("r1")` is visible
      with `filterActive:false` (no manual expand).
      (b) "toggling a folder persists via onSetExpanded": pass `onSetExpanded` mock; expand the
      collection, click the folder chevron (`toggle-folder`), expect
      `onSetExpanded(collectionId, folderId, <newState>)`.
      (c) "toggling a collection persists with null itemId": click `toggle-collection`, expect
      `onSetExpanded(collectionId, null, <newState>)`.
      (existing collapsed-by-default tests must stay green — all their fixtures have `expanded:false`,
      so seeding yields an empty set and behavior is unchanged.)
  - **Impl:**
    - `treeNav.ts`: add `expandedIds(collections): string[]`.
    - `treeEdit.ts`: add `setNodeExpanded` (collection flag for `itemId===null`; `mapItemsDeep` to set
      `{ ...it, expanded }` on a folder).
    - `useCatalogTree.ts`: add `setExpanded` to `UseCatalogTree` + impl using the `optimistic` helper
      (`setNodeExpanded` local transform, `ipc.collectionSetExpanded` call).
    - `CollectionTree.tsx`: add prop `onSetExpanded: (collectionId, itemId|null, expanded) => void`.
      Seed `open` **once** when collections first become non-empty (a `seededRef` effect →
      `setOpen(new Set(expandedIds(collections)))`). Wrap `toggle`/`setOpenId(true)` to also persist:
      resolve the node via `pathToItem(collections, id)` → `collectionId = path[0]`,
      `itemId = id === collectionId ? null : id`, call `onSetExpanded(collectionId, itemId, newState)`.
      The filter `effectiveOpen` force-expand path must NOT persist (it never calls toggle/onExpand).
    - `SidebarShell.tsx`: pass `onSetExpanded={cat.setExpanded}` to `<CollectionTree>`.

- [x] **Task 6: Wire sort + active request (#7, spec §6.3/§7.2).**
  - **Files:** `src/features/catalog/uiState.ts` (NEW) + `.test.ts` (NEW),
    `src/features/catalog/SidebarShell.tsx` (+ `.test.tsx`), `src/app/WorkflowApp.tsx` (+ `.test.tsx`),
    `src/features/catalog/treeNav.ts` (add `findSavedRequest`) (+ test).
  - **TDD — tests first:**
    - `uiState.test.ts`: mock `@/ipc/client`; `loadUiState()` calls `ipc.appSettingsGet` and caches the
      result (`readUiState()` returns it); `patchUiState({ sort_key: "recent" })` merges into the cache
      and calls `ipc.appSettingsSet` with the **full** merged object (active_request preserved);
      a second `patchUiState({ active_request: ref })` preserves the earlier `sort_key`.
    - `treeNav.test`: `findSavedRequest(tree, collectionId, itemId)` returns the deep request leaf or
      `null`.
    - `SidebarShell.test.tsx`: mock `./uiState`; on mount `loadUiState` resolves `{ sort_key: "recent" }`
      → the sort control reflects "recent" (await effect). Changing the sort calls
      `patchUiState({ sort_key: <key> })`.
    - `WorkflowApp.test.tsx`: mock `@/features/catalog/uiState` (`loadUiState`, `patchUiState`,
      `readUiState`). (i) on mount with `loadUiState` → `{ active_request: { collection_id:"c1",
      item_id:"rX" } }` and a `cat.tree` containing that leaf, `openSavedRequest` is called once for the
      restored request. (ii) opening a request (`open-req` button) calls
      `patchUiState({ active_request: { collection_id, item_id } })`. (iii) the active id reaches the
      sidebar: extend the `SidebarShell` mock to surface `activeItemId` and assert it equals the open
      draft origin's `requestId`.
  - **Impl:**
    - `uiState.ts`: module-level `cache: UiStateIpc = { sort_key: null, active_request: null }`;
      `loadUiState()` (`cache = await ipc.appSettingsGet(); return cache`), `readUiState()`, and
      `patchUiState(patch: Partial<UiStateIpc>)` (`cache = { ...cache, ...patch }; await
      ipc.appSettingsSet(cache)`).
    - `treeNav.ts`: add `findSavedRequest(collections, collectionId, itemId): SavedRequestIpc | null`.
    - `SidebarShell.tsx`: add an `activeItemId?: string | null` prop (default `null`) and pass it to
      `<CollectionTree activeItemId={activeItemId ?? null}>` (replacing the hardcoded `null`). On mount,
      `void loadUiState().then((s) => { if (s.sort_key) setSortKey(s.sort_key as SortKey); })`.
      Change the sort handler to `(k) => { setSortKey(k); void patchUiState({ sort_key: k }); }`.
    - `WorkflowApp.tsx`: derive `const activeItemId = useDraftOrigin()?.requestId ?? null;` and pass to
      `<SidebarShell activeItemId={activeItemId} …>`. In `openRequest`, after the guarded open, call
      `void patchUiState({ active_request: { collection_id: collectionId, item_id: req.id } })`. Add a
      **run-once** mount effect that, once `cat.tree` is loaded, `loadUiState()`s and — if
      `active_request` is set — resolves the leaf via `findSavedRequest` and calls `openSavedRequest`
      (direct, not guarded — there is no draft yet at startup). Guard with a ref so it fires only once.

- [x] **Task 7: Auto-expand on drag (#4, spec §8).**
  - **Files:** `src/features/catalog/CollectionTree.tsx` (+ `.test.tsx`).
  - **TDD — tests first (`vi.useFakeTimers()`):**
    (a) hovering a **collapsed** folder during a drag for 700ms expands it — start a drag
    (`fireEvent.dragStart` on a request row), `dragOver` the collapsed folder, `vi.advanceTimersByTime(700)`,
    assert the folder's children become visible (and `onSetExpanded` was called for the folder).
    (b) leaving early cancels — `dragOver` the folder, advance 300ms, `dragOver` a different row,
    advance 400ms, assert the folder did NOT expand.
    (c) drop/dragEnd clears any pending timer.
  - **Impl:** in `CollectionTree`, hold an auto-expand ref `{ id: string | null; timer: ReturnType<typeof
    setTimeout> | null }`. In `onDragOverRow(target, zone)`: if `drag` is active and the target is a
    container (`kind === "collection" || "folder"`) that is **not** in `effectiveOpen` and
    `target.id !== ref.id`, clear the existing timer, set `ref.id = target.id`, and start a 700ms timer
    that expands via the same persisted path used by `onExpand` (`setOpenId(target.id, true)` +
    `persistExpanded(target.id, true)`). When the hovered target changes to a different id, reset. Clear
    the timer (and `ref.id`) in `onDropRow` and `onDragEndItem`. Use a module const
    `AUTO_EXPAND_MS = 700`.

- [x] **Task 8: Full e2e verification (spec §10).** Run, from repo root: `pnpm lint`, `pnpm test`,
  `pnpm build`, `cargo test -p handshaker-core`, `cargo test -p handshaker` — all green (capture
  output; no success claim without it, per verification-before-completion). Document which manual
  checklist items are now covered by automated tests vs. need a human run:
  1. Expand collection + folder → restart → still expanded (#5) — *covered by seeding + persist tests;
     restart is manual.*
  2. Change sort → restart → preserved; active request reopened (#7) — *persist/restore unit-tested;
     restart manual.*
  3. Collection name click → overview + expand; request row click anywhere → opens (#1/#2) — *plan-03.*
  4. Toggle `grpcIcon` in Appearance → tree updates instantly (#3) — *live-reactivity test (Task 3).*
  5. 8px indent + guide lines with hover emphasis (#6/#9) — *plan-03; manual visual.*
  6. cmd+ctrl+B / `mod+B` hide/show, no cmd+B conflict — *WorkflowApp toggle test; see Approach notes.*
  7. DnD onto collapsed folder → auto-expand → drop inside; order persists (#4) — *Task 7 tests; manual
     end-to-end.*

- [x] **Task 9: Dead-code sweep + commit.** Confirm `StreamBadge` is gone (Task 3) and grep for any
  now-unused imports/helpers (old `<select>` remnants in SortControl, unused `treeTypes` fields). Use
  `mcp__ccd_session__spawn_task` for any out-of-scope findings instead of expanding this plan. Final
  commit; flip this plan's banner and `plan-00-index` plan-04 row to ✅ DONE.

**Done-when:** all 10 spec points covered (automated where feasible, else flagged for manual run), every
suite green, `StreamBadge`/dead code removed, plan-00-index updated.
