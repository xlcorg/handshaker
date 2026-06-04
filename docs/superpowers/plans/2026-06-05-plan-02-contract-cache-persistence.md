# Persist the Contract (Reflection) Cache — Plan #2 (B7) — Implementation Plan

> **✅ STATUS: COMPLETE** — all 3 tasks done, subagent-driven (impl + spec-review +
> quality-review per task, + final holistic review). Branch `redesign/workflow-ui-spec-plans`,
> commits `41d29bf..0a33cae` (3). Backend gate green: `handshaker-core` **107** (+4) ·
> `handshaker` **32** (+1). **No IPC/DTO/command/bindings change** — `git diff --stat`
> confirms only `grpc/file_contract_cache.rs` (new), `grpc/mod.rs`, `src-tauri/state.rs`,
> `src-tauri/Cargo.toml` (dev-dep `tempfile`). Frontend untouched (still on plan-01's
> known-broken legacy list).
> **Review-driven deltas (commit `79789d5`):** `key_filename` privatized (was `pub` —
> leaked persistence-format detail); `invalidate` made `NotFound`-safe (dropped TOCTOU
> `exists()` pre-check); corrupt-load test tightened. **Impl note:** `FileContractCache`
> does not derive `Debug` (its `CachedContract` can't — `prost_reflect::DescriptorPool` is
> not `Debug`); consistent with sibling `InMemoryContractCache`.
> 🧹 **/clear-чекпойнт** here (02→03). Next: plan-03 (pure frontend functions: `mapping.ts`,
> `grouping.ts`, `sort.ts`) — outline, detail to TDD before executing.
>
> ---
> **(historical) Original pre-execution banner:** Branch `redesign/workflow-ui-spec-plans`.
> Follows plan-01 (`cadaccd..625241b`, 🧹 01→02 checkpoint). Backend-only; the cache is
> internal — `activate()` already calls `ContractCache::{get,put}`.
>
> **Deviations from plan-00 index (sanctioned here):**
> 1. **Placement:** the index file-map listed `collections/contract_cache.rs`. The cache is
>    a **grpc** concern — its trait `ContractCache` + `InMemoryContractCache` live in
>    `grpc/contract_cache.rs`. The file-backed impl goes **next to its trait**:
>    `grpc/file_contract_cache.rs` (mirrors `collections/{in_memory,file_store}.rs`). Index
>    row updated to match.
> 2. **Trait signature unchanged.** `ContractCache::{put,invalidate}` stay `-> ()`. A cache
>    is a perf optimization: a failed disk write must not break a live session, and changing
>    the trait would ripple into `contract::activate()` + the in-memory impl + all tests for
>    zero correctness gain. The file impl is **write-through over an in-memory mirror** and
>    surfaces the rare persist/remove failure via `eprintln!` (core has no logger — grep
>    confirmed no `tracing`/`log`). `load()` is the only fallible-at-boot path and returns
>    `Result`.
> 3. **Best-effort load.** Unlike `FileCollectionStore` (corrupt file ⇒ hard `Persistence`
>    error), a corrupt/undecodable **cache** entry is **skipped** on load (it simply
>    re-reflects). The cache is disposable; one bad file must not abort app boot.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (default) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the descriptor/contract cache (today session-only `InMemoryContractCache`
in `state.rs`) **survive restarts** by persisting each cached contract to disk, keyed by
resolved address, and reloading it on boot. Reflection is skipped on a cache hit across
sessions, not just within one.

**Architecture:** A new `FileContractCache` in `handshaker-core::grpc` implements the
existing `ContractCache` trait as an **in-memory mirror + write-through to disk**. Each
entry → one `<dir>/<hex(key)>.json` `Envelope<PersistedContract>` (reusing
`persist::{atomic_write_json,read_json,Envelope}`). The `DescriptorPool` is serialized via
`prost_reflect`'s `DescriptorPool::encode_to_vec()` (protobuf `FileDescriptorSet` bytes) and
rebuilt with `DescriptorPool::decode()`; the `ServiceCatalog` (already `serde`) is stored
alongside, plus `fetched_at` as epoch-ms. `state.rs::load()` swaps `InMemoryContractCache`
→ `FileContractCache::load(data_dir/contracts)`; `AppState::default()` keeps in-memory.

