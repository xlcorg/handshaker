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
3. Click «+ New env…», type `staging`, save → env created, auto-activated. Pill reads `staging ▾`.
4. Reopen menu → `No environment`, `✓ staging`. Click `No environment` row → switches back to no-env. Pill reads `No environment ▾`. Click `staging` row → switches back.
5. With active = `staging`, hover `staging` row → `⋮` → «Edit variables…» → add `uid=alpha`. Save. Body `{{uid}}` preview now shows `→ resolves: {"...":"alpha"}`.
6. Create a second env `prod`. Hover `prod` row → `⋮` → «Rename env…» → `prod-eu` → Save. Menu shows `No environment`, `✓ prod-eu` (was created last and auto-activated), `staging`. Variables on the renamed env preserved.
7. Hover `staging` row → `⋮` → «Delete env…» → confirm dialog → Delete. Active stays `prod-eu`. Menu shows `No environment`, `✓ prod-eu`.
8. Delete the active env: hover `prod-eu` row → `⋮` → «Delete env…» → Delete. Frontend pre-switches active to `No environment` (since target was active), then `env_delete(prod-eu)`. Pill reads `No environment ▾`. Menu shows just `✓ No environment`.
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
   - `EnvSwitcherMenu` component (replaces direct EditEnvDialog trigger inside `EnvPill`).
   - `NewEnvDialog` — single name input + Save.
   - `RenameEnvDialog` — current name (read-only) + new name input + Save. Composed on the frontend via `env_upsert` + `env_active_set` + `env_delete` (non-atomic; in-memory storage makes failure-during-composition negligible).
   - `ConfirmDeleteEnvDialog` — shadcn AlertDialog with destructive «Delete» button. «Variables will be lost.»
   - `EnvPill` rebuilt around the new menu; existing `Edit variables…` flow lands as one of the menu items.
   - `⌘E` / `Ctrl+E` hotkey opens the dropdown — global keyboard listener in `App.tsx`.
3. **State plumbing:**
   - `App.tsx` becomes the owner of the `envs: EnvironmentIpc[]` list + `activeEnv: string | null`. Pill consumes both via props. `null` ≡ "No environment".
   - List refreshes on mount + after every mutation reply.
   - `activeEnv` propagated as a prop to `InvokePanel` → `ResolvesPreview` so the latter re-fires `vars_resolve` when env switches (live preview updates without page reload). When `activeEnv === null`, the preview line still calls `vars_resolve` and renders the unresolved-vars warning (consistent with «No environment» semantics).

### 1.2 Out of scope (explicit deferrals)

- **`env_rename` IPC command.** Frontend-composed rename keeps us strictly aligned with master §5.2 / §6.2. If a future plan needs atomic rename (e.g. file-backed `EnvironmentStore` where write fanout is expensive), it gets added as a documented master-spec extension at that point.
- **`ActiveEnvChanged` event.** Decided not needed for MVP single-window scope (Q3 of brainstorm). `App.tsx` owns the active-env string and propagates via props; backend stays the source of truth queried at next `vars_resolve` / `env_active_get`. Master §6.3 does not list this event.
- **Variables-table-inline switcher** (e.g. inside `EditEnvDialog`). The dialog continues to edit only the env it was opened for. Switching envs always happens through the header pill. Keeps mental model simple.
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
    EnvSwitcherMenu.tsx         NEW    — DropdownMenu composition
    NewEnvDialog.tsx            NEW    — single name input
    RenameEnvDialog.tsx         NEW    — old/new name inputs
    ConfirmDeleteEnvDialog.tsx  NEW    — AlertDialog
    EditEnvDialog.tsx           UNCHANGED
    VariablesTable.tsx          UNCHANGED
  features/invoke/
    ResolvesPreview.tsx         MODIFY — add activeEnv to useEffect deps
    InvokePanel.tsx             MODIFY — pass activeEnv prop down
  components/ui/
    dropdown-menu.tsx           NEW (shadcn add)
    alert-dialog.tsx            NEW (shadcn add)
  ipc/
    client.ts                   MODIFY — typed wrapper envDelete
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
                          │  Edit variables…          │
                          │  Rename env…              │
                          │  Delete env… (red)        │
                          └──────────────────────────┘
