# Env switcher — menu polish + manual environment ordering — design

**Date:** 2026-06-10
**Status:** 📐 spec approved — plan not yet written
**Branch:** `claude/blissful-wing-ddce4f`

## Scope

Two user-reported issues with the environments dropdown (`EnvSwitcherMenu`, opened
from the titlebar `WorkflowEnvControl` pill):

1. The **"No environment"** row renders visually larger/lighter than the other rows.
2. There is **no way to reorder** environments — the list is force-sorted
   alphabetically.

Plus two menu-structure changes locked during brainstorming:

3. Remove the bottom **"+ New env…"** item (and its separator); instead add a small
   **`+` icon button** in the top-right corner of the `ENVIRONMENTS` header row.
4. Delete **`EnvPill`** — it is dead code (no importers; only a doc-comment mention
   in `WorkflowEnvControl`), and it would otherwise have to carry the new
   `onReorder` plumbing for nothing.

## Problems

1. **"No environment" font.** The row uses `font-thin` (weight 100)
   ([EnvSwitcherMenu.tsx:44](../../../src/features/envs/EnvSwitcherMenu.tsx)), but the
   app only loads Inter 400/500/600/700 ([main.tsx](../../../src/main.tsx)). There is
   no real thin face, so WebView2's synthetic rendering makes the row look
   inconsistent (perceived as larger) next to the regular items.
2. **No order concept anywhere.** Both `EnvironmentStore` impls are
   `HashMap`-backed, so `list()` order is **nondeterministic**;
   `FileEnvironmentStore::persist` sorts the JSON array by name; the frontend
   re-sorts with `localeCompare`
   ([EnvSwitcherMenu.tsx:33](../../../src/features/envs/EnvSwitcherMenu.tsx)). Manual
   ordering needs a persisted order and a UI affordance.

## Decisions (locked during brainstorming)

- **Reorder UX: drag-and-drop rows inside the dropdown**, with the same thin
  insertion-line affordance as the sidebar (`DropLine`). No up/down buttons, no
  separate manage dialog.
- **Order is data, owned by the backend** (option A). `environments.json` keeps its
  existing JSON-array shape but the array order becomes the user order; a new
  `env_reorder` IPC command persists it. Not a ui-state preference (order must
  travel with the data file), not a per-env `position` field (needless schema
  noise).
- **"No environment" fix:** drop `font-thin`; the row becomes a regular `text-sm`
  item, keeping `text-muted-foreground` to distinguish it from real envs.
- **Menu structure:** header row = `ENVIRONMENTS` label + right-aligned `+`
  icon-button (same compact icon-`DropdownMenuItem` pattern as the per-row
  pencil, but **always visible**, not hover-revealed); the bottom "+ New env…"
  item and the separator above it are removed.

## Design

### 1. Core: order-preserving `EnvironmentStore`

- Trait gains `fn reorder(&self, names: &[String]) -> Result<(), CoreError>`.
- Both impls (`FileEnvironmentStore`, `InMemoryEnvironmentStore`) switch their
  backing store from `HashMap<String, Environment>` to `Vec<Environment>` — the
  vector order **is** the user order. Env counts are tiny; O(n) name lookups are
  fine.
- Semantics:
  - `upsert` of an **existing** name replaces **in place** (position preserved);
    a **new** name appends at the end.
  - `delete` preserves the order of the remaining envs.
  - `reorder(names)` requires `names` to be an exact permutation of the current
    set (same length, same names) — otherwise `CoreError::InvalidTarget`. On
    success the vector is rearranged to match. Same clone-then-commit + atomic
    write discipline as today.
- `FileEnvironmentStore::persist` stops sorting by name — it writes the vector
  order. `load` keeps file order. **No migration:** existing files are already
  JSON arrays; their current (alphabetical) order simply becomes the initial
  user order.

### 2. IPC: `env_reorder`

- `src-tauri/src/commands/env.rs`: `env_reorder_impl(&self, names: Vec<String>)`
  (thin delegate to the store) + `#[tauri::command] env_reorder`, registered in
  `lib.rs` alongside the other env commands. Regenerate specta bindings →
  `ipc.envReorder(names)` on the frontend.
- `env_list` now returns the stored order (it already returns `store.list()`
  verbatim — the ordering fix comes from the store change).

### 3. Frontend: `EnvSwitcherMenu`

- **Remove the `localeCompare` sort** — render `envs` in the order received.
- **Menu structure** (top → bottom): header row (`ENVIRONMENTS` label +
  right-aligned `+` icon `DropdownMenuItem`, `aria-label="New environment"`,
  → `onNewEnv`) → "No environment" (regular size, muted) → env rows. No trailing
  separator / "New env…" item.
