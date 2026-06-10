# Env Switcher — Menu Polish + Manual Environment Ordering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 🚧 in progress — tasks 1–3 done (core stores `6f93b2d`+`6a30cc7`, IPC `bd8437e`), next: task 4
**Spec:** `docs/superpowers/specs/2026-06-10-env-switcher-reorder-design.md`
**Branch:** `claude/blissful-wing-ddce4f` (worktree `.claude/worktrees/blissful-wing-ddce4f`)

**Goal:** Fix the oversized "No environment" row, restructure the env dropdown (header `+` instead of a bottom "New env…" item), and add drag-and-drop reordering of environments with the order persisted by the backend.

**Architecture:** Order becomes a first-class property of the env list: both `EnvironmentStore` impls switch from `HashMap` to `Vec<Environment>` (vector order = user order), the trait gains `reorder(names)`, and a new `env_reorder` IPC command persists drops. The frontend stops alphabetical sorting, makes env rows draggable inside the Radix dropdown (reusing the catalog `DropLine` indicator), and keeps a renamed env's position by re-issuing the order after the upsert+delete rename dance. Dead `EnvPill` component is deleted.

**Tech Stack:** Rust (handshaker-core, tauri commands, tauri-specta bindings), React 18 + TypeScript, Radix DropdownMenu, HTML5 DnD, vitest + Testing Library.

---

## Preflight (once per fresh worktree)

`cargo test -p handshaker` and the bindings export compile `src-tauri`, whose `generate_context!` requires `dist/` (see CLAUDE.md). If `dist/` is missing:

```powershell
pnpm install   # already done in this worktree
pnpm build
```

Verification commands used throughout:

```powershell
cargo test -p handshaker-core   # core stores
cargo test -p handshaker        # tauri commands (needs dist/)
pnpm test                       # vitest
pnpm lint                       # tsc -b
```

---

### Task 1: Core — `reorder` on the trait + shared permutation helper + Vec-backed in-memory store

**Files:**
- Modify: `crates/handshaker-core/src/env/mod.rs`
- Modify: `crates/handshaker-core/src/env/in_memory.rs`

- [ ] **Step 1: Write failing tests for the shared `reordered` helper** — append to the `tests` mod in `crates/handshaker-core/src/env/mod.rs`:

```rust
    fn env(name: &str) -> Environment {
        Environment { name: name.into(), variables: HashMap::new(), color: None }
    }

    #[test]
    fn reordered_rearranges() {
        let cur = vec![env("a"), env("b"), env("c")];
        let next = reordered(&cur, &["c".into(), "a".into(), "b".into()]).unwrap();
        let names: Vec<_> = next.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["c", "a", "b"]);
    }

    #[test]
    fn reordered_rejects_wrong_length() {
        let cur = vec![env("a"), env("b")];
        assert!(reordered(&cur, &["a".into()]).is_err());
    }

    #[test]
    fn reordered_rejects_unknown_name() {
        let cur = vec![env("a"), env("b")];
        assert!(reordered(&cur, &["a".into(), "ghost".into()]).is_err());
    }

    #[test]
    fn reordered_rejects_duplicate_name() {
        let cur = vec![env("a"), env("b")];
        assert!(reordered(&cur, &["a".into(), "a".into()]).is_err());
    }
```

