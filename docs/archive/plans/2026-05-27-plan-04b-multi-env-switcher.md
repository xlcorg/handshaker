# Plan #4b — Multi-env switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Postman-style multi-env switcher in the header — non-removable "No environment" pseudo-row at the top, real envs below with per-row submenus, unified `EnvEditorDialog` for create+edit+rename, AlertDialog for delete confirm. Backend gains one new IPC command (`env_delete`) and widens `env_active_get` / `env_active_set` to `Option<String>`.

**Architecture:** Three thin slices.
1. Backend in `src-tauri`: widen `active_env: RwLock<Option<String>>`, refactor command logic to `impl AppState` for unit-testability, add `env_delete` with active-env guard, drop the bootstrapped Default env.
2. Frontend IPC layer: typed wrappers in `client.ts` with `string | null` semantics for active env.
3. Frontend UI: shadcn `dropdown-menu` + `alert-dialog` + `label` primitives compose into `EnvSwitcherMenu` (radix `DropdownMenuRadioGroup` for env switching + per-row nested `DropdownMenu` for actions), a unified `EnvEditorDialog` that handles create+edit+rename in one Save round-trip, and a small `ConfirmDeleteEnvDialog`.

**Tech Stack:** Rust 2021 + Tauri 2.x + tauri-specta v2 (backend); React 18 + Vite + TypeScript strict + Tailwind v4 + shadcn/ui new-york style (OKLCH dark palette already wired) + radix-ui primitives + Monaco unchanged + lucide-react icons.

**Spec:** [`docs/superpowers/specs/2026-05-27-plan-04b-multi-env-switcher-design.md`](../specs/2026-05-27-plan-04b-multi-env-switcher-design.md) (commit `d939bba`).

**Branch (when worktree is created):** `claude/plan-04b-multi-env-switcher` under `.claude/worktrees/plan-04b-multi-env-switcher`. Per project convention, the using-git-worktrees skill creates this at execution time; tasks below assume the worktree exists and you're inside it.

---

## File Structure

**Backend (`src-tauri/src/`):**
- **Modify** `state.rs` — `active_env: RwLock<Option<String>>`, default `None`; `InMemoryEnvironmentStore::new()` (drop `with_default()`).
- **Modify** `commands/env.rs` — refactor `env_active_get` / `env_active_set` to thin wrappers over `impl AppState` methods (testable); widen signatures to `Option<String>`; add `env_delete`; add `#[cfg(test)] mod tests`.
- **Modify** `commands/vars.rs` — refactor to thin wrapper over `impl AppState`; handle `active = None` by resolving against empty var set; add a test.
- **Modify** `lib.rs` — register `env_delete` in `collect_commands![]`.

**Frontend (`src/`):**
- **Modify** `ipc/client.ts` — `envActiveGet` returns `Promise<string | null>`; `envActiveSet` accepts `string | null`; add `envDelete`.
- **Regen** `ipc/bindings.ts` — via `cargo run -p handshaker --bin export-bindings`.
- **Modify** `App.tsx` — lift `envs: EnvironmentIpc[]` and `activeEnv: string | null` into state; ⌘E/Ctrl+E global hotkey; pass `activeEnv` to `InvokePanel`.
- **Modify** `features/envs/EnvPill.tsx` — render `EnvSwitcherMenu` instead of opening a dialog directly; show `No environment` label when `activeEnv === null`.
- **Move + Modify** `features/envs/EditEnvDialog.tsx` → `EnvEditorDialog.tsx` — widen `envName: string` prop to `originalName: string | null`; add Name `<Input>` above `VariablesTable`; unified `handleSave` for create / edit-no-rename / edit-with-rename.
- **Create** `features/envs/EnvSwitcherMenu.tsx` — radix-themed shadcn `DropdownMenu` with `DropdownMenuRadioGroup` for env switching + per-row nested `DropdownMenu` for `Edit env…` / `Delete env…`.
- **Create** `features/envs/ConfirmDeleteEnvDialog.tsx` — shadcn `AlertDialog` with destructive-style action.
- **Modify** `features/invoke/InvokePanel.tsx` — accept `activeEnv: string | null` prop; pass to `ResolvesPreview`.
- **Modify** `features/invoke/ResolvesPreview.tsx` — accept `activeEnv: string | null` prop; include in `useEffect` deps so preview re-fires on switch.
- **Add via shadcn CLI** `components/ui/dropdown-menu.tsx`, `components/ui/alert-dialog.tsx`, `components/ui/label.tsx`.

---

## Task 1: Backend — Widen `active_env` to `Option<String>` + refactor `env_active_get` / `env_active_set` to `impl AppState`

**Files:**
- Modify: `src-tauri/src/state.rs:10-28`
- Modify: `src-tauri/src/commands/env.rs:1-40`
- Test: `src-tauri/src/commands/env.rs` (new `#[cfg(test)] mod tests`)

The refactor pattern: the IPC command stays `#[tauri::command]` but delegates to an `impl AppState` method that takes `&self` and is plain async — directly callable from `#[tokio::test]` without `tauri::State` plumbing.

- [ ] **Step 1: Update `state.rs` field type and bootstrap**

Edit `src-tauri/src/state.rs`. Replace the existing struct + Default impl with:

```rust
//! Tauri-side app state. Fields land per plans #2-#6.

use std::sync::Arc;

use handshaker_core::env::in_memory::InMemoryEnvironmentStore;
use handshaker_core::env::EnvironmentStore;
use handshaker_core::grpc::GrpcConnection;
use tokio::sync::{Mutex, RwLock};

pub struct AppState {
    /// At most one active gRPC connection per spec §4.
    pub connection: Mutex<Option<Arc<GrpcConnection>>>,
    /// Environment store. Cold boot: empty.
    pub env_store: Arc<dyn EnvironmentStore>,
    /// Active environment name; `None` ≡ "No environment" (Postman-style).
    /// Updated by `env_active_set`. UI loads via `env_active_get`.
    pub active_env: RwLock<Option<String>>,
    // plan #6: pub collection_store: Arc<dyn CollectionStore>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            connection: Mutex::new(None),
            env_store: Arc::new(InMemoryEnvironmentStore::new()),
            active_env: RwLock::new(None),
        }
    }
}
```

- [ ] **Step 2: Run `cargo check` from `src-tauri/`**

```bash
cd src-tauri && cargo check
```

Expected: compile errors in `commands/env.rs` (existing `env_active_get` returns `String`, mismatches new `RwLock<Option<String>>`). Errors look like `expected struct String, found enum Option`. This is the TDD failing-state.

- [ ] **Step 3: Rewrite `commands/env.rs` with `impl AppState` pattern**

Replace `src-tauri/src/commands/env.rs` entirely with:

```rust
//! Environment IPC commands. See spec §5.1.
//!
//! Each command is a thin `#[tauri::command]` wrapper over an `impl AppState`
//! method. The impl methods are directly unit-testable from `#[tokio::test]`
//! without Tauri's full `State<'_, T>` plumbing — see the `#[cfg(test)]` block
//! at the bottom of this file.

use handshaker_core::env::Environment;
use handshaker_core::error::CoreError;
use tauri::State;

use crate::ipc::env::EnvironmentIpc;
use crate::ipc::error::IpcError;
use crate::state::AppState;

impl AppState {
    /// Inner logic for `env_list`. Synchronous because the store's `list()` is sync.
    pub fn env_list_impl(&self) -> Vec<EnvironmentIpc> {
        self.env_store.list().into_iter().map(EnvironmentIpc::from).collect()
    }

    /// Inner logic for `env_active_get`. `None` ≡ "No environment".
    pub async fn env_active_get_impl(&self) -> Option<String> {
        self.active_env.read().await.clone()
    }

    /// Inner logic for `env_active_set`. Passing `None` always succeeds.
    /// Passing `Some(name)` errors with `InvalidTarget` if the env does not exist.
    pub async fn env_active_set_impl(&self, name: Option<String>) -> Result<(), CoreError> {
        if let Some(ref n) = name {
            if self.env_store.get(n).is_none() {
                return Err(CoreError::InvalidTarget(format!("no such env: `{n}`")));
            }
        }
        *self.active_env.write().await = name;
        Ok(())
    }