- **DnD:** env rows (only — not "No environment", not the header) become HTML5
  draggable. On `dragover`, the before/after zone is picked by the row's vertical
  midpoint; the indicator is the existing `DropLine` from
  [DropLine.tsx](../../../src/features/catalog/DropLine.tsx) (generic; the menu
  rows must set `--bl: 0px; --br: 0px` since `DropLine` positions itself with the
  sidebar's bleed vars). Drop computes the full new name order and calls a new
  `onReorder(names: string[])` prop; same-position drops are no-ops (no callback).
  Dropping outside the menu cancels. The component stays presentational — it never
  calls IPC itself.
- **Owner wiring (`WorkflowEnvControl`):** `onReorder` applies the new order
  optimistically (`setEnvs` reordered) and calls `ipc.envReorder(names)`; on error
  it refetches `envList` (silent self-heal — the menu just snaps back).
- **Rename keeps position:** `EnvEditorDialog`'s save flow is
  `envUpsert(new)` + `envDelete(old)`
  ([EnvEditorDialog.tsx:96-109](../../../src/features/envs/EnvEditorDialog.tsx)),
  which would push a renamed env to the end. After that dance, when
  `renamed`, the dialog additionally calls `ipc.envReorder` with the previous
  order where `originalName` is substituted by the new name (it already receives
  `envs`, whose order is now meaningful).

### 4. Dead code: delete `EnvPill`

`src/features/envs/EnvPill.tsx` has no importers. Delete it (it has no test
file). `WorkflowEnvControl`'s doc comment is rewritten to stand alone instead of
mirroring `EnvPill`.

## Components touched

| File | Change |
|------|--------|
| `crates/handshaker-core/src/env/mod.rs` | trait: add `reorder`; doc updates |
| `crates/handshaker-core/src/env/file_store.rs` | `Vec`-backed; in-place upsert; unsorted persist; `reorder` |
| `crates/handshaker-core/src/env/in_memory.rs` | `Vec`-backed; in-place upsert; `reorder` |
| `src-tauri/src/commands/env.rs` | `env_reorder_impl` + `env_reorder` command + tests |
| `src-tauri/src/lib.rs` | register `env_reorder`; bindings regen |
| `src/ipc/bindings.ts` | regenerated (`envReorder`) |
| `src/features/envs/EnvSwitcherMenu.tsx` | drop sort + `font-thin`; header `+`; remove "New env…"; DnD + `onReorder` prop |
| `src/features/workflow/WorkflowEnvControl.tsx` | wire `onReorder` (optimistic + IPC + refetch-on-error); doc comment |
| `src/features/envs/EnvEditorDialog.tsx` | post-rename `envReorder` to keep position |
| `src/features/envs/EnvPill.tsx` | **delete** (dead code) |

No new dependencies.

## Testing

Core (`cargo test -p handshaker-core`):

- upsert appends new names at the end; upsert of an existing name keeps its
  position; delete preserves remaining order.
- `reorder`: happy path persists + is returned by `list()`; rejects wrong
  length / unknown / duplicate names (set mismatch).
- File store: order survives a write→reload roundtrip; a legacy (alphabetical)
  file loads as-is.

Tauri (`cargo test -p handshaker`): `env_reorder_impl` happy path + set-mismatch
rejection.

Frontend (vitest):

- `EnvSwitcherMenu` renders envs in prop order (no sorting); "No environment" has
  no `font-thin`; header has the `+` item (→ `onNewEnv`); no "New env…" item.
- DnD: simulated `dragstart`/`dragover`/`drop` fires `onReorder` with the new
  full order; same-position drop does not fire it.
- `WorkflowEnvControl`: `onReorder` → optimistic order + `envReorder` IPC call.
- `EnvEditorDialog`: rename triggers `envReorder` with the old order, old name
  substituted; non-rename saves do not call it.
- Update any test referencing `EnvPill` / "New env…" / sorted order.

Manual (live WebView2 — required):

- DnD inside the Radix dropdown is the main risk: dragging must not close the
  menu, must not fight the hover pencil, and the `DropLine` must render at the
  right edge positions. Verify a reorder survives an app restart.

## Out of scope

- Reordering from a dedicated "manage environments" view (none exists).
- Keyboard-accessible reordering (the sidebar DnD has the same limitation).
- Any change to env variables/colors/active-env semantics.
