# Plan 01 — Backend persistence (expanded flag + ui-state store)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.
> Steps use checkbox (`- [ ]`) syntax. **Detail is TDD-complete** — execute task-by-task.

**Status:** ✅ DONE (2026-06-06). All 6 tasks + final review complete; suites green
(`handshaker-core` 111, `handshaker` all, `src/ipc` 10/10). Commits `041cfa1..871854f`.
Follow-up (deferred): introduce `InMemoryUiStateStore` so `AppState::default()` / `env.rs`
test helper drop the temp-dir workaround (no functional risk today). 🧹 /clear-чекпойнт перед plan-02.
**Branch:** `claude/quirky-cannon-0d95d6`.
**Spec:** `docs/superpowers/specs/2026-06-06-collection-sidebar-improvements-design.md` §7.
**Goal:** Persist UI state of the collection on the backend — (a) per-node `expanded` flag on
collections/folders, surfaced via `collection_set_expanded`; (b) a global `ui-state.json` store
for `sort_key` + `active_request`, surfaced via `app_settings_get`/`app_settings_set`.
**Architecture:** `expanded` rides inside the existing per-collection JSON (no new file for it);
`#[serde(default)]` keeps old files loadable. Global state is a brand-new single-file store
mirroring `FileCollectionStore`, built on the existing `persist` primitives (`Envelope<T>`,
`atomic_write_json`, `read_json_or_default`).

## Build / test commands

- `cargo test -p handshaker-core` · `cargo test -p handshaker`
- `cargo run -p handshaker --bin export-bindings` (regen bindings after IPC change)
- `pnpm test src/ipc/<file>` · `pnpm lint`

## File structure (boundaries)

- Modify `crates/handshaker-core/src/collections/mod.rs` — `expanded` on `Collection`/`Folder`.
- Modify `crates/handshaker-core/src/collections/tree.rs` — `set_expanded` helper.
- Create `crates/handshaker-core/src/ui_state.rs` — `UiState` + `FileUiStateStore`.
- Modify `crates/handshaker-core/src/lib.rs` — `pub mod ui_state;`.
- Modify `src-tauri/src/ipc/collection.rs` — `expanded` on `FolderIpc`/`CollectionIpc` + converters.
- Create `src-tauri/src/ipc/ui_state.rs` — `UiStateIpc` + converters; register in `ipc/mod.rs`.
- Modify `src-tauri/src/commands/collection.rs` — `collection_set_expanded`.
- Create `src-tauri/src/commands/ui_state.rs` — `app_settings_get`/`app_settings_set`;
  register in `commands/mod.rs`.
- Modify `src-tauri/src/state.rs` — construct + hold `FileUiStateStore`.
- Modify `src-tauri/src/lib.rs` — register commands.
- Regenerate `src/ipc/bindings.ts`; modify `src/ipc/client.ts` (+ test).

---

### Task 1: `expanded` flag on core `Collection`/`Folder`

**Files:** Modify `crates/handshaker-core/src/collections/mod.rs` (structs lines 38–67);
Modify `crates/handshaker-core/src/collections/tree.rs` (add helper + tests).

- [ ] **Step 1: Write the failing test** — append to `tree.rs` `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn set_expanded_toggles_folder_flag() {
        let mut items = vec![Item::Folder(Folder {
            id: iid(1), name: "f".into(), items: vec![], expanded: false,
        })];
        assert!(set_expanded(&mut items, iid(1), true));
        match &items[0] { Item::Folder(f) => assert!(f.expanded), _ => panic!() }
        assert!(!set_expanded(&mut items, iid(999), true)); // missing → false
    }
```

(Use the existing `iid(..)` test helper in `tree.rs`; if absent, mirror the id-constructor used
by neighbouring tests.)

- [ ] **Step 2: Run to verify fail** — `cargo test -p handshaker-core set_expanded`
  Expected: FAIL — `expanded` not a field of `Folder` / `set_expanded` undefined.

- [ ] **Step 3: Add the fields.** In `mod.rs`, add to `Collection` (after `created_at`, line ~49)
  and `Folder` (after `items`, line ~64):

```rust
    #[serde(default)]
    pub expanded: bool,
```

`#[serde(default)]` is REQUIRED so existing collection JSON (no `expanded`) still deserializes.

