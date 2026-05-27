# Plan #4b — Multi-env switcher (Design)

**Date:** 2026-05-27
**Branch (suggested):** `claude/plan-04b-multi-env-switcher`
**Realizes spec rules:**
- Master §4 line 137 — relax «одна Default env в MVP» constraint to multi-env (with single Default still as bootstrap).
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

**Goal:** turn the header env-pill from a single-purpose "edit Default's variables" trigger into a real multi-env switcher with create / rename / delete CRUD. Backend gains exactly one new IPC command (`env_delete`); the bulk of the work is frontend (dropdown menu + three small dialogs + hotkey).

**Acceptance:** in the running app, the user can:
1. Click the header pill → see a dropdown listing `Default` with a check icon.
2. Pick «+ New env…», type `staging`, save → new env is created, becomes active, pill reads `staging ▾`.
3. Reopen the dropdown → both envs listed; click `Default` → switches back, ResolvesPreview re-renders with Default's variables.
4. Pick «Rename env…» on `staging`, type `prod`, save → pill now reads `prod ▾`; variables preserved.
5. Pick «Delete env…» on `prod`, confirm → env removed; active falls back to `Default`.
6. Try Delete on the last env → menu item is disabled; backend would reject anyway with `InvalidTarget`.
7. `⌘E` / `Ctrl+E` opens the dropdown menu (focus first item, ↑↓ navigates, Enter selects, Esc closes).

### 1.1 In scope

1. **Backend:** add `env_delete` IPC command (single line of new logic). Register in `collect_commands!`. Last-env protection — `InMemoryEnvironmentStore::delete` already idempotent; we add the «cannot delete the only env» guard at the IPC layer (frontend disables the menu item too, so this is defense-in-depth, not the primary UX).
2. **Frontend:**
   - shadcn add `dropdown-menu` and `alert-dialog`.
   - `EnvSwitcherMenu` component (replaces direct EditEnvDialog trigger inside `EnvPill`).
   - `NewEnvDialog` — single name input + Save.
   - `RenameEnvDialog` — current name (read-only) + new name input + Save. Composed on the frontend via `env_upsert` + `env_active_set` + `env_delete` (non-atomic; in-memory storage makes failure-during-composition negligible).
   - `ConfirmDeleteEnvDialog` — shadcn AlertDialog with destructive «Delete» button. «Variables will be lost.»
   - `EnvPill` rebuilt around the new menu; existing `Edit variables…` flow lands as one of the menu items.
   - `⌘E` / `Ctrl+E` hotkey opens the dropdown — global keyboard listener in `App.tsx`.
3. **State plumbing:**
   - `App.tsx` becomes the owner of the `envs: EnvironmentIpc[]` list + `activeEnv: string`. Pill consumes both via props.
   - List refreshes on mount + after every mutation reply.
   - `activeEnv` propagated as a prop to `InvokePanel` → `ResolvesPreview` so the latter re-fires `vars_resolve` when env switches (live preview updates without page reload).

### 1.2 Out of scope (explicit deferrals)

- **`env_rename` IPC command.** Frontend-composed rename keeps us strictly aligned with master §5.2 / §6.2. If a future plan needs atomic rename (e.g. file-backed `EnvironmentStore` where write fanout is expensive), it gets added as a documented master-spec extension at that point.
- **`ActiveEnvChanged` event.** Decided not needed for MVP single-window scope (Q3 of brainstorm). `App.tsx` owns the active-env string and propagates via props; backend stays the source of truth queried at next `vars_resolve` / `env_active_get`. Master §6.3 does not list this event.
- **Variables-table-inline switcher** (e.g. inside `EditEnvDialog`). The dialog continues to edit only the env it was opened for. Switching envs always happens through the header pill. Keeps mental model simple.
- **Persistence to disk.** Master §4 line 148 — in-memory only in MVP.
- **Bulk import/export of envs.** Out of MVP scope.
- **Env-level «active» persistence across app restarts.** Active env is also in-memory; restart resets to `Default`.
- **Auth-per-env editing.** Lands with Plan #5.
- **Variables at Collection scope.** Lands with Plan #6.

## 2. Architecture — three layers

### 2.1 Core (`crates/handshaker-core/src/env/`)

**No changes.** The trait already exposes `list / get / upsert / delete` exactly as master §5.2 prescribes, and `InMemoryEnvironmentStore` already implements all four. `delete` is currently idempotent (silently succeeds on missing name) — kept as-is; the «cannot delete only env» rule lives at the IPC boundary.