Also add `use std::collections::HashMap;` inside the tests mod if not already imported there (the file's top-level import covers it via `use super::*`).

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p handshaker-core env::`
Expected: compile FAIL — `reordered` not found.

- [ ] **Step 3: Implement trait method + helper** in `crates/handshaker-core/src/env/mod.rs`:

Add `reorder` to the trait (replace the existing trait block):

```rust
/// Storage abstraction for environments. Implementations: [`in_memory::InMemoryEnvironmentStore`].
/// List order is canonical (user-meaningful) and must be preserved by impls.
pub trait EnvironmentStore: Send + Sync {
    /// Environments in user order.
    fn list(&self) -> Vec<Environment>;
    fn get(&self, name: &str) -> Option<Environment>;
    /// Existing name ⇒ replace in place (position preserved). New name ⇒ append.
    fn upsert(&self, env: Environment) -> Result<(), CoreError>;
    /// Order-preserving removal. Idempotent for unknown names.
    fn delete(&self, name: &str) -> Result<(), CoreError>;
    /// Rearrange the whole set to exactly `names` — must be a permutation of
    /// the current name set, otherwise `CoreError::InvalidTarget`.
    fn reorder(&self, names: &[String]) -> Result<(), CoreError>;
}
```

Add the shared helper (below `validate_env_name`):

```rust
/// Validate `names` as an exact permutation of `current`'s names and return
/// `current` rearranged to that order. Shared by store impls.
pub(crate) fn reordered(
    current: &[Environment],
    names: &[String],
) -> Result<Vec<Environment>, CoreError> {
    if names.len() != current.len() {
        return Err(CoreError::InvalidTarget(format!(
            "reorder: expected {} names, got {}",
            current.len(),
            names.len()
        )));
    }
    let mut remaining: Vec<&Environment> = current.iter().collect();
    let mut next = Vec::with_capacity(current.len());
    for name in names {
        match remaining.iter().position(|e| &e.name == name) {
            Some(i) => next.push(remaining.remove(i).clone()),
            None => {
                return Err(CoreError::InvalidTarget(format!(
                    "reorder: unknown or duplicate name `{name}`"
                )))
            }
        }
    }
    Ok(next)
}
```

- [ ] **Step 4: Write failing order tests for the in-memory store** — append to the `tests` mod in `crates/handshaker-core/src/env/in_memory.rs`:

```rust
    fn named(name: &str) -> Environment {
        Environment { name: name.into(), variables: HashMap::new(), color: None }
    }

    #[test]
    fn list_preserves_insertion_order() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["b", "a", "c"] {
            s.upsert(named(n)).unwrap();
        }
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["b", "a", "c"]);
    }

    #[test]
    fn upsert_existing_keeps_position() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["a", "b", "c"] {
            s.upsert(named(n)).unwrap();
        }
        let mut vars = HashMap::new();
        vars.insert("k".to_string(), "v".to_string());
        s.upsert(Environment { name: "b".into(), variables: vars, color: None }).unwrap();
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["a", "b", "c"]);
        assert_eq!(s.get("b").unwrap().variables.get("k"), Some(&"v".to_string()));
    }

    #[test]
    fn delete_preserves_order() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["a", "b", "c"] {
            s.upsert(named(n)).unwrap();
        }
        s.delete("b").unwrap();
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["a", "c"]);
    }

    #[test]
    fn reorder_rearranges_list() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["a", "b", "c"] {
            s.upsert(named(n)).unwrap();
        }
        s.reorder(&["c".into(), "a".into(), "b".into()]).unwrap();
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["c", "a", "b"]);
    }

    #[test]
    fn reorder_rejects_set_mismatch_and_leaves_order_unchanged() {
        let s = InMemoryEnvironmentStore::new();
        for n in ["a", "b"] {
            s.upsert(named(n)).unwrap();
        }
        assert!(s.reorder(&["a".into()]).is_err());
        assert!(s.reorder(&["a".into(), "ghost".into()]).is_err());
        let names: Vec<_> = s.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["a", "b"]);
    }
```

- [ ] **Step 5: Run to verify failure**

Run: `cargo test -p handshaker-core in_memory`
Expected: compile FAIL — `InMemoryEnvironmentStore` has no `reorder`; then (after trait change) missing trait impl.

- [ ] **Step 6: Rewrite the in-memory store as Vec-backed** — in `crates/handshaker-core/src/env/in_memory.rs`, replace the struct + impls (keep the existing module docs and the `HashMap` import — `with_default` still uses it for `variables`):

```rust
/// Thread-safe in-memory store. Backed by `RwLock<Vec<Environment>>` — the
/// vector order is the canonical user order. Env counts are tiny; O(n) name
/// lookups are fine.
pub struct InMemoryEnvironmentStore {
    inner: RwLock<Vec<Environment>>,
}

impl InMemoryEnvironmentStore {
    pub fn new() -> Self {
        Self { inner: RwLock::new(Vec::new()) }
    }

    /// Bootstrap with a single empty `"Default"` env. Used by Tauri startup.
    pub fn with_default() -> Self {
        Self {
            inner: RwLock::new(vec![Environment {
                name: "Default".to_string(),
                variables: HashMap::new(),
                color: None,
            }]),
        }
    }
}

impl Default for InMemoryEnvironmentStore {
    fn default() -> Self { Self::new() }
}

impl EnvironmentStore for InMemoryEnvironmentStore {
    fn list(&self) -> Vec<Environment> {
        self.inner.read().expect("env store lock poisoned").clone()
    }

    fn get(&self, name: &str) -> Option<Environment> {
        self.inner
            .read()
            .expect("env store lock poisoned")
            .iter()
            .find(|e| e.name == name)
            .cloned()
    }

    fn upsert(&self, env: Environment) -> Result<(), CoreError> {
        validate_env_name(&env.name)?;
        let mut guard = self.inner.write().expect("env store lock poisoned");
        match guard.iter_mut().find(|e| e.name == env.name) {
            Some(slot) => *slot = env,
            None => guard.push(env),
        }
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), CoreError> {
        self.inner
            .write()
            .expect("env store lock poisoned")
            .retain(|e| e.name != name);
        Ok(())
    }

