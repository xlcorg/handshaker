# Collection import / export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 📝 NOT STARTED. Spec: [../specs/2026-06-16-collection-import-export-design.md](../specs/2026-06-16-collection-import-export-design.md). Branch: `claude/inspiring-gates-48a9bf`.

**Goal:** Let the user export collections (one, or all + all environments) to a JSON file and import such a file back with a **non-destructive merge** (update on key match, add otherwise, never delete).

**Architecture:** A new core `bundle` module reuses the existing `Envelope` atomic-write primitive to read/write a `{kind, collections, environments}` document. Three thin Tauri commands (`bundle_export`, `bundle_import_inspect`, `bundle_import_apply`) gather/merge over the existing `collection_store`/`env_store`. Native file dialogs come from `tauri-plugin-dialog`; the frontend orchestrates dialog → IPC → toast → refresh. Three entry points (collection row menu, collections-panel ⋯ menu, Settings) share one `transfer.ts` module + `useImportFlow` hook + `ImportSummaryDialog`.

**Tech Stack:** Rust (handshaker-core + Tauri), serde, `tauri-plugin-dialog`, tauri-specta bindings, React 18 + TypeScript, vitest + @testing-library/react, sonner toasts, shadcn AlertDialog/DropdownMenu.

**Prerequisites (fresh worktree):** run `pnpm install`, then build `dist/` once (`pnpm build`) before compiling `src-tauri` (`generate_context!` needs `dist/`). Full gate at the end: `cargo test --workspace`, `pnpm test`, `pnpm lint`, `pnpm build`, bindings no-drift.

---

## Phase A — Backend (Rust)

### Task 1: Core `bundle` module — `Bundle` type + `write_bundle` / `read_bundle`

**Files:**
- Create: `crates/handshaker-core/src/bundle.rs`
- Modify: `crates/handshaker-core/src/lib.rs` (add `pub mod bundle;`)

- [ ] **Step 1: Declare the module**

In `crates/handshaker-core/src/lib.rs`, add `pub mod bundle;` next to the other `pub mod` lines (e.g. after `pub mod auth;` — keep alphabetical if the file is alphabetical).

- [ ] **Step 2: Write `crates/handshaker-core/src/bundle.rs` with the type, helpers, and failing tests**

```rust
//! Portable export/import bundle: one JSON document carrying any number of
//! collections plus any number of environments. Reuses the [`Envelope`]
//! atomic-write + schema-version primitive (so a future-version file is
//! rejected for free). The `kind` tag guards against importing an unrelated
//! JSON (a single-collection on-disk file, random JSON, …).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::collections::Collection;
use crate::env::Environment;
use crate::error::CoreError;
use crate::persist::{atomic_write_json, read_json, Envelope};

/// Self-describing tag stored in every export file.
pub const BUNDLE_KIND: &str = "handshaker-export";

/// A portable export payload. Uses core types directly, so the file's serde
/// shape matches the on-disk per-collection / environments files.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bundle {
    pub kind: String,
    pub collections: Vec<Collection>,
    pub environments: Vec<Environment>,
}

impl Bundle {
    /// Wrap collections + environments with the current [`BUNDLE_KIND`].
    pub fn new(collections: Vec<Collection>, environments: Vec<Environment>) -> Self {
        Self { kind: BUNDLE_KIND.to_string(), collections, environments }
    }
}

/// Serialize `bundle` into an [`Envelope`] and atomically write it to `path`.
pub fn write_bundle(path: &Path, bundle: &Bundle) -> Result<(), CoreError> {
    atomic_write_json(path, &Envelope::new(bundle))
}

/// Read + validate an export file: envelope parse (+ future-version gate) then
/// a `kind` check. A foreign/corrupt file is a `CoreError`, never a panic.
pub fn read_bundle(path: &Path) -> Result<Bundle, CoreError> {
    let bundle: Bundle = read_json(path)?;
    if bundle.kind != BUNDLE_KIND {
        return Err(CoreError::InvalidTarget(format!(
            "not a Handshaker export file (kind `{}`)",
            bundle.kind
        )));
    }
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use uuid::Uuid;

    use super::*;
    use crate::auth::SavedAuthConfig;
    use crate::collections::ids::CollectionId;

    fn sample_collection(id: u128, name: &str) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(id)),
            name: name.into(),
            items: vec![],
            variables: HashMap::new(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
        }
    }

    fn sample_env(name: &str) -> Environment {
        Environment { name: name.into(), variables: HashMap::new(), color: None }
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.json");
        let bundle = Bundle::new(vec![sample_collection(1, "c")], vec![sample_env("prod")]);
        write_bundle(&path, &bundle).unwrap();
        let back = read_bundle(&path).unwrap();
        assert_eq!(back, bundle);
    }

    #[test]
    fn read_rejects_foreign_kind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("foreign.json");
        // A Bundle-shaped file with the wrong kind.
        let foreign = Bundle { kind: "something-else".into(), collections: vec![], environments: vec![] };
        atomic_write_json(&path, &Envelope::new(&foreign)).unwrap();
        let err = read_bundle(&path).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)), "got {err:?}");
    }

    #[test]
    fn read_rejects_non_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, b"{ not valid json").unwrap();
        assert!(matches!(read_bundle(&path).unwrap_err(), CoreError::Persistence(_)));
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cargo test -p handshaker-core bundle::`
Expected: 3 tests pass (`write_then_read_round_trips`, `read_rejects_foreign_kind`, `read_rejects_non_json`).

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/bundle.rs crates/handshaker-core/src/lib.rs
git commit -m "feat(core): bundle module — read/write portable export envelope"
```

---

### Task 2: IPC DTOs + `bundle_export_impl` + command wrapper

**Files:**
- Create: `src-tauri/src/ipc/bundle.rs`
- Modify: `src-tauri/src/ipc/mod.rs` (add `pub mod bundle;`)
- Create: `src-tauri/src/commands/bundle.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod bundle;`)

- [ ] **Step 1: Add the IPC DTOs** — `src-tauri/src/ipc/bundle.rs`

```rust
//! IPC DTOs for the import/export bundle commands.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Result of inspecting an export file before applying it (no mutation).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ImportSummaryIpc {
    pub collections_total: u32,
    pub collections_existing: u32,
    pub environments_total: u32,
    pub environments_existing: u32,
}

