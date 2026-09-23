# Plan #6 — Collections backend foundation (Design)

**Date:** 2026-05-31
**Branch (suggested):** `claude/plan-06-collections-backend`
**Sub-project:** #1 of 3 in the Collections feature (see §0.1). This spec covers the **backend foundation only** — the recursive collection model, persistence to disk (collections **and** environments), the request-resolution engine, the descriptor (contract) cache, and the IPC commands that expose them. No UI behaviour changes in this sub-project; the existing single-host shell keeps working unchanged until sub-project #2 rewires the address bar.

**Realizes master-spec rules** ([`2026-05-26-handshaker-mvp-design.md`](2026-05-26-handshaker-mvp-design.md)):
- Master §5.5 — `Collection / Item / Folder / SavedRequest`, `EffectiveRequest`, `resolve_request`. Implemented as specified.
- Master §5.2 — `VariableSet { env, collection }`, resolver priority `env > collection`. **Unchanged** — no per-folder variables (§4 line 139 preserved; see §0.2 reconciliation).
- Master §5.3 — `AuthByEnv` on Collection / Folder / Request with inheritance (nearest `Some` wins). Storage + resolution implemented; OAuth2 token fetch stays `NotImplemented` (master §5.4).
- Master §5.8 — `ContractCache`, `ContractKey { address, tls }`, `CachedContract { pool, catalog, fetched_at }`; `activate()` consults the cache.
- Master §6.2 — collection IPC commands (`collection_list/get/upsert/delete/set_variables/add_item/rename_item/move_item/duplicate_item/delete_item/restore_item`, `auth_set_for_env`).
- Master §4 line 148 — **promotes** the persistence placeholder (`InMemoryCollectionStore`) to a real `FileCollectionStore` (per-collection JSON, atomic temp+rename). Also fixes the pre-existing in-memory-only environment store by adding `FileEnvironmentStore` on the same primitive.

## 0. Sources and prior documents

- **Master spec:** [`2026-05-26-handshaker-mvp-design.md`](2026-05-26-handshaker-mvp-design.md) — §5.5 collections model, §5.2 variables, §5.3 auth, §5.6 gRPC types, §5.8 contract cache, §6 IPC contract. **This sub-project realizes that design; it does not redesign it.**
- **Plan #4b design:** [`2026-05-27-plan-04b-multi-env-switcher-design.md`](2026-05-27-plan-04b-multi-env-switcher-design.md) — established `active_env: Option<String>` ("No environment"), the frontend-composed-rename pattern, and the "test command fns directly with a constructed `AppState`" convention. Reused here.
- **Plan #4 errata:** [`../errata/2026-05-27-plan-04-env-vars.md`](../errata/2026-05-27-plan-04-env-vars.md) — tauri-specta emits `HashMap<String,String>` as a `Partial<{...}>` TS shape. The same coercion applies to `Collection.variables`, `SavedRequest.metadata`, and `AuthByEnv.configs`.
- **Existing core:** [`crates/handshaker-core/src/lib.rs`](../../../crates/handshaker-core/src/lib.rs) reserves `collections (plan 6)`; [`grpc/connection.rs`](../../../crates/handshaker-core/src/grpc/connection.rs) defines `GrpcTarget` + `GrpcConnection { target, transport, channel, pool, catalog }`; [`grpc/contract.rs`](../../../crates/handshaker-core/src/grpc/contract.rs) defines `activate()`; [`env/`](../../../crates/handshaker-core/src/env/mod.rs) defines `EnvironmentStore` + `InMemoryEnvironmentStore`.
- **Existing state wiring:** [`src-tauri/src/state.rs`](../../../src-tauri/src/state.rs) — `AppState { connection, env_store, active_env }`, with the line `// plan #6: pub collection_store: Arc<dyn CollectionStore>,` already reserved.
- `CoreError` ([`crates/handshaker-core/src/error.rs`](../../../crates/handshaker-core/src/error.rs)) — all needed variants already exist (master §5.1). One new variant proposed: `Persistence(String)` (see §3.4).

### 0.1 The three sub-projects (decomposition)

The full Collections feature is split into three independently-mergeable sub-projects, each with its own design + plan + implementation cycle. Rationale: the backend is a foundation with non-trivial logic (recursive tree mutation, atomic disk persistence, inheritance resolution, descriptor caching) and the repo has a strong Rust-test culture — it should be solid and covered before any UI depends on it.

1. **#1 — Backend foundation (this spec).** Core model + stores + resolver + contract cache + IPC. No UX change.
2. **#2 — Frontend data layer + address bar + Send/Save.** `useCollections` hook, `currentRequest` draft state, address bar without Connect/Disconnect, lazy connect-on-Send via the contract cache, the Save-request dialog, method picker fed by the cache.
3. **#3 — Sidebar collections tree + node views + polish.** Recursive tree with hover-`⋯` + right-click context menus (single red Delete), empty-folder hiding, Collection/Folder/Request main-pane views, folder/collection auth editors, inline-sized Env/Settings dialogs, status-colour audit.