    fn reorder(&self, names: &[String]) -> Result<(), CoreError> {
        let mut guard = self.inner.write().expect("env store lock poisoned");
        *guard = super::reordered(&guard, names)?;
        Ok(())
    }
}
```

Note: the file's existing tests (`upsert_inserts_and_replaces`, `delete_removes_silently_idempotent`, `with_default_creates_default_env`, `concurrent_upsert_and_list_does_not_panic`) must keep passing unchanged.

- [ ] **Step 7: Run core env tests**

Run: `cargo test -p handshaker-core env::`
Expected: FAIL — `file_store.rs` does not implement `reorder` yet (trait method missing). That's Task 2; to keep this task green, Task 1 and Task 2 are committed together **or** proceed directly to Task 2 before committing. **Decision: implement Task 2 next, commit both as one commit** (the trait change atomically affects both impls).

### Task 2: Core — Vec-backed `FileEnvironmentStore` (order persisted, unsorted)

**Files:**
- Modify: `crates/handshaker-core/src/env/file_store.rs`

- [ ] **Step 1: Write failing order-persistence tests** — append to the `tests` mod in `file_store.rs` (the existing `env(name, kv)` helper stays):

```rust
    #[test]
    fn order_survives_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        let store = FileEnvironmentStore::load(path.clone()).unwrap();
        for n in ["b", "a", "c"] {
            store.upsert(env(n, &[])).unwrap();
        }
        store.reorder(&["c".into(), "b".into(), "a".into()]).unwrap();
        drop(store);
        let store2 = FileEnvironmentStore::load(path).unwrap();
        let names: Vec<_> = store2.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["c", "b", "a"]);
    }

    #[test]
    fn upsert_existing_keeps_position() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        let store = FileEnvironmentStore::load(path).unwrap();
        for n in ["a", "b", "c"] {
            store.upsert(env(n, &[])).unwrap();
        }
        store.upsert(env("b", &[("k", "v")])).unwrap();
        let names: Vec<_> = store.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["a", "b", "c"]);
    }

    #[test]
    fn legacy_file_loads_in_file_order() {
        // Pre-reorder files were written alphabetically; their array order
        // simply becomes the initial user order. No migration.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        let raw = r#"{"schema_version":1,"data":[{"name":"local","variables":{}},{"name":"prod","variables":{}}]}"#;
        std::fs::write(&path, raw).unwrap();
        let store = FileEnvironmentStore::load(path).unwrap();
        let names: Vec<_> = store.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["local", "prod"]);
    }

    #[test]
    fn reorder_rejects_set_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileEnvironmentStore::load(dir.path().join("environments.json")).unwrap();
        store.upsert(env("a", &[])).unwrap();
        store.upsert(env("b", &[])).unwrap();
        assert!(store.reorder(&["a".into()]).is_err());
        assert!(store.reorder(&["a".into(), "ghost".into()]).is_err());
        let names: Vec<_> = store.list().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["a", "b"]);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p handshaker-core file_store`
Expected: compile FAIL — no `reorder` on `FileEnvironmentStore`.

- [ ] **Step 3: Rewrite the file store as Vec-backed** — replace the struct + impls in `file_store.rs` (module docs: replace the "deterministically ordered by name" sentence with "in user order"; drop the now-unused top-level `use std::collections::HashMap;` — the tests get `HashMap` through `Environment`'s field type inference):

```rust
pub struct FileEnvironmentStore {
    path: PathBuf,
    inner: RwLock<Vec<Environment>>,
}

impl FileEnvironmentStore {
    pub fn load(path: PathBuf) -> Result<Self, CoreError> {
        let list: Vec<Environment> = read_json_or_default(&path)?;
        Ok(Self { path, inner: RwLock::new(list) })
    }

    /// Serialize the given list to disk in its (user-meaningful) order.
    fn persist(&self, list: &[Environment]) -> Result<(), CoreError> {
        atomic_write_json(&self.path, &Envelope::new(list.to_vec()))
    }
}

impl EnvironmentStore for FileEnvironmentStore {
    fn list(&self) -> Vec<Environment> {
        self.inner.read().expect("env store lock poisoned").clone()
    }

    fn get(&self, name: &str) -> Option<Environment> {
        self.inner
            .read()
            .expect("env store lock poisoned")
            .iter()
            .find(|e| e.name == name)
            .cloned()
    }

    fn upsert(&self, env: Environment) -> Result<(), CoreError> {
        validate_env_name(&env.name)?;
        let mut guard = self.inner.write().expect("env store lock poisoned");
        let mut next = guard.clone();
        match next.iter_mut().find(|e| e.name == env.name) {
            Some(slot) => *slot = env,
            None => next.push(env),
        }
        self.persist(&next)?;
        *guard = next;
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), CoreError> {
        let mut guard = self.inner.write().expect("env store lock poisoned");
        if !guard.iter().any(|e| e.name == name) {
            return Ok(()); // idempotent; no disk write needed
        }
        let next: Vec<Environment> =
            guard.iter().filter(|e| e.name != name).cloned().collect();
        self.persist(&next)?;
        *guard = next;
        Ok(())
    }