/// Result of applying an import (merge).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ImportResultIpc {
    pub collections_added: u32,
    pub collections_updated: u32,
    pub environments_added: u32,
    pub environments_updated: u32,
}
```

Add `pub mod bundle;` to `src-tauri/src/ipc/mod.rs` (alphabetical: before `pub mod catalog;`).

- [ ] **Step 2: Write the failing test + `bundle_export_impl`** — `src-tauri/src/commands/bundle.rs`

```rust
//! Import/export bundle commands. Thin `#[tauri::command]` wrappers over
//! `impl AppState` methods (unit-testable without Tauri's `State<'_, T>`).
//! Import is a NON-DESTRUCTIVE merge: collections keyed by id, environments by
//! name — update on match, add otherwise, never delete.

use std::path::Path;

use handshaker_core::bundle::{self, Bundle};
use handshaker_core::error::CoreError;
use tauri::State;

use crate::ipc::bundle::{ImportResultIpc, ImportSummaryIpc};
use crate::ipc::collection::parse_collection_id;
use crate::ipc::error::IpcError;
use crate::state::AppState;

impl AppState {
    /// Gather collections (+ environments when `collection_id` is None) and write
    /// the bundle to `path`. `Some(id)` exports just that collection, no envs.
    pub fn bundle_export_impl(&self, path: String, collection_id: Option<String>) -> Result<(), CoreError> {
        let bundle = match collection_id {
            None => Bundle::new(self.collection_store.list(), self.env_store.list()),
            Some(id) => {
                let cid = parse_collection_id(&id)?;
                let c = self
                    .collection_store
                    .get(cid)
                    .ok_or_else(|| CoreError::InvalidTarget(format!("no collection {cid:?}")))?;
                Bundle::new(vec![c], vec![])
            }
        };
        bundle::write_bundle(Path::new(&path), &bundle)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn bundle_export(
    state: State<'_, AppState>,
    path: String,
    collection_id: Option<String>,
) -> Result<(), IpcError> {
    state.bundle_export_impl(path, collection_id).map_err(IpcError::from)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use handshaker_core::bundle::read_bundle;
    use uuid::Uuid;

    use super::*;
    use crate::ipc::collection::CollectionIpc;
    use crate::ipc::collection::SavedAuthConfigIpc;

    fn empty_collection_ipc(id: u128, name: &str) -> CollectionIpc {
        CollectionIpc {
            id: Uuid::from_u128(id).to_string(),
            name: name.into(),
            items: vec![],
            variables: HashMap::new(),
            auth: SavedAuthConfigIpc::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
        }
    }

    #[test]
    fn export_all_writes_collections_and_envs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("all.json");
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c1")).unwrap();
        state.collection_upsert_impl(empty_collection_ipc(2, "c2")).unwrap();
        state
            .env_upsert_impl(handshaker_core::env::Environment {
                name: "prod".into(),
                variables: HashMap::new(),
                color: None,
            })
            .unwrap();

        state.bundle_export_impl(path.to_string_lossy().into_owned(), None).unwrap();

        let bundle = read_bundle(&path).unwrap();
        assert_eq!(bundle.collections.len(), 2);
        assert_eq!(bundle.environments.len(), 1);
    }

    #[test]
    fn export_one_writes_single_collection_no_envs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("one.json");
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c1")).unwrap();
        state.collection_upsert_impl(empty_collection_ipc(2, "c2")).unwrap();
        state
            .env_upsert_impl(handshaker_core::env::Environment {
                name: "prod".into(),
                variables: HashMap::new(),
                color: None,
            })
            .unwrap();

        let one = Uuid::from_u128(1).to_string();
        state.bundle_export_impl(path.to_string_lossy().into_owned(), Some(one)).unwrap();

        let bundle = read_bundle(&path).unwrap();
        assert_eq!(bundle.collections.len(), 1);
        assert_eq!(bundle.collections[0].name, "c1");
        assert!(bundle.environments.is_empty());
    }
}
```

Add `pub mod bundle;` to `src-tauri/src/commands/mod.rs` (alphabetical: after `pub mod auth;`).

> Note: `parse_collection_id`, `CollectionIpc`, `SavedAuthConfigIpc` are already `pub(crate)`/`pub` in `src-tauri/src/ipc/collection.rs`; `collection_upsert_impl` / `env_upsert_impl` already exist on `AppState`.

- [ ] **Step 3: Run the tests**

Run: `cargo test -p handshaker bundle::`
Expected: `export_all_writes_collections_and_envs` and `export_one_writes_single_collection_no_envs` pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ipc/bundle.rs src-tauri/src/ipc/mod.rs src-tauri/src/commands/bundle.rs src-tauri/src/commands/mod.rs
git commit -m "feat(ipc): bundle export command + DTOs"
```

