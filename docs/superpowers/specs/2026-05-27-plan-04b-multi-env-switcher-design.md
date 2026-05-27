# Plan #4b — Multi-env switcher (Design)

**Date:** 2026-05-27
**Branch (suggested):** `claude/plan-04b-multi-env-switcher`
**Realizes spec rules:**
- Master §4 line 137 — relax «одна Default env в MVP» constraint to multi-env. Bootstrap also changes: no auto-seeded Default; initial state is "No environment" (Postman-style), the user explicitly creates their first env.
- Master §5.2 — `EnvironmentStore` trait (already matches; no changes).
- Master §6.2 — wire up the only missing IPC command: `env_delete`.
- Master §8.1 — header env-pill `<Active> ▾` becomes a real switcher dropdown.
- Master §9 — `⌘E` / `Ctrl+E` hotkey opens the switcher.
- Master §10.1 — Switch env optimistic; persist via debounced IPC (in-memory persist is a no-op in MVP).

## 0. Sources and prior documents

- Master spec: [`2026-05-26-handshaker-mvp-design.md`](2026-05-26-handshaker-mvp-design.md) — env data model, IPC contract, header layout, hotkeys.
- Plan #4 design: [`2026-05-27-plan-04-env-vars-design.md`](2026-05-27-plan-04-env-vars-design.md) — §1.2 explicit out-of-scope list. Plan #4b reverses three items: «Multiple environments + switcher dropdown», «Env CRUD», «`env_delete` IPC command».
- Plan #4 errata: [`../errata/2026-05-27-plan-04-env-vars.md`](../errata/2026-05-27-plan-04-env-vars.md) — deviation #2 (tauri-specta `Partial<...>` shape for `HashMap<String, String>`) directly impacts how the new dialogs read `EnvironmentIpc.variables`. Same coercion pattern applies.
- `CoreError` ([`crates/handshaker-core/src/error.rs`](../../../crates/handshaker-core/src/error.rs)) — no new variants. `InvalidTarget` covers all new validation failures (already used by `env_active_set` and `env_upsert` for invalid names).

## 1. Goal and scope

**Goal:** turn the header env-pill from a single-purpose "edit Default's variables" trigger into a real multi-env switcher with create / rename / delete CRUD. Bootstrap is changed from auto-seeding a `Default` env to a Postman-style **"No environment"** initial state — the user explicitly creates their first env. Backend gains exactly one new IPC command (`env_delete`) and the signatures of `env_active_get` / `env_active_set` change to use `Option<String>` to model the no-env state. The bulk of the work is frontend (dropdown menu + three small dialogs + hotkey).