    fn reorder(&self, names: &[String]) -> Result<(), CoreError> {
        let mut guard = self.inner.write().expect("env store lock poisoned");
        let next = super::reordered(&guard, names)?;
        self.persist(&next)?;
        *guard = next;
        Ok(())
    }
}
```

Existing tests (`color_persists_across_reload`, `missing_color_deserializes_as_none`, `upsert_then_reload_sees_env`, `delete_persists_across_reload`, `cold_boot_is_empty`, `rejects_invalid_name`) must keep passing unchanged.

- [ ] **Step 4: Run all core tests**

Run: `cargo test -p handshaker-core`
Expected: ALL PASS (mod.rs helper tests, in_memory order tests, file_store order tests, all pre-existing tests).

- [ ] **Step 5: Commit (Tasks 1+2 together — one atomic trait change)**

```powershell
git add crates/handshaker-core/src/env
git commit -m "feat(core): order-preserving env stores + EnvironmentStore::reorder"
```

### Task 3: IPC — `env_reorder` command + bindings + client wrapper

**Files:**
- Modify: `src-tauri/src/commands/env.rs`
- Modify: `src-tauri/src/lib.rs:14` (use list) and `:40-44` (collect_commands)
- Regenerate: `src/ipc/bindings.ts`
- Modify: `src/ipc/client.ts`

**Prerequisite:** `dist/` must exist (see Preflight).

- [ ] **Step 1: Write failing command tests** — append to the `tests` mod in `src-tauri/src/commands/env.rs`:

```rust
    #[tokio::test]
    async fn env_reorder_rearranges_list() {
        let state = build_state(&[("a", &[]), ("b", &[]), ("c", &[])], None);
        state
            .env_reorder_impl(vec!["c".into(), "a".into(), "b".into()])
            .unwrap();
        let names: Vec<String> = state.env_list_impl().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["c", "a", "b"]);
    }

    #[tokio::test]
    async fn env_reorder_rejects_set_mismatch() {
        let state = build_state(&[("a", &[]), ("b", &[])], None);
        assert!(state.env_reorder_impl(vec!["a".into()]).is_err());
        assert!(state
            .env_reorder_impl(vec!["a".into(), "ghost".into()])
            .is_err());
        assert_eq!(state.env_list_impl().len(), 2);
    }
```

(`build_state` pre-inserts via `upsert`, so with the Vec-backed store the initial order is the slice order — deterministic.)

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p handshaker env_reorder`
Expected: compile FAIL — `env_reorder_impl` not found.

- [ ] **Step 3: Implement impl + command** — in `src-tauri/src/commands/env.rs`, add to the `impl AppState` block (after `env_delete_impl`):

```rust
    /// Inner logic for `env_reorder`. Validation (exact permutation of the
    /// current env set) lives in `EnvironmentStore::reorder`.
    pub fn env_reorder_impl(&self, names: Vec<String>) -> Result<(), CoreError> {
        self.env_store.reorder(&names)
    }
```

And the command (after `env_delete`):

```rust
#[tauri::command]
#[specta::specta]
pub async fn env_reorder(state: State<'_, AppState>, names: Vec<String>) -> Result<(), IpcError> {
    state.env_reorder_impl(names).map_err(IpcError::from)
}
```

- [ ] **Step 4: Register the command** — in `src-tauri/src/lib.rs`:

Line 14: `use commands::env::{env_active_get, env_active_set, env_delete, env_list, env_reorder, env_upsert};`

In `collect_commands![...]`, after `env_delete,` add `env_reorder,`.

- [ ] **Step 5: Run tauri tests**

Run: `cargo test -p handshaker`
Expected: ALL PASS including the two new `env_reorder_*` tests.

- [ ] **Step 6: Regenerate bindings**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings`
Expected: `src/ipc/bindings.ts` regenerated; it now contains an `envReorder(names: string[])` command wrapper. Do not hand-edit the file.

- [ ] **Step 7: Add the typed client wrapper** — in `src/ipc/client.ts`, after `envDelete` (line ~108):

```ts
export async function envReorder(names: string[]): Promise<void> {
  const r = await commands.envReorder(names);
  if (r.status === "error") throw r.error;
}
```

And add `envReorder,` to the `ipc` aggregate object right after `envDelete,`.

- [ ] **Step 8: Frontend still typechecks**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src-tauri/src crates src/ipc
git commit -m "feat(ipc): env_reorder command + envReorder client wrapper"
```

### Task 4: Delete dead `EnvPill`

**Files:**
- Delete: `src/features/envs/EnvPill.tsx`
- Modify: `src/features/workflow/WorkflowEnvControl.tsx:13-20` (doc comment)

- [ ] **Step 1: Confirm it is dead**

Run: `git grep -l "EnvPill" -- src`
Expected: only `src/features/envs/EnvPill.tsx` itself and `src/features/workflow/WorkflowEnvControl.tsx` (a doc-comment mention).

- [ ] **Step 2: Delete the file**

```powershell
git rm src/features/envs/EnvPill.tsx
```

- [ ] **Step 3: Rewrite `WorkflowEnvControl`'s doc comment** so it stands alone (it currently says "Mirrors {@link EnvPill}, except…"):

```tsx
/**
 * Titlebar env switcher bound to the ACTIVE WORKFLOW.
 *
 * Env selection routes through {@link workflowStore.setWorkflowEnv} (which
 * updates the active workflow's `envName` and syncs the backend via
 * `envActiveSet`). This component never calls `ipc.envActiveSet` directly —
 * the store owns that.
 */
```

- [ ] **Step 4: Verify**

Run: `pnpm lint; if ($?) { pnpm test }`
Expected: both PASS (nothing imported EnvPill).

- [ ] **Step 5: Commit**

```powershell
git add -A src/features
git commit -m "chore(envs): delete dead EnvPill component"
```

### Task 5: `EnvSwitcherMenu` — no sort, regular "No environment", header `+`, drop "New env…"