    /// Inner logic for `env_upsert`. Validation lives in `EnvironmentStore::upsert`.
    pub fn env_upsert_impl(&self, env: Environment) -> Result<(), CoreError> {
        self.env_store.upsert(env)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn env_list(state: State<'_, AppState>) -> Result<Vec<EnvironmentIpc>, IpcError> {
    Ok(state.env_list_impl())
}

#[tauri::command]
#[specta::specta]
pub async fn env_active_get(state: State<'_, AppState>) -> Result<Option<String>, IpcError> {
    Ok(state.env_active_get_impl().await)
}

#[tauri::command]
#[specta::specta]
pub async fn env_active_set(
    state: State<'_, AppState>,
    name: Option<String>,
) -> Result<(), IpcError> {
    state.env_active_set_impl(name).await.map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn env_upsert(state: State<'_, AppState>, env: EnvironmentIpc) -> Result<(), IpcError> {
    state.env_upsert_impl(Environment::from(env)).map_err(IpcError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;

    use handshaker_core::env::in_memory::InMemoryEnvironmentStore;
    use tokio::sync::{Mutex, RwLock};

    /// Build an `AppState` for tests. `active` is the initial active-env value
    /// (`None` ≡ "No environment"); `envs` are pre-inserted into the store.
    fn build_state(envs: &[(&str, &[(&str, &str)])], active: Option<&str>) -> AppState {
        let store = InMemoryEnvironmentStore::new();
        for (name, vars) in envs {
            let mut map = HashMap::new();
            for (k, v) in *vars {
                map.insert(k.to_string(), v.to_string());
            }
            store
                .upsert(Environment {
                    name: name.to_string(),
                    variables: map,
                })
                .unwrap();
        }
        AppState {
            connection: Mutex::new(None),
            env_store: Arc::new(store),
            active_env: RwLock::new(active.map(|s| s.to_string())),
        }
    }

    #[tokio::test]
    async fn env_active_get_returns_none_on_fresh_state() {
        let state = AppState::default();
        assert_eq!(state.env_active_get_impl().await, None);
        assert!(state.env_list_impl().is_empty());
    }

    #[tokio::test]
    async fn env_active_set_accepts_none() {
        let state = build_state(&[("prod", &[])], Some("prod"));
        state.env_active_set_impl(None).await.unwrap();
        assert_eq!(state.env_active_get_impl().await, None);
    }

    #[tokio::test]
    async fn env_active_set_rejects_missing_some() {
        let state = AppState::default();
        let err = state
            .env_active_set_impl(Some("ghost".to_string()))
            .await
            .unwrap_err();
        match err {
            CoreError::InvalidTarget(msg) => assert!(msg.contains("ghost")),
            other => panic!("expected InvalidTarget, got {other:?}"),
        }
        assert_eq!(state.env_active_get_impl().await, None);
    }
}
```

- [ ] **Step 4: Run the new tests, expect PASS**

```bash
cd src-tauri && cargo test --package handshaker env_active
```

Expected output: three tests pass — `env_active_get_returns_none_on_fresh_state`, `env_active_set_accepts_none`, `env_active_set_rejects_missing_some`.

- [ ] **Step 5: Run the whole workspace test suite, expect green**

```bash
cargo test --workspace
```

Expected: previous 76 passed, now 79 passed (+3 new tests), 1 ignored, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/commands/env.rs
git commit -m "$(cat <<'EOF'
feat(envs): widen active_env to Option<String>; bootstrap empty

State.active_env becomes RwLock<Option<String>> with default None,
mirroring Postman's "No environment" initial state. env_store is no
longer seeded with a Default env at startup.

Refactors env_list / env_active_get / env_active_set / env_upsert into
thin #[tauri::command] wrappers over impl AppState methods, so test
code can construct AppState directly and exercise the logic without
tauri::State plumbing.

Adds three #[tokio::test] cases:
- env_active_get_returns_none_on_fresh_state
- env_active_set_accepts_none
- env_active_set_rejects_missing_some

cargo test --workspace: 79 passed, 1 ignored, 0 failed (was 76).
EOF
)"
```

---

## Task 2: Backend — `vars_resolve` handles `active = None`

**Files:**
- Modify: `src-tauri/src/commands/vars.rs`
- Test: `src-tauri/src/commands/vars.rs` (new `#[cfg(test)] mod tests`)

- [ ] **Step 1: Add the failing test**

Replace `src-tauri/src/commands/vars.rs` content with the version that includes a test stub but unchanged impl:

```rust
//! Variable substitution IPC command. See spec §5.1.

use std::collections::HashMap;

use handshaker_core::vars::{resolve_template_with_diagnostics, ResolutionReport, VariableSet};
use tauri::State;

use crate::ipc::error::IpcError;
use crate::ipc::vars::ResolutionReportIpc;
use crate::state::AppState;

impl AppState {
    /// Inner logic for `vars_resolve`. When `active_env` is `None`, resolves
    /// against an empty env var map (so every `{{var}}` in the template ends
    /// up in `unresolved_vars`).
    pub async fn vars_resolve_impl(&self, template: &str) -> ResolutionReport {
        let active = self.active_env.read().await.clone();
        let env_owned = active
            .as_deref()
            .and_then(|n| self.env_store.get(n))
            .map(|e| e.variables)
            .unwrap_or_default();
        let collection_owned: HashMap<String, String> = HashMap::new(); // populated in Plan #6
        let vars = VariableSet {
            env: &env_owned,
            collection: &collection_owned,
        };
        resolve_template_with_diagnostics(template, &vars)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn vars_resolve(
    state: State<'_, AppState>,
    template: String,
) -> Result<ResolutionReportIpc, IpcError> {
    Ok(state.vars_resolve_impl(&template).await.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn vars_resolve_treats_active_none_as_empty_var_set() {
        let state = AppState::default(); // active = None, store empty
        let report = state.vars_resolve_impl(r#"{"k":"{{x}}"}"#).await;
        // The template has one var; with no active env, it lands in unresolved.
        assert_eq!(report.unresolved_vars, vec!["x".to_string()]);
        assert!(report.cycle_chain.is_none());
        // resolved is the template verbatim (no substitution happened).
        assert_eq!(report.resolved, r#"{"k":"{{x}}"}"#);
    }
}
```

- [ ] **Step 2: Run the test, expect PASS**

```bash
cd src-tauri && cargo test --package handshaker vars_resolve
```

Expected: `vars_resolve_treats_active_none_as_empty_var_set` passes.

Note: although the impl change from Task 1 (`RwLock<Option<String>>`) already made `vars_resolve` not compile until this step, the test asserts the correct new behavior (`active = None` ⇒ empty var set).

- [ ] **Step 3: Run the whole workspace, expect green**

```bash
cargo test --workspace
```

Expected: 80 passed, 1 ignored, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/vars.rs
git commit -m "$(cat <<'EOF'
feat(vars): resolve against empty var set when active_env is None

Refactors vars_resolve into impl AppState for unit-testability.
When active_env is None (Postman-style "No environment"), the
resolver receives an empty env var map; every {{var}} in the
template lands in unresolved_vars. Matches the UI expectation that
ResolvesPreview shows "⚠ Unresolved: ..." in the no-env state.

Adds vars_resolve_treats_active_none_as_empty_var_set test.
EOF
)"
```

---

## Task 3: Backend — `env_delete` IPC command + tests + register

**Files:**
- Modify: `src-tauri/src/commands/env.rs` (add `env_delete_impl` + `env_delete` + 3 tests)
- Modify: `src-tauri/src/lib.rs` (register in `collect_commands!`)

- [ ] **Step 1: Add the failing tests**

Append the three new test functions inside the existing `#[cfg(test)] mod tests` block in `src-tauri/src/commands/env.rs` (after the three tests added in Task 1):

```rust
    #[tokio::test]
    async fn env_delete_rejects_when_target_is_active() {
        let state = build_state(&[("prod", &[("uid", "alpha")])], Some("prod"));
        let err = state.env_delete_impl("prod").await.unwrap_err();
        match err {
            CoreError::InvalidTarget(msg) => {
                assert!(msg.contains("cannot delete active env"));
                assert!(msg.contains("prod"));
            }
            other => panic!("expected InvalidTarget, got {other:?}"),
        }
        // Store is unchanged.
        assert!(state.env_store.get("prod").is_some());
    }

    #[tokio::test]
    async fn env_delete_succeeds_for_inactive() {
        let state = build_state(
            &[("prod", &[("uid", "alpha")]), ("staging", &[])],
            Some("prod"),
        );
        state.env_delete_impl("staging").await.unwrap();
        assert!(state.env_store.get("staging").is_none());
        // active unchanged.
        assert_eq!(state.env_active_get_impl().await, Some("prod".to_string()));
    }

    #[tokio::test]
    async fn env_delete_succeeds_for_only_real_env_when_active_is_none() {
        // active=None and only one real env exists. Deleting that env leaves
        // the store empty, which is a valid terminal state ("No environment").
        let state = build_state(&[("prod", &[])], None);
        state.env_delete_impl("prod").await.unwrap();
        assert!(state.env_list_impl().is_empty());
        assert_eq!(state.env_active_get_impl().await, None);
    }
```

- [ ] **Step 2: Run the new tests, expect FAIL**

```bash
cd src-tauri && cargo test --package handshaker env_delete
```

Expected: compile error — `env_delete_impl` does not exist on `AppState`. This is the failing-test state.

- [ ] **Step 3: Add `env_delete_impl` on `AppState`**

Inside `impl AppState { ... }` block in `src-tauri/src/commands/env.rs`, add (between `env_upsert_impl` and the closing `}`):

```rust
    /// Inner logic for `env_delete`. Rejects if `name` matches the currently
    /// active env (the frontend is expected to switch active first, typically
    /// to `None` ≡ "No environment"). Idempotent for unknown names.
    pub async fn env_delete_impl(&self, name: &str) -> Result<(), CoreError> {
        let active = self.active_env.read().await.clone();
        if active.as_deref() == Some(name) {
            return Err(CoreError::InvalidTarget(format!(
                "cannot delete active env `{name}`; switch first"
            )));
        }
        self.env_store.delete(name)
    }
```

- [ ] **Step 4: Add the `#[tauri::command]` wrapper**

Below the existing `env_upsert` `#[tauri::command]` block in `src-tauri/src/commands/env.rs`, append:

```rust
#[tauri::command]
#[specta::specta]
pub async fn env_delete(state: State<'_, AppState>, name: String) -> Result<(), IpcError> {
    state.env_delete_impl(&name).await.map_err(IpcError::from)
}
```

- [ ] **Step 5: Register the command in `lib.rs`**

Open `src-tauri/src/lib.rs`. In the existing `use commands::env::{...}` line, add `env_delete`:

```rust
use commands::env::{env_active_get, env_active_set, env_delete, env_list, env_upsert};
```

Then in the `collect_commands![...]` macro inside `specta_builder()`, add `env_delete` to the list (alphabetically near other env commands):

```rust
        .commands(collect_commands![
            app_version,
            grpc_connect,
            grpc_disconnect,
            grpc_refresh_contract,
            grpc_invoke_unary,
            grpc_build_request_skeleton,
            env_list,
            env_active_get,
            env_active_set,
            env_upsert,
            env_delete,
            vars_resolve,
        ])
```

- [ ] **Step 6: Run the new tests, expect PASS**

```bash
cd src-tauri && cargo test --package handshaker env_delete
```

Expected: three new tests pass — `env_delete_rejects_when_target_is_active`, `env_delete_succeeds_for_inactive`, `env_delete_succeeds_for_only_real_env_when_active_is_none`.

- [ ] **Step 7: Run the whole workspace, expect green**

```bash
cargo test --workspace
```

Expected: 83 passed, 1 ignored, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/env.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(envs): add env_delete IPC command

Adds env_delete with an active-env guard: refuses to delete the
currently active env. The frontend composes the
'switch active to None → env_delete' sequence in
ConfirmDeleteEnvDialog. No last-env restriction — emptying the
store is a valid steady state under the Postman-style "No
environment" model.

Registers env_delete in collect_commands![] so tauri-specta picks
it up at the next bindings export.

Three new #[tokio::test] cases:
- env_delete_rejects_when_target_is_active
- env_delete_succeeds_for_inactive
- env_delete_succeeds_for_only_real_env_when_active_is_none

cargo test --workspace: 83 passed, 1 ignored.
EOF
)"
```

---

## Task 4: Backend — Regenerate `tauri-specta` bindings

**Files:**
- Regen: `src/ipc/bindings.ts` (via `cargo run -p handshaker --bin export-bindings`)

- [ ] **Step 1: Run the bindings exporter**

```bash
cargo run -p handshaker --bin export-bindings
```

Expected output: a one-shot run that writes `src/ipc/bindings.ts`. The binary's source is `src-tauri/src/bin/export-bindings.rs` from Plan #2; it calls `specta_builder().export(...)`.

- [ ] **Step 2: Inspect the diff**

```bash
git diff src/ipc/bindings.ts
```

Expected changes:
- New `commands.envDelete` export with signature like `(name: string) => Promise<Result<null, IpcError>>` (exact shape depends on tauri-specta version — typically the existing `Result<T, E>` wrapper).
- `commands.envActiveGet` return type widened from `Result<string, IpcError>` to `Result<string | null, IpcError>`.
- `commands.envActiveSet` argument type widened from `(name: string)` to `(name: string | null)`.
- Possible `EnvironmentIpc` re-emit (cosmetic; no structural change).

If you see structural changes outside of these four points, stop and investigate before committing.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm lint
```

Expected: errors. Files that consume the old signatures (`src/ipc/client.ts`, `src/App.tsx`, possibly others) will type-error against the new `string | null` shape. These get fixed in Tasks 5 and 6.

This step's purpose is to *expect* the lint failure as a TDD-style failing state — Task 5 makes it green again.

- [ ] **Step 4: Commit the regenerated bindings**

```bash
git add src/ipc/bindings.ts
git commit -m "$(cat <<'EOF'
chore(ipc): regenerate bindings.ts after env_delete + Option signatures

tauri-specta export reflects the Plan #4b backend changes:
- adds commands.envDelete
- widens commands.envActiveGet return to string | null
- widens commands.envActiveSet arg to string | null

pnpm lint is intentionally broken at this commit — fixed in the
next task that updates src/ipc/client.ts and consumers.
EOF
)"
```

---

## Task 5: Frontend — IPC wrappers in `client.ts` for new signatures + `envDelete`

**Files:**
- Modify: `src/ipc/client.ts`

- [ ] **Step 1: Update `envActiveGet` to return `Promise<string | null>`**

In `src/ipc/client.ts`, replace the existing `envActiveGet` function with:

```ts
export async function envActiveGet(): Promise<string | null> {
  const r = await commands.envActiveGet();
  if (r.status === "error") throw r.error;
  return r.data;
}
```

- [ ] **Step 2: Update `envActiveSet` to accept `string | null`**

Replace the existing `envActiveSet` function with:

```ts
export async function envActiveSet(name: string | null): Promise<void> {
  const r = await commands.envActiveSet(name);
  if (r.status === "error") throw r.error;
}
```

- [ ] **Step 3: Add `envDelete` wrapper**

Below the existing `envUpsert` function, add:

```ts
export async function envDelete(name: string): Promise<void> {
  const r = await commands.envDelete(name);
  if (r.status === "error") throw r.error;
}
```

- [ ] **Step 4: Register `envDelete` in the `ipc` object**

Update the `ipc` object at the bottom of `src/ipc/client.ts` to include the new wrapper. The full block becomes:

```ts
export const ipc = {
  appVersion,
  grpcConnect,
  grpcDisconnect,
  grpcRefreshContract,
  grpcInvokeUnary,
  grpcBuildRequestSkeleton,
  envList,
  envActiveGet,
  envActiveSet,
  envUpsert,
  envDelete,
  varsResolve,
};
```

- [ ] **Step 5: Run `pnpm lint`, expect errors in consumers**

```bash
pnpm lint
```

Expected: errors in `src/App.tsx` (the `setActiveEnv(name)` callback receives `string | null` but state type is `string`) and possibly `src/features/envs/EditEnvDialog.tsx`. These are fixed in the next task; this step confirms the IPC layer types are now correct and the breakage is *only* at consumer sites.

- [ ] **Step 6: Commit**

```bash
git add src/ipc/client.ts
git commit -m "$(cat <<'EOF'
feat(ipc): widen envActiveGet/envActiveSet to string | null; add envDelete

Updates the thin client.ts wrappers to match the regenerated
tauri-specta bindings:
- envActiveGet returns Promise<string | null>
- envActiveSet accepts (name: string | null)
- new envDelete(name: string) wrapper

pnpm lint still broken at this commit — consumers patched in the
next task.
EOF
)"
```

---

## Task 6: Frontend — null-safety patches for existing consumers (transitional)

**Files:**
- Modify: `src/App.tsx` (state type)
- Modify: `src/features/envs/EnvPill.tsx` (render `No environment` label; disable click when null)
- Modify: `src/features/envs/EditEnvDialog.tsx` (handle null `envName` — bail out early)

This is a transitional task: at the end of it, the app compiles and runs again with `pnpm tauri dev`, but the UI is intermediate — pill shows `No environment ▾` on cold boot and clicking it is a no-op until `EnvSwitcherMenu` lands in Task 10. The real Plan #4 behavior (pill click → opens dialog for the active env) only fires when `activeEnv !== null`. The point of this task is to stop the build from being broken.

- [ ] **Step 1: Update `App.tsx` activeEnv state typing**

In `src/App.tsx`, replace:

```tsx
const [activeEnv, setActiveEnv] = useState<string>("Default");
```

with:

```tsx
const [activeEnv, setActiveEnv] = useState<string | null>(null);
```

The existing `useEffect` that calls `ipc.envActiveGet().then(setActiveEnv)` already works against the new return type (`string | null`).

- [ ] **Step 2: Update `EnvPill.tsx` to accept `string | null`**

Replace `src/features/envs/EnvPill.tsx` content with:

```tsx
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { EditEnvDialog } from "./EditEnvDialog";

export interface EnvPillProps {
  activeEnv: string | null;
  /** Called after the user saves variables in the dialog. */
  onVariablesSaved: (variables: Record<string, string>) => void;
}

export function EnvPill({ activeEnv, onVariablesSaved }: EnvPillProps) {
  const [open, setOpen] = useState(false);
  const label = activeEnv ?? "No environment";
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          // In this transitional state, opening the editor only makes sense for
          // a concrete env. No-op when active is null; the dropdown menu (Task
          // 10) will provide both "switch" and "open editor for a row" paths.
          if (activeEnv !== null) setOpen(true);
        }}
        className="gap-1 font-mono"
        disabled={activeEnv === null}
      >
        {label}
        <ChevronDown className="w-3 h-3" aria-hidden />
      </Button>
      {activeEnv !== null && (
        <EditEnvDialog
          open={open}
          envName={activeEnv}
          onOpenChange={setOpen}
          onSaved={onVariablesSaved}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify `EditEnvDialog.tsx` is fine**

`EditEnvDialog.tsx` already takes `envName: string` and is only rendered when `activeEnv !== null` (after Step 2). No edit needed — but read the file to confirm:

```bash
cat src/features/envs/EditEnvDialog.tsx | head -30
```

Expected: `envName: string` in `EditEnvDialogProps`. If the prop is consumed as `envName ?? ""` anywhere, change it to expect a real string. Otherwise skip.

- [ ] **Step 4: Run `pnpm lint`, expect clean**

```bash
pnpm lint
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Manual smoke — cold boot**

```bash
pnpm tauri dev
```

Wait for the dev window to open. Expected:
- Header pill reads `No environment ▾`, rendered as a disabled `<Button>` (the chevron icon is still visible).
- Clicking the pill does nothing.
- The rest of the app (ConnectPanel, etc.) renders normally.

Quit the dev server (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/features/envs/EnvPill.tsx
git commit -m "$(cat <<'EOF'
chore(envs): patch consumers for activeEnv: string | null

Transitional patch — keeps the build green and the app launchable
while EnvSwitcherMenu and the rest of the Plan #4b UI come online.

- App.tsx: activeEnv state type widened to string | null, default null
- EnvPill.tsx: renders "No environment ▾" + disabled state when activeEnv is null
- EnvPill.tsx: only mounts EditEnvDialog when activeEnv is non-null

Cold boot now lands on "No environment ▾"; the pill is intentionally
inert in this transitional state. Dropdown menu lands in Task 10.
EOF
)"
```

---

## Task 7: Frontend — add shadcn components (`dropdown-menu`, `alert-dialog`, `label`)

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx` (via shadcn CLI)
- Create: `src/components/ui/alert-dialog.tsx` (via shadcn CLI)
- Create: `src/components/ui/label.tsx` (via shadcn CLI)

- [ ] **Step 1: Run the shadcn CLI**

```bash
pnpm dlx shadcn@latest add dropdown-menu alert-dialog label
```

Expected: three new files created at `src/components/ui/dropdown-menu.tsx`, `src/components/ui/alert-dialog.tsx`, `src/components/ui/label.tsx`. No interactive prompts (the project's `components.json` config from Plan #4 supplies the style + path aliases).

If the CLI prompts about overwriting existing files, answer No — none of these three should exist yet (only `button`, `dialog`, `input`, `resizable`, `tabs` from Plan #4).

- [ ] **Step 2: Verify the files exist**

```bash
ls src/components/ui/
```

Expected to include: `alert-dialog.tsx`, `button.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `input.tsx`, `label.tsx`, `resizable.tsx`, `tabs.tsx`.

- [ ] **Step 3: Run `pnpm lint`, expect clean**

```bash
pnpm lint
```

Expected: zero errors. The new files compile against the existing radix-ui meta-package already in deps.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/dropdown-menu.tsx src/components/ui/alert-dialog.tsx src/components/ui/label.tsx
git commit -m "$(cat <<'EOF'
chore(ui): add shadcn dropdown-menu, alert-dialog, label

Adds the three primitives Plan #4b needs:
- dropdown-menu: EnvSwitcherMenu + per-row action submenus
- alert-dialog: ConfirmDeleteEnvDialog destructive confirm
- label: Name field in EnvEditorDialog

Inherits components.json config from Plan #4 (new-york style,
OKLCH dark theme). radix-ui meta-package already in deps from
Plan #4 — no new npm dependencies.
EOF
)"
```

---

## Task 8: Frontend — rename `EditEnvDialog` → `EnvEditorDialog` with unified Save handler

**Files:**
- Move: `src/features/envs/EditEnvDialog.tsx` → `src/features/envs/EnvEditorDialog.tsx`
- Modify: the moved file's content (props, name input, unified `handleSave`)
- Modify: `src/features/envs/EnvPill.tsx` (update import + prop passing; still uses dialog directly in this task)

This task adds the unified create/edit/rename surface but keeps `EnvPill` opening it directly (Plan #4 style) — `EnvSwitcherMenu` lands in Task 9/10.

- [ ] **Step 1: Rename the file via `git mv`**

```bash
git mv src/features/envs/EditEnvDialog.tsx src/features/envs/EnvEditorDialog.tsx
```

Confirms via `git status`:

```bash
git status
```

Expected: `renamed: src/features/envs/EditEnvDialog.tsx -> src/features/envs/EnvEditorDialog.tsx`.

- [ ] **Step 2: Rewrite the file's content**

Replace `src/features/envs/EnvEditorDialog.tsx` content with:

```tsx
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import { ipc } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { VariablesTable } from "./VariablesTable";

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export interface EnvEditorDialogProps {
  open: boolean;
  /** `null` ⇒ create mode (empty name + empty vars). String ⇒ edit mode. */
  originalName: string | null;
  /** Current active env (used to decide whether a rename needs to flip active). */
  activeEnv: string | null;
  /** Existing envs (for duplicate-name detection). */
  envs: EnvironmentIpc[];
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save. Parent should refetch envs + sync activeEnv. */
  onSaved: (savedName: string, becameActive: boolean) => void;
}

export function EnvEditorDialog({
  open,
  originalName,
  activeEnv,
  envs,
  onOpenChange,
  onSaved,
}: EnvEditorDialogProps) {
  const isCreate = originalName === null;
  const [name, setName] = useState<string>(originalName ?? "");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reload state whenever the dialog opens or the target env changes.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(originalName ?? "");
    if (originalName === null) {
      setVars({});
      return;
    }
    // Edit mode: load variables for originalName from the parent-provided list.
    const cur = envs.find((e) => e.name === originalName);
    const loaded: Record<string, string> = {};
    if (cur) {
      // Defensive coerce — tauri-specta emits Partial<Record<...>> for HashMap.
      for (const [k, v] of Object.entries(cur.variables)) {
        if (typeof v === "string") loaded[k] = v;
      }
    }
    setVars(loaded);
  }, [open, originalName, envs]);

  const nameInvalid = name.length > 0 && !NAME_RE.test(name);
  const nameEmpty = name.length === 0;
  const nameIsDuplicate =
    !nameInvalid && !nameEmpty && name !== originalName && envs.some((e) => e.name === name);
  const canSave = !nameInvalid && !nameEmpty && !nameIsDuplicate;

  async function handleSave() {
    if (!canSave) return;
    const renamed = !isCreate && name !== originalName;
    setBusy(true);
    setError(null);
    try {
      // 1. Persist the (possibly renamed) env with its current variables.
      await ipc.envUpsert({ name, variables: vars });

      // 2. Renaming the active env: switch active to the new name BEFORE
      //    deleting the old one (backend env_delete refuses to delete active).
      let becameActive = false;
      if (renamed && activeEnv === originalName) {
        await ipc.envActiveSet(name);
        becameActive = true;
      }

      // 3. Renaming: drop the old name.
      if (renamed && originalName !== null) {
        await ipc.envDelete(originalName);
      }

      // 4. Create mode: auto-activate the new env.
      if (isCreate) {
        await ipc.envActiveSet(name);
        becameActive = true;
      }

      onSaved(name, becameActive);
      onOpenChange(false);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setError(t.message ?? t.type ?? "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isCreate ? "New environment" : "Edit environment"}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? "Create a new environment and define its variables."
              : "Rename or update variables."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="env-name">Name</Label>
            <Input
              id="env-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(
                "font-mono text-sm",
                (nameInvalid || nameIsDuplicate) && "border-destructive",
              )}
              aria-invalid={nameInvalid || nameIsDuplicate}
              autoFocus
              placeholder="e.g. prod"
            />
            {nameInvalid && (
              <p className="text-xs text-destructive mt-1">
                name must match ^[a-zA-Z_][a-zA-Z0-9_-]*$
              </p>
            )}
            {nameIsDuplicate && (
              <p className="text-xs text-destructive mt-1">name already exists</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Variables</Label>
            <VariablesTable value={vars} onChange={setVars} />
          </div>
        </div>
        {error && (
          <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || busy}>
            {busy ? "Saving…" : isCreate ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Update `EnvPill.tsx` to use the renamed component**

In `src/features/envs/EnvPill.tsx`, this task keeps `EnvPill` opening the editor directly (still Plan #4-style, but now via the unified editor). Replace the file's content with:

```tsx
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { EnvEditorDialog } from "./EnvEditorDialog";

export interface EnvPillProps {
  envs: EnvironmentIpc[];
  activeEnv: string | null;
  onSaved: (savedName: string, becameActive: boolean) => void;
}

export function EnvPill({ envs, activeEnv, onSaved }: EnvPillProps) {
  const [open, setOpen] = useState(false);
  const label = activeEnv ?? "No environment";
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          if (activeEnv !== null) setOpen(true);
        }}
        className="gap-1 font-mono"
        disabled={activeEnv === null}
      >
        {label}
        <ChevronDown className="w-3 h-3" aria-hidden />
      </Button>
      <EnvEditorDialog
        open={open}
        originalName={activeEnv}
        activeEnv={activeEnv}
        envs={envs}
        onOpenChange={setOpen}
        onSaved={onSaved}
      />
    </>
  );
}
```

- [ ] **Step 4: Update `App.tsx` to load `envs` and pass to `EnvPill`**

In `src/App.tsx`, add state for the envs list and a refetch helper. Find the existing state hooks block:

```tsx
const [activeEnv, setActiveEnv] = useState<string | null>(null);
```

Right after it, add:

```tsx
const [envs, setEnvs] = useState<EnvironmentIpc[]>([]);
```

Add a fetcher effect right after the existing `ipc.envActiveGet().then(setActiveEnv)` effect:

```tsx
useEffect(() => {
  ipc.envList().then(setEnvs).catch(console.error);
}, []);
```

Import `EnvironmentIpc` from bindings. Update the existing import line:

```tsx
import type { ServiceCatalogIpc, InvokeOutcomeIpc, EnvironmentIpc } from "@/ipc/bindings";
```

Update the `<EnvPill ... />` element in the header. Find:

```tsx
<EnvPill activeEnv={activeEnv} onVariablesSaved={() => { /* no-op: live preview re-fetches */ }} />
```

Replace with:

```tsx
<EnvPill
  envs={envs}
  activeEnv={activeEnv}
  onSaved={async (savedName, becameActive) => {
    setEnvs(await ipc.envList());
    if (becameActive) setActiveEnv(savedName);
  }}
/>
```

- [ ] **Step 5: Run `pnpm lint`, expect clean**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 6: Manual smoke — unified editor opens for active env**

```bash
pnpm tauri dev
```

Expected:
- Cold boot: pill reads `No environment ▾` (disabled). Clicking does nothing. (We still need the dropdown menu to *create* an env — that's Task 10.)

Quick functional test: temporarily seed an env by editing `state.rs` ad hoc — actually skip this and just confirm the build is healthy. Visual verification of the editor itself comes in Task 11 when the menu can open it.

Quit dev server.

- [ ] **Step 7: Commit**

```bash
git add src/features/envs/EnvEditorDialog.tsx src/features/envs/EnvPill.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat(envs): EnvEditorDialog — unified create/edit/rename surface

Renames EditEnvDialog -> EnvEditorDialog and extends the API:
- originalName: string | null replaces envName: string (null = create mode)
- Name <Input> + <Label> rendered above the existing VariablesTable
- Validation: regex + duplicate-name detection (excluding self in edit mode)
- Unified handleSave handles all three branches:
  - create: envUpsert + envActiveSet (auto-activate)
  - edit-no-rename: envUpsert
  - edit-with-rename: envUpsert(new) + envActiveSet(new if was active) + envDelete(old)

App.tsx now owns envs: EnvironmentIpc[] state and refetches via
onSaved. EnvPill still opens the dialog directly in this task
(transitional) — EnvSwitcherMenu lands next.
EOF
)"
```

---

## Task 9: Frontend — build `EnvSwitcherMenu` component

**Files:**
- Create: `src/features/envs/EnvSwitcherMenu.tsx`

This task creates the component but does not yet wire it into `EnvPill`. Callbacks are received as props. The integration happens in Task 10.

- [ ] **Step 1: Create the file**

Create `src/features/envs/EnvSwitcherMenu.tsx` with:

```tsx
import { MoreVertical } from "lucide-react";
import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentIpc } from "@/ipc/bindings";