---

### Task 3: `bundle_import_inspect_impl` + command wrapper

**Files:**
- Modify: `src-tauri/src/commands/bundle.rs`

- [ ] **Step 1: Add the failing test** (append inside the existing `#[cfg(test)] mod tests`)

```rust
    #[test]
    fn inspect_counts_existing_vs_new_without_mutating() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.json");

        // Source state → export file with c1, c2 + env prod, staging.
        let source = AppState::default();
        source.collection_upsert_impl(empty_collection_ipc(1, "c1")).unwrap();
        source.collection_upsert_impl(empty_collection_ipc(2, "c2")).unwrap();
        source.env_upsert_impl(handshaker_core::env::Environment { name: "prod".into(), variables: HashMap::new(), color: None }).unwrap();
        source.env_upsert_impl(handshaker_core::env::Environment { name: "staging".into(), variables: HashMap::new(), color: None }).unwrap();
        source.bundle_export_impl(src.to_string_lossy().into_owned(), None).unwrap();

        // Target already has c1 (id collision) + env prod (name collision).
        let target = AppState::default();
        target.collection_upsert_impl(empty_collection_ipc(1, "c1-local")).unwrap();
        target.env_upsert_impl(handshaker_core::env::Environment { name: "prod".into(), variables: HashMap::new(), color: None }).unwrap();

        let summary = target.bundle_import_inspect_impl(src.to_string_lossy().into_owned()).unwrap();
        assert_eq!(summary.collections_total, 2);
        assert_eq!(summary.collections_existing, 1); // c1
        assert_eq!(summary.environments_total, 2);
        assert_eq!(summary.environments_existing, 1); // prod

        // Inspect must NOT mutate.
        assert_eq!(target.collection_list_impl().len(), 1);
    }
```

- [ ] **Step 2: Implement `bundle_import_inspect_impl`** (add to the `impl AppState` block)

```rust
    /// Read + validate an export file and count how many of its collections /
    /// environments already exist locally. Does NOT mutate anything.
    pub fn bundle_import_inspect_impl(&self, path: String) -> Result<ImportSummaryIpc, CoreError> {
        let bundle = bundle::read_bundle(Path::new(&path))?;
        let collections_existing = bundle
            .collections
            .iter()
            .filter(|c| self.collection_store.get(c.id).is_some())
            .count() as u32;
        let environments_existing = bundle
            .environments
            .iter()
            .filter(|e| self.env_store.get(&e.name).is_some())
            .count() as u32;
        Ok(ImportSummaryIpc {
            collections_total: bundle.collections.len() as u32,
            collections_existing,
            environments_total: bundle.environments.len() as u32,
            environments_existing,
        })
    }
```

- [ ] **Step 3: Add the command wrapper** (after `bundle_export`)

```rust
#[tauri::command]
#[specta::specta]
pub async fn bundle_import_inspect(
    state: State<'_, AppState>,
    path: String,
) -> Result<ImportSummaryIpc, IpcError> {
    state.bundle_import_inspect_impl(path).map_err(IpcError::from)
}
```

- [ ] **Step 4: Run the test**

Run: `cargo test -p handshaker bundle::tests::inspect_counts_existing_vs_new_without_mutating`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/bundle.rs
git commit -m "feat(ipc): bundle import inspect (counts, no mutation)"
```

---

### Task 4: `bundle_import_apply_impl` — non-destructive merge

**Files:**
- Modify: `src-tauri/src/commands/bundle.rs`

- [ ] **Step 1: Add failing tests** (append inside `#[cfg(test)] mod tests`)

```rust
    fn env(name: &str, kv: &[(&str, &str)]) -> handshaker_core::env::Environment {
        handshaker_core::env::Environment {
            name: name.into(),
            variables: kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            color: None,
        }
    }

    #[test]
    fn apply_merges_updates_adds_and_never_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.json");

        // Source export: c1 (renamed), c2 (new) + env prod {b:2}, staging.
        let source = AppState::default();
        source.collection_upsert_impl(empty_collection_ipc(1, "c1-from-file")).unwrap();
        source.collection_upsert_impl(empty_collection_ipc(2, "c2")).unwrap();
        source.env_upsert_impl(env("prod", &[("b", "2")])).unwrap();
        source.env_upsert_impl(env("staging", &[])).unwrap();
        source.bundle_export_impl(src.to_string_lossy().into_owned(), None).unwrap();

        // Target: c1 (local name), c9 (NOT in file), env prod {a:1}, keep {x:1}.
        let target = AppState::default();
        target.collection_upsert_impl(empty_collection_ipc(1, "c1-local")).unwrap();
        target.collection_upsert_impl(empty_collection_ipc(9, "c9-local")).unwrap();
        target.env_upsert_impl(env("prod", &[("a", "1")])).unwrap();
        target.env_upsert_impl(env("keep", &[("x", "1")])).unwrap();

        let result = target.bundle_import_apply_impl(src.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.collections_added, 1); // c2
        assert_eq!(result.collections_updated, 1); // c1
        assert_eq!(result.environments_added, 1); // staging
        assert_eq!(result.environments_updated, 1); // prod

        // c1 updated to the file's name; c9 untouched; c2 added.
        let one = Uuid::from_u128(1).to_string();
        assert_eq!(target.collection_get_impl(&one).unwrap().name, "c1-from-file");
        assert!(target.collection_get_impl(&Uuid::from_u128(9).to_string()).is_ok());
        assert_eq!(target.collection_list_impl().len(), 3);

        // prod merged: a kept, b added. keep untouched. staging added.
        let prod = target.env_store.get("prod").unwrap();
        assert_eq!(prod.variables.get("a").map(String::as_str), Some("1"));
        assert_eq!(prod.variables.get("b").map(String::as_str), Some("2"));
        assert!(target.env_store.get("keep").is_some());
        assert!(target.env_store.get("staging").is_some());
    }

    #[test]
    fn apply_rejects_foreign_file_and_leaves_data_intact() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, b"{ not a bundle").unwrap();
        let target = AppState::default();
        target.collection_upsert_impl(empty_collection_ipc(1, "keep")).unwrap();

        assert!(target.bundle_import_apply_impl(bad.to_string_lossy().into_owned()).is_err());
        assert_eq!(target.collection_list_impl().len(), 1); // untouched
    }
```