**Files:**
- Modify: `src/features/envs/EnvSwitcherMenu.tsx`
- Test: `src/features/envs/EnvSwitcherMenu.test.tsx`

- [ ] **Step 1: Write failing tests** — in `EnvSwitcherMenu.test.tsx`, update `setup()` to pass envs in **reverse-alphabetical order** and add the new cases:

```tsx
function setup() {
  const onActiveSet = vi.fn();
  const onNewEnv = vi.fn();
  render(
    <EnvSwitcherMenu
      envs={[
        { name: "prod", variables: {}, color: null },
        { name: "local", variables: {}, color: null },
      ]}
      trigger={<button type="button">env-trigger</button>}
      onActiveSet={onActiveSet}
      onEditEnv={() => {}}
      onNewEnv={onNewEnv}
    />,
  );
  return { onActiveSet, onNewEnv };
}
```

New tests:

```tsx
  it("renders envs in prop order (no alphabetical sorting)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    const prod = await screen.findByText("prod");
    const local = screen.getByText("local");
    // prod (first in props) must precede local in the DOM.
    expect(prod.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("'No environment' is a regular-size row (no font-thin)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    const item = await screen.findByText("No environment");
    expect(item.closest("[data-slot='dropdown-menu-item']")!.className).not.toContain("font-thin");
  });

  it("header has a + button that calls onNewEnv; no bottom 'New env…' item", async () => {
    const user = userEvent.setup();
    const { onNewEnv } = setup();
    await user.click(screen.getByText("env-trigger"));
    expect(screen.queryByText(/New env/)).not.toBeInTheDocument();
    await user.click(await screen.findByLabelText("New environment"));
    expect(onNewEnv).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- EnvSwitcherMenu`
Expected: the three new tests FAIL (sorted order renders local first; `font-thin` present; "New env…" present / no "New environment" label).

- [ ] **Step 3: Restructure the component** — `EnvSwitcherMenu.tsx` becomes:

```tsx
import { Pencil, Plus } from "lucide-react";
import { forwardRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { colorHex, resolveColorKey } from "./colors";

export interface EnvSwitcherMenuProps {
  /** Environments in user order (the backend list order is canonical). */
  envs: EnvironmentIpc[];
  /** Inner content of the DropdownMenuTrigger — typically the env-pill button. */
  trigger: React.ReactNode;
  onActiveSet: (name: string | null) => void;
  /** Open the env settings/edit dialog (which also offers delete). */
  onEditEnv: (name: string) => void;
  onNewEnv: () => void;
}

/** Postman-style env switcher matching {@link WorkflowSelector}'s menu: small
 * uppercase header with a right-aligned `+` (new env), "No environment" as a
 * plain muted row, then env rows in backend order. Each env row reveals a gear
 * on hover that opens the edit dialog (where the env can also be deleted). */
export const EnvSwitcherMenu = forwardRef<HTMLButtonElement, EnvSwitcherMenuProps>(
  function EnvSwitcherMenu(props, triggerRef) {
    const { envs, trigger, onActiveSet, onEditEnv, onNewEnv } = props;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={triggerRef}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          <div className="flex items-center justify-between">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Environments
            </DropdownMenuLabel>
            <DropdownMenuItem
              aria-label="New environment"
              onSelect={onNewEnv}
              className="mr-1 h-6 w-6 justify-center p-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </DropdownMenuItem>
          </div>
          <DropdownMenuItem onSelect={() => onActiveSet(null)} className="text-muted-foreground">
            No environment
          </DropdownMenuItem>
          {envs.map((env) => (
            <div key={env.name} className="group flex items-center">
              <DropdownMenuItem className="flex-1 gap-2" onSelect={() => onActiveSet(env.name)}>
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorHex(resolveColorKey(env)) }}
                />
                {env.name}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`Edit ${env.name}`}
                onSelect={() => onEditEnv(env.name)}
                className="mr-1 h-6 w-6 justify-center p-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
```

Changes vs the old file: no `[...envs].sort(...)`; no `font-thin` on "No environment"; header is a flex row with the always-visible `+` item; the trailing `DropdownMenuSeparator` + "New env…" item are gone (and `DropdownMenuSeparator` is no longer imported).

- [ ] **Step 4: Run the suite**

