# Backend Schema for Collections Refactor (Plan #1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the persistent `Collection` model to match the redesign: ordered
metadata rows, a single auth config per node (no per-env map, folders carry no auth),
plus `pinned` / `description` / `created_at` / `last_used_at` / `use_count`. Update the
IPC DTOs, the resolve path, the commands, and regenerate TS bindings.

**Architecture:** Core structs in `handshaker-core::collections` change together (they
must compile as a unit); `resolve.rs` adapts metadata iteration + the auth chain; IPC
DTOs mirror the new shape and drop `AuthByEnvIpc`; commands drop `auth_set_for_env` and
gain `collection_set_node_auth` + `collection_bump_usage`. No data migration (new feature).

**Tech Stack:** Rust (handshaker-core + src-tauri/tauri-specta), serde JSON persistence,
`cargo test`. Branch `redesign/workflow-ui-spec-plans`.

**Spec ref:** `docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`
§4 (B1–B6), §7 (auth model). B7 (persist contract cache) is **plan-02**.

> **Note on timestamps:** `created_at` / `last_used_at` are epoch-ms supplied by the
> frontend (`Date.now()`), stored as `i64`. tauri-specta maps `i64` → TS `number`. If the
> specta export rejects `i64` at the IPC boundary, fall back to `f64` (epoch ms fits
> exactly in f64 below 2^53) and note it in the commit.

---

### Task 1: Core model — MetadataRow, single auth, new fields

**Files:**
- Modify: `crates/handshaker-core/src/collections/mod.rs`
- Modify (test constructors only): `crates/handshaker-core/src/collections/file_store.rs:83-93`,
  `crates/handshaker-core/src/collections/in_memory.rs` (any `Collection {…}`/`SavedRequest {…}` literals)

- [ ] **Step 1: Write the failing test** (append to `mod.rs` `#[cfg(test)]`; create the module if absent)

```rust
#[cfg(test)]
mod model_tests {
    use super::*;
    use crate::auth::SavedAuthConfig;
    use crate::collections::ids::{CollectionId, ItemId};
    use uuid::Uuid;

    #[test]
    fn saved_request_holds_ordered_metadata_and_single_auth() {
        let r = SavedRequest {
            id: ItemId(Uuid::from_u128(1)),
            name: "r".into(),
            address_template: "{{host}}".into(),
            service: "svc".into(),
            method: "M".into(),
            body_template: "{}".into(),
            metadata: vec![
                MetadataRow { key: "a".into(), value: "1".into(), enabled: true },
                MetadataRow { key: "a".into(), value: "2".into(), enabled: false },
            ],
            auth: SavedAuthConfig::None,
            tls_override: None,
            last_used_at: None,
            use_count: 0,
        };
        // duplicate keys preserved in order
        assert_eq!(r.metadata.len(), 2);
        assert!(!r.metadata[1].enabled);
    }

    #[test]
    fn collection_has_pinned_description_created_at_and_single_auth() {
        let c = Collection {
            id: CollectionId(Uuid::from_u128(2)),
            name: "c".into(),
            items: vec![],
            variables: std::collections::HashMap::new(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: true,
            description: Some("d".into()),
            created_at: 1_700_000_000_000,
        };
        assert!(c.pinned);
        assert_eq!(c.description.as_deref(), Some("d"));
    }
}
```

- [ ] **Step 2: Run — verify it fails to compile**

Run: `cargo test -p handshaker-core collections::mod 2>&1 | head -40`
Expected: compile errors — `MetadataRow` not found, unknown fields `auth`/`pinned`/etc.

- [ ] **Step 3: Rewrite the structs in `mod.rs`**

Replace the `Collection`, `Folder`, `SavedRequest` structs (lines ~29–69) and add
`MetadataRow`. Change the `use` on line 12 to import `SavedAuthConfig` (drop `AuthByEnv`):

```rust
use crate::auth::{AuthCredentials, SavedAuthConfig};
```