- [ ] **Step 2: Implement `bundle_import_apply_impl`** (add to `impl AppState`)

```rust
    /// Apply an export file as a NON-DESTRUCTIVE merge. Collections keyed by id,
    /// environments by name. On match → update (env variables merged, imported
    /// wins on shared keys); otherwise → add. Nothing is ever deleted; the active
    /// environment is untouched. Validation happens up front, so a foreign/corrupt
    /// file changes nothing.
    pub fn bundle_import_apply_impl(&self, path: String) -> Result<ImportResultIpc, CoreError> {
        let bundle = bundle::read_bundle(Path::new(&path))?;

        let mut collections_added = 0u32;
        let mut collections_updated = 0u32;
        for c in bundle.collections {
            if self.collection_store.get(c.id).is_some() {
                collections_updated += 1;
            } else {
                collections_added += 1;
            }
            self.collection_store.upsert(c)?;
        }

        let mut environments_added = 0u32;
        let mut environments_updated = 0u32;
        for imported in bundle.environments {
            match self.env_store.get(&imported.name) {
                Some(mut existing) => {
                    for (k, v) in imported.variables {
                        existing.variables.insert(k, v);
                    }
                    if imported.color.is_some() {
                        existing.color = imported.color;
                    }
                    self.env_store.upsert(existing)?;
                    environments_updated += 1;
                }
                None => {
                    self.env_store.upsert(imported)?;
                    environments_added += 1;
                }
            }
        }

        Ok(ImportResultIpc {
            collections_added,
            collections_updated,
            environments_added,
            environments_updated,
        })
    }
```

- [ ] **Step 3: Add the command wrapper** (after `bundle_import_inspect`)

```rust
#[tauri::command]
#[specta::specta]
pub async fn bundle_import_apply(
    state: State<'_, AppState>,
    path: String,
) -> Result<ImportResultIpc, IpcError> {
    state.bundle_import_apply_impl(path).map_err(IpcError::from)
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p handshaker bundle::`
Expected: all bundle tests pass (export ×2, inspect ×1, apply ×2).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/bundle.rs
git commit -m "feat(ipc): bundle import apply — non-destructive merge"
```

---

### Task 5: Register commands + `tauri-plugin-dialog` + capabilities

**Files:**
- Modify: `Cargo.toml` (root workspace deps)
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs` (use + `collect_commands!` + `.plugin(...)`)
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json` (npm dep)

- [ ] **Step 1: Add the Rust dependency**

In the root `Cargo.toml` under `[workspace.dependencies]`, next to the other tauri plugins:

```toml
tauri-plugin-dialog = "2"
```

In `src-tauri/Cargo.toml`, next to the other `tauri-plugin-*` lines:

```toml
tauri-plugin-dialog = { workspace = true }
```

- [ ] **Step 2: Register the commands and the plugin** in `src-tauri/src/lib.rs`

Add the import near the other `use commands::...` lines:

```rust
use commands::bundle::{bundle_export, bundle_import_apply, bundle_import_inspect};
```

Add the three commands to the `collect_commands![ … ]` list (after `app_settings_set,`):

```rust
            bundle_export,
            bundle_import_inspect,
            bundle_import_apply,
```

Register the plugin in the `tauri::Builder` chain (next to the other `.plugin(...)` calls):

```rust
        .plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 3: Grant dialog permissions** in `src-tauri/capabilities/default.json`

Add to the `"permissions"` array:

```json
    "dialog:allow-open",
    "dialog:allow-save"
```

- [ ] **Step 4: Add the JS dependency** in `package.json` `dependencies`:

```json
    "@tauri-apps/plugin-dialog": "^2",
```

Then run `pnpm install`.

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check -p handshaker`
Expected: compiles with no errors (the three commands are now wired; the dialog plugin resolves).

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json pnpm-lock.yaml
git commit -m "feat(tauri): register bundle commands + dialog plugin + permissions"
```

🧹 **/clear-checkpoint** — backend complete. Fresh session for the frontend.