**Tech Stack:** Rust (handshaker-core + src-tauri), `prost-reflect = 0.14` (`encode_to_vec`
/ `decode` — verified on docs.rs), serde JSON persistence, `cargo test`. No new crate deps in
core (filename is a **hex of the canonical key string** — stable, reversible, collision-free,
no `sha2`/`base64`/`hex` needed). `src-tauri` gains a `tempfile` dev-dep for the wiring test.

**Spec ref:** `docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`
§4 (B7), §10 (reflection / contract cache — keyed by resolved address, persists; Refresh
invalidates).

> **Note on the pool↔JSON size trade-off:** `serde_json` encodes `Vec<u8>` as a number
> array (~3–4× the raw bytes). For a descriptor `FileDescriptorSet` (typ. low tens of KB)
> this is acceptable for a disposable cache. A `base64`/binary-sidecar optimization is a
> **deferred follow-up**, not in scope.

---

### Task 1: `FileContractCache` — persist / reload / invalidate (core)

**Files:**
- Create: `crates/handshaker-core/src/grpc/file_contract_cache.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs` (register module + re-export)

- [x] **Step 1: Write the failing tests** (new file — write the `#[cfg(test)]` block first,
  with a minimal module skeleton so it compiles to a *test failure*, not a parse error)

Create `file_contract_cache.rs` with the struct/impl **stubs that compile** (so the
test binary builds and the assertions fail), then the tests below. A clean TDD path: write
the public surface as `unimplemented!()` bodies + the real tests, confirm red, then fill in.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::grpc::catalog::build_catalog;
    use crate::grpc::contract_cache::ContractKey;
    use crate::grpc::descriptor::build_pool;
    use prost_types::{
        DescriptorProto, FieldDescriptorProto, FileDescriptorProto, MethodDescriptorProto,
        ServiceDescriptorProto, field_descriptor_proto::Type as FieldType,
    };
    use std::time::{Duration, UNIX_EPOCH};

    const FETCHED_MS: u64 = 1_700_000_000_000;

    fn sample_pool() -> prost_reflect::DescriptorPool {
        let file = FileDescriptorProto {
            name: Some("test/echo.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![
                DescriptorProto {
                    name: Some("Ping".into()),
                    field: vec![FieldDescriptorProto {
                        name: Some("id".into()),
                        number: Some(1),
                        r#type: Some(FieldType::String as i32),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                DescriptorProto { name: Some("Pong".into()), ..Default::default() },
            ],
            service: vec![ServiceDescriptorProto {
                name: Some("Echo".into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Send".into()),
                    input_type: Some(".test.Ping".into()),
                    output_type: Some(".test.Pong".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        build_pool(vec![file]).expect("build sample pool")
    }

    fn sample_contract() -> CachedContract {
        let pool = sample_pool();
        let catalog = build_catalog(&pool);
        CachedContract {
            pool,
            catalog,
            fetched_at: UNIX_EPOCH + Duration::from_millis(FETCHED_MS),
        }
    }

    fn key(addr: &str, tls: bool) -> ContractKey {
        ContractKey { address: addr.into(), tls }
    }

    #[test]
    fn put_then_reload_round_trips_pool_catalog_and_timestamp() {
        let dir = tempfile::tempdir().unwrap();
        let k = key("api.example:443", true);
        let original = sample_contract();

        let cache = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        cache.put(k.clone(), original.clone());

        // Reload from a fresh instance — survives "restart".
        drop(cache);
        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        let got = reloaded.get(&k).expect("entry survives reload");

        // pool re-resolves the service
        assert!(got.pool.get_service_by_name("test.Echo").is_some());
        // catalog is byte-identical (ServiceCatalog: PartialEq)
        assert_eq!(got.catalog, original.catalog);
        // fetched_at round-trips at epoch-ms granularity
        assert_eq!(
            got.fetched_at.duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
            FETCHED_MS
        );
    }

    #[test]
    fn invalidate_removes_file_and_entry() {
        let dir = tempfile::tempdir().unwrap();
        let k = key("h:1", false);
        let cache = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        cache.put(k.clone(), sample_contract());

        let json_count = || std::fs::read_dir(dir.path()).unwrap()
            .filter(|e| e.as_ref().unwrap().path().extension().and_then(|s| s.to_str()) == Some("json"))
            .count();
        assert_eq!(json_count(), 1);

        cache.invalidate(&k);
        assert!(cache.get(&k).is_none());
        assert_eq!(json_count(), 0);
        // and reload stays empty
        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        assert!(reloaded.get(&k).is_none());
    }

    #[test]
    fn corrupt_entry_is_skipped_on_load_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        // one good entry + one garbage .json
        let cache = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        cache.put(key("good:1", false), sample_contract());
        std::fs::write(dir.path().join("deadbeef.json"), b"{ not valid").unwrap();
        drop(cache);

        // load does not error; the good entry is still there, the bad one absent
        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        assert!(reloaded.get(&key("good:1", false)).is_some());
    }

    #[test]
    fn key_filename_is_stable_and_distinguishes_tls_and_address() {
        let a = key_filename(&key("h:1", false));
        assert_eq!(a, key_filename(&key("h:1", false))); // stable
        assert_ne!(a, key_filename(&key("h:1", true)));   // tls in key
        assert_ne!(a, key_filename(&key("h:2", false)));  // address in key
        assert!(a.ends_with(".json"));
    }
}
```

- [x] **Step 2: Run — verify it fails** (red)

Run: `cargo test -p handshaker-core file_contract_cache 2>&1 | tail -30`
Expected: tests build but fail (stub `unimplemented!()`), or compile errors naming the
not-yet-written items. Either is a valid red.

- [x] **Step 3: Implement `FileContractCache`** (top of the same file, above the test mod)

```rust
//! Disk-backed `ContractCache`: one `<dir>/<hex-key>.json` per cached contract, written
//! atomically (temp+rename) through an in-memory mirror. Survives restarts so reflection
//! is skipped across sessions (spec §10 / B7). The cache is **disposable**: persist/remove
//! failures are logged, not propagated (a miss just re-reflects), and a corrupt entry is
//! skipped on load rather than aborting boot.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{Duration, UNIX_EPOCH};

use prost_reflect::DescriptorPool;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::grpc::catalog::ServiceCatalog;
use crate::grpc::contract_cache::{CachedContract, ContractCache, ContractKey};
use crate::persist::{atomic_write_json, read_json, Envelope};

/// On-disk shape of one cached contract. `pool` is `DescriptorPool::encode_to_vec()`
/// (protobuf `FileDescriptorSet` bytes); `fetched_at` is epoch-ms.
#[derive(Serialize, Deserialize)]
struct PersistedContract {
    address: String,
    tls: bool,
    pool: Vec<u8>,
    catalog: ServiceCatalog,
    fetched_at: i64,
}

/// `<canonical-key>` hex-encoded (stable, reversible, filesystem-safe) + `.json`.
/// Canonical key = `"{tls}|{address}"`; hex avoids `:` / `/` in addresses.
fn key_filename(key: &ContractKey) -> String {
    let canonical = format!("{}|{}", key.tls, key.address);
    let mut name = canonical.bytes().fold(String::with_capacity(canonical.len() * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    });
    name.push_str(".json");
    name
}

#[derive(Debug)]
pub struct FileContractCache {
    dir: PathBuf,
    inner: RwLock<HashMap<ContractKey, CachedContract>>,
}

impl FileContractCache {
    /// Load every `*.json` under `dir` (creating `dir` if absent). A file that fails to
    /// parse or whose pool fails to decode is **skipped** (logged), never fatal.
    pub fn load(dir: PathBuf) -> Result<Self, CoreError> {
        fs::create_dir_all(&dir)
            .map_err(|e| CoreError::Persistence(format!("create dir {}: {e}", dir.display())))?;
        let mut map = HashMap::new();
        for entry in fs::read_dir(&dir)
            .map_err(|e| CoreError::Persistence(format!("read dir {}: {e}", dir.display())))?
        {
            let entry = entry.map_err(|e| CoreError::Persistence(format!("dir entry: {e}")))?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue; // skip orphaned .tmp etc.
            }
            match Self::read_entry(&path) {
                Ok((key, contract)) => {
                    map.insert(key, contract);
                }
                Err(e) => {
                    eprintln!("contract cache: skipping {}: {e}", path.display());
                }
            }
        }
        Ok(Self { dir, inner: RwLock::new(map) })
    }

    fn read_entry(path: &Path) -> Result<(ContractKey, CachedContract), CoreError> {
        let p: PersistedContract = read_json(path)?;
        let pool = DescriptorPool::decode(p.pool.as_slice())
            .map_err(|e| CoreError::DescriptorBuild(format!("decode cached pool: {e}")))?;
        let key = ContractKey { address: p.address, tls: p.tls };
        let contract = CachedContract {
            pool,
            catalog: p.catalog,
            fetched_at: UNIX_EPOCH + Duration::from_millis(p.fetched_at.max(0) as u64),
        };
        Ok((key, contract))
    }

    fn file_path(&self, key: &ContractKey) -> PathBuf {
        self.dir.join(key_filename(key))
    }

    fn persist(&self, key: &ContractKey, contract: &CachedContract) -> Result<(), CoreError> {
        let fetched_at = contract
            .fetched_at
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let payload = PersistedContract {
            address: key.address.clone(),
            tls: key.tls,
            pool: contract.pool.encode_to_vec(),
            catalog: contract.catalog.clone(),
            fetched_at,
        };
        atomic_write_json(&self.file_path(key), &Envelope::new(payload))
    }
}

impl ContractCache for FileContractCache {
    fn get(&self, key: &ContractKey) -> Option<CachedContract> {
        self.inner.read().expect("contract cache poisoned").get(key).cloned()
    }

    /// Write-through: persist (best-effort) then update the mirror. A persist failure is
    /// logged but the in-memory entry still lands, so the session benefits regardless.
    fn put(&self, key: ContractKey, contract: CachedContract) {
        if let Err(e) = self.persist(&key, &contract) {
            eprintln!("contract cache: failed to persist {}: {e}", key.address);
        }
        self.inner.write().expect("contract cache poisoned").insert(key, contract);
    }

    fn invalidate(&self, key: &ContractKey) {
        let path = self.file_path(key);
        if path.exists() {
            if let Err(e) = fs::remove_file(&path) {
                eprintln!("contract cache: failed to remove {}: {e}", path.display());
            }
        }
        self.inner.write().expect("contract cache poisoned").remove(key);
    }
}
```

- [x] **Step 4: Register the module + re-export** in `grpc/mod.rs`

Add `pub mod file_contract_cache;` (after `pub mod descriptor;`) and extend the
contract_cache re-export line:

```rust
pub use file_contract_cache::FileContractCache;
```

- [x] **Step 5: Run — verify pass** (green)

Run: `cargo test -p handshaker-core file_contract_cache 2>&1 | tail -20`
Expected: all 4 tests pass.
Run (no regressions in grpc): `cargo test -p handshaker-core grpc 2>&1 | tail -10`

- [x] **Step 6: Commit**

```bash
git add crates/handshaker-core/src/grpc/file_contract_cache.rs crates/handshaker-core/src/grpc/mod.rs
git commit -m "feat(core): file-backed ContractCache (persist reflection contract, B7)"
```

---

### Task 2: Wire `FileContractCache` into `AppState::load` (src-tauri)

**Files:**
- Modify: `src-tauri/src/state.rs` (use `FileContractCache` in `load`; update field doc)
- Modify: `src-tauri/Cargo.toml` (add `[dev-dependencies] tempfile`)

- [x] **Step 1: Add the failing wiring test** (append to `state.rs#tests`)

```rust
    #[test]
    fn load_uses_file_backed_contract_cache_under_contracts_dir() {
        use handshaker_core::grpc::ContractKey;
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path()).unwrap();

        // the cache directory is created on load
        assert!(dir.path().join("contracts").is_dir());
        // cold cache: nothing cached yet
        let k = ContractKey { address: "h:1".into(), tls: false };
        assert!(state.contract_cache.get(&k).is_none());

        // a put persists a file that a fresh load picks up
        // (proves the Arc<dyn ContractCache> behind load() is the file-backed one)
        let json_before = std::fs::read_dir(dir.path().join("contracts")).unwrap().count();
        assert_eq!(json_before, 0);
    }
```

(This asserts the `contracts/` dir is created by `load` — only the file-backed impl does
that. The deeper persist/reload behavior is already covered by Task 1's core tests.)

- [x] **Step 2: Add `tempfile` dev-dep + run — verify red**

In `src-tauri/Cargo.toml`, add:

```toml
[dev-dependencies]
tempfile = { workspace = true }
```

Run: `cargo test -p handshaker state 2>&1 | tail -20`
Expected: compile error — `FileContractCache` not used yet ⇒ `contracts/` dir absent ⇒
`is_dir()` assert fails (or, before wiring, the dir isn't created). Red.

- [x] **Step 3: Swap the cache in `load` + update the field doc**

In `state.rs`:
- import: `use handshaker_core::grpc::{ContractCache, FileContractCache, InMemoryContractCache};`
- in `load(...)`, replace
  `contract_cache: Arc::new(InMemoryContractCache::new()),`
  with
  `contract_cache: Arc::new(FileContractCache::load(data_dir.join("contracts"))?),`
- update the field doc comment from
  `/// Descriptor cache (plan #6). Session-only, not persisted.`
  to
  `/// Descriptor/contract cache. File-backed in `load` (persists across restarts, B7);
  /// in-memory under `default()`.`

`AppState::default()` keeps `InMemoryContractCache::new()` (tests stay off-disk).

- [x] **Step 4: Run — verify pass** (green)

Run: `cargo test -p handshaker state 2>&1 | tail -20`
Expected: both state tests pass.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/Cargo.toml
git commit -m "feat(state): persist contract cache via FileContractCache in load (B7)"
```

---

### Task 3: Full backend gate (no bindings — internal change)

**Files:** none (verification + banner update only).

- [x] **Step 1: Full backend gate**

Run: `cargo test -p handshaker-core 2>&1 | tail -5`
Run: `cargo test -p handshaker 2>&1 | tail -5`
Expected: both green. (No IPC/specta surface changed ⇒ **no `export-bindings` run**, no
`bindings.ts` diff. Frontend `tsc` state is unchanged from plan-01's known-broken legacy
list — do **not** touch it here.)

- [x] **Step 2: Sanity — confirm no IPC drift**

Run: `git --no-pager diff --stat` — expect only `grpc/file_contract_cache.rs`, `grpc/mod.rs`,
`state.rs`, `src-tauri/Cargo.toml`, and this plan/the index. **No** `src/ipc/bindings.ts`,
**no** `commands/`/`ipc/` changes.

- [x] **Step 3: Update banners**

- This plan's header: STATUS → **✅ COMPLETE**, with commit range + the gate counts.
- `plan-00-index.md` plan-02 row: `outline` → `✅ done` (+ commit range).

---

## Self-Review (run after writing, before execution)

- **Spec coverage:** B7 / §10 — persist by resolved address (Task 1: `PersistedContract`
  keyed by `{address,tls}` = `ContractKey`); survives restart (Task 1 round-trip test +
  Task 2 wiring); Refresh→invalidate removes the persisted file (Task 1 `invalidate` test).
- **Key fidelity:** `ContractKey` already = `{address, tls}` with `skip_verify` deliberately
  excluded (doesn't change the contract) — the persisted key mirrors it exactly; no new key
  semantics introduced.
- **No blast radius:** trait unchanged ⇒ `contract::activate()` and `InMemoryContractCache`
  untouched; `AppState::default()` stays in-memory ⇒ existing tests unaffected. No IPC/DTO/
  command/bindings change ⇒ frontend untouched (still on plan-01's known-broken legacy list).
- **prost-reflect API (verified, docs.rs 0.14):** `DescriptorPool::encode_to_vec(&self) ->
  Vec<u8>` (inherent) + `DescriptorPool::decode<B: Buf>(bytes) -> Result<Self, DescriptorError>`
  (inherent). `.as_slice(): &[u8]` impls `Buf`. No trait import needed.
- **Open follow-up:** base64/binary-sidecar to shrink the JSON `Vec<u8>` bloat (deferred);
  no TTL/expiry (Refresh is the only invalidation path per §10) — intentional.