```

- Pill itself stays a `Button variant="ghost" size="sm"` showing the active env name (or `No environment` when active is `null`) + `▾` chevron icon. Pill click → opens `EnvSwitcherMenu`.
- **«No environment» pseudo-row (always at the top, separator below):**
  - Renders the literal text `No environment` in `text-muted-foreground` italic style to distinguish from real envs.
  - Click → calls `ipc.envActiveSet(null)` and `setActiveEnv(null)` in `App.tsx`. Pill becomes `No environment ▾`. Menu closes.
  - `Check` icon on the left when `activeEnv === null`.
  - **No trailing `⋮`** — not editable, not renamable, not deletable. The row is purely a switch target.
- **Env rows (real envs, direct manipulation):**
  - Sorted alphabetically.
  - **Click on the row body (name area)** → switches active to this env. Calls `ipc.envActiveSet(name)` and `setActiveEnv(name)` in `App.tsx`. Menu closes.
  - **Active row** carries a `Check` icon (lucide-react) on the left; non-active rows render a same-width placeholder for alignment.
  - **Trailing `⋮` icon** (lucide-react `MoreVertical`) is rendered with `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` — hidden by default, revealed on row hover or keyboard focus. The `⋮` is a separate clickable element from the row body.
  - **Click on `⋮`** → opens a nested per-row submenu anchored next to the icon (radix nested `DropdownMenu` via `DropdownMenuSub` or a separate `DropdownMenu` instance — implementation choice for writing-plans). Menu close on outer-row click is suppressed via `event.stopPropagation()` on the `⋮` button so the user can keep interacting with the parent menu.
- **Per-row submenu contents (act on THIS row's env, not necessarily the active one):**
  - «Edit variables…» — opens `EditEnvDialog` with `envName = row.name`.
  - «Rename env…» — opens `RenameEnvDialog` with `oldName = row.name`.
  - «Delete env…» — opens `ConfirmDeleteEnvDialog` with `target = row.name`. Styled `text-destructive`. **Always enabled** for real env rows (no last-env restriction — deleting the last real env just leaves `No environment` active).
- **Below the env list:**
  - Separator.
  - **«+ New env…»** — opens `NewEnvDialog`. Auto-activates the created env on success (matches Postman create-and-activate behavior).
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
  - ⌘E / Ctrl+E opens the menu (see §5.5).

#### 5.1.1 Direct manipulation rationale (Postman-style)

The «point at the thing, then act on it» model is what Postman uses and what users expect from environment switchers. The alternative considered was a single-level menu where Edit/Rename/Delete entries live below the env list and always act on the active env. Rejected for two reasons:

1. **Cross-env friction.** Deleting an inactive env would require: (a) click env to switch active → (b) reopen menu → (c) click «Delete env…». Three interactions plus an unwanted active-env switch as side effect. With per-row submenus: (a) hover row → (b) click ⋮ → (c) click Delete. Same step count without the side effect.
2. **Visual ambiguity.** «Delete env…» sitting below the env list raises the question «delete what?». Per-row `⋮` makes the target unambiguous because the menu is anchored to the row.

Trade-off accepted: a second menu level slightly complicates keyboard nav (radix `DropdownMenuSub` provides `→ ←` arrow keys to enter / leave the submenu, which is the standard cascade-menu convention).

### 5.2 `NewEnvDialog`

```
┌─ New env ────────────────────────────────────── × ┐
│                                                   │
│  Name:  [______________]                          │
│         (a-z, A-Z, 0-9, _ -; must start with      │
│          letter or _)                             │
│                                                   │
│                              [ Cancel ] [ Create ]│
└───────────────────────────────────────────────────┘
```

- shadcn `Dialog` (already added by Plan #4).
- Single `Input` for name. Real-time client-side validation: `^[a-zA-Z_][a-zA-Z0-9_-]*$`. Invalid → red border (matches `VariablesTable` style).
- Already-exists check is client-side: if `envs.some(e => e.name === input)` → red border + helper text «name already exists».
- `Create` button disabled when input empty, invalid, or duplicate.
- On `Create`: call `ipc.envUpsert({ name, variables: {} })`, then `ipc.envActiveSet(name)`, then in `App.tsx` `setActiveEnv(name)` and refetch `envs`. Close dialog. On error → inline footer error strip (same pattern as `EditEnvDialog`).
- Esc / Cancel / click-outside → discard.

### 5.3 `RenameEnvDialog`

```
┌─ Rename env ───────────────────────────────────── × ┐
│                                                     │
│  Current name:  prod                                │
│  New name:      [_______________]                   │
│                                                     │
│                             [ Cancel ] [ Rename ]   │
└─────────────────────────────────────────────────────┘
```

- Opened from a per-row `⋮` submenu (§5.1); the row's env is the rename target. The dialog operates on whichever env was clicked, **not** necessarily the active env. If the target happens to be active, the active-env handover lives in step 2 below.
- Same validation rules as `NewEnvDialog` for the new name input.
- Cannot rename to an existing name (other than the current — re-typing the same name is a no-op and just closes the dialog).
- `Rename` button disabled when input empty, invalid, or duplicate (excluding self).
- On `Rename` (frontend-composed, in order):
  1. `ipc.envUpsert({ name: newName, variables: <copy of old variables> })` — creates the renamed env.
  2. If `activeEnv === oldName` → `ipc.envActiveSet(newName)`.
  3. `ipc.envDelete(oldName)`.
  4. Refetch `envs` in `App.tsx`; `setActiveEnv(newName)` if was renaming active.
- Failure in step 1 → revert dialog, show inline error, no partial state. Failure in step 2 or 3 → toast «Rename partially failed: <error>. The new env exists; please remove the old one manually.» (extreme corner case under in-memory storage; documented for completeness rather than expected).
- Esc / Cancel → discard.

### 5.4 `ConfirmDeleteEnvDialog`

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
- shadcn `AlertDialog` (added in #4b).
- Title: «Delete env?». Description includes env name in `<code>` style.
- Buttons: `Cancel` (default), `Delete` (`destructive` variant).
- On `Delete` (frontend-composed):
  1. If `activeEnv === target` → switch active to `No environment`: `ipc.envActiveSet(null)`, `setActiveEnv(null)`.
  2. `ipc.envDelete(target)`.
  3. Refetch `envs` in `App.tsx`.
- Failure in step 1 or 2 → footer error strip; dialog stays open.
- Esc / Cancel → discard.

The active-env-switching guard at the backend (§4.2) means step 1 is mandatory when deleting the active env — otherwise step 2 fails with `InvalidTarget("cannot delete active env...")`. UI handles this transparently.

**Why switch to `No environment` rather than the first alphabetical remaining env?** Postman's behavior matches: deleting the active env drops you to «No Environment», not to an arbitrary neighbour. This is also more predictable: deleting a real env is a destructive op; auto-switching to another arbitrary env is a second mutation the user didn't request. «No environment» as the post-delete state lets the user explicitly pick the next active.

### 5.5 Global hotkey ⌘E / Ctrl+E

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

### 5.6 Visual style

- `EnvSwitcherMenu` uses shadcn `DropdownMenu` default classes (background `--popover`, border `--border`, foreground `--popover-foreground`).
- `DropdownMenuItem` for «Delete env…» — explicit `className="text-destructive focus:text-destructive focus:bg-destructive/10"` to make destructive intent obvious.
- The `No environment` row uses `text-muted-foreground italic` to distinguish it visually from real env names.
- `Check` icon on active env: `w-4 h-4 mr-2 text-foreground`. Non-active rows get `<span className="w-4 mr-2" />` placeholder for alignment.
- `AlertDialog` for delete uses shadcn defaults; destructive button class.
- `NewEnvDialog` / `RenameEnvDialog` inputs reuse the same `font-mono text-sm` styling as `VariablesTable` for consistency.

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

### 6.3 Create env

`NewEnvDialog.handleCreate(name)`:
1. `ipc.envUpsert({ name, variables: {} })`.
2. `ipc.envActiveSet(name)` (new envs auto-activate — convenient for «I want to start editing this one»).
3. `setActiveEnv(name)`.
4. `ipc.envList()` → `setEnvs`.
5. Close dialog.

### 6.4 Rename env

`RenameEnvDialog.handleRename(oldName, newName)`:
1. Look up `oldEnv = envs.find(e => e.name === oldName)`.
2. `ipc.envUpsert({ name: newName, variables: oldEnv.variables })`.
3. If `activeEnv === oldName`: `ipc.envActiveSet(newName)` and `setActiveEnv(newName)`.
4. `ipc.envDelete(oldName)`.
5. `ipc.envList()` → `setEnvs`.
6. Close dialog.

### 6.5 Delete env

`ConfirmDeleteEnvDialog.handleDelete(targetName)`:
1. If `activeEnv === targetName`:
   a. `ipc.envActiveSet(null)`.
   b. `setActiveEnv(null)`.  // post-delete state = "No environment"
2. `ipc.envDelete(targetName)`.
3. `ipc.envList()` → `setEnvs`.
4. Close dialog.

### 6.6 Edit variables

Per-row entry from §5.1: hover any real env row → `⋮` → «Edit variables…». Opens `EditEnvDialog` for `row.name`, which uses `ipc.envUpsert`. Active env does not change.

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
4. **Create first env.** Click «+ New env…» → type `staging` → Create. Dialog closes; pill reads `staging ▾` (auto-activated). Reopen menu: `No environment`, `✓ staging`. The `staging` row has `⋮` on hover; `No environment` does not.
5. **Switch back to No environment.** Click `No environment` row → pill reads `No environment ▾`. Preview returns to `⚠ Unresolved: uid`.
6. **Switch to env.** Click `staging` row → pill reads `staging ▾`. Preview: `⚠ Unresolved: uid` (staging is empty). Per-row Edit: hover `staging`, click `⋮` → `Edit variables…` → add `uid=alpha`. Save. Preview now: `→ resolves: {"id":"alpha"}`.
7. **Create second env.** «+ New env…» → `prod` → Create. Pill → `prod ▾` (auto-activated). Menu shows `No environment`, `✓ prod`, `staging`. Preview: `⚠ Unresolved: uid` (prod has no `uid`).
8. **Cross-env preview.** Click `staging` row → preview restores `→ resolves: {"id":"alpha"}`. Click `prod` row → unresolved again.
9. **Per-row Rename (non-active target).** Active is `prod`. Hover `staging` row → `⋮` → `Rename env…` → `staging-eu` → Save. Pill stays `prod ▾`. Menu shows `No environment`, `✓ prod`, `staging-eu`. Confirms renaming non-active does not switch.
10. **Per-row Delete (inactive target).** Hover `staging-eu` row → `⋮` → `Delete env…` → confirm → Delete. Pill remains `prod ▾`. Menu: `No environment`, `✓ prod`.
11. **Per-row Delete (active target).** Hover `prod` row → `⋮` → `Delete env…` → confirm → Delete. Frontend pre-switches active to `null` then backend deletes `prod`. Pill reads `No environment ▾`. Menu: `✓ No environment`. No real envs left, but no «last-env» error fires.
12. **Validation.** «+ New env…» → `1bad` → red border, `Create` disabled. Try `No environment` (with space) → red border (regex `^[a-zA-Z_][a-zA-Z0-9_-]*$` rejects the space — no special «reserved name» check needed, the literal pseudo-row label is grammatically un-creatable). Type a name that already exists, e.g. `staging` if it's present → red border + helper «name already exists», `Create` disabled.
13. **Hotkey.** `⌘E` (macOS) or `Ctrl+E` (Windows) → dropdown opens, first row focused. ↓ moves focus, Enter switches. → opens the focused row's submenu (only for real env rows); on `No environment` row, → is a no-op. ← closes the submenu. Esc closes the menu.
14. **Esc behaviour.** Open any dialog → Esc → closes without persisting input. Open the per-row submenu → Esc → only the submenu closes, outer menu stays open. Esc again → outer menu closes.
15. **Regression.** Body editor `{{var}}` highlighting still works. Send with `active = some env` and a resolvable body still posts to server. Send with `active = None` and a body containing `{{var}}` is blocked by the existing unresolved-vars guard in `handleSend` (toast «Unresolved variables: …»). Ctrl+Enter still sends.

### 7.7 Cross-platform smoke

Hotkey: macOS Cmd vs Windows Ctrl is handled by the `e.metaKey || e.ctrlKey` check. Must verify on at least one of each. On Windows (current dev machine), `Ctrl+E` works. macOS verification pending or deferred to errata if not exercisable.

## 8. Error wiring

| Trigger | `CoreError` | `IpcError` | UI surface |
|---|---|---|---|
| `env_delete` on active env | `InvalidTarget("cannot delete active env `{name}`; switch first")` | `InvalidTarget { message }` | Confirm dialog footer error strip; UI auto-switches active to `None` before delete, so should never fire. |
| `env_delete` on missing env | `delete` is idempotent (returns `Ok`) — no error. | n/a | n/a |
| `env_upsert` invalid name | `InvalidTarget("invalid env name: ...")` | `InvalidTarget { message }` | NewEnvDialog / RenameEnvDialog footer error strip. Client-side validation prevents reaching the IPC in practice. |
| `env_active_set Some(name)` missing env | `InvalidTarget("no such env: ...")` | `InvalidTarget { message }` | Toast in App.tsx (existing handler). |
| `env_active_set(None)` | infallible | n/a | n/a |

**No new `CoreError` / `IpcError` variants.** The exhaustive-match test stays green without edits.

## 9. Open risks and mitigation

| # | Risk | Mitigation |
|---|---|---|
| R1 | ⌘E global handler swallows Monaco's built-in `editor.action.toggleTabFocusMode` (mapped to Ctrl+M on default Monaco, but other commands use Ctrl+E in some keymaps). | Accept for MVP; revisit if users report. Could narrow scope via `e.target` check excluding the editor container. |
| R2 | Rename non-atomicity: between `env_upsert(new)` and `env_delete(old)` a parallel `env_active_get` call could see both envs. Trivial under single-user MVP. | Documented; not blocking. |
| R3 | Plan #4 frontend code (e.g. `EditEnvDialog`) assumes `activeEnv` is always a non-empty string. After the signature widening, code paths that consume `activeEnv` without a null check could throw. | Implementation task explicitly audits and updates all consumers of `activeEnv`. The compiler/`tsc` catches most via the `string \| null` type. Pre-merge `pnpm lint` is the gate. |
| R4 | shadcn add invocations (`dropdown-menu`, `alert-dialog`) pull additional radix dependencies that bloat the Monaco-isolated bundle. | radix-ui meta-package is already in deps; shadcn `add` only generates wrappers. No measurable bundle delta expected. |
| R5 | Confirm dialog on Delete is good UX but adds a click for power users. | Acceptable — env deletion is destructive in spirit (loses variables) and infrequent. No «don't ask again» checkbox to keep state surface small. |
| R6 | tauri-specta bindings regeneration drift — adding 1 command. | Standard `cargo run -p handshaker --bin export-bindings` step; `pnpm lint` (tsc -b) catches type drift in `client.ts`. |
| R7 | «Row click switches + ⋮ click opens submenu» is unusual for a radix `DropdownMenu`. Naively nesting two click targets inside `DropdownMenuItem` either swallows the row click or fires both handlers. | Two acceptable implementations: (a) render env rows as plain `<div>` (not `DropdownMenuItem`) with a left clickable area for switch and a right `Button` that triggers a separate nested `DropdownMenu` for actions — loses radix's auto ↑↓ focus management and needs a small manual roving-tabindex implementation; (b) use `DropdownMenuSub` so the entire row is a sub-trigger that opens the actions submenu, and put «Switch to this env» as the first item inside the submenu — costs one extra click for the most common op (switch). Recommend (a) for fidelity to Postman; pick during writing-plans based on implementation cost. |

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
3. **Frontend wrapper** `ipc.envDelete` in `src/ipc/client.ts`. Audit existing `activeEnv` consumers for null-safety (`App.tsx`, `EnvPill`, `EditEnvDialog`, `InvokePanel`'s pass-through to `ResolvesPreview`). `pnpm lint` clean.
4. **shadcn add `dropdown-menu` and `alert-dialog`**. Verify they appear in `src/components/ui/`. Lint passes.
5. **`EnvSwitcherMenu` component** — renders the menu shell: a non-removable `No environment` row at the top (Check icon when `activeEnv === null`, no ⋮), separator, real env rows with `Check` on active + trailing `⋮` revealed on row hover/focus, separator, and «+ New env…» at the bottom. Each `⋮` opens a per-row submenu with `Edit variables…`, `Rename env…`, `Delete env…` placeholders that only log for now. Verify keyboard nav (↑↓ between rows, → / ← for submenu) works out of the box from radix; → on `No environment` is a no-op.
6. **Refactor `EnvPill`** to render `EnvSwitcherMenu` instead of opening `EditEnvDialog` directly. Lift `envs` and `activeEnv` state into `App.tsx`. Pass them as props. When `activeEnv === null`, pill renders `No environment ▾`. Wire the per-row `Edit variables…` to the existing `EditEnvDialog` (passing `envName = row.name`) — regression gate against Plan #4: the prior «click pill → opens Edit» path is gone, replaced by per-row Edit. Manual smoke: app boots with `No environment ▾`, opening the menu shows just the pseudo-row.
7. **`NewEnvDialog`** — name validation, create + activate flow. Wire into `EnvSwitcherMenu`. Manual smoke: can create env from `No environment` state; pill switches to new env.
8. **`RenameEnvDialog`** — composed rename. Wire into menu. Manual smoke: can rename, variables preserved.
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
| shadcn dropdown-menu | <https://ui.shadcn.com/docs/components/dropdown-menu> | menu primitive + `align="end"` API |
| shadcn alert-dialog | <https://ui.shadcn.com/docs/components/alert-dialog> | confirm dialog pattern, destructive button styling |
| radix DropdownMenu | <https://www.radix-ui.com/primitives/docs/components/dropdown-menu> | keyboard interaction (↑↓ Enter Esc, → / ← for submenus) and `disabled` semantics; `DropdownMenuSub` for per-row submenus |
| Postman docs «Managing environments» | <https://learning.postman.com/docs/sending-requests/variables/managing-environments/> | confirms «click the dropdown menu in the upper right … to select an active environment» pattern — row-click switches |
| Postman docs «Navigating Postman» | <https://learning.postman.com/docs/getting-started/basics/navigating-postman/> | confirms «hover over an item, it exposes View more actions» — basis for per-row `⋮` affordance |
| Memory rule `feedback_verify_technical_claims` | local | requires source citations |
| Memory rule `feedback_ui_transparent_mechanics` | local | confirms switcher dropdown is standard affordance, not an engine-state indicator |
| Memory rule `preference_subagent_driven_default` | local | execution mode after writing-plans |