```rust
/// An ordered metadata header row (templated value, literal key).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MetadataRow {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Collection {
    pub id: CollectionId,
    pub name: String,
    pub items: Vec<Item>,
    pub variables: HashMap<String, String>,
    pub auth: SavedAuthConfig,
    pub default_tls: bool,
    pub skip_tls_verify: bool,
    pub pinned: bool,
    pub description: Option<String>,
    pub created_at: i64, // epoch ms, set by frontend
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Folder {
    pub id: ItemId,
    pub name: String,
    pub items: Vec<Item>,
    // no auth: folders are pure organization (spec §7)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedRequest {
    pub id: ItemId,
    pub name: String,
    pub address_template: String,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: Vec<MetadataRow>,
    pub auth: SavedAuthConfig,
    pub tls_override: Option<bool>,
    pub last_used_at: Option<i64>, // epoch ms
    pub use_count: u32,
}
```

- [ ] **Step 4: Fix in-crate test constructors**

In `file_store.rs` `coll(...)` and `in_memory.rs` test literals, replace
`auth_by_env: AuthByEnv::default()` → `auth: SavedAuthConfig::None`, and add
`pinned: false, description: None, created_at: 0`. Drop the `use crate::auth::AuthByEnv;`
where now unused; add `use crate::auth::SavedAuthConfig;`.

- [ ] **Step 5: Run — verify compile + pass**

Run: `cargo test -p handshaker-core collections 2>&1 | tail -20`
Expected: `model_tests` pass; `resolve` tests still **fail to compile** (handled in Task 2).
If only `resolve.rs` errors remain, proceed.

- [ ] **Step 6: Commit**

```bash
git add crates/handshaker-core/src/collections/mod.rs crates/handshaker-core/src/collections/file_store.rs crates/handshaker-core/src/collections/in_memory.rs
git commit -m "feat(core): metadata rows + single auth + collection meta fields"
```

---

### Task 2: resolve.rs — ordered metadata (skip disabled) + single-auth chain

**Files:**
- Modify: `crates/handshaker-core/src/collections/resolve.rs`

- [ ] **Step 1: Replace the metadata loop + auth chain**

In `resolve_request` (lines 32–46) replace the metadata build and auth call:

```rust
    let mut metadata = HashMap::with_capacity(request.metadata.len());
    for row in &request.metadata {
        if !row.enabled {
            continue; // disabled rows are not sent
        }
        // Keys are literal; only values are templated. Last enabled row wins on dup key.
        metadata.insert(row.key.clone(), resolve_string(&row.value, &vars)?);
    }

    // --- 2. TLS ---
    let tls = request.tls_override.unwrap_or(collection.default_tls);
    let target = GrpcTarget::new(address, tls, collection.skip_tls_verify)?;

    // --- 3. Auth (nearest non-None config: request → collection; folders carry none) ---
    let auth = resolve_auth_chain(request, collection)?;
```

Replace `resolve_auth_chain` (lines 60–79) and drop the now-unused `ancestors`/`env_name`
params and the `AuthByEnv` import:

```rust
/// Nearest non-`None` config wins: request first, then collection. Folders carry no auth.
fn resolve_auth_chain(
    request: &SavedRequest,
    collection: &Collection,
) -> Result<Option<crate::auth::AuthCredentials>, CoreError> {
    for cfg in [&request.auth, &collection.auth] {
        if !matches!(cfg, crate::auth::SavedAuthConfig::None) {
            return resolve_auth(cfg);
        }
    }
    Ok(None)
}
```

Update the call site for auth: it no longer depends on `active_env` (env only affects
`{{var}}` resolution + the env var the config names). Replace the `let auth = match …`
block accordingly (the snippet above already does so). Keep the `_ancestors: &[&Folder]`
parameter on `resolve_request` for signature stability but prefix with `_`, OR remove it
and update callers — **remove it** and update `commands`/tests that pass `&[]`.

Update line 8 import: `use crate::auth::{resolve_auth, SavedAuthConfig};` (drop `AuthByEnv`).

- [ ] **Step 2: Update resolve tests**

In the `#[cfg(test)]` module: `base_request()` uses `metadata: vec![]`,
`auth: SavedAuthConfig::None`, `last_used_at: None, use_count: 0` (drop `auth_by_env`).
`base_collection` uses `auth: SavedAuthConfig::None` + `pinned:false, description:None, created_at:0`.
Rewrite the metadata test to push a `MetadataRow`; rewrite the auth tests:
- `auth_nearest_some_wins_request_over_collection`: set `req.auth = EnvVar{…}`, `coll.auth = EnvVar{SHOULD_NOT}`.
- delete `auth_falls_back_to_folder_then_collection` (folders have no auth); add
  `auth_falls_back_to_collection` (req `None`, coll `EnvVar`).