const NO_ENV_VALUE = "__no_env__"; // sentinel for DropdownMenuRadioGroup; null cannot be a value.

export interface EnvSwitcherMenuProps {
  envs: EnvironmentIpc[];
  activeEnv: string | null;
  /** Inner content of the DropdownMenuTrigger — typically the EnvPill button. */
  trigger: React.ReactNode;
  onActiveSet: (name: string | null) => void;
  onEditEnv: (name: string) => void;
  onDeleteEnv: (name: string) => void;
  onNewEnv: () => void;
}

/** Postman-style env switcher: per-row direct manipulation.
 *
 * Layout:
 *   <DropdownMenuLabel>Environments</DropdownMenuLabel>
 *   <DropdownMenuRadioGroup>
 *     <DropdownMenuRadioItem value="__no_env__">No environment</DropdownMenuRadioItem>
 *     <Separator />
 *     {envs.map(env => (
 *       <div className="flex items-center group">
 *         <DropdownMenuRadioItem value={env.name}>{env.name}</DropdownMenuRadioItem>
 *         <DropdownMenu>{...per-row submenu...}</DropdownMenu>
 *       </div>
 *     ))}
 *   </DropdownMenuRadioGroup>
 *   <Separator />
 *   <DropdownMenuItem>+ New env…</DropdownMenuItem>
 *
 * The trailing ⋮ button uses stopPropagation so the outer radio-group
 * does NOT interpret its click as a row-switch. radix portals the
 * inner DropdownMenu, so click-outside on the inner menu does not
 * bubble to the outer one. See spec §5.1 + R7.
 */