---

## Phase B — Bindings + IPC client

### Task 6: Regenerate bindings + add `client.ts` wrappers

**Files:**
- Modify: `src/ipc/bindings.ts` (regenerated — do not hand-edit)
- Modify: `src/ipc/client.ts`

- [ ] **Step 1: Regenerate the TypeScript bindings**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings`
Expected: prints `wrote …/src/ipc/bindings.ts`; the file now contains `bundleExport`, `bundleImportInspect`, `bundleImportApply` on `commands`, plus `ImportSummaryIpc` and `ImportResultIpc` types.

- [ ] **Step 2: Add the typed wrappers** in `src/ipc/client.ts`

Add to the type imports block (`import type { … } from "./bindings"`): `ImportSummaryIpc`, `ImportResultIpc`.

Add the wrapper functions (after `collectionRestoreItem`):

```ts
export async function bundleExport(path: string, collectionId: string | null): Promise<void> {
  const r = await commands.bundleExport(path, collectionId);
  if (r.status === "error") throw r.error;
}

export async function bundleImportInspect(path: string): Promise<ImportSummaryIpc> {
  const r = await commands.bundleImportInspect(path);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function bundleImportApply(path: string): Promise<ImportResultIpc> {
  const r = await commands.bundleImportApply(path);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

Add all three to the exported `ipc` object (after `collectionRestoreItem,`):

```ts
  bundleExport,
  bundleImportInspect,
  bundleImportApply,
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm lint`
Expected: `tsc -b` passes (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/ipc/bindings.ts src/ipc/client.ts
git commit -m "feat(ipc): regenerate bindings + bundle client wrappers"
```

---

## Phase C — Frontend orchestration & UI

### Task 7: `transfer.ts` — export + import primitives

**Files:**
- Create: `src/features/catalog/transfer.ts`
- Test: `src/features/catalog/transfer.test.ts`

- [ ] **Step 1: Write the failing test** — `src/features/catalog/transfer.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/envs/envRevision", () => ({ bumpEnvRevision: vi.fn() }));
vi.mock("@/ipc/client", () => ({
  ipc: { bundleExport: vi.fn(), bundleImportInspect: vi.fn(), bundleImportApply: vi.fn() },
}));

import { save, open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { bumpEnvRevision } from "@/features/envs/envRevision";
import { ipc } from "@/ipc/client";
import { exportBundle, pickAndInspectImport, applyImport } from "./transfer";

beforeEach(() => vi.clearAllMocks());

describe("exportBundle", () => {
  it("writes to the chosen path", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/x.json");
    await exportBundle("col-1", "x.json");
    expect(ipc.bundleExport).toHaveBeenCalledWith("/tmp/x.json", "col-1");
    expect(toast.success).toHaveBeenCalled();
  });

  it("is a no-op when the save dialog is cancelled", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await exportBundle(null, "all.json");
    expect(ipc.bundleExport).not.toHaveBeenCalled();
  });
});

describe("pickAndInspectImport", () => {
  it("returns path + summary on a picked file", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/in.json");
    const summary = { collections_total: 1, collections_existing: 0, environments_total: 0, environments_existing: 0 };
    (ipc.bundleImportInspect as ReturnType<typeof vi.fn>).mockResolvedValue(summary);
    const res = await pickAndInspectImport();
    expect(res).toEqual({ path: "/tmp/in.json", summary });
  });

  it("returns null when cancelled", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await pickAndInspectImport()).toBeNull();
    expect(ipc.bundleImportInspect).not.toHaveBeenCalled();
  });
});