- calls drop the `ancestors` arg: `resolve_request(&req, &coll, Some(&active))`.
Add a test `disabled_metadata_row_is_skipped`.

```rust
    #[test]
    fn disabled_metadata_row_is_skipped() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let mut req = base_request();
        req.metadata = vec![
            MetadataRow { key: "on".into(), value: "1".into(), enabled: true },
            MetadataRow { key: "off".into(), value: "2".into(), enabled: false },
        ];
        let eff = resolve_request(&req, &coll, Some(&active)).unwrap();
        assert_eq!(eff.metadata.get("on"), Some(&"1".to_string()));
        assert!(eff.metadata.get("off").is_none());
    }
```

(Import `MetadataRow` via `use super::super::MetadataRow;` or `use crate::collections::MetadataRow;`.)

- [ ] **Step 3: Run — verify pass**

Run: `cargo test -p handshaker-core collections 2>&1 | tail -20`
Expected: all `collections` tests pass.

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/collections/resolve.rs
git commit -m "feat(core): resolve ordered metadata + request→collection auth chain"
```

---

### Task 3: IPC DTOs — MetadataRowIpc, single auth, new fields, drop AuthByEnvIpc

**Files:**
- Modify: `src-tauri/src/ipc/collection.rs`

- [ ] **Step 1: Write the failing round-trip test**

Replace `sample_collection()` and the round-trip test in the `#[cfg(test)]` block to the
new shape; add a metadata-order assertion:

```rust
    fn sample_collection() -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(42)),
            name: "c".into(),
            items: vec![Item::Folder(Folder {
                id: ItemId(Uuid::from_u128(1)),
                name: "f".into(),
                items: vec![Item::Request(SavedRequest {
                    id: ItemId(Uuid::from_u128(2)),
                    name: "r".into(),
                    address_template: "{{host}}".into(),
                    service: "svc".into(),
                    method: "M".into(),
                    body_template: "{}".into(),
                    metadata: vec![
                        MetadataRow { key: "a".into(), value: "1".into(), enabled: true },
                        MetadataRow { key: "a".into(), value: "2".into(), enabled: false },
                    ],
                    auth: SavedAuthConfig::None,
                    tls_override: Some(true),
                    last_used_at: Some(123),
                    use_count: 4,
                })],
            })],
            variables: HashMap::new(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: true,
            description: Some("d".into()),
            created_at: 1_700_000_000_000,
        }
    }
```

(Update imports: `use handshaker_core::collections::{Collection, Folder, Item, MetadataRow, SavedRequest};`
and `use handshaker_core::auth::SavedAuthConfig;`; drop `AuthByEnv as CoreAuthByEnv`.)
In `bad_uuid_is_invalid_target`, replace `auth_by_env: AuthByEnvIpc::default()` →
`auth: SavedAuthConfigIpc::None` and add `pinned:false, description:None, created_at:0`.

- [ ] **Step 2: Run — verify it fails to compile**

Run: `cargo test -p handshaker collection 2>&1 | head -30`
Expected: unknown field / type errors.

- [ ] **Step 3: Rewrite the DTOs**