- [ ] **Step 4: Add the tree helper.** In `tree.rs`:

```rust
/// Set the `expanded` flag of the folder with `id`, searching recursively. Returns whether found.
pub fn set_expanded(items: &mut [Item], id: ItemId, expanded: bool) -> bool {
    for it in items.iter_mut() {
        if let Item::Folder(f) = it {
            if f.id == id { f.expanded = expanded; return true; }
            if set_expanded(&mut f.items, id, expanded) { return true; }
        }
    }
    false
}
```

- [ ] **Step 5: Fix all `Folder`/`Collection` literals.** Compiler will flag every struct literal
  missing `expanded` (constructors, tests, `in_memory.rs`, `file_store.rs` fixtures). Add
  `expanded: false` to each. Run `cargo build -p handshaker-core` and fix until clean.

- [ ] **Step 6: Run to verify pass** — `cargo test -p handshaker-core`  Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/handshaker-core/src/collections/
git commit -m "feat(core): expanded flag on Collection/Folder + tree::set_expanded (plan-01)"
```

---

### Task 2: core `ui_state` store

**Files:** Create `crates/handshaker-core/src/ui_state.rs`; Modify
`crates/handshaker-core/src/lib.rs` (add `pub mod ui_state;`).

- [ ] **Step 1: Write the failing test** — create `ui_state.rs` with the struct + tests first:

```rust
use crate::persist::{atomic_write_json, read_json_or_default, Envelope};
use crate::CoreError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ActiveRequestRef {
    pub collection_id: String,
    pub item_id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct UiState {
    #[serde(default)]
    pub sort_key: Option<String>,
    #[serde(default)]
    pub active_request: Option<ActiveRequestRef>,
}

#[derive(Debug)]
pub struct FileUiStateStore {
    path: PathBuf,
    inner: RwLock<UiState>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trips_through_disk() {
        let dir = tempdir().unwrap();
        let store = FileUiStateStore::load(dir.path()).unwrap();
        assert_eq!(store.get(), UiState::default());
        store.set(UiState {
            sort_key: Some("recent".into()),
            active_request: Some(ActiveRequestRef { collection_id: "c1".into(), item_id: "r1".into() }),
        }).unwrap();
        // reload from a fresh store → persisted
        let store2 = FileUiStateStore::load(dir.path()).unwrap();
        assert_eq!(store2.get().sort_key.as_deref(), Some("recent"));
        assert_eq!(store2.get().active_request.unwrap().item_id, "r1");
    }
}
```

- [ ] **Step 2: Run to verify fail** — `cargo test -p handshaker-core ui_state`
  Expected: FAIL — `FileUiStateStore::load`/`get`/`set` undefined.

- [ ] **Step 3: Implement the store** (append to `ui_state.rs`, mirroring `FileCollectionStore`):

```rust
impl FileUiStateStore {
    /// Load `ui-state.json` from `dir` (empty default if missing/corrupt-as-default).
    pub fn load(dir: &Path) -> Result<Self, CoreError> {
        let path = dir.join("ui-state.json");
        let state: UiState = read_json_or_default(&path)?;
        Ok(Self { path, inner: RwLock::new(state) })
    }

    pub fn get(&self) -> UiState {
        self.inner.read().expect("ui_state poisoned").clone()
    }

    pub fn set(&self, state: UiState) -> Result<(), CoreError> {
        let mut guard = self.inner.write().expect("ui_state poisoned");
        atomic_write_json(&self.path, &Envelope::new(state.clone()))?;
        *guard = state;
        Ok(())
    }
}
```

Then in `crates/handshaker-core/src/lib.rs` add `pub mod ui_state;` next to the other modules.
(Confirm `tempfile` is a dev-dependency of `handshaker-core`; it is used by `file_store` tests —
if not, add it under `[dev-dependencies]`.)

- [ ] **Step 4: Run to verify pass** — `cargo test -p handshaker-core ui_state`  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/ui_state.rs crates/handshaker-core/src/lib.rs
git commit -m "feat(core): FileUiStateStore — ui-state.json (sort + active request) (plan-01)"
```

---

### Task 3: IPC DTOs — `expanded` + `UiStateIpc`

**Files:** Modify `src-tauri/src/ipc/collection.rs` (FolderIpc 105–110, CollectionIpc 188–199,
converters 135–214); Create `src-tauri/src/ipc/ui_state.rs`; Modify `src-tauri/src/ipc/mod.rs`.

- [ ] **Step 1: Add `expanded` to the IPC DTOs.** In `ipc/collection.rs`, add to `FolderIpc`
  (after `items`) and `CollectionIpc` (after `created_at`):

```rust
    pub expanded: bool,
```

- [ ] **Step 2: Thread through converters.** In `FolderIpc::from_core` set
  `expanded: f.expanded`; in `into_core` set `expanded: self.expanded`. Same for `CollectionIpc`
  `from_core`/`into_core`. (No `#[serde(default)]` needed on the IPC DTO — bindings always carry it.)

- [ ] **Step 3: Create `UiStateIpc`** — `src-tauri/src/ipc/ui_state.rs`:

```rust
use handshaker_core::ui_state::{ActiveRequestRef, UiState};
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ActiveRequestRefIpc {
    pub collection_id: String,
    pub item_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UiStateIpc {
    pub sort_key: Option<String>,
    pub active_request: Option<ActiveRequestRefIpc>,
}

impl UiStateIpc {
    pub fn from_core(s: UiState) -> Self {
        Self {
            sort_key: s.sort_key,
            active_request: s.active_request.map(|a| ActiveRequestRefIpc {
                collection_id: a.collection_id, item_id: a.item_id,
            }),
        }
    }
    pub fn into_core(self) -> UiState {
        UiState {
            sort_key: self.sort_key,
            active_request: self.active_request.map(|a| ActiveRequestRef {
                collection_id: a.collection_id, item_id: a.item_id,
            }),
        }
    }
}
```

Add `pub mod ui_state;` to `src-tauri/src/ipc/mod.rs`.

- [ ] **Step 4: Verify compile** — `cargo build -p handshaker` (fix any literal-missing-`expanded`
  in tauri-side fixtures). Existing `cargo test -p handshaker` should still pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/
git commit -m "feat(ipc): expanded on Folder/Collection DTOs + UiStateIpc (plan-01)"
```

---

### Task 4: commands — `collection_set_expanded` + app-settings

**Files:** Modify `src-tauri/src/commands/collection.rs`; Create
`src-tauri/src/commands/ui_state.rs`; Modify `src-tauri/src/commands/mod.rs`,
`src-tauri/src/state.rs`.

- [ ] **Step 1: Add `FileUiStateStore` to `AppState`.** In `state.rs`, add field
  `pub ui_state_store: Arc<FileUiStateStore>` and construct it in `AppState::load` next to
  `collection_store` (same `data_dir`): `FileUiStateStore::load(&data_dir)?` wrapped in `Arc`.

- [ ] **Step 2: Write failing Rust tests** in `commands/collection.rs` `#[cfg(test)]`:

```rust
    #[test]
    fn set_expanded_persists_collection_and_folder() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, folder_ipc(10, "f")).unwrap();
        // collection-level (item_id = None)
        state.collection_set_expanded_impl(&cid(1), None, true).unwrap();
        assert!(state.collection_get_impl(&cid(1)).unwrap().expanded);
        // folder-level
        state.collection_set_expanded_impl(&cid(1), Some(cid(10)), true).unwrap();
        let c = state.collection_get_impl(&cid(1)).unwrap();
        assert!(matches!(&c.items[0], ItemIpc::Folder(f) if f.expanded));
    }
```

(`empty_collection_ipc`/`folder_ipc`/`cid` are the existing test helpers used by the move tests.
Their `folder_ipc` constructor must now also set `expanded: false`.)

- [ ] **Step 3: Implement impl + command.** In `commands/collection.rs` add to `impl AppState`
  (mirror `collection_rename_item_impl`):

```rust
    pub fn collection_set_expanded_impl(
        &self, collection_id: &str, item_id: Option<String>, expanded: bool,
    ) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let mut c = self.require_collection(cid)?;
        match item_id {
            None => c.expanded = expanded,
            Some(iid) => {
                let iid = parse_item_id(&iid)?;
                if !tree::set_expanded(&mut c.items, iid, expanded) {
                    return Err(CoreError::InvalidTarget(format!("folder {iid:?} not found")));
                }
            }
        }
        self.collection_store.upsert(c)
    }
```

And the command wrapper (after `collection_rename_item`):

```rust
#[tauri::command]
#[specta::specta]
pub async fn collection_set_expanded(
    state: State<'_, AppState>, collection_id: String, item_id: Option<String>, expanded: bool,
) -> Result<(), IpcError> {
    state.collection_set_expanded_impl(&collection_id, item_id, expanded).map_err(IpcError::from)
}
```

- [ ] **Step 4: app-settings commands** — create `commands/ui_state.rs`:

```rust
use crate::ipc::error::IpcError;
use crate::ipc::ui_state::UiStateIpc;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn app_settings_get(state: State<'_, AppState>) -> Result<UiStateIpc, IpcError> {
    Ok(UiStateIpc::from_core(state.ui_state_store.get()))
}

#[tauri::command]
#[specta::specta]
pub async fn app_settings_set(state: State<'_, AppState>, patch: UiStateIpc) -> Result<(), IpcError> {
    state.ui_state_store.set(patch.into_core()).map_err(IpcError::from)
}
```

(`patch` replaces the whole `UiState`; the frontend always sends the full object — keep it simple.)
Add `pub mod ui_state;` to `commands/mod.rs`. (Verify the `IpcError`/`error` import path matches
the existing collection command file.)

- [ ] **Step 5: Run tests** — `cargo test -p handshaker`  Expected: PASS (incl. new test).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/state.rs
git commit -m "feat(commands): collection_set_expanded + app_settings get/set (plan-01)"
```

---

### Task 5: register commands + regenerate bindings

**Files:** Modify `src-tauri/src/lib.rs`; Regenerate `src/ipc/bindings.ts`.

- [ ] **Step 1: Register.** In `lib.rs`, add `collection_set_expanded` to the
  `commands::collection::{...}` use-list, add `use commands::ui_state::{app_settings_get,
  app_settings_set};`, and add all three to `collect_commands!`.

- [ ] **Step 2: Regenerate** — `cargo run -p handshaker --bin export-bindings`
  Then confirm: `pnpm exec rg "collectionSetExpanded|appSettingsGet|appSettingsSet" src/ipc/bindings.ts`
  Expected: three generated methods present.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs src/ipc/bindings.ts
git commit -m "feat(ipc): register set_expanded + app_settings, regen bindings (plan-01)"
```

---

### Task 6: frontend client wrappers

**Files:** Modify `src/ipc/client.ts` (+ `ipc` export); Test `src/ipc/client.uiState.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/ipc/client.uiState.test.ts` (mirror
  `client.moveAcross.test.ts`): mock `./bindings` with
  `{ collectionSetExpanded: vi.fn(), appSettingsGet: vi.fn(), appSettingsSet: vi.fn() }`; assert
  `collectionSetExpanded("c1", null, true)` forwards args, `appSettingsGet()` returns `data` on ok,
  and an error result throws `r.error`.

- [ ] **Step 2: Run to verify fail** — `pnpm test src/ipc/client.uiState.test.ts`  Expected: FAIL.

- [ ] **Step 3: Implement wrappers** in `client.ts` (mirror existing unwrap pattern):

```ts
export async function collectionSetExpanded(collectionId: string, itemId: string | null, expanded: boolean): Promise<void> {
  const r = await commands.collectionSetExpanded(collectionId, itemId, expanded);
  if (r.status === "error") throw r.error;
}
export async function appSettingsGet(): Promise<UiStateIpc> {
  const r = await commands.appSettingsGet();
  if (r.status === "error") throw r.error;
  return r.data;
}
export async function appSettingsSet(patch: UiStateIpc): Promise<void> {
  const r = await commands.appSettingsSet(patch);
  if (r.status === "error") throw r.error;
}
```

Import `UiStateIpc` from `./bindings`; add the three names to the `ipc` export object.

- [ ] **Step 4: Run to verify pass** — `pnpm test src/ipc/client.uiState.test.ts`  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/client.ts src/ipc/client.uiState.test.ts
git commit -m "feat(ipc): client wrappers for set_expanded + app_settings (plan-01)"
```

---

**Done-when:** `cargo test -p handshaker-core` + `cargo test -p handshaker` green; bindings carry
the three new commands + `expanded`; `pnpm test src/ipc` green. 🧹 /clear-чекпойнт перед plan-02.