export const EnvSwitcherMenu = forwardRef<HTMLButtonElement, EnvSwitcherMenuProps>(
  function EnvSwitcherMenu(props, triggerRef) {
    const { envs, activeEnv, trigger, onActiveSet, onEditEnv, onDeleteEnv, onNewEnv } = props;
    const sorted = [...envs].sort((a, b) => a.name.localeCompare(b.name));
    const radioValue = activeEnv ?? NO_ENV_VALUE;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={triggerRef}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[14rem]">
          <DropdownMenuLabel>Environments</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={radioValue}
            onValueChange={(v) => onActiveSet(v === NO_ENV_VALUE ? null : v)}
          >
            <DropdownMenuRadioItem
              value={NO_ENV_VALUE}
              className="text-muted-foreground italic"
            >
              No environment
            </DropdownMenuRadioItem>
            {sorted.length > 0 && <DropdownMenuSeparator />}
            {sorted.map((env) => (
              <div key={env.name} className="flex items-center group">
                <DropdownMenuRadioItem value={env.name} className="flex-1">
                  {env.name}
                </DropdownMenuRadioItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Actions for ${env.name}`}
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start">
                    <DropdownMenuItem onSelect={() => onEditEnv(env.name)}>
                      Edit env…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => onDeleteEnv(env.name)}
                      className="text-destructive focus:text-destructive focus:bg-destructive/10"
                    >
                      Delete env…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewEnv}>+ New env…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
```

- [ ] **Step 2: Run `pnpm lint`, expect clean**

```bash
pnpm lint
```

Expected: zero errors. The component is unused at this point but compiles standalone.

- [ ] **Step 3: Commit**

```bash
git add src/features/envs/EnvSwitcherMenu.tsx
git commit -m "$(cat <<'EOF'
feat(envs): EnvSwitcherMenu component

Postman-style env switcher built on shadcn DropdownMenu primitives:
- DropdownMenuRadioGroup for env selection (No environment + real envs)
- per-row trailing ⋮ Button asChild triggers a nested DropdownMenu
  with Edit env… / Delete env… actions (destructive style)
- stopPropagation on ⋮ click prevents the outer radio-group from
  interpreting it as a row switch
- forwardRef on the outer DropdownMenuTrigger so App.tsx can wire
  ⌘E/Ctrl+E to programmatically open the menu (Task 12)

Component is standalone in this commit — wired into EnvPill in the
next task.
EOF
)"
```

---

## Task 10: Frontend — refactor `EnvPill` to render `EnvSwitcherMenu` + wire all menu actions

**Files:**
- Modify: `src/features/envs/EnvPill.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Rewrite `EnvPill.tsx`**

Replace `src/features/envs/EnvPill.tsx` content with:

```tsx
import { ChevronDown } from "lucide-react";
import { forwardRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { EnvEditorDialog } from "./EnvEditorDialog";
import { EnvSwitcherMenu } from "./EnvSwitcherMenu";

export interface EnvPillProps {
  envs: EnvironmentIpc[];
  activeEnv: string | null;
  /** Called whenever envs change (after upsert/delete/rename). */
  onEnvsChanged: () => void | Promise<void>;
  /** Called whenever activeEnv changes. */
  onActiveEnvChanged: (next: string | null) => void;
}

export const EnvPill = forwardRef<HTMLButtonElement, EnvPillProps>(function EnvPill(props, ref) {
  const { envs, activeEnv, onEnvsChanged, onActiveEnvChanged } = props;
  /** null = closed; null in originalName = create mode; string in originalName = edit mode. */
  const [editor, setEditor] = useState<{ originalName: string | null } | null>(null);

  const label = activeEnv ?? "No environment";

  return (
    <>
      <EnvSwitcherMenu
        ref={ref}
        envs={envs}
        activeEnv={activeEnv}
        trigger={
          <Button variant="ghost" size="sm" className="gap-1 font-mono">
            {label}
            <ChevronDown className="w-3 h-3" aria-hidden />
          </Button>
        }
        onActiveSet={(next) => {
          // Optimistic: update local state first, fire-and-forget IPC.
          onActiveEnvChanged(next);
          void ipc.envActiveSet(next);
        }}
        onEditEnv={(name) => setEditor({ originalName: name })}
        onDeleteEnv={(_name) => {
          // Wired in Task 11 (ConfirmDeleteEnvDialog).
          // For now, log so Task 10 manual smoke can proceed; Task 11 swaps this.
          console.warn("Delete env requested — ConfirmDeleteEnvDialog lands in Task 11");
        }}
        onNewEnv={() => setEditor({ originalName: null })}
      />
      {editor && (
        <EnvEditorDialog
          open={true}
          originalName={editor.originalName}
          activeEnv={activeEnv}
          envs={envs}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onSaved={async (savedName, becameActive) => {
            await onEnvsChanged();
            if (becameActive) onActiveEnvChanged(savedName);
          }}
        />
      )}
    </>
  );
});
```

- [ ] **Step 2: Update `App.tsx` to pass the new prop shape**

In `src/App.tsx`, find the existing `<EnvPill ... />` line. Replace with:

```tsx
<EnvPill
  envs={envs}
  activeEnv={activeEnv}
  onEnvsChanged={async () => setEnvs(await ipc.envList())}
  onActiveEnvChanged={setActiveEnv}
/>
```

Don't worry about the ref forwarding yet — Task 12 attaches a ref for the ⌘E hotkey.

- [ ] **Step 3: Run `pnpm lint`, expect clean**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 4: Manual smoke — switcher works**

```bash
pnpm tauri dev
```

Expected:
- Cold boot: pill reads `No environment ▾`. Now clickable (no longer disabled).
- Click pill → dropdown opens. Shows `✓ No environment` (italic muted) + separator + `+ New env…`. No real env rows.
- Click `+ New env…` → `EnvEditorDialog` opens in create mode (header `New environment`, empty name field, empty Variables table, Save button labeled `Create`).
- Type name `staging`, add one row to Variables table: `uid` = `alpha`. Click `Create`. Dialog closes; pill reads `staging ▾`.
- Reopen menu: `No environment`, `✓ staging`. Hover `staging` row → trailing ⋮ appears. Click ⋮ → submenu with `Edit env…`, `Delete env…`.
- Click `Edit env…` → editor opens in edit mode (name `staging`, table shows `uid=alpha`, button `Save`). Add `region=eu`, change name to `staging-eu`, click `Save`. Dialog closes. Pill reads `staging-eu ▾`. Reopen menu: `No environment`, `✓ staging-eu`.
- Click `Delete env…` → console warning appears (Task 11 wires this).
- Click `No environment` row → pill reads `No environment ▾`. Click `staging-eu` row → switches back.

Quit dev server.

- [ ] **Step 5: Commit**

```bash
git add src/features/envs/EnvPill.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat(envs): wire EnvSwitcherMenu into EnvPill

EnvPill now renders EnvSwitcherMenu as its trigger surface and owns
the EnvEditorDialog open/close state. The menu's onEditEnv and
onNewEnv callbacks both open the editor (edit vs create mode via
originalName). onDeleteEnv is a console.warn placeholder until the
next task lands ConfirmDeleteEnvDialog.

App.tsx provides onEnvsChanged (refetches env list) and
onActiveEnvChanged callbacks. The optimistic switch happens via
setActiveEnv before the envActiveSet IPC resolves.

Smoke confirmed: create env with vars in one shot, switch, rename
via editor, switch back, all clean.
EOF
)"
```

---

## Task 11: Frontend — `ConfirmDeleteEnvDialog` + wire to menu

**Files:**
- Create: `src/features/envs/ConfirmDeleteEnvDialog.tsx`
- Modify: `src/features/envs/EnvPill.tsx`

- [ ] **Step 1: Create the dialog file**

Create `src/features/envs/ConfirmDeleteEnvDialog.tsx`:

```tsx
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { ipc } from "@/ipc/client";

export interface ConfirmDeleteEnvDialogProps {
  /** When `null`, the dialog is closed. Set to a name to open. */
  target: string | null;
  /** Current active env — used to decide whether to pre-switch on delete. */
  activeEnv: string | null;
  onOpenChange: (open: boolean) => void;
  /** Called on successful delete; parent should refetch the env list. */
  onDeleted: (deletedName: string, activeChangedToNull: boolean) => void;
}

export function ConfirmDeleteEnvDialog({
  target,
  activeEnv,
  onOpenChange,
  onDeleted,
}: ConfirmDeleteEnvDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (target === null) return;
    setBusy(true);
    setError(null);
    try {
      let activeChangedToNull = false;
      // 1. If deleting the active env, switch active to None first.
      if (activeEnv === target) {
        await ipc.envActiveSet(null);
        activeChangedToNull = true;
      }
      // 2. Delete the target env.
      await ipc.envDelete(target);

      onDeleted(target, activeChangedToNull);
      onOpenChange(false);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setError(t.message ?? t.type ?? "delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete env?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <code className="font-mono">{target ?? ""}</code>? Its
            variables will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={busy}
            className={buttonVariants({ variant: "destructive" })}
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Wire into `EnvPill.tsx`**

Replace `src/features/envs/EnvPill.tsx` content with:

```tsx
import { ChevronDown } from "lucide-react";
import { forwardRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { ConfirmDeleteEnvDialog } from "./ConfirmDeleteEnvDialog";
import { EnvEditorDialog } from "./EnvEditorDialog";
import { EnvSwitcherMenu } from "./EnvSwitcherMenu";

export interface EnvPillProps {
  envs: EnvironmentIpc[];
  activeEnv: string | null;
  /** Called whenever envs change (after upsert/delete/rename). */
  onEnvsChanged: () => void | Promise<void>;
  /** Called whenever activeEnv changes. */
  onActiveEnvChanged: (next: string | null) => void;
}

export const EnvPill = forwardRef<HTMLButtonElement, EnvPillProps>(function EnvPill(props, ref) {
  const { envs, activeEnv, onEnvsChanged, onActiveEnvChanged } = props;
  const [editor, setEditor] = useState<{ originalName: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const label = activeEnv ?? "No environment";

  return (
    <>
      <EnvSwitcherMenu
        ref={ref}
        envs={envs}
        activeEnv={activeEnv}
        trigger={
          <Button variant="ghost" size="sm" className="gap-1 font-mono">
            {label}
            <ChevronDown className="w-3 h-3" aria-hidden />
          </Button>
        }
        onActiveSet={(next) => {
          onActiveEnvChanged(next);
          void ipc.envActiveSet(next);
        }}
        onEditEnv={(name) => setEditor({ originalName: name })}
        onDeleteEnv={(name) => setDeleteTarget(name)}
        onNewEnv={() => setEditor({ originalName: null })}
      />
      {editor && (
        <EnvEditorDialog
          open={true}
          originalName={editor.originalName}
          activeEnv={activeEnv}
          envs={envs}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onSaved={async (savedName, becameActive) => {
            await onEnvsChanged();
            if (becameActive) onActiveEnvChanged(savedName);
          }}
        />
      )}
      <ConfirmDeleteEnvDialog
        target={deleteTarget}
        activeEnv={activeEnv}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDeleted={async (_name, activeChangedToNull) => {
          await onEnvsChanged();
          if (activeChangedToNull) onActiveEnvChanged(null);
        }}
      />
    </>
  );
});
```

- [ ] **Step 3: Run `pnpm lint`, expect clean**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 4: Manual smoke — delete works**

```bash
pnpm tauri dev
```

Expected scenarios:
- Create env `staging` from cold boot (per Task 10 smoke). Hover its row → ⋮ → `Delete env…` → AlertDialog opens with title `Delete env?` and description `Are you sure you want to delete staging?`.
- Click `Cancel` → dialog closes, env still exists.
- Reopen, click `Delete` → env removed. Pill reads `No environment ▾` (active was `staging`, pre-switched to `null`, then `env_delete` succeeded).
- Repeat with two envs, deleting the inactive one: pill stays on the active env after delete (no pre-switch fired).

Quit dev server.

- [ ] **Step 5: Commit**

```bash
git add src/features/envs/ConfirmDeleteEnvDialog.tsx src/features/envs/EnvPill.tsx
git commit -m "$(cat <<'EOF'
feat(envs): ConfirmDeleteEnvDialog wired to EnvSwitcherMenu

shadcn AlertDialog with destructive-style action button via
buttonVariants({ variant: "destructive" }). The handleDelete
composer:
1. If target === activeEnv: envActiveSet(null) (backend would
   refuse to delete active otherwise)
2. envDelete(target)
3. onDeleted callback → parent refetches envs + clears active

EnvPill now owns both the editor and delete dialogs as siblings.
Per-row Delete env… opens the AlertDialog; Cancel/Esc/click-outside
discard.
EOF
)"
```

---

## Task 12: Frontend — ⌘E / Ctrl+E global hotkey

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the ref + listener in `App.tsx`**

In `src/App.tsx`, add at the top of the component body, near the other `useState` hooks:

```tsx
const envSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
```

Add `useRef` to the React import line:

```tsx
import { useEffect, useRef, useState } from "react";
```

Add a new `useEffect` near the other effect blocks (anywhere before `return`):

```tsx
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E")) {
      e.preventDefault();
      envSwitcherTriggerRef.current?.click();
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

Attach the ref to `EnvPill`:

```tsx
<EnvPill
  ref={envSwitcherTriggerRef}
  envs={envs}
  activeEnv={activeEnv}
  onEnvsChanged={async () => setEnvs(await ipc.envList())}
  onActiveEnvChanged={setActiveEnv}
/>
```

- [ ] **Step 2: Run `pnpm lint`, expect clean**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 3: Manual smoke — hotkey opens dropdown**

```bash
pnpm tauri dev
```

Expected:
- App boots. Press `Ctrl+E` (or `Cmd+E` on macOS). Dropdown opens; first focusable item (the `No environment` row, since `activeEnv` is null) gets focus indicator.
- ↓ moves focus to next row (if any envs exist). Enter switches. Esc closes.
- If focus is inside Monaco when the hotkey fires, it still works (the listener uses `window.addEventListener` which fires before Monaco's editor-scoped handlers).

Quit dev server.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
feat(envs): ⌘E / Ctrl+E global hotkey opens env switcher

window-level keydown listener in App.tsx, forwarded via ref to the
EnvSwitcherMenu's DropdownMenuTrigger. Programmatic .click() opens
the menu and lets radix focus the first row (matches master §9
"⌘E — Открыть env-switcher").

Listener uses preventDefault to swallow the keystroke before
Monaco's editor-level handler can interpret it.
EOF
)"
```

---

## Task 13: Frontend — propagate `activeEnv` to `ResolvesPreview` for live re-resolve

**Files:**
- Modify: `src/features/invoke/ResolvesPreview.tsx`
- Modify: `src/features/invoke/InvokePanel.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `activeEnv` prop to `ResolvesPreview`**

In `src/features/invoke/ResolvesPreview.tsx`, update the props and the useEffect deps. Replace the `ResolvesPreviewProps` interface and the body of the `useEffect`:

```tsx
export interface ResolvesPreviewProps {
  body: string;
  /** Current active env. Included so the preview re-resolves when env switches. */
  activeEnv: string | null;
}

export function ResolvesPreview({ body, activeEnv }: ResolvesPreviewProps) {
  const [report, setReport] = useState<ResolutionReportIpc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // If body has no vars, hide preview entirely.
    if (!hasVars(body)) {
      setReport(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      ipc.varsResolve(body).then(setReport).catch(() => setReport(null));
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [body, activeEnv]);

  // ... rest of the component unchanged
```

Keep the existing render logic (the `if (report.cycle_chain)` block, etc.) intact.

- [ ] **Step 2: Add `activeEnv` prop to `InvokePanel`**

In `src/features/invoke/InvokePanel.tsx`, update the props interface:

```tsx
export interface InvokePanelProps {
  selected: SelectedMethod;
  activeEnv: string | null;
  onOutcome: (outcome: InvokeOutcomeIpc) => void;
  onError: (message: string) => void;
}
```

Update the destructure:

```tsx
export function InvokePanel({ selected, activeEnv, onOutcome, onError }: InvokePanelProps) {
```

Pass `activeEnv` down to `ResolvesPreview` — find the existing line:

```tsx
<ResolvesPreview body={body} />
```

Replace with:

```tsx
<ResolvesPreview body={body} activeEnv={activeEnv} />
```

- [ ] **Step 3: Update `App.tsx` to pass `activeEnv` to `InvokePanel`**

Find the existing `<InvokePanel ... />` in `src/App.tsx`. Replace with:

```tsx
<InvokePanel
  selected={selected}
  activeEnv={activeEnv}
  onOutcome={(o) => {
    setOutcome(o);
    setError(null);
  }}
  onError={(m) => setError(m)}
/>
```

- [ ] **Step 4: Run `pnpm lint`, expect clean**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 5: Manual smoke — preview updates on env switch**

```bash
pnpm tauri dev
```

Expected:
- Cold boot. Connect to `127.0.0.1:5002`. Pick a method that has a body with `{{uid}}` (or set one manually — e.g. type body `{"id":"{{uid}}"}` in the editor).
- Preview reads `⚠ Unresolved: uid` (no env).
- Open dropdown → `+ New env…` → create env `staging` with `uid=alpha` → Save.
- Preview re-resolves automatically (within ~300ms) to `→ resolves: {"id":"alpha"}`.
- Open dropdown → switch to `No environment` → preview returns to `⚠ Unresolved: uid` immediately (the activeEnv dep triggers a fresh resolve).
- Switch back to `staging` → preview returns to resolved.

Quit dev server.

- [ ] **Step 6: Commit**

```bash
git add src/features/invoke/ResolvesPreview.tsx src/features/invoke/InvokePanel.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat(invoke): ResolvesPreview re-fires vars_resolve on activeEnv change

Passes activeEnv: string | null through InvokePanel into
ResolvesPreview as a prop. ResolvesPreview's useEffect now includes
activeEnv in its deps, so switching env from the header dropdown
triggers a fresh debounced vars_resolve and the preview line
updates live without page reload.
EOF
)"
```

---

## Task 14: Manual UI smoke per spec §7.6 (16 steps)

**Files:** None modified unless deviations are found.

This task walks through the full 16-step smoke flow from the spec to verify end-to-end behavior, then either commits an errata file (if deviations are found) or proceeds to PR.

- [ ] **Step 1: Start the dev server**

```bash
pnpm tauri dev
```

Wait for the window to open.

- [ ] **Step 2: Walk through spec §7.6 steps 1–16**

Open the spec at [`docs/superpowers/specs/2026-05-27-plan-04b-multi-env-switcher-design.md`](../specs/2026-05-27-plan-04b-multi-env-switcher-design.md), navigate to §7.6, and run every step in order. Take notes on any deviations:

1. Cold boot: pill `No environment ▾`, body `{"id":"{{uid}}"}` → preview `⚠ Unresolved: uid`.
2. Open dropdown: `✓ No environment` only, separator, `+ New env…`. `No environment` has no `⋮`.
3. Unresolved preview confirms `active=None` semantics.
4. `+ New env…` → name `staging`, var `uid=alpha`, `Create` → pill `staging ▾`, preview `→ resolves: {"id":"alpha"}`.
5. Click `No environment` → preview unresolved; click `staging` → resolved.
6. Per-row Edit (vars only): add `lang=en`, Save → vars persist on reopen.
7. Per-row Edit (rename in same dialog): `staging` → `staging-eu` → pill `staging-eu ▾`.
8. Create second env `prod` → pill `prod ▾`.
9. Cross-env preview confirmed.
10. Edit non-active: rename `staging-eu` to `staging-eu-2`, add `region=eu` — pill stays `prod ▾`.
11. Delete inactive (`staging-eu-2`) → pill stays `prod ▾`.
12. Delete active (`prod`) → pill returns to `No environment ▾`.
13. Validation: `1bad` invalid; space-containing names rejected.
14. Hotkey: `⌘E`/`Ctrl+E` opens menu; `→` opens row's submenu.
15. Esc behavior: dialog → Esc closes without persisting; submenu → Esc closes only submenu.
16. Regression: `{{var}}` yellow highlight; Send with active=env+resolvable body posts; Send with active=None+`{{var}}` body is blocked by handleSend's unresolved-vars guard.

- [ ] **Step 3: If any deviation found, capture an errata file**

If any of the 16 steps deviates from the spec's expected behavior, create `docs/superpowers/errata/2026-05-27-plan-04b-multi-env-switcher.md` following the format used by [`docs/superpowers/errata/2026-05-27-plan-04-env-vars.md`](../errata/2026-05-27-plan-04-env-vars.md):

```markdown
# Errata — Plan #4b Multi-env switcher

> Documents deviations introduced during implementation of [Plan #4b](../plans/2026-05-27-plan-04b-multi-env-switcher.md) from the design spec.

Applies to:
- [Plan #4b design spec](../specs/2026-05-27-plan-04b-multi-env-switcher-design.md)

## Deviations

| # | Document § | Original | Revised | Reason |
|---|---|---|---|---|
| 1 | [section ref] | [verbatim plan text] | [what shipped] | [why — link to commit if applicable] |

## Status

[merged / pending / fixed in next plan]
```

Fill in the table for each deviation. Commit the errata in a separate commit from any fix commits.

- [ ] **Step 4: Run full test suite one more time**

Quit dev server. Run:

```bash
cargo test --workspace && pnpm lint && pnpm build
```

Expected:
- `cargo test --workspace`: 83 passed, 1 ignored, 0 failed.
- `pnpm lint`: clean.
- `pnpm build`: clean (Monaco still lazy-chunked, no new chunks of concern).

- [ ] **Step 5: Commit the errata (if any) or skip if smoke was clean**

If §3 produced an errata file:

```bash
git add docs/superpowers/errata/2026-05-27-plan-04b-multi-env-switcher.md
git commit -m "docs(errata): Plan #4b — N deviation(s) from spec"
```

If smoke was clean, no commit needed at this step — proceed to finishing-a-development-branch via the next skill.

---

## Self-Review (post-write)

**Spec coverage check:**
- §1.1 In scope items 1–3 → Tasks 1–4 (backend) + 5–7 (frontend wrappers + shadcn add) + 8–13 (UI work). ✓
- §1.2 OOS items — none of these are touched by tasks. ✓
- §3 Data types — covered by Task 1 (state.rs + signatures). ✓
- §4.1 Command table — all 5 commands either unchanged or updated; new env_delete in Task 3. ✓
- §4.2 env_delete semantics — Task 3 implements the exact code block. ✓
- §4.2.1 env_active_set semantics — Task 1 implements. ✓
- §5.0 Component library/theme — Task 7 adds the 3 new primitives. ✓
- §5.1 EnvSwitcherMenu — Task 9 creates; Task 10 wires. ✓
- §5.2 EnvEditorDialog — Task 8. ✓
- §5.3 ConfirmDeleteEnvDialog — Task 11. ✓
- §5.4 ⌘E hotkey — Task 12. ✓
- §5.5 Visual style exceptions — built into the components in Tasks 8, 9, 11. ✓
- §6 Data flows — all branches covered in Tasks 8, 10, 11, 13. ✓
- §7.2 src-tauri unit tests — all 7 tests present in Tasks 1, 2, 3. ✓
- §7.6 Manual smoke (16 steps) — Task 14. ✓

**Placeholder scan:** no "TBD", "TODO", "implement later", or "similar to Task N" left in steps. Every code step contains the full code; every command shows the full command line.

**Type consistency:**
- `EnvEditorDialogProps.originalName: string | null` — same across Tasks 8, 10, 11. ✓
- `EnvSwitcherMenuProps.onActiveSet: (name: string | null) => void` — Task 9 declares, Task 10 passes a matching callback. ✓
- `ConfirmDeleteEnvDialogProps.target: string | null` — Tasks 11 + 11 callsite. ✓
- `AppState.active_env: RwLock<Option<String>>` — Tasks 1, 2, 3 all use `read().await.clone()` returning `Option<String>` and pattern-match consistently. ✓
- `vars_resolve_impl` signature `(&self, template: &str) -> ResolutionReport` — Tasks 2 declares, Task 14 (no further callers in plan beyond commands). ✓

No type drift detected.

---

## Execution Handoff

Per the project's auto-loaded memory rule [`preference_subagent_driven_default`](../../../../../Users/1337/.claude/projects/C--dev-rust-handshaker/memory/preference_subagent_driven_default.md): **execution mode is auto-picked as Subagent-Driven** without prompting.

Next skill to invoke: `superpowers:subagent-driven-development`. That skill (per its own checklist) will create the worktree at `.claude/worktrees/plan-04b-multi-env-switcher` on branch `claude/plan-04b-multi-env-switcher` via `superpowers:using-git-worktrees`, then dispatch a fresh subagent per task with review checkpoints between tasks.