describe("applyImport", () => {
  it("applies, bumps env revision, toasts", async () => {
    const result = { collections_added: 1, collections_updated: 0, environments_added: 0, environments_updated: 0 };
    (ipc.bundleImportApply as ReturnType<typeof vi.fn>).mockResolvedValue(result);
    const out = await applyImport("/tmp/in.json");
    expect(out).toEqual(result);
    expect(bumpEnvRevision).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/transfer.test.ts`
Expected: FAIL — `transfer.ts` has no such exports.

- [ ] **Step 3: Implement** — `src/features/catalog/transfer.ts`

```ts
import { save, open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { ipc } from "@/ipc/client";
import { bumpEnvRevision } from "@/features/envs/envRevision";
import type { ImportSummaryIpc, ImportResultIpc } from "@/ipc/bindings";

const FILTERS = [{ name: "Handshaker export", extensions: ["json"] }];

function errMsg(e: unknown): string {
  const t = e as { message?: string; type?: string };
  return t?.message ?? t?.type ?? "operation failed";
}

/** Export one collection (or everything when `collectionId` is null) to a chosen file. */
export async function exportBundle(collectionId: string | null, defaultName: string): Promise<void> {
  let path: string | null;
  try {
    path = await save({ defaultPath: defaultName, filters: FILTERS });
  } catch (e) {
    toast.error(errMsg(e));
    return;
  }
  if (!path) return; // cancelled
  try {
    await ipc.bundleExport(path, collectionId);
    toast.success("Exported");
  } catch (e) {
    toast.error(errMsg(e));
  }
}

/** Pick an export file and inspect it (no mutation). Returns null on cancel/error. */
export async function pickAndInspectImport(): Promise<{ path: string; summary: ImportSummaryIpc } | null> {
  let picked: string | string[] | null;
  try {
    picked = await open({ multiple: false, directory: false, filters: FILTERS });
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
  if (typeof picked !== "string") return null; // cancelled (null) or unexpected
  try {
    const summary = await ipc.bundleImportInspect(picked);
    return { path: picked, summary };
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}

/** Apply a previously-inspected import (merge). Bumps env revision; the caller reloads collections. */
export async function applyImport(path: string): Promise<ImportResultIpc | null> {
  try {
    const result = await ipc.bundleImportApply(path);
    bumpEnvRevision();
    const added = result.collections_added + result.environments_added;
    const updated = result.collections_updated + result.environments_updated;
    toast.success(`Imported — ${added} added, ${updated} updated`);
    return result;
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/transfer.test.ts`
Expected: PASS (7 assertions across 5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/transfer.ts src/features/catalog/transfer.test.ts
git commit -m "feat(catalog): transfer.ts — export/import dialog orchestration"
```

---

### Task 8: `useImportFlow` hook + `ImportSummaryDialog`

**Files:**
- Create: `src/features/catalog/useImportFlow.ts`
- Create: `src/features/catalog/ImportSummaryDialog.tsx`
- Test: `src/features/catalog/ImportSummaryDialog.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/features/catalog/ImportSummaryDialog.test.tsx`

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportSummaryDialog } from "./ImportSummaryDialog";

const summary = { collections_total: 3, collections_existing: 1, environments_total: 2, environments_existing: 1 };

describe("ImportSummaryDialog", () => {
  it("shows totals and how many will be updated, nothing deleted", () => {
    render(
      <ImportSummaryDialog open summary={summary} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/3 collections/i)).toBeInTheDocument();
    expect(screen.getByText(/2 environments/i)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is deleted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeInTheDocument();
  });

  it("fires onConfirm when Import is clicked", async () => {
    const onConfirm = vi.fn();
    render(<ImportSummaryDialog open summary={summary} onConfirm={onConfirm} onCancel={vi.fn()} />);
    screen.getByRole("button", { name: /^import$/i }).click();
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/ImportSummaryDialog.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the dialog** — `src/features/catalog/ImportSummaryDialog.tsx`

```tsx
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
import type { ImportSummaryIpc } from "@/ipc/bindings";

export interface ImportSummaryDialogProps {
  open: boolean;
  summary: ImportSummaryIpc | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Non-destructive import confirmation: shows what will be added/updated. */
export function ImportSummaryDialog({ open, summary, onConfirm, onCancel }: ImportSummaryDialogProps) {
  const existing = summary ? summary.collections_existing + summary.environments_existing : 0;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Import collections?</AlertDialogTitle>
          <AlertDialogDescription>
            {summary
              ? `${summary.collections_total} collections and ${summary.environments_total} environments will be imported.` +
                (existing > 0 ? ` ${existing} already exist and will be updated.` : "") +
                " Nothing is deleted."
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Import</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Implement the hook** — `src/features/catalog/useImportFlow.ts`

```ts
import { useCallback, useState } from "react";
import type { ImportSummaryIpc } from "@/ipc/bindings";
import { useCatalog } from "./CatalogProvider";
import { applyImport, pickAndInspectImport } from "./transfer";

export interface ImportFlow {
  pending: { path: string; summary: ImportSummaryIpc } | null;
  /** Open the file picker + inspect; opens the summary dialog on success. */
  start: () => Promise<void>;
  /** Apply the inspected import, then reload the catalog. */
  confirm: () => Promise<void>;
  cancel: () => void;
}

/** Shared import flow for the panel ⋯ menu and the Settings pane. */
export function useImportFlow(): ImportFlow {
  const cat = useCatalog();
  const [pending, setPending] = useState<{ path: string; summary: ImportSummaryIpc } | null>(null);

  const start = useCallback(async () => {
    const picked = await pickAndInspectImport();
    if (picked) setPending(picked);
  }, []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    const res = await applyImport(pending.path);
    setPending(null);
    if (res) await cat.reload();
  }, [pending, cat]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending, start, confirm, cancel };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/ImportSummaryDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/useImportFlow.ts src/features/catalog/ImportSummaryDialog.tsx src/features/catalog/ImportSummaryDialog.test.tsx
git commit -m "feat(catalog): useImportFlow hook + ImportSummaryDialog"
```

---

### Task 9: Collection row menu — `Export` item

**Files:**
- Modify: `src/features/catalog/CollectionNode.tsx`
- Test: `src/features/catalog/CollectionNode.test.tsx` (add a case)

- [ ] **Step 1: Add a failing test** in `src/features/catalog/CollectionNode.test.tsx`

```tsx
it("calls onExportCollection from the row menu Export item", async () => {
  const onExportCollection = vi.fn();
  // render CollectionNode with the existing test harness's cb, plus onExportCollection.
  // (Mirror the file's existing render helper; pass cb={{ ...baseCb, onExportCollection }}.)
  // Open the row menu and click "Export".
  renderCollectionNode({ onExportCollection });
  await openRowMenu();
  screen.getByRole("menuitem", { name: /export/i }).click();
  expect(onExportCollection).toHaveBeenCalledWith("col-id");
});
```

> Adapt to this test file's existing render helper and `TreeCallbacks` mock. The key behavior: a row-menu item labelled "Export" invokes `cb.onExportCollection(col.id)`.

- [ ] **Step 2: Thread the callback through `TreeCallbacks`**

In `src/features/catalog/treeTypes.ts` add to the `TreeCallbacks` interface:

```ts
  onExportCollection: (collectionId: string) => void;
```

Wire it where the other collection callbacks are assembled (`CollectionTree.tsx` → its `cb` object, and `SidebarShell.tsx` passes a prop down). In `SidebarShell.tsx`, pass `onExportCollection={(id) => { const c = cat.tree.find((x) => x.id === id); exportBundle(id, `${c?.name ?? "collection"}.json`); }}` (import `exportBundle` from `./transfer`). Follow the existing prop-drill pattern used by `onDuplicateItem`/`onDeleteCollection`.

- [ ] **Step 3: Add the menu item** in `CollectionNode.tsx`

Add `Download` to the lucide import, and insert the item into the `items` array between Rename and the Delete separator:

```tsx
    { icon: <Download />, label: "Export", onClick: () => cb.onExportCollection(col.id) },
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run src/features/catalog/CollectionNode.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/CollectionNode.tsx src/features/catalog/CollectionNode.test.tsx src/features/catalog/treeTypes.ts src/features/catalog/CollectionTree.tsx src/features/catalog/SidebarShell.tsx
git commit -m "feat(catalog): per-collection Export in the row menu"
```

---

### Task 10: Collections-panel ⋯ menu — `Export` + `Import`

**Files:**
- Modify: `src/features/catalog/SidebarShell.tsx`
- Test: `src/features/catalog/SidebarShell.test.tsx` (add a case)

- [ ] **Step 1: Add a failing test** in `src/features/catalog/SidebarShell.test.tsx`

```tsx
it("offers Export and Import in the collections-panel ⋯ menu", async () => {
  // Render SidebarShell within its existing test providers (CatalogProvider etc.).
  renderSidebar();
  screen.getByRole("button", { name: /collection actions/i }).click();
  expect(await screen.findByRole("menuitem", { name: /^export$/i })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /^import$/i })).toBeInTheDocument();
});
```

> Mock `@tauri-apps/plugin-dialog` (`save`/`open`) and `@/ipc/client`'s bundle methods at the top of the test file (mirror Task 7's mocks), since clicking the items reaches `transfer.ts`.

- [ ] **Step 2: Implement the panel menu** in `SidebarShell.tsx`

Add imports:

```tsx
import { MoreHorizontal } from "lucide-react";
import { exportBundle } from "./transfer";
import { useImportFlow } from "./useImportFlow";
import { ImportSummaryDialog } from "./ImportSummaryDialog";
```

Inside the component, add `const importFlow = useImportFlow();`.

In the "Collections" header row (the `div` at line ~104 with `SidebarGroupLabel` + `SortControl`), add a ⋯ `DropdownMenu` next to `SortControl`:

```tsx
          <div className="flex items-center gap-1">
            <SortControl value={sortKey} onChange={onChangeSort} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="collection actions" className="size-6">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem aria-label="export" onClick={() => void exportBundle(null, "handshaker-export.json")}>
                  <Download />
                  Export
                </DropdownMenuItem>
                <DropdownMenuItem aria-label="import" onClick={() => void importFlow.start()}>
                  <Upload />
                  Import
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
```

(Add `Download, Upload` to the lucide import; the existing row wrapper currently holds only `SortControl` — wrap both in the new flex container shown above.)

Render the dialog once near the end of the returned JSX (inside the `Sidebar`):

```tsx
      <ImportSummaryDialog
        open={importFlow.pending !== null}
        summary={importFlow.pending?.summary ?? null}
        onConfirm={() => void importFlow.confirm()}
        onCancel={importFlow.cancel}
      />
```

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run src/features/catalog/SidebarShell.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/catalog/SidebarShell.tsx src/features/catalog/SidebarShell.test.tsx
git commit -m "feat(catalog): collections-panel ⋯ menu with Export / Import"
```

---

### Task 11: Settings → `Import / Export` pane

**Files:**
- Create: `src/features/settings/ImportExportPane.tsx`
- Modify: `src/features/settings/SettingsDialog.tsx` (register the section)
- Test: `src/features/settings/ImportExportPane.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/features/settings/ImportExportPane.test.tsx`

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn().mockResolvedValue(null), open: vi.fn().mockResolvedValue(null) }));
vi.mock("@/ipc/client", () => ({
  ipc: { bundleExport: vi.fn(), bundleImportInspect: vi.fn(), bundleImportApply: vi.fn() },
}));

import { CatalogProvider } from "@/features/catalog/CatalogProvider";
import { ImportExportPane } from "./ImportExportPane";

describe("ImportExportPane", () => {
  it("renders Export and Import actions + the non-destructive note", () => {
    render(
      <CatalogProvider>
        <ImportExportPane />
      </CatalogProvider>,
    );
    expect(screen.getByRole("button", { name: /^export$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing is deleted/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/settings/ImportExportPane.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the pane** — `src/features/settings/ImportExportPane.tsx`

```tsx
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { exportBundle } from "@/features/catalog/transfer";
import { useImportFlow } from "@/features/catalog/useImportFlow";
import { ImportSummaryDialog } from "@/features/catalog/ImportSummaryDialog";

export function ImportExportPane() {
  const importFlow = useImportFlow();
  return (
    <SettingsGroup>
      <SettingsRow label="Export" description="Save all collections and environments to a JSON file.">
        <Button size="sm" variant="outline" onClick={() => void exportBundle(null, "handshaker-export.json")}>
          <Download className="size-4" />
          Export
        </Button>
      </SettingsRow>
      <SettingsRow label="Import" description="Merge collections and environments from a file — nothing is deleted.">
        <Button size="sm" variant="outline" onClick={() => void importFlow.start()}>
          <Upload className="size-4" />
          Import
        </Button>
      </SettingsRow>
      <ImportSummaryDialog
        open={importFlow.pending !== null}
        summary={importFlow.pending?.summary ?? null}
        onConfirm={() => void importFlow.confirm()}
        onCancel={importFlow.cancel}
      />
    </SettingsGroup>
  );
}
```

> Confirm the `SettingsGroup`/`SettingsRow` prop shape against `SettingsDialog.tsx` (other panes import them the same way); adjust `label`/`description` prop names if they differ.

- [ ] **Step 4: Register the section** in `src/features/settings/SettingsDialog.tsx`

Add the import: `import { ImportExportPane } from "./ImportExportPane";`. Add to the sections array (after `["keyboard", "Keyboard"]`):

```tsx
  ["import-export", "Import / Export"],
```

Add the render branch (after the keyboard branch):

```tsx
            {section === "import-export" && <ImportExportPane />}
```

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run src/features/settings/ImportExportPane.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/ImportExportPane.tsx src/features/settings/ImportExportPane.test.tsx src/features/settings/SettingsDialog.tsx
git commit -m "feat(settings): Import / Export pane"
```

---

### Task 12: Refresh the environment switcher after import

**Files:**
- Modify: `src/features/workflow/WorkflowEnvControl.tsx`
- Test: `src/features/workflow/WorkflowEnvControl.test.tsx` (add a case) — or a focused test if none exists.

- [ ] **Step 1: Add a failing test**

The env list in `WorkflowEnvControl` is fetched on mount via `refreshEnvs()`. After import, `transfer.ts` calls `bumpEnvRevision()`. The component must re-fetch when the env revision bumps.

```tsx
it("re-fetches environments when the env revision bumps", async () => {
  const { envList } = await import("@/ipc/client");
  (envList as ReturnType<typeof vi.fn>).mockResolvedValue([{ name: "prod", variables: {}, color: null }]);
  render(<WorkflowEnvControl />); // within the file's existing providers
  await waitFor(() => expect(envList).toHaveBeenCalledTimes(1));
  (await import("@/features/envs/envRevision")).bumpEnvRevision();
  await waitFor(() => expect(envList).toHaveBeenCalledTimes(2));
});
```

> Use the test file's existing mock of `@/ipc/client` (mock `envList`). If `WorkflowEnvControl.test.tsx` doesn't exist, create a minimal one mocking `@/ipc/client` and `./store` as the other workflow tests do.

- [ ] **Step 2: Subscribe to the env revision** in `WorkflowEnvControl.tsx`

Change the import to also pull the hook:

```tsx
import { bumpEnvRevision, useEnvRevision } from "@/features/envs/envRevision";
```

Add `const envRevision = useEnvRevision();` near the other hooks, and add the revision to the mount effect's deps so a bump re-fetches:

```tsx
  useEffect(() => {
    void refreshEnvs();
  }, [refreshEnvs, envRevision]);
```

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run src/features/workflow/WorkflowEnvControl.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/workflow/WorkflowEnvControl.tsx src/features/workflow/WorkflowEnvControl.test.tsx
git commit -m "feat(envs): refresh the switcher on env-revision bump (post-import)"
```

---

## Final gate

- [ ] **Run the full test + build gate**

```bash
cargo test --workspace
pnpm test
pnpm lint
pnpm build
```

Expected: all green. Then confirm bindings are not stale:

```bash
cargo run -p handshaker --bin export-bindings --features export-bindings
git diff --exit-code src/ipc/bindings.ts
```

Expected: no diff (bindings already committed in Task 6).

- [ ] **Live WebView2 pass (manual, post-merge):** `pnpm tauri:dev` → Export one collection from its row menu; Export everything from the panel ⋯ and Settings; Import the file on a second data dir / after editing a collection — confirm merge updates the matching collection, adds the rest, leaves untouched collections/envs intact, and the env switcher reflects imported environments without a reload.

---

## Self-review notes (for the implementer)

- **Spec coverage:** format/`kind` (Task 1) · per-collection + all export (Tasks 2, 9, 10, 11) · inspect (Task 3) · non-destructive merge incl. env-variable merge (Task 4) · plugin/permissions/bindings (Tasks 5, 6) · three UI entry points (Tasks 9, 10, 11) · summary dialog (Task 8) · env refresh (Task 12) · secrets lossless (no code — covered by exporting core types as-is). Active env intentionally not stored/changed (Task 4).
- **Naming consistency:** Rust `bundle_export` / `bundle_import_inspect` / `bundle_import_apply`; TS `bundleExport` / `bundleImportInspect` / `bundleImportApply`; DTOs `ImportSummaryIpc` / `ImportResultIpc`. `BUNDLE_KIND = "handshaker-export"`.
- **Test-file adaptation:** Tasks 9/10/12 add cases to existing test files whose render helpers/mocks vary — mirror each file's established harness rather than the sketch shown.