### 0.2 Reconciliation with brainstorm (decisions that shaped this spec)

The brainstorm explored a few directions that were **reconciled back to the master spec**; recording them so the spec is unambiguous:

- **Variable scope = env + collection only.** Folders carry **no** variables (master §4 line 139 preserved). An earlier brainstorm idea of per-folder variables was dropped by the user in favour of the master-spec model. Folders carry **auth only** (master §5.3).
- **Variable priority = `env > collection`** (master §5.2 / §227; matches classic Postman where Environment overrides Collection). A "local-overrides-env" ordering was considered and rejected.
- **Root entity = `Collection`** (master §5.5). Folders/requests live inside a Collection; the Collection carries `default_tls`, `skip_tls_verify`, collection-scope `variables`, and root `auth_by_env`.
- **No "server" entity.** The endpoint is `SavedRequest.address_template` (a `{{var}}` template), resolved to `GrpcTarget` at send time (master §4 line 135). "Adding a server via the address bar" = editing the draft request's address and saving it into a collection.
- **Connection is lazy / not held.** This sub-project introduces the `ContractCache` that makes that possible (cheap re-activate on cache hit) but does **not** change the connection lifecycle yet — that rewiring is sub-project #2. Here, `activate()` simply gains a cache lookup; existing `grpc_connect`/`grpc_invoke_unary` keep working.

## 1. Goal and scope

**Goal:** stand up the entire backend for Postman-style collections so that sub-projects #2/#3 are pure frontend wiring over a stable, tested IPC surface. Concretely: a recursive `Collection` tree that persists to disk, an environment store that finally persists to disk, a `resolve_request` engine that turns a `SavedRequest` + ancestors + active env into an `EffectiveRequest` (resolved address/body/metadata/auth/TLS), a `ContractCache` keyed by `(address, tls)`, and the IPC commands to drive all of it.

**Acceptance (backend, exercised via `cargo test` + a thin manual IPC smoke):**
1. **Cold boot persistence.** Fresh app data dir → `collection_list()` returns `[]`, `env_list()` returns `[]`. Create a collection + an env, restart the process → both reappear (disk-backed). *(This is new: today envs vanish on restart.)*
2. **Tree CRUD.** `collection_upsert` a collection with a nested folder containing a request; `collection_get(id)` returns the full tree. `collection_add_item` / `rename_item` / `move_item` / `duplicate_item` / `delete_item` mutate the on-disk tree and round-trip.
3. **Idempotency.** `collection_add_item` with an already-present `ItemId` returns `Ok` without duplicating; `collection_delete` / `collection_delete_item` on a missing id returns `Ok`.
4. **Resolution.** `resolve_request(request, ancestors, collection, active_env)` produces an `EffectiveRequest` with: address/body/metadata resolved through `{{var}}` (priority `env > collection`); TLS = `request.tls_override.unwrap_or(collection.default_tls)`; auth = nearest ancestor with a `Some` config for the active env (Request → Folder(s) → Collection).
5. **Unresolved/cycle errors.** A `{{missing}}` var → `CoreError::UnresolvedVariable`; a 4-pass cycle → `CoreError::VariableCycle`.
6. **Contract cache.** Two `activate()` calls to the same `(address, tls)` perform reflection once; the second is a cache hit (assertable via a transport spy in core tests). `grpc_refresh_contract` / `collection`-driven refresh invalidates and re-reflects.
7. **Atomic writes.** A simulated write failure (unwritable temp) leaves the previous on-disk JSON intact (temp+rename never truncates the live file).

### 1.1 In scope

**Core (`crates/handshaker-core/`):**
- `persist/` — a small atomic-JSON persistence primitive (`atomic_write_json`, `read_json_or_default`, schema-version envelope). Path-injected, no Tauri dependency → unit-testable on a `tempfile::TempDir`.
- `env/file_store.rs` — `FileEnvironmentStore` implementing the existing `EnvironmentStore` trait, backed by one JSON file. `InMemoryEnvironmentStore` stays for tests.
- `collections/` — model (`CollectionId`, `ItemId`, `Collection`, `Item`, `Folder`, `SavedRequest`, `EffectiveRequest`), `CollectionStore` trait, `InMemoryCollectionStore`, `FileCollectionStore` (per-collection JSON), `resolve_request` + the inheritance/variable/TLS walk, and tree-mutation helpers (`add_item`, `rename_item`, `move_item`, `duplicate_item`, `delete_item`, `find_item`, `snapshot`/`restore`).
- `grpc/contract_cache.rs` — `ContractCache` trait + `InMemoryContractCache`, `ContractKey`, `CachedContract`. `activate()` gains an optional cache consult (cache-miss → reflect + store; cache-hit → rebuild `GrpcConnection` from the cached pool/catalog without re-reflecting).
- One new `CoreError::Persistence(String)` variant (§3.4).