**Acceptance:** in the running app, the user can:
1. **Cold boot** — pill reads `No environment ▾`. Body `{{var}}` immediately shows `⚠ Unresolved: var` (no env → empty var set → unresolved).
2. Click the header pill → menu opens with a non-removable `✓ No environment` row at the top, then a separator, then `+ New env…`. No real envs yet.
3. Click «+ New env…» → `EnvEditorDialog` opens in create mode (empty name, empty variables table). Type name `staging`, add a variable `uid=alpha`, click Save → env created with variables in one round-trip, auto-activated. Pill reads `staging ▾`. Body `{{uid}}` preview now reads `→ resolves: {"...":"alpha"}`.
4. Reopen menu → `No environment`, `✓ staging`. Click `No environment` row → switches back to no-env, preview returns to unresolved. Click `staging` row → switches back.
5. With active = `staging`, hover `staging` row → `⋮` → «Edit env…» → `EnvEditorDialog` opens in edit mode (name `staging` populated, vars populated). Rename to `staging-eu`, add `region=eu`, Save → frontend-composed rename+upsert. Pill reads `staging-eu ▾`. Variables `uid` and `region` both present.
6. Create a second env `prod` via «+ New env…», auto-activated. Hover `staging-eu` row → `⋮` → «Edit env…» → rename to `prod-eu` (a name collision check fires if you try `prod`) → Save. Variables preserved.
7. Hover `staging-eu`'s row entry (actually now `prod-eu` after step 6 — pick whichever non-active env exists) → `⋮` → «Delete env…» → confirm dialog → Delete. Menu shrinks by one.
8. Delete the active env: hover active row → `⋮` → «Delete env…» → Delete. Frontend pre-switches active to `No environment` (since target was active), then `env_delete(target)`. Pill reads `No environment ▾`.
9. `⌘E` / `Ctrl+E` opens the dropdown menu (focus first row; ↑↓ navigates; Enter switches; → opens the focused row's submenu; ← closes the submenu; Esc closes the menu). The `No environment` row has no submenu (no `⋮`), so → on it is a no-op.

### 1.1 In scope

1. **Backend:**
   - Add `env_delete` IPC command (single line of new logic). Register in `collect_commands!`. No last-env guard — once all envs are deleted, active falls to `None` (≡ "No environment") and that's a valid steady state.
   - **Change `active_env` from `RwLock<String>` to `RwLock<Option<String>>`.** `None` ≡ "No environment".
   - **Change `env_active_get` signature** from `Result<String, IpcError>` to `Result<Option<String>, IpcError>` (TS: `string | null`).
   - **Change `env_active_set` signature** from `name: String` to `name: Option<String>` (TS: `string | null`). Passing `null` switches to no-env. Validation still rejects a `Some(name)` referring to a non-existent env.
   - **Remove the `with_default()` bootstrap.** `AppState::default()` now uses `InMemoryEnvironmentStore::new()` (empty) and `active_env = None`. The `with_default` constructor stays in the core crate for tests but is unused by `src-tauri`.
   - `vars_resolve` reads the active env name; if `None`, it resolves against an empty `HashMap<String, String>`. `resolve_template_with_diagnostics` already handles empty var sets — all `{{var}}` end up in `unresolved_vars`.
2. **Frontend:**
   - shadcn add `dropdown-menu` and `alert-dialog`.
   - `EnvSwitcherMenu` component (replaces direct dialog trigger inside `EnvPill`).
   - **`EnvEditorDialog`** — single unified dialog for both Create and Edit, modeled on Postman's env editor (name input + variables table in the same surface). Takes `originalName: string | null` prop: `null` ≡ create mode (empty name + empty vars), otherwise edit mode (preload from `env_list`). On Save, if `name` changed, performs frontend-composed rename (`env_upsert(new, vars)` → `env_active_set(new)` if active was old → `env_delete(old)`); otherwise just `env_upsert`. This **replaces** Plan #4's `EditEnvDialog`.
   - `ConfirmDeleteEnvDialog` — shadcn AlertDialog with destructive «Delete» button. «Variables will be lost.»
   - `EnvPill` rebuilt around the new menu; the per-row submenu has just two entries: `Edit env…` and `Delete env…`.
   - `⌘E` / `Ctrl+E` hotkey opens the dropdown — global keyboard listener in `App.tsx`.
3. **State plumbing:**
   - `App.tsx` becomes the owner of the `envs: EnvironmentIpc[]` list + `activeEnv: string | null`. Pill consumes both via props. `null` ≡ "No environment".
   - List refreshes on mount + after every mutation reply.
   - `activeEnv` propagated as a prop to `InvokePanel` → `ResolvesPreview` so the latter re-fires `vars_resolve` when env switches (live preview updates without page reload). When `activeEnv === null`, the preview line still calls `vars_resolve` and renders the unresolved-vars warning (consistent with «No environment» semantics).

### 1.2 Out of scope (explicit deferrals)

- **`env_rename` IPC command.** Frontend-composed rename keeps us strictly aligned with master §5.2 / §6.2. If a future plan needs atomic rename (e.g. file-backed `EnvironmentStore` where write fanout is expensive), it gets added as a documented master-spec extension at that point.
- **`ActiveEnvChanged` event.** Decided not needed for MVP single-window scope (Q3 of brainstorm). `App.tsx` owns the active-env string and propagates via props; backend stays the source of truth queried at next `vars_resolve` / `env_active_get`. Master §6.3 does not list this event.
- **Variables-table-inline switcher** (e.g. inside `EnvEditorDialog`). The editor stays bound to whatever env was clicked (or `null` in create mode). Switching envs always happens through the header pill. Keeps mental model simple.
- **Persistence to disk.** Master §4 line 148 — in-memory only in MVP.
- **Bulk import/export of envs.** Out of MVP scope.
- **Env-level «active» persistence across app restarts.** Active env is in-memory; restart always resets to `None` ("No environment").
- **Auth-per-env editing.** Lands with Plan #5.
- **Variables at Collection scope.** Lands with Plan #6.

## 2. Architecture — three layers

### 2.1 Core (`crates/handshaker-core/src/env/`)

**No changes.** The trait already exposes `list / get / upsert / delete` exactly as master §5.2 prescribes, and `InMemoryEnvironmentStore` already implements all four. `delete` is currently idempotent (silently succeeds on missing name) — kept as-is. The `with_default()` constructor stays for use in tests but `src-tauri` no longer calls it.

There is no «cannot delete the only env» rule. The "No environment" pseudo-entry handled at the src-tauri / UI layer subsumes that invariant: when `env_store.list()` is empty, `active_env` is `None`, and the UI shows `No environment ▾`. No core involvement.

### 2.2 src-tauri (`src-tauri/src/`)

```
src/
  commands/env.rs    MODIFY — add env_delete; widen env_active_get / env_active_set
                              signatures from String to Option<String>
  commands/vars.rs   MODIFY — handle active_env = None (resolve against empty var map)
  ipc/env.rs         UNCHANGED — EnvironmentIpc types stay the same
  state.rs           MODIFY — active_env: RwLock<Option<String>>; default = None;
                              env_store seeded empty (no with_default() call)
  lib.rs             MODIFY — register env_delete in collect_commands![]
```

That's the entirety of the Rust delta. Estimated ~50 lines including tests.

### 2.3 Frontend (`src/`)

```
src/
  features/envs/
    EnvPill.tsx                 MODIFY — render EnvSwitcherMenu instead of direct dialog
    EnvSwitcherMenu.tsx         NEW    — DropdownMenu composition (per-row submenus)
    EnvEditorDialog.tsx         MODIFY — was EditEnvDialog (renamed + expanded).
                                         Now: takes `originalName: string | null`;
                                         renders Name input ABOVE the variables
                                         table; null → create mode, otherwise edit;
                                         Save composes rename+upsert when name changed
    ConfirmDeleteEnvDialog.tsx  NEW    — AlertDialog
    VariablesTable.tsx          UNCHANGED
    EditEnvDialog.tsx           DELETE — replaced by EnvEditorDialog
  features/invoke/
    ResolvesPreview.tsx         MODIFY — add activeEnv to useEffect deps
    InvokePanel.tsx             MODIFY — pass activeEnv prop down
  components/ui/
    dropdown-menu.tsx           NEW (shadcn add dropdown-menu)
    alert-dialog.tsx            NEW (shadcn add alert-dialog)
    label.tsx                   NEW (shadcn add label) — paired with Input in EnvEditorDialog
  ipc/
    client.ts                   MODIFY — typed wrapper envDelete; updated
                                         envActiveGet/envActiveSet for Option
    bindings.ts                 REGEN  — via export-bindings
  App.tsx                       MODIFY — lift envs + activeEnv state up;
                                         add ⌘E / Ctrl+E global listener;
                                         pass activeEnv to InvokePanel
```

No Zustand introduction (KISS continued from Plan #4). React props + local state are sufficient at this scope; Zustand lands when multi-tab / cross-feature state arrives (likely Plan #6 with Collections).

## 3. Data types

**No new IPC types.** `EnvironmentIpc` from Plan #4 ([`src-tauri/src/ipc/env.rs`](../../../src-tauri/src/ipc/env.rs)) is reused for every command including the new `env_delete` (which takes a `String`, not an `EnvironmentIpc`).

**Signature changes (Plan #4 → Plan #4b):**
- `env_active_get`: return type `String` → `Option<String>` (tauri-specta emits TS `string | null`).
- `env_active_set`: argument `name: String` → `name: Option<String>` (TS `string | null`).
- `AppState::active_env`: `RwLock<String>` → `RwLock<Option<String>>`; default `None` (was `"Default"`).
- `AppState::env_store`: initialized via `InMemoryEnvironmentStore::new()` (was `with_default()`); store starts empty.

`InMemoryEnvironmentStore::with_default()` is left in the core crate (used by some existing tests; not invoked by `src-tauri`).

## 4. IPC contract

### 4.1 Commands (after Plan #4b)

| Command | Args | Return | Status |
|---|---|---|---|
| `env_list` | — | `Vec<EnvironmentIpc>` | unchanged (Plan #4) |
| `env_active_get` | — | `Option<String>` (TS: `string \| null`) | **signature widened** — `null` = "No environment" |
| `env_active_set` | `name: Option<String>` (TS: `string \| null`) | `()` | **signature widened** — pass `null` to clear active |
| `env_upsert` | `env: EnvironmentIpc` | `()` | unchanged (Plan #4) |
| `env_delete` | `name: String` | `()` | **NEW** |
| `vars_resolve` | `template: String` | `ResolutionReportIpc` | unchanged (Plan #4) — backend now handles `active = None` internally |

### 4.2 `env_delete` semantics

```rust
#[tauri::command]
#[specta::specta]
pub async fn env_delete(state: State<'_, AppState>, name: String) -> Result<(), IpcError> {
    // Active-env guard. Frontend is expected to env_active_set(None or other) before
    // delete when targeting the active env. We refuse to delete the currently active
    // env to keep the invariant "active is always None or a real existing env" trivial.
    let active = state.active_env.read().await.clone();
    if active.as_deref() == Some(name.as_str()) {
        return Err(handshaker_core::error::CoreError::InvalidTarget(format!(
            "cannot delete active env `{name}`; switch first"
        )).into());
    }
    state.env_store.delete(&name).map_err(IpcError::from)
}
```

**No last-env guard.** With "No environment" as a valid steady state, deleting the last real env simply leaves `env_store.list()` empty and `active_env = None`. The pill renders `No environment ▾`. Nothing breaks.

**Why keep the active-env guard?** Without it, `env_delete(activeName)` would leave `active_env` pointing at a deleted env, breaking the invariant «active is None or a real existing env» throughout the backend (especially `vars_resolve`). Two implementation options were considered:
- (a) Auto-clear active in the backend (`if active == name { active = None }`) and return `()`. Slightly more lenient API but harder to reason about; UI may have stale `activeEnv` until next `env_active_get`.
- (b) Refuse with `InvalidTarget`, force frontend to compose `env_active_set(None_or_other) → env_delete(target)`. Stays exactly within master §6.2 signature. The frontend already composes this in `ConfirmDeleteEnvDialog.handleConfirm`.

Chose (b) for the same reason as before — keeps the IPC simple and lets the frontend stay the source of truth for the React-prop `activeEnv`.

### 4.2.1 `env_active_set` semantics

```rust
#[tauri::command]
#[specta::specta]
pub async fn env_active_set(state: State<'_, AppState>, name: Option<String>) -> Result<(), IpcError> {
    match &name {
        Some(n) => {
            if state.env_store.get(n).is_none() {
                return Err(handshaker_core::error::CoreError::InvalidTarget(format!(
                    "no such env: `{n}`"
                )).into());
            }
        }
        None => {} // null clears active — always allowed
    }
    *state.active_env.write().await = name;
    Ok(())
}
```

### 4.3 Events

**None added.** As decided in Q3 of brainstorm, env switching propagates through React props from `App.tsx` down to consumers. Master §6.3 does not list `ActiveEnvChanged`.

### 4.4 Error mapping

All paths reuse existing `IpcError` variants:
- `env_delete` active-env / invalid-name → `IpcError::InvalidTarget { message }`.
- `env_upsert` invalid name → `IpcError::InvalidTarget { message }` (existing).
- `env_active_set Some(name)` for missing env → `IpcError::InvalidTarget { message }` (existing). `env_active_set(None)` never fails.

The `from_core_error_exhaustive` test in `src-tauri/src/ipc/error.rs` (Plan #1) needs **no update**.

## 5. UI surface

### 5.0 Component library and theme

**Theme:** unchanged from master §8.8 — shadcn `new-york` style on the OKLCH dark palette already wired in `src/styles/globals.css`. No new color tokens, no new fonts. Everything ships under `.dark` class which is the only mode in MVP.

**Component policy:** every interactive surface in Plan #4b uses shadcn/ui primitives directly. No custom styled buttons, no hand-rolled menu items, no ad-hoc dialogs. Where a shadcn primitive does not exist (e.g. the trailing `⋮` icon inside a menu row), the markup is a thin composition of shadcn `<Button variant="ghost" size="icon">` + `<lucide-react>` icon, **not** a raw `<button>` or `<div role="button">`.

Primitives used (some new, some already in the project):

| Primitive | Status | Used in |
|---|---|---|
| `<Button>` | Plan #4 | Pill trigger, ⋮ icon button, dialog footer buttons |
| `<Input>` | Plan #4 | Name field in EnvEditorDialog; key/value inputs (via existing `VariablesTable`) |
| `<Dialog>` family (`DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`) | Plan #4 | EnvEditorDialog |
| `<Label>` | **NEW (shadcn add `label`)** | Name field label in EnvEditorDialog |
| `<DropdownMenu>` family — `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuLabel`, `DropdownMenuItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSeparator` | **NEW (shadcn add `dropdown-menu`)** | EnvSwitcherMenu (outer menu + per-row actions submenu) |
| `<AlertDialog>` family — `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, `AlertDialogAction` | **NEW (shadcn add `alert-dialog`)** | ConfirmDeleteEnvDialog |
| `<Separator>` | Plan #4 (only if absent — shadcn add `separator` is `pnpm dlx shadcn@latest add separator`) | Optional visual separator between Name section and Variables section in EnvEditorDialog |

shadcn defaults from <https://ui.shadcn.com/docs/components/...> are used as-is. No restyling, no className overrides except:
- `text-destructive` / `focus:text-destructive` / `focus:bg-destructive/10` on destructive menu items (Delete env…). This is the shadcn-documented pattern for destructive menu items.
- `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` on the per-row `⋮` button so it's hover/focus-revealed (Postman-style).
- `text-muted-foreground italic` on the `No environment` menu row to visually distinguish the pseudo-entry from real env names.

shadcn CLI config (`components.json`) is already present in the project from Plan #4's `dialog` addition; new components inherit the same style + path aliases.

### 5.1 Header — `EnvPill` + `EnvSwitcherMenu`

Models Postman's environment quick-look (top-right of the workbench): each env row is independently clickable for switch and exposes per-row hover actions via a trailing icon. References — [Postman docs: «Group sets of variables using environments»](https://learning.postman.com/docs/sending-requests/variables/managing-environments/) confirms «click the dropdown menu in the upper right … to select an active environment» as the row click; per-row hover-revealed actions are documented in [Postman docs: «Navigating Postman»](https://learning.postman.com/docs/getting-started/basics/navigating-postman/) («hover over an item, it exposes View more actions»).

```
┌──────────────────────────────────────────────────────────┐
│  Handshaker                              prod ▾          │   (or `No environment ▾`)
└──────────────────────────────────────────────────────────┘
                                          │
                                          ▼  (click or ⌘E)
                          ┌─────────────────────────────┐
                          │  Environments                │   ← label header
                          │  ─────────────────────────── │
                          │    No environment            │   ← no ⋮, not removable
                          │  ─────────────────────────── │
                          │  ✓ prod                   ⋮  │   ← ⋮ on row hover/focus
                          │    staging                ⋮  │
                          │  ─────────────────────────── │
                          │  + New env…                  │
                          └─────────────────────────────┘
                                  │ click ⋮ on a real env row →
                                  ▼
                          ┌──────────────────────────┐
                          │  Edit env…                │   ← opens unified editor
                          │  Delete env… (red)        │
                          └──────────────────────────┘
```

- Pill itself stays a shadcn `<Button variant="ghost" size="sm">` showing the active env name (or `No environment` when active is `null`) + `▾` chevron icon (`lucide-react ChevronDown`). The `<Button>` is also the `<DropdownMenuTrigger asChild>`.
- **Menu shell:** `<DropdownMenu>` → `<DropdownMenuTrigger asChild>{Pill}</DropdownMenuTrigger>` → `<DropdownMenuContent align="end">`. Inside `DropdownMenuContent`:
  1. `<DropdownMenuLabel>Environments</DropdownMenuLabel>` — section header.
  2. `<DropdownMenuRadioGroup value={activeEnv ?? ""} onValueChange={onActiveSet}>` containing all switch-target rows. shadcn's radio-group primitive gives us:
     - Automatic selected-state styling (the indicator is the inserted `Check` icon).
     - `value=""` reserved for the `No environment` pseudo-row; `value=<name>` for real env rows.
  3. `<DropdownMenuSeparator />` between real env rows and the trailer.
  4. `<DropdownMenuItem onSelect={openCreateDialog}>+ New env…</DropdownMenuItem>` — trailer.
- **«No environment» pseudo-row:**
  - `<DropdownMenuRadioItem value="" className="text-muted-foreground italic">No environment</DropdownMenuRadioItem>` — the radio-item visually distinguished by italic muted text.
  - The radio-item indicator (left-side dot/check) renders only when `activeEnv === null`.
  - **No `⋮`** — radio-item is the entire clickable surface.
- **Env rows (real envs, direct manipulation):**
  - Sorted alphabetically.
  - Each row is a `<div className="flex items-center group">` containing:
    - `<DropdownMenuRadioItem value={env.name} className="flex-1">{env.name}</DropdownMenuRadioItem>` — the row body; click switches active.
    - A nested `<DropdownMenu>` rendered as `<DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={(e) => e.stopPropagation()}><MoreVertical /></Button></DropdownMenuTrigger>` followed by a `<DropdownMenuContent>` carrying the per-row actions. The `stopPropagation` on click is what prevents the outer radio-group from interpreting the ⋮ click as a row switch.
  - The radio-item indicator (left-side check) renders only on the active row.
- **Per-row actions submenu** (one `<DropdownMenu>` per row, anchored to its `⋮` trigger):
  - `<DropdownMenuItem onSelect={() => openEditDialog(env.name)}>Edit env…</DropdownMenuItem>` — opens `EnvEditorDialog` with `originalName = env.name` (edit mode).
  - `<DropdownMenuItem onSelect={() => openDeleteDialog(env.name)} className="text-destructive focus:text-destructive focus:bg-destructive/10">Delete env…</DropdownMenuItem>` — opens `ConfirmDeleteEnvDialog` with `target = env.name`. **Always enabled** for real env rows (no last-env restriction).
- **Trailing menu item** (after the radio group, after the separator): `<DropdownMenuItem onSelect={openCreateDialog}>+ New env…</DropdownMenuItem>` — opens `EnvEditorDialog` with `originalName = null` (create mode). Auto-activates the created env on Save.
- **When `env_store.list()` is empty** (cold boot, or all envs deleted):
  - The menu shows just `✓ No environment` + separator + `+ New env…`. No real-env rows.
- **Layout details:**
  - Width: fits the longest env name + ⋮ icon padding; no horizontal scrolling.
  - Position: anchored under the pill, right-aligned (`align="end"`).
- **Keyboard navigation (provided by radix):**
  - ↑↓ navigates between rows and the «+ New env…» entry.
  - On a row, → opens the per-row submenu; ← closes it.
  - Enter on a row activates it (switches env).
  - Esc closes the menu.
  - ⌘E / Ctrl+E opens the menu (see §5.4).

#### 5.1.1 Direct manipulation rationale (Postman-style)

The «point at the thing, then act on it» model is what Postman uses and what users expect from environment switchers. The alternative considered was a single-level menu where Edit/Rename/Delete entries live below the env list and always act on the active env. Rejected for two reasons:

1. **Cross-env friction.** Deleting an inactive env would require: (a) click env to switch active → (b) reopen menu → (c) click «Delete env…». Three interactions plus an unwanted active-env switch as side effect. With per-row submenus: (a) hover row → (b) click ⋮ → (c) click Delete. Same step count without the side effect.
2. **Visual ambiguity.** «Delete env…» sitting below the env list raises the question «delete what?». Per-row `⋮` makes the target unambiguous because the menu is anchored to the row.

Trade-off accepted: a second menu level slightly complicates keyboard nav (radix `DropdownMenuSub` provides `→ ←` arrow keys to enter / leave the submenu, which is the standard cascade-menu convention).

### 5.2 `EnvEditorDialog` (unified create + edit)

This is the only env-editing surface in the app. It replaces Plan #4's `EditEnvDialog` and obsoletes the originally proposed separate `NewEnvDialog` / `RenameEnvDialog`. Modeled on Postman's environment editor — name and variables live on the same surface and persist together on Save.

```
┌─ Environment ──────────────────────────────────────── × ┐
│                                                         │
│  Name:  [staging-eu_______________]                     │
│                                                         │
│  Variables                                              │
│  ┌──────────────┬──────────────────────┬──┐             │
│  │ key          │ value                │  │             │
│  ├──────────────┼──────────────────────┼──┤             │
│  │ uid          │ alpha                │ ✕│             │
│  │ region       │ eu                   │ ✕│             │
│  │ Add variable │                      │  │             │
│  └──────────────┴──────────────────────┴──┘             │
│                                                         │
│                              [ Cancel ] [ Save ]        │
└─────────────────────────────────────────────────────────┘
```

- **shadcn primitives:** `<Dialog>` → `<DialogContent>` → `<DialogHeader>` (`<DialogTitle>` + `<DialogDescription>`) → body (`<Label>` + `<Input>` + `<VariablesTable>`) → `<DialogFooter>` (`<Button variant="ghost">` Cancel + `<Button>` Save/Create). All primitives from <https://ui.shadcn.com/docs/components/dialog>; no className overrides on the dialog shell.
- **Mode is controlled by the `originalName: string | null` prop:**
  - `null` → **create mode**: name field empty, variables table empty. `<DialogTitle>` reads `New environment`; `<DialogDescription>` reads `Create a new environment and define its variables.`; primary button label `Create`.
  - `string` → **edit mode**: name field preloaded with current name, variables loaded from `env_list().find(e => e.name === originalName)`. `<DialogTitle>` reads `Edit environment`; `<DialogDescription>` reads `Rename or update variables.`; primary button label `Save`.
- **Name field:** `<Label htmlFor="env-name">Name</Label>` + `<Input id="env-name" />`. Real-time validation `^[a-zA-Z_][a-zA-Z0-9_-]*$`. Invalid → `aria-invalid="true"` + shadcn's destructive border (the project already styles invalid inputs via `border-destructive`; the `VariablesTable` component sets the same class on invalid keys). Already-exists check: if `name !== originalName && envs.some(e => e.name === name)` → invalid + helper text rendered as a `<p className="text-xs text-destructive mt-1">name already exists</p>` below the input. Re-typing the original name in edit mode is a no-op (not flagged as duplicate).
- **Variables table:** reuses the existing `VariablesTable` component from Plan #4 unchanged (key validation, hover-delete, dup warning, empty-row materialization). Preceded by a small `<Label>Variables</Label>` heading for visual structure.
- **Footer:** `<DialogFooter>` containing `<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>` and the primary `<Button onClick={handleSave} disabled={!canSave || busy}>{isCreate ? "Create" : "Save"}</Button>`. Buttons inherit shadcn default styling (no `className` overrides).
- **Save button** is `disabled` when name empty, invalid, or duplicate. When enabled, clicking it runs the unified handler:

  ```ts
  async function handleSave() {
    const isCreate = originalName === null;
    const renamed   = !isCreate && name !== originalName;

    try {
      // 1. Persist the (possibly renamed) env with its current variables.
      await ipc.envUpsert({ name, variables: vars });

      // 2. If renaming the active env, switch active to the new name BEFORE
      //    deleting the old one — otherwise the backend env_delete guard
      //    refuses to delete the active env.
      if (renamed && activeEnv === originalName) {
        await ipc.envActiveSet(name);
        setActiveEnv(name);
      }

      // 3. If renaming, drop the old name. Idempotent — safe to retry.
      if (renamed) {
        await ipc.envDelete(originalName);
      }

      // 4. In create mode, auto-activate the newly created env.
      if (isCreate) {
        await ipc.envActiveSet(name);
        setActiveEnv(name);
      }

      onSaved();   // App.tsx refetches envs + closes the dialog
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    }
  }
  ```

- **Failure handling:**
  - Step 1 fails → inline footer error strip, dialog stays open, no state change applied.
  - Steps 2 / 3 fail (rare under in-memory storage) → footer error strip; the dialog stays open so the user can retry. The new env may already exist (from step 1) and the old one still exists — not a data-loss scenario, but the user gets to choose whether to retry delete or close and clean up manually.
- Esc / Cancel / click-outside → discard.

### 5.3 `ConfirmDeleteEnvDialog`

```
┌─ Delete env? ──────────────────────────────────────┐
│                                                    │
│  Are you sure you want to delete `prod`?           │
│  Its variables will be lost.                       │
│                                                    │
│                             [ Cancel ] [ Delete ]  │
└────────────────────────────────────────────────────┘
```

- Opened from a per-row `⋮` submenu (§5.1); the row's env is the delete target, **regardless of whether it is the currently active env**. The active-env handover (step 1 below) only fires when target === active.
- **shadcn primitives:** `<AlertDialog>` → `<AlertDialogContent>` → `<AlertDialogHeader>` (`<AlertDialogTitle>` + `<AlertDialogDescription>`) → `<AlertDialogFooter>` (`<AlertDialogCancel>` + `<AlertDialogAction>`). All from <https://ui.shadcn.com/docs/components/alert-dialog>; no className overrides on the shell.
- **Title:** `<AlertDialogTitle>Delete env?</AlertDialogTitle>`.
- **Description:** `<AlertDialogDescription>Are you sure you want to delete <code>{target}</code>? Its variables will be lost.</AlertDialogDescription>`. The `<code>` element inherits the project's mono font styling.
- **Footer buttons:** `<AlertDialogCancel>Cancel</AlertDialogCancel>` (shadcn's default cancel styling) and `<AlertDialogAction onClick={handleDelete} className={buttonVariants({ variant: "destructive" })}>Delete</AlertDialogAction>`. Per shadcn docs, `AlertDialogAction` uses the default button styling; the `destructive` variant is applied via `buttonVariants` — this is the exact pattern recommended at <https://ui.shadcn.com/docs/components/alert-dialog#destructive-style>.
- On `Delete` (frontend-composed):
  1. If `activeEnv === target` → switch active to `No environment`: `ipc.envActiveSet(null)`, `setActiveEnv(null)`.
  2. `ipc.envDelete(target)`.
  3. Refetch `envs` in `App.tsx`.
- Failure in step 1 or 2 → footer error strip; dialog stays open.
- Esc / Cancel → discard.

The active-env-switching guard at the backend (§4.2) means step 1 is mandatory when deleting the active env — otherwise step 2 fails with `InvalidTarget("cannot delete active env...")`. UI handles this transparently.

**Why switch to `No environment` rather than the first alphabetical remaining env?** Postman's behavior matches: deleting the active env drops you to «No Environment», not to an arbitrary neighbour. This is also more predictable: deleting a real env is a destructive op; auto-switching to another arbitrary env is a second mutation the user didn't request. «No environment» as the post-delete state lets the user explicitly pick the next active.

### 5.4 Global hotkey ⌘E / Ctrl+E

In `App.tsx`:

```ts
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && (e.key === "e" || e.key === "E")) {
      e.preventDefault();
      envSwitcherTriggerRef.current?.click();
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

The `envSwitcherTriggerRef` is forwarded from `EnvPill` to the underlying `DropdownMenuTrigger`. Programmatic `click()` opens the menu and focuses the first item — matches the «Открыть env-switcher» master §9 hotkey row.

Notable: this also intercepts ⌘E in the Monaco editor (which would otherwise insert a character or run a Monaco command). Acceptable for MVP — env switcher is more important than the default Monaco binding. If users complain, we'll register a Monaco-level handler that lets ⌘E bubble out.

### 5.5 Visual style

Theme and component policy are spelled out in §5.0 — short version: shadcn `new-york` style on the OKLCH dark palette from master §8.8, no color overrides. Plan #4b's per-feature exceptions are limited to:

- Destructive menu items («Delete env…»): `className="text-destructive focus:text-destructive focus:bg-destructive/10"` — the shadcn-documented pattern for destructive entries inside `DropdownMenuContent`.
- `No environment` row: `className="text-muted-foreground italic"` to visually mark it as a pseudo-entry.
- Trailing `⋮` button: `className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"` (the row wrapper carries `className="flex items-center group"`).
- Active env indicator: `DropdownMenuRadioItem`'s built-in indicator (a `<Check>` icon inserted by shadcn) appears automatically on the selected value; no manual icon placement needed.
- Names in code positions (the `<code>` element in `AlertDialogDescription`, key/value cells in `VariablesTable`, the Name input itself): inherit `font-mono` from existing project utility classes.
- `EnvEditorDialog` typography otherwise uses shadcn defaults — `Label` is `text-sm font-medium`, `DialogTitle` is `text-lg font-semibold`, `DialogDescription` is `text-sm text-muted-foreground`. No overrides.

## 6. Data flow

### 6.1 Initial load

1. `App.tsx` mount effect (existing): `ipc.envActiveGet()` → `setActiveEnv`. On cold boot returns `null` (no env auto-seeded).
2. NEW: `App.tsx` mount effect: `ipc.envList()` → `setEnvs`. On cold boot returns `[]`.
3. `<EnvPill envs={envs} activeEnv={activeEnv} onChange={refresh} />` — pill renders.
4. The pill displays `No environment` when `activeEnv === null`; otherwise the env name.

### 6.2 Switch active env

1. User clicks an env row (real env or the `No environment` pseudo-row).
2. Menu callback: `setActiveEnv(value)` (optimistic, sync, where `value` is `string` or `null`), then fire-and-forget `ipc.envActiveSet(value)` from the click handler. No `await` blocking the render — the optimistic UI update happens immediately and the IPC call resolves in the background.
3. `activeEnv` prop change propagates to `InvokePanel` → `ResolvesPreview` → `useEffect` deps trigger → `ipc.varsResolve(body)` re-fires. When `activeEnv === null` the backend uses an empty var set; `unresolved_vars` will list every `{{var}}` in the body.

On `env_active_set` failure (e.g. env got deleted in another window — not possible in MVP but coded for completeness): revert `activeEnv` to previous, show toast «failed to switch env». In practice: never fires.

### 6.3 Create / edit / rename env (unified)

All three flows are handled by a single `EnvEditorDialog.handleSave()` — see §5.2 for the verbatim handler. The branches:

- **Create** (`originalName === null`):
  1. `ipc.envUpsert({ name, variables: vars })`.
  2. `ipc.envActiveSet(name)`. `setActiveEnv(name)`.
  3. `ipc.envList()` → `setEnvs`. Close dialog.

- **Edit, name unchanged** (`originalName === name`):
  1. `ipc.envUpsert({ name, variables: vars })` — replaces the variables map on the existing env.
  2. `ipc.envList()` → `setEnvs`. Close dialog.

- **Edit with rename** (`originalName !== null && originalName !== name`):
  1. `ipc.envUpsert({ name, variables: vars })` — creates the renamed env with the final var set.
  2. If `activeEnv === originalName`: `ipc.envActiveSet(name)`, `setActiveEnv(name)`.
  3. `ipc.envDelete(originalName)`.
  4. `ipc.envList()` → `setEnvs`. Close dialog.

Failure handling per step is described inline in §5.2's `handleSave` listing.

### 6.4 Delete env

`ConfirmDeleteEnvDialog.handleDelete(targetName)`:
1. If `activeEnv === targetName`:
   a. `ipc.envActiveSet(null)`.
   b. `setActiveEnv(null)`.  // post-delete state = "No environment"
2. `ipc.envDelete(targetName)`.
3. `ipc.envList()` → `setEnvs`.
4. Close dialog.


## 7. Testing strategy

### 7.1 Core unit tests

**None added** — no core changes.

### 7.2 src-tauri unit tests

| File | Test |
|---|---|
| `src-tauri/src/commands/env.rs` (add a new `#[cfg(test)] mod tests`; the file currently has no test module) | `env_delete_rejects_when_target_is_active` |
| | `env_delete_succeeds_for_inactive` |
| | `env_delete_succeeds_for_only_real_env_when_active_is_none` (no last-env restriction) |
| | `env_active_set_accepts_none` |
| | `env_active_set_rejects_missing_some` |
| | `env_active_get_returns_none_on_fresh_state` |
| `src-tauri/src/commands/vars.rs` (add tests if absent) | `vars_resolve_treats_active_none_as_empty_var_set` |

Setup helper: `fn build_state_with(envs: &[(&str, &[(&str, &str)])], active: Option<&str>) -> AppState`. Uses `InMemoryEnvironmentStore::new()` then upserts each.

The «no tauri test infra» constraint from Plan #4 §9 still applies: we test the command function directly with a constructed `AppState`, not through Tauri's full IPC plumbing.

### 7.3 Integration tests

No new integration test file. Existing `vars_end_to_end.rs` is independent and still passes.

### 7.4 Frontend tests

Still no Vitest in the project. Continue manual smoke (§7.6).

### 7.5 `cargo test --workspace`

Should grow from current `76 passed, 1 ignored, 0 failed` to `~83 passed, 1 ignored, 0 failed` (7 new src-tauri tests in §7.2).

### 7.6 Manual UI smoke

Run against `127.0.0.1:5002` (Notex testbed) per handoff §10:

1. `pnpm tauri dev`. **Cold boot.** Pill reads `No environment ▾`. (No auto-seeded Default env anymore.)
2. **Open dropdown.** Click pill → menu opens. `✓ No environment` is the only row (no real envs yet). Below: separator + `+ New env…`. The `No environment` row has **no** trailing `⋮`.
3. **Unresolved preview without env.** Pick a method, type body `{"id":"{{uid}}"}`. Preview line: `⚠ Unresolved: uid`. Confirms `vars_resolve` with `active = None` returns the var as unresolved.
4. **Create first env with vars in one shot.** Click «+ New env…» → `EnvEditorDialog` opens in create mode (header `New environment`, name empty, table empty). Type name `staging`; in the variables table add `uid` = `alpha`. Click `Create`. Dialog closes; pill reads `staging ▾` (auto-activated). Preview reads `→ resolves: {"id":"alpha"}` immediately. Confirms unified create flow (name + vars saved in one round-trip).
5. **Switch back to No environment.** Click `No environment` row → pill reads `No environment ▾`. Preview returns to `⚠ Unresolved: uid`. Click `staging` row → back to resolved.
6. **Per-row Edit (vars only).** Hover `staging` row → `⋮` → `Edit env…` → dialog opens in edit mode (header `Edit environment`, name `staging`, table shows `uid=alpha`). Add a second variable `lang=en`. Click `Save`. Dialog closes. Reopen the editor for `staging` — both vars persist. Preview unchanged (still `→ resolves: {"id":"alpha"}`; `lang` is defined but unused by the current body).
7. **Per-row Edit (rename in same dialog).** Hover `staging` row → `⋮` → `Edit env…` → change name from `staging` to `staging-eu` (vars left alone). `Save`. Pill now reads `staging-eu ▾` (active env was renamed → handover fired). Menu: `No environment`, `✓ staging-eu`. Confirms unified rename via the editor.
8. **Create second env.** «+ New env…» → name `prod`, leave vars empty → `Create`. Pill → `prod ▾` (auto-activated). Menu: `No environment`, `✓ prod`, `staging-eu`. Preview: `⚠ Unresolved: uid` (prod has no `uid`).
9. **Cross-env preview.** Click `staging-eu` row → preview restores `→ resolves: {"id":"alpha"}`. Click `prod` row → unresolved.
10. **Edit non-active env (rename + var change).** Active is `prod`. Hover `staging-eu` row → `⋮` → `Edit env…` → rename to `staging-eu-2`, add var `region=eu`. `Save`. Pill stays `prod ▾` (renaming a non-active row does not switch active). Menu: `No environment`, `✓ prod`, `staging-eu-2`.
11. **Per-row Delete (inactive target).** Hover `staging-eu-2` row → `⋮` → `Delete env…` → confirm → `Delete`. Pill stays `prod ▾`. Menu: `No environment`, `✓ prod`.
12. **Per-row Delete (active target).** Hover `prod` row → `⋮` → `Delete env…` → confirm → `Delete`. Frontend pre-switches active to `null`, then backend deletes `prod`. Pill reads `No environment ▾`. Menu: `✓ No environment`. No real envs left, but no «last-env» error fires.
13. **Validation.** «+ New env…» → `1bad` → red border, `Create` disabled. `No environment` (with space) → red border (regex rejects space). In edit mode, leaving the name unchanged is **not** flagged as duplicate (no-op self-name). Typing the name of another existing env in either mode → red border + helper «name already exists», `Save`/`Create` disabled.
14. **Hotkey.** `⌘E` (macOS) or `Ctrl+E` (Windows) → dropdown opens, first row focused. ↓ moves focus, Enter switches. → opens the focused row's submenu (only for real env rows); on `No environment` row, → is a no-op. ← closes the submenu. Esc closes the menu.
15. **Esc behaviour.** Open any dialog → Esc → closes without persisting input. Open the per-row submenu → Esc → only the submenu closes, outer menu stays open. Esc again → outer menu closes.
16. **Regression.** Body editor `{{var}}` highlighting still works. Send with `active = some env` and a resolvable body still posts to server. Send with `active = None` and a body containing `{{var}}` is blocked by the existing unresolved-vars guard in `handleSend` (toast «Unresolved variables: …»). Ctrl+Enter still sends.

### 7.7 Cross-platform smoke

Hotkey: macOS Cmd vs Windows Ctrl is handled by the `e.metaKey || e.ctrlKey` check. Must verify on at least one of each. On Windows (current dev machine), `Ctrl+E` works. macOS verification pending or deferred to errata if not exercisable.

## 8. Error wiring

| Trigger | `CoreError` | `IpcError` | UI surface |
|---|---|---|---|
| `env_delete` on active env | `InvalidTarget("cannot delete active env `{name}`; switch first")` | `InvalidTarget { message }` | Confirm dialog footer error strip; UI auto-switches active to `None` before delete, so should never fire. |
| `env_delete` on missing env | `delete` is idempotent (returns `Ok`) — no error. | n/a | n/a |
| `env_upsert` invalid name | `InvalidTarget("invalid env name: ...")` | `InvalidTarget { message }` | EnvEditorDialog footer error strip. Client-side validation prevents reaching the IPC in practice. |
| `env_active_set Some(name)` missing env | `InvalidTarget("no such env: ...")` | `InvalidTarget { message }` | Toast in App.tsx (existing handler). |
| `env_active_set(None)` | infallible | n/a | n/a |

**No new `CoreError` / `IpcError` variants.** The exhaustive-match test stays green without edits.

## 9. Open risks and mitigation

| # | Risk | Mitigation |
|---|---|---|
| R1 | ⌘E global handler swallows Monaco's built-in `editor.action.toggleTabFocusMode` (mapped to Ctrl+M on default Monaco, but other commands use Ctrl+E in some keymaps). | Accept for MVP; revisit if users report. Could narrow scope via `e.target` check excluding the editor container. |
| R2 | Rename non-atomicity: between `env_upsert(new)` and `env_delete(old)` a parallel `env_active_get` call could see both envs. Trivial under single-user MVP. | Documented; not blocking. |
| R3 | Plan #4 frontend code (notably the soon-to-be-renamed `EditEnvDialog` and `App.tsx`) assumes `activeEnv` is always a non-empty string. After the signature widening, code paths that consume `activeEnv` without a null check could throw. | Implementation task explicitly audits and updates all consumers of `activeEnv`. The compiler/`tsc` catches most via the `string \| null` type. Pre-merge `pnpm lint` is the gate. |
| R4 | shadcn add invocations (`dropdown-menu`, `alert-dialog`) pull additional radix dependencies that bloat the Monaco-isolated bundle. | radix-ui meta-package is already in deps; shadcn `add` only generates wrappers. No measurable bundle delta expected. |
| R5 | Confirm dialog on Delete is good UX but adds a click for power users. | Acceptable — env deletion is destructive in spirit (loses variables) and infrequent. No «don't ask again» checkbox to keep state surface small. |
| R6 | tauri-specta bindings regeneration drift — adding 1 command. | Standard `cargo run -p handshaker --bin export-bindings` step; `pnpm lint` (tsc -b) catches type drift in `client.ts`. |
| R7 | Nesting a `<DropdownMenu>` (for per-row actions) inside a `<DropdownMenuRadioGroup>` (for env switching) is a less-trodden radix pattern. Outer-menu click-outside handling could close both menus when the user clicks the ⋮; or vice versa, opening the inner menu could be blocked by the radio group's focus capture. | Mitigation in `EnvSwitcherMenu`: wrap the ⋮ button click handler with `e.stopPropagation()` (already specified in §5.1) so the outer radio-group doesn't interpret it as a row switch. radix's `DropdownMenu` portal renders the inner content in a separate stacking context, so click-outside on the inner menu does not propagate to the outer menu. If this combination misbehaves during smoke (§7.6), the documented fallback is to render env rows as plain `<div>` wrappers around a clickable name area and a separate `<DropdownMenu>` for the ⋮ — losing radix radio-group keyboard nav and requiring manual roving-tabindex. Pick during implementation. |

## 10. Implementation order (input to writing-plans)

Roughly TDD-friendly; `writing-plans` refines into tasks with subagent breakdown.

1. **Backend signature widening + bootstrap removal:**
   - `AppState`: `active_env: RwLock<Option<String>>`, default `None`. Drop the `with_default()` call — `env_store` is `InMemoryEnvironmentStore::new()`.
   - `commands/env.rs::env_active_get` → returns `Option<String>`.
   - `commands/env.rs::env_active_set` → takes `Option<String>`; passing `None` is always Ok.
   - `commands/vars.rs::vars_resolve` → treat `active = None` as empty var set.
   - Update the existing «active env in state» test from Plan #4 to use `Option` shape.
   - Regen bindings; existing client wrappers in `src/ipc/client.ts` get type-updated (env_active_get returns `string | null`, env_active_set accepts `string | null`).
   - `cargo test --workspace` green at this checkpoint.
2. **`env_delete` IPC command** + unit tests (active-env reject, success on inactive, success when only env is being deleted while active=None). Register in `collect_commands!`. Regen bindings.
3. **Frontend wrapper** `ipc.envDelete` in `src/ipc/client.ts`. Audit existing `activeEnv` consumers for null-safety (`App.tsx`, `EnvPill`, `EditEnvDialog` (about to be renamed), `InvokePanel`'s pass-through to `ResolvesPreview`). `pnpm lint` clean.
4. **shadcn add `dropdown-menu`, `alert-dialog`, `label`** (one `pnpm dlx shadcn@latest add dropdown-menu alert-dialog label` invocation). Verify they appear in `src/components/ui/`. Lint passes. Inherits `components.json` config from Plan #4 — no theme/style choice prompts.
5. **Rename `EditEnvDialog` → `EnvEditorDialog`** and expand its API:
   - Rename file `EditEnvDialog.tsx` → `EnvEditorDialog.tsx`. Update all imports.
   - Change props: `envName: string` → `originalName: string | null`. Add header that reads `New environment` (create mode) or `Edit environment` (edit mode); update Save button label accordingly.
   - Add a `Name` input ABOVE the `VariablesTable`. Real-time validation + duplicate detection per §5.2.
   - Replace the existing single-purpose `handleSave` with the unified branching handler (§5.2) — create / edit-no-rename / edit-with-rename.
   - Unit-level smoke (no Vitest, so just type-check + visual): open in create mode (empty), open in edit mode for an existing env, confirm vars and name preload.
6. **`EnvSwitcherMenu` component** — renders the menu shell: a non-removable `No environment` row at the top (Check icon when `activeEnv === null`, no ⋮), separator, real env rows with `Check` on active + trailing `⋮` revealed on row hover/focus, separator, and «+ New env…» at the bottom. Each `⋮` opens a per-row submenu with `Edit env…`, `Delete env…` placeholders that only log for now. Verify keyboard nav (↑↓ between rows, → / ← for submenu) works out of the box from radix; → on `No environment` is a no-op.
7. **Refactor `EnvPill`** to render `EnvSwitcherMenu` instead of opening `EnvEditorDialog` directly. Lift `envs` and `activeEnv` state into `App.tsx`. Pass them as props. When `activeEnv === null`, pill renders `No environment ▾`. Manual smoke: app boots with `No environment ▾`, opening the menu shows just the pseudo-row.
8. **Wire `EnvEditorDialog` to the menu:**
   - «+ New env…» → opens `EnvEditorDialog` with `originalName = null` (create mode).
   - Per-row `⋮ → Edit env…` → opens `EnvEditorDialog` with `originalName = row.name` (edit mode).
   - Manual smoke: can create env with vars in one shot; can edit vars without renaming; can rename (active and non-active) with vars preserved.
9. **`ConfirmDeleteEnvDialog`** — alert-dialog + active-env handover to `None`. Wire into menu. Manual smoke: can delete inactive, can delete active (falls back to `No environment`), can delete all envs (terminal state is `No environment`).
10. **`⌘E` / `Ctrl+E` hotkey** — global listener in `App.tsx` + ref to trigger. Smoke: opens dropdown.
11. **`activeEnv` prop to `ResolvesPreview`** — wire through `InvokePanel`. Smoke: switching env updates preview live; null activeEnv shows everything as unresolved.
12. **Full §7.6 smoke pass.** Fix issues. Iterate.
13. **Errata file** if any deviation surfaces.

## 11. Sources verified before submission

| Source | URL / path | Used for |
|---|---|---|
| Master spec §4 | `2026-05-26-handshaker-mvp-design.md` | env-MVP scope, persistence policy |
| Master spec §5.2 | local | `EnvironmentStore` trait shape — confirms no rename method |
| Master spec §6.2 | local | IPC command list — confirms `env_delete` and absence of `env_rename` |
| Master spec §6.3 | local | event list — confirms `ActiveEnvChanged` absent |
| Master spec §8.1 | local | header layout, pill placement |
| Master spec §9 | local | `⌘E` hotkey for env-switcher |
| Master spec §10.1 | local | optimistic switch + debounced persist policy |
| Plan #4 design §1.2 | `2026-05-27-plan-04-env-vars-design.md` | confirms exact OOS items being lifted |
| Plan #4 errata #2 | `../errata/2026-05-27-plan-04-env-vars.md` | `EnvironmentIpc.variables` `Partial<...>` shape — informs how dialogs read variables |
| shadcn dropdown-menu | <https://ui.shadcn.com/docs/components/dropdown-menu> | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent` (`align="end"`), `DropdownMenuLabel`, `DropdownMenuItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSeparator` |
| shadcn alert-dialog | <https://ui.shadcn.com/docs/components/alert-dialog> | `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, `AlertDialogAction` |
| shadcn alert-dialog destructive style | <https://ui.shadcn.com/docs/components/alert-dialog#destructive-style> | `buttonVariants({ variant: "destructive" })` pattern for `AlertDialogAction` |
| shadcn dialog | <https://ui.shadcn.com/docs/components/dialog> | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` — already in project from Plan #4, used by `EnvEditorDialog` |
| shadcn label | <https://ui.shadcn.com/docs/components/label> | `<Label htmlFor>` paired with `<Input>` for the Name field |
| shadcn theme (new-york dark) | <https://ui.shadcn.com/themes> + master §8.8 | the OKLCH palette already wired in `src/styles/globals.css`; no Plan #4b additions |
| radix DropdownMenu | <https://www.radix-ui.com/primitives/docs/components/dropdown-menu> | keyboard interaction (↑↓ Enter Esc, → / ← for submenus); event propagation semantics for nested DropdownMenu inside DropdownMenuRadioGroup |
| Postman docs «Managing environments» | <https://learning.postman.com/docs/sending-requests/variables/managing-environments/> | confirms «click the dropdown menu in the upper right … to select an active environment» pattern — row-click switches |
| Postman docs «Navigating Postman» | <https://learning.postman.com/docs/getting-started/basics/navigating-postman/> | confirms «hover over an item, it exposes View more actions» — basis for per-row `⋮` affordance |
| Memory rule `feedback_verify_technical_claims` | local | requires source citations |
| Memory rule `feedback_ui_transparent_mechanics` | local | confirms switcher dropdown is standard affordance, not an engine-state indicator |
| Memory rule `preference_subagent_driven_default` | local | execution mode after writing-plans |