- Add `MetadataRowIpc` and delete `AuthByEnvIpc` (lines 85–102):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MetadataRowIpc {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

impl MetadataRowIpc {
    pub fn from_core(r: MetadataRow) -> Self {
        Self { key: r.key, value: r.value, enabled: r.enabled }
    }
    pub fn into_core(self) -> MetadataRow {
        MetadataRow { key: self.key, value: self.value, enabled: self.enabled }
    }
}
```

- `FolderIpc`: remove `auth_by_env`. `SavedRequestIpc`: `metadata: Vec<MetadataRowIpc>`,
  `auth: SavedAuthConfigIpc`, add `last_used_at: Option<i64>`, `use_count: u32` (drop
  `auth_by_env`). `CollectionIpc`: `auth: SavedAuthConfigIpc`, add `pinned: bool`,
  `description: Option<String>`, `created_at: i64` (drop `auth_by_env`).
- Update `ItemIpc::from_core`/`into_core` and `CollectionIpc::from_core`/`into_core`:
  folder no longer maps auth; request maps `metadata` via
  `r.metadata.into_iter().map(MetadataRowIpc::from_core).collect()` (and `.into_core()` back),
  `auth: SavedAuthConfigIpc::from_core(r.auth)` / `self.auth.into_core()`, and the new fields.
- Update imports: drop `AuthByEnv`; add `MetadataRow`.

- [ ] **Step 4: Run — verify pass**

Run: `cargo test -p handshaker collection 2>&1 | tail -20`
Expected: `collection_round_trips_through_ipc` + `bad_uuid_is_invalid_target` pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/collection.rs
git commit -m "feat(ipc): metadata-row + single-auth DTOs; drop AuthByEnvIpc"
```

---

### Task 4: Commands — drop auth_set_for_env, add set_node_auth + bump_usage

**Files:**
- Modify: `src-tauri/src/commands/collection.rs`
- Modify (register commands): `src-tauri/src/lib.rs` (the `collect_commands!`/`invoke_handler` list)

- [ ] **Step 1: Write the failing tests** (in `commands/collection.rs#tests`)

Replace `auth_set_for_env_root_node_and_clear` with:

```rust
    #[test]
    fn set_node_auth_on_collection_and_request() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        let cfg = SavedAuthConfigIpc::EnvVar {
            env_var: "TOK".into(), header_name: "authorization".into(), prefix: "Bearer ".into(),
        };
        // collection root (item_id None)
        state.collection_set_node_auth_impl(&cid(1), None, cfg.clone()).unwrap();
        // request node
        state.collection_set_node_auth_impl(&cid(1), Some(cid(20)), cfg).unwrap();
        let got = state.collection_get_impl(&cid(1)).unwrap();
        assert!(matches!(got.auth, SavedAuthConfigIpc::EnvVar { .. }));
    }

    #[test]
    fn bump_usage_sets_last_used_and_increments_count() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        state.collection_bump_usage_impl(&cid(1), &cid(20), 555).unwrap();
        state.collection_bump_usage_impl(&cid(1), &cid(20), 777).unwrap();
        let got = state.collection_get_impl(&cid(1)).unwrap();
        let req = match &got.items[0] { ItemIpc::Request(r) => r, _ => panic!() };
        assert_eq!(req.last_used_at, Some(777));
        assert_eq!(req.use_count, 2);
    }
```

Update `empty_collection_ipc` and `request_ipc` helpers to the new DTO shape
(`auth: SavedAuthConfigIpc::None`, `metadata: vec![]`, `last_used_at: None, use_count: 0`,
collection `pinned:false, description:None, created_at:0`). Update imports
(`MetadataRowIpc`, drop `AuthByEnvIpc`/`FolderIpc` auth usage).

- [ ] **Step 2: Run — verify it fails to compile**

Run: `cargo test -p handshaker collection 2>&1 | head -30`
Expected: missing `collection_set_node_auth_impl` / `collection_bump_usage_impl`.

- [ ] **Step 3: Replace `auth_set_for_env_impl` with the two new impls**

```rust
    pub fn collection_set_node_auth_impl(
        &self, collection_id: &str, item_id: Option<String>, config: SavedAuthConfigIpc,
    ) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let mut c = self.require_collection(cid)?;
        let core = config.into_core();
        match item_id {
            None => c.auth = core,
            Some(s) => {
                let iid = parse_item_id(&s)?;
                match tree::find_item_mut(&mut c.items, iid) {
                    Some(Item::Request(r)) => r.auth = core,
                    Some(Item::Folder(_)) => {
                        return Err(CoreError::InvalidTarget("folders carry no auth".into()))
                    }
                    None => return Err(CoreError::InvalidTarget(format!("item {iid:?} not found"))),
                }
            }
        }
        self.collection_store.upsert(c)
    }

    pub fn collection_bump_usage_impl(
        &self, collection_id: &str, item_id: &str, used_at: i64,
    ) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let mut c = self.require_collection(cid)?;
        match tree::find_item_mut(&mut c.items, iid) {
            Some(Item::Request(r)) => {
                r.last_used_at = Some(used_at);
                r.use_count = r.use_count.saturating_add(1);
            }
            _ => return Err(CoreError::InvalidTarget(format!("request {iid:?} not found"))),
        }
        self.collection_store.upsert(c)
    }
```

Update the `use` line 13–16 (drop `SavedAuthConfigIpc` from a removed path if needed; it
now comes from `crate::ipc::collection`). Replace the `auth_set_for_env` `#[tauri::command]`
wrapper (lines 212–216) with two wrappers:

```rust
#[tauri::command]
#[specta::specta]
pub async fn collection_set_node_auth(
    state: State<'_, AppState>, collection_id: String, item_id: Option<String>, config: SavedAuthConfigIpc,
) -> Result<(), IpcError> {
    state.collection_set_node_auth_impl(&collection_id, item_id, config).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_bump_usage(
    state: State<'_, AppState>, collection_id: String, item_id: String, used_at: i64,
) -> Result<(), IpcError> {
    state.collection_bump_usage_impl(&collection_id, &item_id, used_at).map_err(IpcError::from)
}
```

- [ ] **Step 4: Update command registration in `lib.rs`**

Find the handler list (grep `auth_set_for_env`); replace that entry with
`collection_set_node_auth, collection_bump_usage`. (Both the `collect_commands!` for
specta export and the `tauri::generate_handler!` if separate.)

- [ ] **Step 5: Run — verify pass**

Run: `cargo test -p handshaker collection 2>&1 | tail -20`
Expected: both new tests pass; existing tree tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/collection.rs src-tauri/src/lib.rs
git commit -m "feat(ipc): collection_set_node_auth + collection_bump_usage; drop auth_set_for_env"
```

---

### Task 5: Regenerate bindings + full backend gate

**Files:**
- Modify (generated): `src/ipc/bindings.ts`

- [ ] **Step 1: Regenerate TS bindings**

Run: `cargo run -p handshaker --bin export_bindings`
Expected: `src/ipc/bindings.ts` updated — `SavedRequestIpc`/`CollectionIpc`/`FolderIpc`
reflect new fields, `MetadataRowIpc` appears, `AuthByEnvIpc` gone, `collection_set_node_auth`
+ `collection_bump_usage` present, `auth_set_for_env` gone.

- [ ] **Step 2: Verify the diff looks right**

Run: `git --no-pager diff src/ipc/bindings.ts | head -80`
Expected: matches the four edits above. (If `i64` exported as `bigint`, switch timestamp
fields to `f64` in the DTOs and re-run — see header note.)

- [ ] **Step 3: Full backend gate**

Run: `cargo test -p handshaker-core 2>&1 | tail -5`
Run: `cargo test -p handshaker 2>&1 | tail -5`
Expected: both green (collections, ipc, commands, persistence, resolve).

- [ ] **Step 4: Frontend typecheck (will surface dead refs to old fields)**

Run: `pnpm lint 2>&1 | tail -30`
Expected: `tsc` errors **only** in files that read the removed `auth_by_env`/map-`metadata`
(legacy `collections/` + `App.tsx`, and `useCollections.ts`). These are addressed in
plans #3–#9. **Record the failing file list in the commit body** so later plans have the
worklist; do not fix here.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/bindings.ts
git commit -m "chore(ipc): regenerate TS bindings for collections schema change"
```

---

## Self-Review (run after writing, before execution)

- **Spec coverage:** B1 (Task 1/2/3) · B2 (Task 1/2/3/4) · B3 `pinned` (Task 1/3) ·
  B4 usage (Task 1/3/4) · B5 description (Task 1/3) · B6 created_at (Task 1/3) ·
  bindings (Task 5). **B7 is plan-02.** Folder-no-auth (§7) — Task 1/2/3/4.
- **Type consistency:** `MetadataRow{key,value,enabled}` / `MetadataRowIpc` identical
  across core+IPC; `SavedAuthConfig`/`SavedAuthConfigIpc` reused (already exist);
  timestamps `i64` everywhere; `use_count: u32`.
- **Open follow-up for plan-03:** frontend `Step.metadata` is already `MetadataRow[]`
  (`{key,value,enabled}`) — `mapping.ts` maps 1:1 to `MetadataRowIpc`.