**src-tauri (`src-tauri/src/`):**
- `state.rs` — `AppState` gains `collection_store: Arc<dyn CollectionStore>` and `contract_cache: Arc<dyn ContractCache>`. Production wiring switches `env_store` to `FileEnvironmentStore` and adds `FileCollectionStore`, both rooted at `app_data_dir()`. `AppState::default()` (tests) stays in-memory.
- `ipc/collection.rs` (new) — `CollectionIpc`, `ItemIpc`, `FolderIpc`, `SavedRequestIpc`, `SavedAuthConfigIpc`, `AuthByEnvIpc` + `From`/`Into` conversions to the core types (mirrors `ipc/env.rs`).
- `commands/collection.rs` (new) — the master §6.2 collection commands + `auth_set_for_env`, each a thin wrapper over an `impl AppState` method (directly unit-testable, per Plan #4b convention).
- `lib.rs` — register the new commands in `collect_commands!`; regenerate `src/ipc/bindings.ts`.
- `commands/grpc.rs` — `grpc_connect` / `grpc_refresh_contract` pass `&state.contract_cache` into `activate()`. Behaviour-preserving (refresh still forces re-reflection by invalidating first).

**Frontend (`src/`):** only the generated `ipc/bindings.ts` changes (regen) plus typed wrappers in `ipc/client.ts` for the new commands. **No component changes** in this sub-project. (The wrappers are added now so #2 can consume them; they are covered by `tsc` only.)

### 1.2 Out of scope (explicit deferrals)

- **All UI/UX behaviour.** Address bar, sidebar tree, Save dialog, node views, context menus, inline-sized modals, status-colour audit → sub-projects #2/#3.
- **Connection-lifecycle rewiring (lazy connect-on-Send).** The `ContractCache` is built here; the address bar still uses explicit `grpc_connect`/`grpc_disconnect` until #2.
- **OAuth2 token fetch.** `OAuth2ClientCredentialsSource::get_token` stays `CoreError::NotImplemented` (master §5.4 — needs the HTTP backend). `token_force_refresh` / `TokenCache` plumbing is **not** added in #1; only the `EnvVar` auth type resolves to real credentials. `auth_set_for_env` persists any `SavedAuthConfig` (including OAuth2) but resolution of OAuth2 returns `NotImplemented`.
- **Streaming invoke.** Unary only, as today.
- **Keyring / secure secret storage.** Token/secret values still read from `std::env` by name (master §4 line 143). Persistence stores only the env-var *name*, never a secret value.
- **`grpc_invoke_oneshot` / transient-connection command.** Lands in #2 with the address-bar rewire.
- **Schema migrations beyond v1.** The persistence envelope carries a `schema_version` field; only `1` exists. A future bump gets a documented migration; #1 just rejects unknown future versions with `CoreError::Persistence`.

## 2. Architecture — by layer

### 2.1 Core (`crates/handshaker-core/src/`)

```
persist/
  mod.rs            NEW — atomic_write_json<T: Serialize>(path, &T) -> Result<(), CoreError>
                          read_json_or_default<T: DeserializeOwned + Default>(path) -> Result<T, CoreError>
                          Envelope<T> { schema_version: u32, data: T }; VERSION const.
                          Atomic write = serialize → write `<path>.tmp` → fsync → rename over path.
env/
  mod.rs            UNCHANGED (trait already correct)
  in_memory.rs      UNCHANGED (kept for tests)
  file_store.rs     NEW — FileEnvironmentStore { path }: loads on construct, persists whole set on
                          every upsert/delete. Implements EnvironmentStore. Internally guards a
                          parking_lot::RwLock<HashMap<String, Environment>> mirror of disk.
collections/
  mod.rs            NEW — re-exports; Collection / Item / Folder / SavedRequest / EffectiveRequest.
  ids.rs            NEW — CollectionId(Uuid), ItemId(Uuid); uuid v7 ctor `new()`.
  resolve.rs        NEW — resolve_request(...) + ancestor/auth/tls/variable walk.
  tree.rs           NEW — pure tree ops over Vec<Item>: find_item, add_item, rename_item,
                          move_item, duplicate_item (deep clone, fresh ids), delete_item,
                          snapshot_item / restore_item. All total + idempotent where specified.
  store.rs          NEW — CollectionStore trait.
  in_memory.rs      NEW — InMemoryCollectionStore (RwLock<HashMap<CollectionId, Collection>>).
  file_store.rs     NEW — FileCollectionStore { dir }: one JSON file per collection
                          (`<dir>/<uuid>.json`), atomic temp+rename; loads all on construct.
grpc/
  contract.rs       MODIFY — activate(target, transport, cache) consults/populates ContractCache.
  contract_cache.rs NEW — ContractCache trait, InMemoryContractCache, ContractKey, CachedContract.
  mod.rs            MODIFY — pub use contract_cache::*.
lib.rs              MODIFY — pub mod collections; pub mod persist; re-exports.
error.rs            MODIFY — add CoreError::Persistence(String).
```

**Dependency note:** `persist` uses `serde_json` + `std::fs` only (no Tauri). `uuid` v7 needs the `uuid` crate with `v7` feature (check `Cargo.toml`; add if absent). `parking_lot` is already a transitive dep via tonic; confirm or use `std::sync::RwLock`.

### 2.2 src-tauri (`src-tauri/src/`)

```
state.rs            MODIFY — add collection_store + contract_cache fields.
                             Default (tests): InMemory* everywhere.
                             Production ctor `AppState::with_data_dir(&Path)` (NEW):
                               FileEnvironmentStore(<dir>/environments.json),
                               FileCollectionStore(<dir>/collections/),
                               InMemoryContractCache (session-only; not persisted).
ipc/mod.rs          MODIFY — pub mod collection;
ipc/collection.rs   NEW — *Ipc DTOs + From/Into core conversions.
commands/mod.rs     MODIFY — pub mod collection;
commands/collection.rs NEW — impl AppState methods + #[tauri::command] wrappers + #[cfg(test)] mod.
commands/grpc.rs    MODIFY — thread contract_cache into activate() calls.
lib.rs              MODIFY — collect_commands![ ...existing..., collection_* , auth_set_for_env ];
                             run() builds AppState via with_data_dir(app.path().app_data_dir()).
```

`app.path().app_data_dir()` resolution happens in `run()`'s `.setup(...)` closure (it needs the `AppHandle`); `AppState` is inserted via `app.manage(...)` inside setup instead of the current `.manage(AppState::default())`. (Tauri allows `app.manage` in setup.)

### 2.3 Frontend (`src/`)

```
ipc/bindings.ts     REGEN — new commands + Collection*/Item* types.
ipc/client.ts       MODIFY — typed wrappers: collectionList/get/upsert/delete/setVariables/
                             addItem/renameItem/moveItem/duplicateItem/deleteItem/restoreItem,
                             authSetForEnv. Each unwraps Result<T, IpcError> like the env wrappers.
```

No React component touches in #1.

## 3. Data types

### 3.1 Core types (realize master §5.5 verbatim, with serde)

All core collection types gain `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]` for persistence. Master §5.5 struct shapes are used as-is:

```rust
// ids.rs
#[derive(…, Serialize, Deserialize, Hash, Eq, PartialEq, Copy)]
pub struct CollectionId(pub uuid::Uuid);
#[derive(…, Serialize, Deserialize, Hash, Eq, PartialEq, Copy)]
pub struct ItemId(pub uuid::Uuid);
impl CollectionId { pub fn new() -> Self { Self(uuid::Uuid::now_v7()) } }
impl ItemId       { pub fn new() -> Self { Self(uuid::Uuid::now_v7()) } }

// mod.rs — exactly master §5.5
pub struct Collection { pub id: CollectionId, pub name: String, pub items: Vec<Item>,
    pub variables: HashMap<String,String>, pub auth_by_env: AuthByEnv,
    pub default_tls: bool, pub skip_tls_verify: bool }
pub enum Item { Folder(Folder), Request(SavedRequest) }
pub struct Folder { pub id: ItemId, pub name: String, pub items: Vec<Item>, pub auth_by_env: AuthByEnv }
pub struct SavedRequest { pub id: ItemId, pub name: String, pub address_template: String,
    pub service: String, pub method: String, pub body_template: String,
    pub metadata: HashMap<String,String>, pub auth_by_env: AuthByEnv, pub tls_override: Option<bool> }
pub struct EffectiveRequest { pub target: GrpcTarget, pub service: String, pub method: String,
    pub body_json: String, pub metadata: HashMap<String,String>, pub auth: Option<AuthCredentials> }
```

`AuthByEnv` / `SavedAuthConfig` / `EnvVarAuthConfig` / `OAuth2ClientCredentialsConfig` / `AuthCredentials` reuse master §5.3. They move into (or are referenced from) the existing `auth` module if present, else defined under `collections` — **decision at implementation time**: check whether Plan #5's `auth` module exists. (Glob shows no `auth/` dir yet → define these in a new `auth/mod.rs` and have `collections` depend on it, matching master's module layout §80-85.)

### 3.2 Persistence envelope

```rust
#[derive(Serialize, Deserialize)]
pub struct Envelope<T> { pub schema_version: u32, pub data: T }
pub const SCHEMA_VERSION: u32 = 1;
```

- `environments.json` → `Envelope<Vec<Environment>>`.
- `collections/<uuid>.json` → `Envelope<Collection>` (one file per collection; enables per-collection atomic writes and avoids rewriting everything on each edit — master §4 line 148).
- Read path: unknown `schema_version > SCHEMA_VERSION` → `CoreError::Persistence("unsupported schema vN")`. Missing file → `Default` (empty).

### 3.3 IPC DTOs (`src-tauri/src/ipc/collection.rs`)

Mirror `ipc/env.rs`: `#[derive(Serialize, Deserialize, specta::Type)]` DTOs with `From<core> / Into<core>`. `CollectionId`/`ItemId` serialize as strings (UUID). `HashMap<String,String>` fields surface in TS as `Partial<{[k]:string}>` (Plan #4 errata #2) — wrappers in `client.ts` coerce to plain objects on the way in/out, exactly as the env dialogs already do.

`Item` (a Rust enum) maps to a tauri-specta tagged union `{ type: "folder"; … } | { type: "request"; … }`. The frontend (#3) discriminates on `type`.

### 3.4 `CoreError` addition

```rust
#[error("persistence error: {0}")]
Persistence(String),
```

Mapped to `IpcError::Persistence { message }` (add the variant to `ipc/error.rs` + the TS union + the exhaustive-match test in `ipc/error.rs`). This is the **only** new error variant; all collection-validation failures reuse `InvalidTarget` (bad name, missing parent), and resolution failures reuse `UnresolvedVariable` / `VariableCycle` / `ServiceNotFound` / `MethodNotFound` (master §5.1).

## 4. Resolution engine (`collections/resolve.rs`)

`resolve_request(request, ancestors, collection, active_env) -> Result<EffectiveRequest, CoreError>` implements master §5.5's three-step walk. `ancestors` is the folder chain from **outermost→innermost** (Collection is passed separately; folders only).

1. **Variables.** `VariableSet { env: &active_env.variables, collection: &collection.variables }` (master §5.2). Resolve `address_template`, `body_template`, and **each metadata value** (keys are not templated). Priority `env > collection`; multi-pass (≤4); unresolved → `UnresolvedVariable`; cycle → `VariableCycle`. Reuses the existing `vars::resolve` (extend its `VariableSet` if today it only takes a single map — check `vars/mod.rs`).
2. **TLS.** `tls = request.tls_override.unwrap_or(collection.default_tls)`; `skip_verify = collection.skip_tls_verify`. Build `GrpcTarget::new(resolved_address, tls, skip_verify)` (validates host:port).
3. **Auth.** Walk `Request → innermost Folder → … → Collection`; pick the nearest node whose `auth_by_env.configs.get(active_env.name)` is `Some`. Resolve that `SavedAuthConfig`:
   - `None` → `auth = None`.
   - `EnvVar { env_var, header_name, prefix }` → read `std::env::var(env_var)`; missing → `CoreError::Auth("env var {…} not set")`; else `AuthCredentials { header_name, header_value: prefix + value }`.
   - `OAuth2ClientCredentials(_)` → `CoreError::NotImplemented("oauth2 token fetch")` (master §5.4; deferred).
   - No node has a config → `auth = None` (unauthenticated).

`resolve_request` is **pure** (only `std::env` read for auth) → fully unit-testable.

## 5. Tree operations (`collections/tree.rs`)

Pure functions over `&mut Vec<Item>` (the collection's `items`). All operate by `ItemId` and recurse into folders.

| Fn | Semantics |
|---|---|
| `find_item(&[Item], ItemId) -> Option<&Item>` / `_mut` | DFS. |
| `find_parent_items_mut(&mut Vec<Item>, ItemId) -> Option<(&mut Vec<Item>, usize)>` | Locate the container `Vec` + index holding the item (for move/delete). |
| `add_item(&mut Vec<Item>, parent: Option<ItemId>, item: Item) -> Result<(),CoreError>` | Append under `parent` folder (or root if `None`). Idempotent: if `item.id()` already present anywhere, return `Ok` without inserting. `parent` not found / not a folder → `InvalidTarget`. |
| `rename_item(&mut Vec<Item>, ItemId, name) -> Result<(),CoreError>` | Set name. Missing → `InvalidTarget`. Idempotent (same name → Ok). |
| `move_item(&mut Vec<Item>, ItemId, new_parent: Option<ItemId>, pos: usize)` | Detach + reinsert at `pos` under `new_parent`. Reject moving a folder **into its own descendant** (`InvalidTarget`). |
| `duplicate_item(&mut Vec<Item>, ItemId) -> Result<ItemId,CoreError>` | Deep clone with **fresh** `ItemId`s throughout the subtree; insert as next sibling; return new root id. |
| `delete_item(&mut Vec<Item>, ItemId) -> Option<ItemSnapshot>` | Remove + return snapshot for undo. Missing → `None` (idempotent at command layer). |
| `restore_item(&mut Vec<Item>, snapshot, parent: Option<ItemId>, pos)` | Reinsert a snapshot (undo). |

`ItemSnapshot` = the removed `Item` plus its former `(parent, position)`; used by `collection_restore_item`.

## 6. Persistence primitive (`persist/`)

```rust
pub fn atomic_write_json<T: Serialize>(path: &Path, value: &Envelope<T>) -> Result<(), CoreError> {
    // 1. serialize to Vec<u8>
    // 2. write to `<path>.tmp` (create+truncate), write_all, sync_all (fsync)
    // 3. fs::rename(tmp, path)  // atomic on same volume
    // map every io/serde error → CoreError::Persistence(...)
}
pub fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T, CoreError>;
```

- Parent dirs created on first write (`create_dir_all`).
- `FileEnvironmentStore` writes the whole `Vec<Environment>` on each mutation (small data; simplicity > incrementality).
- `FileCollectionStore` writes only the touched collection's file; `delete` removes the file. Both keep an in-memory `RwLock` mirror so reads never hit disk.
- **Crash-safety:** rename is atomic; a crash mid-write leaves either the old file or the fully-written new file, never a truncated one. The `.tmp` may be orphaned — cleaned on next write.

## 7. IPC contract (additions; realize master §6.2)

### 7.1 Commands

| Command | Args | Return |
|---|---|---|
| `collection_list` | — | `Vec<CollectionMetaIpc>` (id + name only) |
| `collection_get` | `id: String` | `CollectionIpc` (full tree) — `InvalidTarget` if absent |
| `collection_upsert` | `collection: CollectionIpc` | `()` |
| `collection_delete` | `id: String` | `()` (idempotent) |
| `collection_set_variables` | `id: String, vars: Map<String,String>` | `()` |
| `collection_add_item` | `collection_id, parent_id: Option<String>, item: ItemIpc` | `()` (idempotent) |
| `collection_rename_item` | `collection_id, item_id, name` | `()` (idempotent) |
| `collection_move_item` | `collection_id, item_id, new_parent_id: Option<String>, position: u32` | `()` |
| `collection_duplicate_item` | `collection_id, item_id` | `String` (new item id) |
| `collection_delete_item` | `collection_id, item_id` | `Option<ItemSnapshotIpc>` (snapshot for undo; `null` if the item was already absent — idempotent) |
| `collection_restore_item` | `collection_id, snapshot: ItemSnapshotIpc, parent_id: Option<String>, position: u32` | `()` |
| `auth_set_for_env` | `collection_id, item_id: Option<String>, env_name, config: Option<SavedAuthConfigIpc>` | `()` (`None` config = reset to inherited) |

All return `Result<_, IpcError>`. Each `#[tauri::command]` is a thin wrapper over an `impl AppState` method (Plan #4b convention) so the logic is testable without Tauri plumbing.

### 7.2 Events

**None added.** Master §6.3 lists only `ContractUpdated` / `ConnectionStateChanged`. Collection mutations propagate via command replies + frontend refetch (the #2/#3 pattern, same as envs in Plan #4b §6.3).

### 7.3 `activate()` signature change

```rust
// before: activate(target, transport) -> Result<GrpcConnection, CoreError>
// after:  activate(target, transport, cache: &dyn ContractCache) -> Result<GrpcConnection, CoreError>
```

Cache-hit → build `GrpcConnection` from `CachedContract.pool` + `.catalog` + a fresh `channel` (the channel is per-connection, not cached). Cache-miss → reflect, build pool/catalog, store `CachedContract`, return connection. `grpc_refresh_contract` calls `cache.invalidate(&key)` before `activate()`. All existing callers in `commands/grpc.rs` pass `&state.contract_cache`. Core tests that call `activate()` pass a throwaway `InMemoryContractCache`.

## 8. Testing strategy

The repo's bar: `cargo test --workspace` currently ~83 passing (post-4b). This sub-project is backend-heavy → most coverage is Rust unit/integration.

### 8.1 Core unit tests (`crates/handshaker-core`)

| Module | Tests |
|---|---|
| `persist` | atomic write+read round-trip; missing file → default; unwritable dir → `Persistence`; **interrupted write leaves old file intact** (write v1, then a write that fails before rename, assert v1 still readable); unknown future `schema_version` → `Persistence`. |
| `env::file_store` | upsert→reload from a new `FileEnvironmentStore` on the same path sees the env; delete persists; survives "restart" (drop + reconstruct). |
| `collections::tree` | add/rename/move/delete/duplicate; idempotent add (dup id); move-into-own-descendant rejected; duplicate makes fresh ids (assert ids differ at every depth); delete returns snapshot; restore reinserts at position. |
| `collections::resolve` | var priority `env > collection`; unresolved → `UnresolvedVariable`; cycle → `VariableCycle`; TLS override vs collection default; auth nearest-Some across Request/Folder/Collection; `EnvVar` reads `std::env` (set a temp var); OAuth2 → `NotImplemented`; no-config → `auth=None`. |
| `collections::file_store` | per-collection file created/removed; reload sees full tree; two collections → two files; corrupt file → `Persistence` (doesn't panic). |
| `grpc::contract_cache` + `contract` | cache miss then hit (transport spy counts reflection calls == 1 for two activates); invalidate forces re-reflect. Uses the existing in-core transport fake (see `tests/common/`). |

### 8.2 src-tauri unit tests (`commands/collection.rs`, `#[cfg(test)]`)

Pattern from `commands/env.rs`: build an `AppState` with `InMemory*` stores, call the `impl AppState` methods directly.

- `collection_upsert` then `collection_get` round-trips the tree.
- `collection_add_item` under a folder; under root; idempotent on dup id; bad parent → `InvalidTarget`.
- `collection_delete` idempotent on missing id.
- `collection_move_item` across folders; rejects cyclic move.
- `collection_duplicate_item` returns a new id; tree grows by one subtree.
- `collection_delete_item` returns a snapshot; `collection_restore_item` puts it back.
- `auth_set_for_env(item=None)` sets collection-root auth; `item=Some` sets a node's auth; `config=None` clears it.

### 8.3 Integration test (`crates/handshaker-core/tests/`)

`collections_persistence.rs` — construct `FileCollectionStore` on a `TempDir`, build a collection with a folder + request, mutate via tree ops through the store, drop + reconstruct the store, assert the tree survived. Mirrors the existing `vars_end_to_end.rs` style.

### 8.4 `ipc/error.rs`

Extend `from_core_error_exhaustive` for the new `Persistence` variant (this test is intentionally exhaustive — adding a `CoreError` variant without updating it fails compilation, which is the guard).

### 8.5 Frontend

No Vitest (unchanged). `pnpm lint` (tsc) must stay green after `client.ts` wrappers + `bindings.ts` regen. The wrappers are exercised for real in sub-project #2.

### 8.6 Manual IPC smoke (thin)

With `pnpm tauri dev`, from the devtools console (or a temporary dev button — removed before merge), call `collection_upsert` + `collection_get` once and restart to confirm disk persistence (acceptance #1). Full UX smoke belongs to #2/#3.

## 9. Open risks and mitigation

| # | Risk | Mitigation |
|---|---|---|
| R1 | `activate()` signature change ripples to every caller (commands + core tests + `tests/*.rs`). | Compiler-enforced; update all call sites in the same task. The set is small (`grpc.rs` ×2, a handful of `tests/invoke_*.rs` / `reflection_*.rs`). Consider a default `&NoCache` to minimize test churn — **decided against** (explicit cache keeps tests honest about cache behaviour). |
| R2 | `app_data_dir()` differs per-OS and may not exist on first run. | `create_dir_all` on first write; `read_json_or_default` treats missing as empty. Manual smoke on Windows (dev machine); macOS/Linux deferred to errata if unexercisable. |
| R3 | Moving `AppState` construction into `.setup()` (needs `AppHandle` for the path) changes `run()`. | Tauri supports `app.manage()` inside setup. Keep `AppState::default()` for tests; add `with_data_dir()` for prod. Low risk; verified by app boot. |
| R4 | tauri-specta union mapping for `Item` (Folder \| Request) and `Option<SavedAuthConfig>` may emit awkward TS. | Validated by `tsc` on regen. If the union shape is unergonomic, add a thin normalizer in `client.ts` (#2 consumes it). Document the emitted shape in an errata if it surprises. |
| R5 | `HashMap` → `Partial<{...}>` TS shape (Plan #4 errata #2) for `variables`/`metadata`/`auth configs`. | Same coercion the env dialogs already use; wrappers normalize. |
| R6 | `uuid` v7 feature not enabled in core `Cargo.toml`. | Add `uuid = { version, features = ["v7", "serde"] }` in Task 0; `now_v7()` needs the `v7` feature. |
| R7 | Per-collection files could drift from the in-memory mirror if a write half-fails. | Mirror is updated **after** a successful `atomic_write_json`; on write error the in-memory state is rolled back to pre-mutation (clone-then-commit). |
| R8 | Determinism in tests: `uuid::now_v7()` is time-based. | Tree tests assert *structure* and *id distinctness*, never specific id values. Where a fixed id is needed, construct `ItemId(Uuid::from_u128(n))` directly. |

## 10. Implementation order (input to writing-plans)

TDD-friendly; `writing-plans` refines into tasks with subagent breakdown (per `preference_subagent_driven_default`).

0. **Deps + error variant.** Add `uuid` v7+serde and (if needed) `tempfile` dev-dep to core `Cargo.toml`. Add `CoreError::Persistence`; add `IpcError::Persistence` + TS union entry + extend the exhaustive-match test. `cargo test --workspace` green.
1. **`persist/` primitive** + tests (atomic write, default-on-missing, crash-leaves-old, bad version).
2. **`FileEnvironmentStore`** + tests; switch production wiring (still `AppState::default()` for tests). Manual: env survives restart.
3. **`auth` types** (master §5.3) — `SavedAuthConfig` family + `AuthByEnv` + `AuthCredentials`. Pure types + a couple of `EnvVar` resolution tests.
4. **`collections` model + `ids` + `tree`** + tree tests (add/rename/move/duplicate/delete/restore, idempotency, cyclic-move guard).
5. **`collections::resolve`** + resolution tests (vars, TLS, auth inheritance). Extend `vars::VariableSet` if needed.
6. **`CollectionStore` trait + `InMemoryCollectionStore` + `FileCollectionStore`** + store/persistence tests + the integration test.
7. **`ContractCache`** + `activate()` rewire; update all call sites; cache hit/miss tests.
8. **`AppState` fields + `with_data_dir`**; production wiring in `run()` via `.setup()`.
9. **`ipc/collection.rs` DTOs** + `From/Into`.
10. **`commands/collection.rs`** (impl methods + command wrappers + `#[cfg(test)]`); register in `collect_commands!`. Thread `contract_cache` through `commands/grpc.rs`.
11. **Regen bindings** (`cargo run -p handshaker --bin export-bindings`); add `client.ts` wrappers; `pnpm lint` green.
12. **Full `cargo test --workspace`** green; thin manual persistence smoke (acceptance #1).
13. **Errata** if any deviation surfaces.

## 11. Sources verified before submission

| Source | URL / path | Used for |
|---|---|---|
| Master spec §5.5 | `2026-05-26-handshaker-mvp-design.md` | Collection/Item/Folder/SavedRequest/EffectiveRequest shapes, inheritance walk |
| Master spec §5.2 | local | `VariableSet { env, collection }`, resolver priority `env > collection`, no per-folder vars |
| Master spec §5.3 / §5.4 | local | `AuthByEnv` + `SavedAuthConfig` family; lazy OAuth2 deferred (`NotImplemented`) |
| Master spec §5.6 | local | `GrpcTarget`, `GrpcConnection` fields |
| Master spec §5.8 | local | `ContractCache`, `ContractKey { address, tls }`, `CachedContract`; `activate()` consults cache |
| Master spec §6.2 | local | collection IPC command list + `auth_set_for_env` |
| Master spec §6.3 | local | events — confirms none added for collections |
| Master spec §4 lines 135/139/143/148 | local | address-as-template, no per-folder vars, secrets-by-env-name, persistence promotion |
| Plan #4b design §1.2 / §7.2 | `2026-05-27-plan-04b-multi-env-switcher-design.md` | impl-AppState-method test convention; frontend-refetch (no events) pattern |
| Plan #4 errata #2 | `../errata/2026-05-27-plan-04-env-vars.md` | `HashMap<String,String>` → `Partial<{...}>` TS coercion |
| `grpc/connection.rs` | `../../../crates/handshaker-core/src/grpc/connection.rs` | real `GrpcTarget` / `GrpcConnection` fields (channel/pool/catalog) |
| `grpc/mod.rs` | local | `activate` re-export location (`contract::activate`) |
| `state.rs` | `../../../src-tauri/src/state.rs` | reserved `collection_store` slot; AppState shape |
| `commands/env.rs` | local | command-wrapper + `#[cfg(test)]` pattern to mirror for collections |
| Tauri `app_data_dir` / `manage` in setup | <https://v2.tauri.app/develop/state-management/> + <https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html> | production store path resolution; managing state inside `.setup()` |
| Memory `feedback_verify_technical_claims` | local | source-citation requirement |
| Memory `feedback_ui_transparent_mechanics` | local | (applies to #3 UI; noted) no cache/inheritance indicators in tree |
| Memory `preference_subagent_driven_default` | local | execution mode after writing-plans |