Run: `pnpm test -- EnvSwitcherMenu`
Expected: ALL PASS (including the three pre-existing tests — they don't depend on sort order or the removed item).

- [ ] **Step 5: Commit**

```powershell
git add src/features/envs/EnvSwitcherMenu.tsx src/features/envs/EnvSwitcherMenu.test.tsx
git commit -m "feat(envs): env menu polish — header +, plain No-environment row, backend order"
```

### Task 6: `computeReorder` pure helper

**Files:**
- Create: `src/features/envs/reorder.ts`
- Test: `src/features/envs/reorder.test.ts`

- [ ] **Step 1: Write failing tests** — `src/features/envs/reorder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeReorder } from "./reorder";

describe("computeReorder", () => {
  const names = ["a", "b", "c"];

  it("moves a row after another", () => {
    expect(computeReorder(names, "a", "c", "after")).toEqual(["b", "c", "a"]);
  });

  it("moves a row before another", () => {
    expect(computeReorder(names, "c", "a", "before")).toEqual(["c", "a", "b"]);
  });

  it("returns null for self-drops", () => {
    expect(computeReorder(names, "b", "b", "before")).toBeNull();
  });

  it("returns null for no-op moves (drop where the row already is)", () => {
    expect(computeReorder(names, "a", "b", "before")).toBeNull();
    expect(computeReorder(names, "b", "a", "after")).toBeNull();
  });

  it("returns null for unknown names", () => {
    expect(computeReorder(names, "ghost", "a", "before")).toBeNull();
    expect(computeReorder(names, "a", "ghost", "before")).toBeNull();
  });

  it("does not mutate the input", () => {
    computeReorder(names, "a", "c", "after");
    expect(names).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- reorder`
Expected: FAIL — module `./reorder` not found.

- [ ] **Step 3: Implement** — `src/features/envs/reorder.ts`:

```ts
/**
 * Compute the full new name order after dropping `drag` before/after `target`.
 * Returns `null` when the drop is invalid (unknown names, self-drop) or a
 * no-op (the resulting order equals the current one) — callers skip the IPC
 * round-trip in that case.
 */
export function computeReorder(
  names: string[],
  drag: string,
  target: string,
  zone: "before" | "after",
): string[] | null {
  if (drag === target) return null;
  if (!names.includes(drag)) return null;
  const without = names.filter((n) => n !== drag);
  const targetIdx = without.indexOf(target);
  if (targetIdx < 0) return null;
  const insertAt = zone === "before" ? targetIdx : targetIdx + 1;
  const next = [...without.slice(0, insertAt), drag, ...without.slice(insertAt)];
  return next.some((n, i) => n !== names[i]) ? next : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- reorder`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/features/envs/reorder.ts src/features/envs/reorder.test.ts
git commit -m "feat(envs): computeReorder drop-order helper"
```

### Task 7: DnD in the menu + `onReorder` wiring in `WorkflowEnvControl`

**Files:**
- Modify: `src/features/envs/EnvSwitcherMenu.tsx`
- Modify: `src/features/workflow/WorkflowEnvControl.tsx`
- Test: `src/features/envs/EnvSwitcherMenu.test.tsx`, `src/features/workflow/WorkflowEnvControl.test.tsx`

- [ ] **Step 1: Write failing menu DnD tests** — in `EnvSwitcherMenu.test.tsx`. The new required prop `onReorder` must be added to `setup()` and to the inline render in the edit-icon test (`onReorder={() => {}}`):

```tsx
function setup() {
  const onActiveSet = vi.fn();
  const onNewEnv = vi.fn();
  const onReorder = vi.fn();
  render(
    <EnvSwitcherMenu
      envs={[
        { name: "prod", variables: {}, color: null },
        { name: "local", variables: {}, color: null },
      ]}
      trigger={<button type="button">env-trigger</button>}
      onActiveSet={onActiveSet}
      onEditEnv={() => {}}
      onNewEnv={onNewEnv}
      onReorder={onReorder}
    />,
  );
  return { onActiveSet, onNewEnv, onReorder };
}
```

Add `fireEvent` to the testing-library import, then:

```tsx
  it("drag-and-drop of an env row fires onReorder with the full new order", async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();
    await user.click(screen.getByText("env-trigger"));
    const prodRow = (await screen.findByText("prod")).closest("[data-env-row]")!;
    const localRow = screen.getByText("local").closest("[data-env-row]")!;
    fireEvent.dragStart(prodRow);
    // jsdom rects are zero-size: clientY 5 ⇒ zone "after", clientY -5 ⇒ "before".
    fireEvent.dragOver(localRow, { clientY: 5 });
    fireEvent.drop(localRow, { clientY: 5 });
    expect(onReorder).toHaveBeenCalledWith(["local", "prod"]);
  });

  it("a no-op drop (same resulting order) does not fire onReorder", async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();
    await user.click(screen.getByText("env-trigger"));
    const prodRow = (await screen.findByText("prod")).closest("[data-env-row]")!;
    const localRow = screen.getByText("local").closest("[data-env-row]")!;
    fireEvent.dragStart(prodRow);
    fireEvent.dragOver(localRow, { clientY: -5 }); // "before" local = where prod already is
    fireEvent.drop(localRow, { clientY: -5 });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("the 'No environment' row is not draggable", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    const none = await screen.findByText("No environment");
    expect(none.closest("[data-env-row]")).toBeNull();
    expect((none.closest("[data-slot='dropdown-menu-item']") as HTMLElement).draggable).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- EnvSwitcherMenu`
Expected: compile/type FAIL (`onReorder` prop unknown), DnD tests FAIL.

- [ ] **Step 3: Add DnD to the component** — final `EnvSwitcherMenu.tsx`:

```tsx
import { Pencil, Plus } from "lucide-react";
import { forwardRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DropLine } from "@/features/catalog/DropLine";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { colorHex, resolveColorKey } from "./colors";
import { computeReorder } from "./reorder";

export interface EnvSwitcherMenuProps {
  /** Environments in user order (the backend list order is canonical). */
  envs: EnvironmentIpc[];
  /** Inner content of the DropdownMenuTrigger — typically the env-pill button. */
  trigger: React.ReactNode;
  onActiveSet: (name: string | null) => void;
  /** Open the env settings/edit dialog (which also offers delete). */
  onEditEnv: (name: string) => void;
  onNewEnv: () => void;
  /** Drag-and-drop reorder: receives the full new name order. Only fired when
   * the order actually changes. */
  onReorder: (names: string[]) => void;
}

type DropZone = "before" | "after";

/** Derive the insertion zone from the pointer's vertical position in the row. */
function zoneFromPointer(rect: DOMRect, clientY: number): DropZone {
  return clientY - rect.top < rect.height / 2 ? "before" : "after";
}

/** Postman-style env switcher matching {@link WorkflowSelector}'s menu: small
 * uppercase header with a right-aligned `+` (new env), "No environment" as a
 * plain muted row, then env rows in backend order — draggable to reorder
 * (thin DropLine insertion indicator, same affordance as the sidebar). Each
 * env row reveals a gear on hover that opens the edit dialog (where the env
 * can also be deleted). */
export const EnvSwitcherMenu = forwardRef<HTMLButtonElement, EnvSwitcherMenuProps>(
  function EnvSwitcherMenu(props, triggerRef) {
    const { envs, trigger, onActiveSet, onEditEnv, onNewEnv, onReorder } = props;
    const [dragName, setDragName] = useState<string | null>(null);
    const [hint, setHint] = useState<{ name: string; zone: DropZone } | null>(null);

    const clearDnd = () => {
      setDragName(null);
      setHint(null);
    };

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={triggerRef}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          <div className="flex items-center justify-between">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Environments
            </DropdownMenuLabel>
            <DropdownMenuItem
              aria-label="New environment"
              onSelect={onNewEnv}
              className="mr-1 h-6 w-6 justify-center p-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </DropdownMenuItem>
          </div>
          <DropdownMenuItem onSelect={() => onActiveSet(null)} className="text-muted-foreground">
            No environment
          </DropdownMenuItem>
          {envs.map((env) => (
            <div
              key={env.name}
              data-env-row={env.name}
              draggable
              onDragStart={(e) => {
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                setDragName(env.name);
              }}
              onDragOver={(e) => {
                if (!dragName) return;
                e.preventDefault();
                setHint({
                  name: env.name,
                  zone: zoneFromPointer(e.currentTarget.getBoundingClientRect(), e.clientY),
                });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragName) {
                  const zone = zoneFromPointer(e.currentTarget.getBoundingClientRect(), e.clientY);
                  const next = computeReorder(
                    envs.map((x) => x.name),
                    dragName,
                    env.name,
                    zone,
                  );
                  if (next) onReorder(next);
                }
                clearDnd();
              }}
              onDragEnd={clearDnd}
              // DropLine spans between the row's --bl/--br bleed vars (a sidebar
              // concept); zero them so the line covers exactly this row.
              className="group relative flex items-center [--bl:0px] [--br:0px]"
            >
              {hint?.name === env.name && <DropLine zone={hint.zone} />}
              <DropdownMenuItem className="flex-1 gap-2" onSelect={() => onActiveSet(env.name)}>
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorHex(resolveColorKey(env)) }}
                />
                {env.name}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`Edit ${env.name}`}
                onSelect={() => onEditEnv(env.name)}
                className="mr-1 h-6 w-6 justify-center p-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
```

- [ ] **Step 4: Run menu tests**

Run: `pnpm test -- EnvSwitcherMenu`
Expected: menu tests PASS, but `pnpm lint` would fail — `WorkflowEnvControl` doesn't pass `onReorder` yet. Continue.

- [ ] **Step 5: Write failing `WorkflowEnvControl` test** — in `WorkflowEnvControl.test.tsx`, extend the mock with `envReorder` and import `fireEvent`:

```tsx
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([
    { name: "staging", variables: {}, color: null },
    { name: "prod", variables: {}, color: null },
  ]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
  envReorder: vi.fn().mockResolvedValue(undefined),
}));

import { envReorder } from "@/ipc/client";
```

New test:

```tsx
  it("drag-reordering env rows calls envReorder and reorders optimistically", async () => {
    const user = userEvent.setup();
    render(<WorkflowEnvControl />);
    await user.click(await screen.findByText("No environment")); // open the menu
    const stagingRow = (await screen.findByText("staging")).closest("[data-env-row]")!;
    const prodRow = screen.getByText("prod").closest("[data-env-row]")!;
    fireEvent.dragStart(stagingRow);
    fireEvent.dragOver(prodRow, { clientY: 5 }); // zero-size jsdom rect ⇒ "after"
    fireEvent.drop(prodRow, { clientY: 5 });
    expect(envReorder).toHaveBeenCalledWith(["prod", "staging"]);
    // Optimistic local order: prod row now precedes staging row.
    const rows = Array.from(document.querySelectorAll("[data-env-row]")).map((r) =>
      r.getAttribute("data-env-row"),
    );
    expect(rows).toEqual(["prod", "staging"]);
  });
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm test -- WorkflowEnvControl`
Expected: FAIL (no `onReorder` passed → type error / envReorder never called).

- [ ] **Step 7: Wire `onReorder` in `WorkflowEnvControl.tsx`** — extend the import (`envList` → `envList, envReorder`) and add the handler after `refreshEnvs`:

```tsx
import { envList, envReorder } from "@/ipc/client";
```

```tsx
  const handleReorder = useCallback(
    async (names: string[]) => {
      // Optimistic: apply the new order locally; on IPC failure refetch so the
      // menu snaps back to the backend's order.
      setEnvs((prev) => {
        const byName = new Map(prev.map((e) => [e.name, e] as const));
        const next = names.flatMap((n) => {
          const env = byName.get(n);
          return env ? [env] : [];
        });
        return next.length === prev.length ? next : prev;
      });
      try {
        await envReorder(names);
      } catch {
        await refreshEnvs();
      }
    },
    [refreshEnvs],
  );
```

Pass it to the menu: `onReorder={handleReorder}` (next to `onActiveSet`).

- [ ] **Step 8: Run frontend suite + lint**

Run: `pnpm test; if ($?) { pnpm lint }`
Expected: ALL PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/features/envs src/features/workflow
git commit -m "feat(envs): drag-and-drop env reordering in the switcher menu"
```

### Task 8: Rename keeps the env's position

**Files:**
- Modify: `src/features/envs/EnvEditorDialog.tsx:106-109`
- Test: `src/features/envs/EnvEditorDialog.test.tsx`

- [ ] **Step 1: Write failing tests** — in `EnvEditorDialog.test.tsx`, add `envReorder` to the ipc mock:

```tsx
vi.mock("@/ipc/client", () => ({
  ipc: {
    envUpsert: vi.fn(),
    envActiveSet: vi.fn(),
    envDelete: vi.fn(),
    envReorder: vi.fn(),
  },
}));

import { ipc } from "@/ipc/client";
```

New tests:

```tsx
describe("EnvEditorDialog rename order preservation", () => {
  const threeEnvs = [
    { name: "a", variables: {}, color: null },
    { name: "b", variables: {}, color: null },
    { name: "c", variables: {}, color: null },
  ];

  it("rename restores the env's position via envReorder", async () => {
    const user = userEvent.setup();
    render(
      <EnvEditorDialog
        open
        originalName="b"
        activeEnv={null}
        envs={threeEnvs}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "b2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ipc.envDelete).toHaveBeenCalledWith("b");
    expect(ipc.envReorder).toHaveBeenCalledWith(["a", "b2", "c"]);
  });

  it("a non-rename save does not call envReorder", async () => {
    const user = userEvent.setup();
    render(
      <EnvEditorDialog
        open
        originalName="b"
        activeEnv={null}
        envs={threeEnvs}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ipc.envReorder).not.toHaveBeenCalled();
  });
});
```

Note: mocks are module-level — if existing tests in this file assert call counts, add `vi.clearAllMocks()` in a `beforeEach` for the new describe block only if needed (the existing tests don't assert ipc calls, they test validation UI).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- EnvEditorDialog`
Expected: first new test FAILS (`envReorder` not called).

- [ ] **Step 3: Implement** — in `EnvEditorDialog.tsx`'s `handleSave`, replace step 3:

```ts
      // 3. Renaming: drop the old name, then restore the env's position —
      //    the upsert above appended the new name at the end of the order.
      if (renamed && originalName !== null) {
        await ipc.envDelete(originalName);
        await ipc.envReorder(envs.map((e) => (e.name === originalName ? trimmedName : e.name)));
      }
```

- [ ] **Step 4: Run the suite**

Run: `pnpm test -- EnvEditorDialog`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/features/envs/EnvEditorDialog.tsx src/features/envs/EnvEditorDialog.test.tsx
git commit -m "fix(envs): keep a renamed env's list position"
```

### Task 9: Full verification + status updates

**Files:**
- Modify: `docs/superpowers/plans/2026-06-10-env-switcher-reorder.md` (status banner)
- Modify: `CLAUDE.md` (Active work section)

- [ ] **Step 1: Full automated verification**

```powershell
cargo test -p handshaker-core
cargo test -p handshaker
pnpm test
pnpm lint
pnpm build
```

Expected: everything green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Manual WebView2 verification (live `pnpm tauri:dev`)** — the DnD-inside-Radix-menu risk can only be checked live:

- Open the env dropdown from the titlebar: header shows `ENVIRONMENTS` + `+` in the corner; no "New env…" at the bottom; "No environment" renders at the same size as the env rows.
- `+` opens the New-environment dialog.
- Drag an env row: menu stays open, DropLine appears at the correct before/after edge, drop reorders the list, hover-pencil still works.
- Reorder, close the app, relaunch — the order survived (persisted in `environments.json`).
- Rename a middle env — it keeps its position.

- [ ] **Step 3: Update the plan banner** (this file) to `🎉 feature-complete` with the final commit hashes, and update `CLAUDE.md`'s «Active work» line accordingly.

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/plans/2026-06-10-env-switcher-reorder.md CLAUDE.md
git commit -m "docs(plan): env-switcher-reorder feature-complete"
```