Trade-off considered: pushing the last-env guard into `InMemoryEnvironmentStore::delete` would let any other consumer (e.g. a future `FileEnvironmentStore`) inherit the invariant for free. Rejected: it couples core to a UX rule that's MVP-specific. A persistent-storage variant might want to allow deleting all envs and ship «no envs» state to the UI. Keep core dumb, enforce at IPC.

### 2.2 src-tauri (`src-tauri/src/`)

```
src/
  commands/env.rs    MODIFY — add #[tauri::command] env_delete
  ipc/env.rs         UNCHANGED — types stay the same
  state.rs           UNCHANGED — active_env: RwLock<String> already in place
  lib.rs             MODIFY — register env_delete in collect_commands![]
```

That's the entirety of the Rust delta. Estimated ≤ 30 lines including tests.

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

## 4. IPC contract

### 4.1 Commands (after Plan #4b)

| Command | Args | Return | Status |
|---|---|---|---|
| `env_list` | — | `Vec<EnvironmentIpc>` | unchanged (Plan #4) |
| `env_active_get` | — | `String` | unchanged (Plan #4) |
| `env_active_set` | `name: String` | `()` | unchanged (Plan #4) |
| `env_upsert` | `env: EnvironmentIpc` | `()` | unchanged (Plan #4) |
| `env_delete` | `name: String` | `()` | **NEW** |
| `vars_resolve` | `template: String` | `ResolutionReportIpc` | unchanged (Plan #4) |

### 4.2 `env_delete` semantics

```rust
#[tauri::command]
#[specta::specta]
pub async fn env_delete(state: State<'_, AppState>, name: String) -> Result<(), IpcError> {
    // Last-env guard. Defense-in-depth — UI disables the menu item too.
    let envs = state.env_store.list();
    if envs.len() <= 1 {
        return Err(handshaker_core::error::CoreError::InvalidTarget(
            "cannot delete the only env".to_string(),
        ).into());
    }
    // Active-env guard. Frontend is expected to env_active_set before delete
    // when targeting the active env. We refuse to delete the currently active
    // env to keep the invariant "active always exists" trivial.
    let active = state.active_env.read().await.clone();
    if active == name {
        return Err(handshaker_core::error::CoreError::InvalidTarget(format!(
            "cannot delete active env `{name}`; switch first"
        )).into());
    }
    state.env_store.delete(&name).map_err(IpcError::from)
}
```

**Why guard «can't delete active»?** Two options were considered:
- (a) Auto-pick a new active in the backend and switch silently. Requires the command to return the new active name to avoid a follow-up `env_active_get` round-trip — deviates from master §6.2 signature `env_delete(name)`.
- (b) Refuse with `InvalidTarget`, force frontend to compose `env_active_set(other) → env_delete(target)`. Stays exactly within master's signature. Frontend orchestration is trivial.

Chose (b). The frontend already composes the delete-active sequence in `ConfirmDeleteEnvDialog.handleConfirm`.

### 4.3 Events

**None added.** As decided in Q3 of brainstorm, env switching propagates through React props from `App.tsx` down to consumers. Master §6.3 does not list `ActiveEnvChanged`.

### 4.4 Error mapping

All paths reuse existing `IpcError` variants:
- `env_delete` last-env / active-env / invalid-name → `IpcError::InvalidTarget { message }`.
- `env_upsert` invalid name → `IpcError::InvalidTarget { message }` (existing).
- `env_active_set` missing env → `IpcError::InvalidTarget { message }` (existing).

The `from_core_error_exhaustive` test in `src-tauri/src/ipc/error.rs` (Plan #1) needs **no update**.

## 5. UI surface

### 5.1 Header — `EnvPill` + `EnvSwitcherMenu`

```
┌──────────────────────────────────────────────────────────┐
│  Handshaker                              prod ▾          │
└──────────────────────────────────────────────────────────┘
                                          │
                                          ▼  (click or ⌘E)
                                  ┌──────────────────────┐
                                  │  ✓ Default            │
                                  │    prod               │
                                  │    staging            │
                                  │  ────────────────────  │
                                  │  Edit variables…       │
                                  │  Rename env…           │
                                  │  Delete env… (red, off│ ← disabled if envs.length===1
                                  │  ────────────────────  │
                                  │  + New env…            │
                                  └──────────────────────┘
```

- Pill itself stays a `Button variant="ghost" size="sm"` with the active env name + `▾` chevron icon.
- Click → DropdownMenu opens. Default trigger affordance from `radix-ui DropdownMenu`.
- Menu items, top to bottom:
  - **Env list.** One `DropdownMenuItem` per env, alphabetically sorted. Active env carries a `Check` icon (lucide-react) on the left; the others have a same-width placeholder (preserves text alignment). Click → calls `ipc.envActiveSet(name)` and `setActiveEnv(name)` in App.tsx state. No confirm.
  - **Separator.**
  - **«Edit variables…»** — opens the existing `EditEnvDialog` for the **currently active** env (matches Plan #4 behavior).
  - **«Rename env…»** — opens `RenameEnvDialog` for the **currently active** env.
  - **«Delete env…»** — opens `ConfirmDeleteEnvDialog` for the **currently active** env. Styled with `text-destructive`. Disabled (`grayed out` via `DropdownMenuItem disabled`) when `envs.length === 1`.
  - **Separator.**
  - **«+ New env…»** — opens `NewEnvDialog`.
- Width: matches the longest env name + chevron, no horizontal scrolling.
- Position: anchored under the pill, right-aligned (use radix `align="end"`).
- Keyboard: provided by radix. ↑↓ navigates, Enter activates, Esc closes. ⌘E to open lands in `App.tsx` (see §5.5).

#### 5.1.1 Why three actions act on «currently active» rather than per-row?

Considered: per-row actions (each env row has trailing ⋮ icon with Edit/Rename/Delete submenu) — more direct manipulation but heavier visually and harder to keyboard-navigate (two-level menu). The chosen single-level «active acts» pattern lines up with Postman's environment manager (which also operates on the active selection) and keeps the menu narrow.

Switching is fast: click env → it becomes active → reopen menu → Edit/Rename/Delete apply to that env. Two clicks per cross-env op, same as direct manipulation if you count the trailing ⋮ click.

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

- shadcn `AlertDialog` (added in #4b).
- Title: «Delete env?». Description includes env name in `<code>` style.
- Buttons: `Cancel` (default), `Delete` (`destructive` variant).
- On `Delete` (frontend-composed):
  1. If `activeEnv === target` → pick a new active: `firstAlphabetical = envs.filter(e => e.name !== target).map(e => e.name).sort()[0]`. Call `ipc.envActiveSet(firstAlphabetical)`, `setActiveEnv(firstAlphabetical)`.
  2. `ipc.envDelete(target)`.
  3. Refetch `envs` in `App.tsx`.
- Failure in step 1 or 2 → footer error strip; dialog stays open.
- Esc / Cancel → discard.

The active-env-switching guard at the backend (§4.2) means step 1 is mandatory when deleting the active env — otherwise step 2 fails with `InvalidTarget("cannot delete active env...")`. UI handles this transparently.

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
- `DropdownMenuItem disabled` (when envs.length === 1) inherits shadcn's reduced opacity automatically.
- `Check` icon on active env: `w-4 h-4 mr-2 text-foreground`. Non-active rows get `<span className="w-4 mr-2" />` placeholder for alignment.
- `AlertDialog` for delete uses shadcn defaults; destructive button class.
- `NewEnvDialog` / `RenameEnvDialog` inputs reuse the same `font-mono text-sm` styling as `VariablesTable` for consistency.

## 6. Data flow

### 6.1 Initial load

1. `App.tsx` mount effect (existing): `ipc.envActiveGet()` → `setActiveEnv`.
2. NEW: `App.tsx` mount effect: `ipc.envList()` → `setEnvs`.
3. `<EnvPill envs={envs} activeEnv={activeEnv} onChange={refresh} />` — pill renders.

### 6.2 Switch active env

1. User clicks env row in `EnvSwitcherMenu`.
2. Menu callback: `setActiveEnv(name)` (optimistic, sync), then fire-and-forget `ipc.envActiveSet(name)` from the click handler. No `await` blocking the render — the optimistic UI update happens immediately and the IPC call resolves in the background.
3. `activeEnv` prop change propagates to `InvokePanel` → `ResolvesPreview` → `useEffect` deps trigger → `ipc.varsResolve(body)` re-fires with the new active env.

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
   a. `newActive = envs.filter(e => e.name !== targetName).map(e => e.name).sort()[0]`.
   b. `ipc.envActiveSet(newActive)`.
   c. `setActiveEnv(newActive)`.
2. `ipc.envDelete(targetName)`.
3. `ipc.envList()` → `setEnvs`.
4. Close dialog.

### 6.6 Edit variables

Unchanged from Plan #4 — opens `EditEnvDialog` for `activeEnv`, which uses `ipc.envUpsert`.

## 7. Testing strategy

### 7.1 Core unit tests

**None added** — no core changes.

### 7.2 src-tauri unit tests

| File | Test |
|---|---|
| `src-tauri/src/commands/env.rs` (add a new `#[cfg(test)] mod tests`; the file currently has no test module) | `env_delete_rejects_when_only_one_env` |
| | `env_delete_rejects_when_target_is_active` |
| | `env_delete_succeeds_for_inactive_non_last` |

Setup helper: `fn build_state_with(envs: &[(&str, &[(&str, &str)])], active: &str) -> AppState`. Uses `InMemoryEnvironmentStore::new()` then upserts each.

The «no tauri test infra» constraint from Plan #4 §9 still applies: we test the command function directly with a constructed `AppState`, not through Tauri's full IPC plumbing.

### 7.3 Integration tests

No new integration test file. Existing `vars_end_to_end.rs` is independent and still passes.

### 7.4 Frontend tests

Still no Vitest in the project. Continue manual smoke (§7.6).

### 7.5 `cargo test --workspace`

Should grow from current `76 passed, 1 ignored, 0 failed` to `~79 passed, 1 ignored, 0 failed` (3 new src-tauri tests in §7.2).

### 7.6 Manual UI smoke

Run against `127.0.0.1:5002` (Notex testbed) per handoff §10:

1. `pnpm tauri dev`. App boots; pill reads `Default ▾`.
2. **Open dropdown.** Click pill → menu opens. `✓ Default` visible. «Delete env…» disabled (envs.length === 1).
3. **Create.** «+ New env…» → type `staging` → Create. Dialog closes; pill reads `staging ▾`. Reopen menu: `Default`, `✓ staging`.
4. **Switch.** Click `Default` in menu → pill reads `Default ▾`. Reopen: `✓ Default`, `staging`.
5. **Edit variables.** Pick a method, type body with `{{uid}}`. Open Default's `Edit variables…` → add `uid=alpha`. Save. Preview shows `→ resolves: {"user_id":"alpha"}`.
6. **Cross-env preview.** Switch to `staging` via menu → preview turns to `⚠ Unresolved: uid` (staging has no `uid`). Switch back → preview restores. Confirms activeEnv → ResolvesPreview prop wiring.
7. **Rename.** Switch to `staging`, open menu → «Rename env…» → new name `prod` → Save. Pill reads `prod ▾`. Reopen menu: `Default`, `✓ prod`.
8. **Delete env (full flow).** State: `Default`, `✓ prod`. «Delete env…» acts on active (`prod`); to remove `Default` instead, first click `Default` in the menu → active = `Default`. Reopen menu: `✓ Default`, `prod`. Click «Delete env…» → confirm dialog. Click `Delete` → frontend pre-switches active to `prod` (only remaining choice), backend then deletes `Default`. Pill reads `prod ▾`. Reopen menu: only `✓ prod`. «Delete env…» is disabled (last env).
9. **Validation.** «+ New env…» → name `1bad` → red border, Create disabled. Type `Default` (when Default exists earlier in flow) → red border, helper text «name already exists», Create disabled.
10. **Hotkey.** `⌘E` (macOS) or `Ctrl+E` (Windows) → dropdown opens, first item focused. ↓↓ Enter → switches.
11. **Esc.** Open any dialog → Esc → closes, no state change.
12. **Regression.** Body editor `{{var}}` highlighting still works. Send still resolves and posts to server. Ctrl+Enter still sends.

### 7.7 Cross-platform smoke

Hotkey: macOS Cmd vs Windows Ctrl is handled by the `e.metaKey || e.ctrlKey` check. Must verify on at least one of each. On Windows (current dev machine), `Ctrl+E` works. macOS verification pending or deferred to errata if not exercisable.

## 8. Error wiring

| Trigger | `CoreError` | `IpcError` | UI surface |
|---|---|---|---|
| `env_delete` on last env | `InvalidTarget("cannot delete the only env")` | `InvalidTarget { message }` | Confirm dialog footer error strip; should never fire if UI disables menu item correctly. |
| `env_delete` on active env | `InvalidTarget("cannot delete active env `{name}`; switch first")` | `InvalidTarget { message }` | Same. UI auto-switches before delete, so should never fire. |
| `env_delete` on missing env | `delete` is idempotent (returns `Ok`) — no error. | n/a | n/a |
| `env_upsert` invalid name | `InvalidTarget("invalid env name: ...")` | `InvalidTarget { message }` | NewEnvDialog / RenameEnvDialog footer error strip. Client-side validation prevents reaching the IPC in practice. |
| `env_active_set` missing env | `InvalidTarget("no such env: ...")` | `InvalidTarget { message }` | Toast in App.tsx (existing handler). |

**No new `CoreError` / `IpcError` variants.** The exhaustive-match test stays green without edits.

## 9. Open risks and mitigation

| # | Risk | Mitigation |
|---|---|---|
| R1 | ⌘E global handler swallows Monaco's built-in `editor.action.toggleTabFocusMode` (mapped to Ctrl+M on default Monaco, but other commands use Ctrl+E in some keymaps). | Accept for MVP; revisit if users report. Could narrow scope via `e.target` check excluding the editor container. |
| R2 | Rename non-atomicity: between `env_upsert(new)` and `env_delete(old)` a parallel `env_active_get` call could see both envs. Trivial under single-user MVP. | Documented; not blocking. |
| R3 | Frontend «can't delete last env» check (`envs.length === 1`) drifts from backend after refetch race. | Backend guard catches it; UI shows footer error. Stale optimistic UI is corrected by `env_list` refetch in the next mutation cycle. |
| R4 | shadcn add invocations (`dropdown-menu`, `alert-dialog`) pull additional radix dependencies that bloat the Monaco-isolated bundle. | radix-ui meta-package is already in deps; shadcn `add` only generates wrappers. No measurable bundle delta expected. |
| R5 | Confirm dialog on Delete is good UX but adds a click for power users. | Acceptable — env deletion is destructive in spirit (loses variables) and infrequent. No «don't ask again» checkbox to keep state surface small. |
| R6 | tauri-specta bindings regeneration drift — adding 1 command. | Standard `cargo run -p handshaker --bin export-bindings` step; `pnpm lint` (tsc -b) catches type drift in `client.ts`. |

## 10. Implementation order (input to writing-plans)

Roughly TDD-friendly; `writing-plans` refines into tasks with subagent breakdown.

1. **`env_delete` IPC command** + unit tests (last-env reject, active-env reject, success). Register in `collect_commands!`. Regen bindings.
2. **Frontend wrapper** `ipc.envDelete` in `src/ipc/client.ts`.
3. **shadcn add `dropdown-menu` and `alert-dialog`**. Verify they appear in `src/components/ui/`. Lint passes.
4. **`EnvSwitcherMenu` component** — renders the menu with env list + 4 action items. No dialogs wired yet; clicking items only logs.
5. **Refactor `EnvPill`** to render `EnvSwitcherMenu` instead of opening `EditEnvDialog` directly. Lift `envs` and `activeEnv` state into `App.tsx`. Pass them as props. Re-test current Plan #4 flow («Edit variables…» still works) — regression gate.
6. **`NewEnvDialog`** — name validation, create + activate flow. Wire into `EnvSwitcherMenu`. Manual smoke: can create env.
7. **`RenameEnvDialog`** — composed rename. Wire into menu. Manual smoke: can rename, variables preserved.
8. **`ConfirmDeleteEnvDialog`** — alert-dialog + active-env handover. Wire into menu. Manual smoke: can delete inactive, active, can't delete last.
9. **`⌘E` / `Ctrl+E` hotkey** — global listener in `App.tsx` + ref to trigger. Smoke: opens dropdown.
10. **`activeEnv` prop to `ResolvesPreview`** — wire through `InvokePanel`. Smoke: switching env updates preview live.
11. **Full §7.6 smoke pass.** Fix issues. Iterate.
12. **Errata file** if any deviation surfaces.

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
| radix DropdownMenu | <https://www.radix-ui.com/primitives/docs/components/dropdown-menu> | keyboard interaction (↑↓ Enter Esc) and `disabled` semantics |
| Memory rule `feedback_verify_technical_claims` | local | requires source citations |
| Memory rule `feedback_ui_transparent_mechanics` | local | confirms switcher dropdown is standard affordance, not an engine-state indicator |
| Memory rule `preference_subagent_driven_default` | local | execution mode after writing-plans |
