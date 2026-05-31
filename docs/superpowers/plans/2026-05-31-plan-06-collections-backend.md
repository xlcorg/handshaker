# Collections Backend Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the entire backend for Postman-style collections (recursive tree, disk persistence for collections *and* environments, request-resolution engine, descriptor cache, IPC commands) so sub-projects #2/#3 are pure frontend wiring over a stable, tested IPC surface.

**Architecture:** New `persist/` atomic-JSON primitive (temp+fsync+rename) underpins a `FileEnvironmentStore` and a `FileCollectionStore` (one JSON file per collection). New `auth/` and `collections/` modules in `handshaker-core` carry the model, pure tree-mutation helpers, and a pure `resolve_request` inheritance walk. A `ContractCache` keyed by `(address, tls)` lets `activate()` skip reflection on a cache hit. `src-tauri` gains `collection_store` + `contract_cache` on `AppState`, IPC DTOs, and thin command wrappers (each over a directly-testable `impl AppState` method).

**Tech Stack:** Rust (handshaker-core + src-tauri/Tauri 2), serde / serde_json, uuid v7, prost-reflect, tonic, tauri-specta (regenerates `src/ipc/bindings.ts`).

**Spec:** [`docs/superpowers/specs/2026-05-31-plan-06-collections-backend-design.md`](../specs/2026-05-31-plan-06-collections-backend-design.md). Realizes master-spec §5.5/§5.2/§5.3/§5.8/§6.2.

---

## File Structure

**Core (`crates/handshaker-core/src/`):**
- `persist/mod.rs` — NEW. `Envelope<T>`, `SCHEMA_VERSION`, `atomic_write_json`, `read_json`, `read_json_or_default`. serde_json + std::fs only.
- `auth/mod.rs` — NEW. `AuthCredentials`, `EnvVarAuthConfig`, `OAuth2ClientCredentialsConfig`, `SavedAuthConfig`, `AuthByEnv`, `resolve_auth`. (Master §5.3.)
- `env/mod.rs` — MODIFY. Add serde derives to `Environment`.
- `env/file_store.rs` — NEW. `FileEnvironmentStore` (whole-set JSON, atomic).
- `collections/mod.rs` — NEW. `Collection`, `Item`, `Folder`, `SavedRequest`, `EffectiveRequest`, re-exports.
- `collections/ids.rs` — NEW. `CollectionId`, `ItemId` (uuid v7).
- `collections/tree.rs` — NEW. Pure tree ops + `ItemSnapshot`.
- `collections/resolve.rs` — NEW. `resolve_request`.
- `collections/store.rs` — NEW. `CollectionStore` trait.
- `collections/in_memory.rs` — NEW. `InMemoryCollectionStore`.
- `collections/file_store.rs` — NEW. `FileCollectionStore` (one file per collection).
- `grpc/contract_cache.rs` — NEW. `ContractCache`, `InMemoryContractCache`, `ContractKey`, `CachedContract`.
- `grpc/contract.rs` — MODIFY. `activate(target, transport, cache)`.
- `grpc/mod.rs` — MODIFY. `pub use contract_cache::*`.
- `lib.rs` — MODIFY. `pub mod auth; pub mod collections; pub mod persist;`.
- `error.rs` — MODIFY. Add `CoreError::Persistence(String)`.
- `Cargo.toml` — MODIFY. Add `uuid` (v7+serde), `tempfile` dev-dep.

**src-tauri (`src-tauri/src/`):**
- `state.rs` — MODIFY. Add `collection_store` + `contract_cache`; add `with_data_dir`.
- `ipc/collection.rs` — NEW. DTOs + fallible conversions.
- `ipc/mod.rs` — MODIFY. `pub mod collection;`.
- `ipc/error.rs` — MODIFY. Add `Persistence` variant + From arm + exhaustive test.
- `commands/collection.rs` — NEW. impl methods + command wrappers + `#[cfg(test)]`.
- `commands/mod.rs` — MODIFY. `pub mod collection;`.
- `commands/grpc.rs` — MODIFY. Thread `contract_cache` into `activate()`; invalidate on refresh.
- `commands/env.rs` — MODIFY (tests only). `build_state` gains the two new fields.
- `lib.rs` — MODIFY. Register commands; build state via `with_data_dir` in `.setup()`.
- `Cargo.toml` — (workspace) `uuid` already added at workspace level in Task 0.

**Frontend (`src/`):**
- `ipc/bindings.ts` — REGEN.
- `ipc/client.ts` — MODIFY. Typed wrappers for the new commands.

**Tests touched by the `activate()` signature change (Task 7):** `tests/contract_activate.rs`, `tests/invoke_unary.rs`, `tests/invoke_skeleton.rs`, `tests/invoke_status.rs`, `tests/invoke_trailers.rs`, `tests/invoke_live.rs`.

---

## Task 0: Dependencies + error variants

**Files:**
- Modify: `Cargo.toml` (workspace deps)
- Modify: `crates/handshaker-core/Cargo.toml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `crates/handshaker-core/src/error.rs:35-37`
- Modify: `src-tauri/src/ipc/error.rs`

- [ ] **Step 1: Add workspace deps**

In `Cargo.toml` under `[workspace.dependencies]`, after the `regex = "1"` block add:

```toml
# Plan #6 — Collections
uuid = { version = "1", features = ["v7", "serde"] }
tempfile = "3"
```

- [ ] **Step 2: Reference `uuid` in core, add `tempfile` dev-dep**

In `crates/handshaker-core/Cargo.toml`, under `[dependencies]` after `regex.workspace = true` add:

```toml
# Plan #6 — Collections
uuid = { workspace = true }
```

Under `[dev-dependencies]` add:

```toml
tempfile.workspace = true
```

- [ ] **Step 2b: Reference `uuid` in `src-tauri`**

The shell parses/formats UUIDs in the IPC layer (Tasks 9–10). In `src-tauri/Cargo.toml`, under `[dependencies]` (after `async-trait.workspace = true`), add:

```toml
uuid = { workspace = true }
```

- [ ] **Step 3: Add `CoreError::Persistence`**

In `crates/handshaker-core/src/error.rs`, add a variant immediately before the closing `}` of the enum (after `NotImplemented`):

```rust
    #[error("persistence error: {0}")]
    Persistence(String),
```

- [ ] **Step 4: Map it in `IpcError`**

In `src-tauri/src/ipc/error.rs`, add a variant to the `IpcError` enum (after `NotImplemented { message: String }`):

```rust
    Persistence { message: String },
```

Add the match arm in `impl From<CoreError> for IpcError` (after the `NotImplemented` arm):

```rust
            CoreError::Persistence(m) => IpcError::Persistence { message: m },
```

In the `from_core_error_exhaustive` test, add to the `cases` vec (after the `NotImplemented` case):

```rust
            CoreError::Persistence("p".into()),
```

and bump the count assertion:

```rust
        assert_eq!(cases.len(), 16, "Update this test when CoreError variants change");
```

- [ ] **Step 5: Verify it compiles and tests pass**

Run: `cargo test --workspace`
Expected: PASS (existing ~83 tests plus the bumped exhaustive check). The `From` match is exhaustive over `CoreError`, so a missed variant fails to compile.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/handshaker-core/Cargo.toml src-tauri/Cargo.toml crates/handshaker-core/src/error.rs src-tauri/src/ipc/error.rs
git commit -m "feat(core): add CoreError::Persistence + uuid/tempfile deps"
```

---

## Task 1: `persist/` atomic-JSON primitive

**Files:**
- Create: `crates/handshaker-core/src/persist/mod.rs`
- Modify: `crates/handshaker-core/src/lib.rs:6-9`

- [ ] **Step 1: Declare the module**

In `crates/handshaker-core/src/lib.rs`, add `pub mod persist;` to the module list (keep alphabetical-ish with the others):

```rust
pub mod env;
pub mod error;
pub mod grpc;
pub mod persist;
pub mod vars;
```

- [ ] **Step 2: Write `persist/mod.rs` with implementation + tests**

Create `crates/handshaker-core/src/persist/mod.rs`:

```rust
//! Atomic JSON persistence primitive. No Tauri dependency — path-injected and
//! unit-testable on a `tempfile::TempDir`.
//!
//! Every persisted file is an [`Envelope<T>`] carrying a `schema_version`. Writes
//! go through `<path>.tmp` + fsync + rename so a crash mid-write never truncates
//! the live file (master spec §4 line 148; design §6).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

/// Current on-disk schema version. Bump + add a migration when the shape changes.
pub const SCHEMA_VERSION: u32 = 1;

/// Versioned wrapper around any persisted payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Envelope<T> {
    pub schema_version: u32,
    pub data: T,
}

impl<T> Envelope<T> {
    /// Wrap `data` with the current schema version.
    pub fn new(data: T) -> Self {
        Self { schema_version: SCHEMA_VERSION, data }
    }
}

/// `<path>` + ".tmp" (keeps the original extension, e.g. `a.json` → `a.json.tmp`).
fn tmp_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

/// Serialize `value` and atomically replace `path`. Creates parent dirs on demand.
/// On any failure the previous contents of `path` are left intact.
pub fn atomic_write_json<T: Serialize>(path: &Path, value: &Envelope<T>) -> Result<(), CoreError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| CoreError::Persistence(format!("create dir {}: {e}", parent.display())))?;
    }
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| CoreError::Persistence(format!("serialize {}: {e}", path.display())))?;
    let tmp = tmp_path(path);
    {
        let mut f = fs::File::create(&tmp)
            .map_err(|e| CoreError::Persistence(format!("create tmp {}: {e}", tmp.display())))?;
        f.write_all(&bytes)
            .map_err(|e| CoreError::Persistence(format!("write tmp {}: {e}", tmp.display())))?;
        f.sync_all()
            .map_err(|e| CoreError::Persistence(format!("fsync tmp {}: {e}", tmp.display())))?;
    }
    fs::rename(&tmp, path)
        .map_err(|e| CoreError::Persistence(format!("rename {} -> {}: {e}", tmp.display(), path.display())))?;
    Ok(())
}

/// Shared envelope-parsing + version gate.
fn parse_envelope<T: DeserializeOwned>(bytes: &[u8], path: &Path) -> Result<T, CoreError> {
    let env: Envelope<T> = serde_json::from_slice(bytes)
        .map_err(|e| CoreError::Persistence(format!("parse {}: {e}", path.display())))?;
    if env.schema_version > SCHEMA_VERSION {
        return Err(CoreError::Persistence(format!(
            "unsupported schema v{} in {} (this build supports up to v{})",
            env.schema_version, path.display(), SCHEMA_VERSION
        )));
    }
    Ok(env.data)
}

/// Read + parse a file that is expected to exist. Missing file → `Persistence` error.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, CoreError> {
    let bytes = fs::read(path)
        .map_err(|e| CoreError::Persistence(format!("read {}: {e}", path.display())))?;
    parse_envelope(&bytes, path)
}

/// Read + parse a file; a missing file yields `T::default()` (empty store on cold boot).
pub fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T, CoreError> {
    match fs::read(path) {
        Ok(bytes) => parse_envelope(&bytes, path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(CoreError::Persistence(format!("read {}: {e}", path.display()))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        atomic_write_json(&path, &Envelope::new(vec![1u32, 2, 3])).unwrap();
        let back: Vec<u32> = read_json_or_default(&path).unwrap();
        assert_eq!(back, vec![1, 2, 3]);
    }

    #[test]
    fn missing_file_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nope.json");
        let back: Vec<u32> = read_json_or_default(&path).unwrap();
        assert!(back.is_empty());
    }

    #[test]
    fn nested_parent_dirs_are_created() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a").join("b").join("data.json");
        atomic_write_json(&path, &Envelope::new(7u32)).unwrap();
        let back: u32 = read_json(&path).unwrap();
        assert_eq!(back, 7);
    }

    #[test]
    fn interrupted_write_leaves_old_file_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        atomic_write_json(&path, &Envelope::new(vec![1u32, 2, 3])).unwrap();

        // Block tmp creation by occupying its path with a directory, so the next
        // write fails BEFORE the rename step.
        let tmp = tmp_path(&path);
        std::fs::create_dir(&tmp).unwrap();

        let err = atomic_write_json(&path, &Envelope::new(vec![9u32])).unwrap_err();
        assert!(matches!(err, CoreError::Persistence(_)), "got {err:?}");

        // Original file is untouched.
        let back: Vec<u32> = read_json_or_default(&path).unwrap();
        assert_eq!(back, vec![1, 2, 3]);
    }

    #[test]
    fn unknown_future_schema_version_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        // Hand-write an envelope from the future.
        let raw = serde_json::to_vec(&Envelope { schema_version: SCHEMA_VERSION + 1, data: 0u32 }).unwrap();
        std::fs::write(&path, raw).unwrap();
        let err = read_json::<u32>(&path).unwrap_err();
        match err {
            CoreError::Persistence(m) => assert!(m.contains("unsupported schema"), "got {m}"),
            other => panic!("expected Persistence, got {other:?}"),
        }
    }
}
```

- [ ] **Step 3: Run the persist tests**

Run: `cargo test -p handshaker-core persist::`
Expected: PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/persist/mod.rs crates/handshaker-core/src/lib.rs
git commit -m "feat(core): atomic JSON persistence primitive"
```

---

## Task 2: `FileEnvironmentStore`

**Files:**
- Modify: `crates/handshaker-core/src/env/mod.rs:11-19`
- Create: `crates/handshaker-core/src/env/file_store.rs`

- [ ] **Step 1: Add serde derives to `Environment` and declare the submodule**

In `crates/handshaker-core/src/env/mod.rs`, add the serde import near the top (after `use crate::error::CoreError;`):

```rust
use serde::{Deserialize, Serialize};
```

Add `pub mod file_store;` next to `pub mod in_memory;`:

```rust
pub mod file_store;
pub mod in_memory;
```

Change the `Environment` derive line from:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Environment {
```

to:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Environment {
```

- [ ] **Step 2: Write `env/file_store.rs` with implementation + tests**

Create `crates/handshaker-core/src/env/file_store.rs`:

```rust
//! Disk-backed implementation of [`EnvironmentStore`]. One JSON file holds the
//! whole environment set (small data — simplicity over incrementality). An
//! in-memory `RwLock` mirror serves reads so they never hit disk; the mirror is
//! updated only after a successful atomic write (clone-then-commit, design §R7).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use crate::error::CoreError;
use crate::persist::{atomic_write_json, read_json_or_default, Envelope};

use super::{validate_env_name, Environment, EnvironmentStore};

pub struct FileEnvironmentStore {
    path: PathBuf,
    inner: RwLock<HashMap<String, Environment>>,
}

impl FileEnvironmentStore {
    /// Load the store from `path` (the JSON file itself). Missing file → empty.
    pub fn load(path: PathBuf) -> Result<Self, CoreError> {
        let list: Vec<Environment> = read_json_or_default(&path)?;
        let map = list.into_iter().map(|e| (e.name.clone(), e)).collect();
        Ok(Self { path, inner: RwLock::new(map) })
    }

    /// Serialize the given map to disk, deterministically ordered by name.
    fn persist(&self, map: &HashMap<String, Environment>) -> Result<(), CoreError> {
        let mut list: Vec<Environment> = map.values().cloned().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        atomic_write_json(&self.path, &Envelope::new(list))
    }
}

impl EnvironmentStore for FileEnvironmentStore {
    fn list(&self) -> Vec<Environment> {
        self.inner.read().expect("env store lock poisoned").values().cloned().collect()
    }

    fn get(&self, name: &str) -> Option<Environment> {
        self.inner.read().expect("env store lock poisoned").get(name).cloned()
    }

    fn upsert(&self, env: Environment) -> Result<(), CoreError> {
        validate_env_name(&env.name)?;
        let mut guard = self.inner.write().expect("env store lock poisoned");
        let mut next = guard.clone();
        next.insert(env.name.clone(), env);
        self.persist(&next)?;
        *guard = next;
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), CoreError> {
        let mut guard = self.inner.write().expect("env store lock poisoned");
        if !guard.contains_key(name) {
            return Ok(()); // idempotent; no disk write needed
        }
        let mut next = guard.clone();
        next.remove(name);
        self.persist(&next)?;
        *guard = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(name: &str, kv: &[(&str, &str)]) -> Environment {
        Environment {
            name: name.to_string(),
            variables: kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        }
    }

    #[test]
    fn upsert_then_reload_sees_env() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        let store = FileEnvironmentStore::load(path.clone()).unwrap();
        store.upsert(env("prod", &[("host", "api:443")])).unwrap();

        // Simulate a restart: drop + reconstruct from the same path.
        drop(store);
        let store2 = FileEnvironmentStore::load(path).unwrap();
        assert_eq!(store2.get("prod").unwrap().variables.get("host"), Some(&"api:443".to_string()));
    }

    #[test]
    fn delete_persists_across_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        let store = FileEnvironmentStore::load(path.clone()).unwrap();
        store.upsert(env("a", &[])).unwrap();
        store.upsert(env("b", &[])).unwrap();
        store.delete("a").unwrap();

        let store2 = FileEnvironmentStore::load(path).unwrap();
        assert!(store2.get("a").is_none());
        assert!(store2.get("b").is_some());
    }

    #[test]
    fn cold_boot_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileEnvironmentStore::load(dir.path().join("environments.json")).unwrap();
        assert!(store.list().is_empty());
    }

    #[test]
    fn rejects_invalid_name() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileEnvironmentStore::load(dir.path().join("environments.json")).unwrap();
        assert!(store.upsert(env("1bad", &[])).is_err());
    }
}
```

- [ ] **Step 3: Run the env file-store tests**

Run: `cargo test -p handshaker-core env::file_store`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/env/mod.rs crates/handshaker-core/src/env/file_store.rs
git commit -m "feat(core): FileEnvironmentStore (disk-backed environments)"
```

---

## Task 3: `auth/` types (master §5.3)

**Files:**
- Create: `crates/handshaker-core/src/auth/mod.rs`
- Modify: `crates/handshaker-core/src/lib.rs`

- [ ] **Step 1: Declare the module**

In `crates/handshaker-core/src/lib.rs`, add `pub mod auth;` as the first module (it has no deps on the others):

```rust
pub mod auth;
pub mod env;
pub mod error;
pub mod grpc;
pub mod persist;
pub mod vars;
```

- [ ] **Step 2: Write `auth/mod.rs` with implementation + tests**

Create `crates/handshaker-core/src/auth/mod.rs`:

```rust
//! Auth configuration + resolution (master spec §5.3 / §5.4).
//!
//! Secrets are NEVER stored as plaintext: an `EnvVar` config names an OS
//! environment variable, read at resolve time (master §4 line 143). OAuth2
//! client-credentials token fetch is deferred (master §5.4) — it parses and
//! persists, but resolution returns `CoreError::NotImplemented`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::CoreError;

/// A resolved header to attach to a request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthCredentials {
    pub header_name: String,
    pub header_value: String,
}

/// Read a secret from an OS env var by NAME; build `header_name: prefix + secret`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvVarAuthConfig {
    /// Name of the OS env var holding the secret (e.g. `API_TOKEN`).
    pub env_var: String,
    /// Header to set (e.g. `authorization`).
    pub header_name: String,
    /// Prefix prepended to the secret value (e.g. `Bearer `).
    pub prefix: String,
}

/// OAuth2 client-credentials config. Token fetch is deferred (master §5.4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuth2ClientCredentialsConfig {
    pub token_url: String,
    pub client_id: String,
    /// Env-var NAME holding the client secret (never plaintext).
    pub client_secret_env_var: String,
    pub scopes: Vec<String>,
}

/// One auth strategy for a node, per active environment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SavedAuthConfig {
    /// Explicitly unauthenticated — stops inheritance (Postman "No Auth").
    None,
    EnvVar(EnvVarAuthConfig),
    OAuth2ClientCredentials(OAuth2ClientCredentialsConfig),
}

/// Per-environment auth map carried by Collection / Folder / Request.
///
/// A key present (even `SavedAuthConfig::None`) means "this node defines auth for
/// that env" and stops inheritance. A key absent means "inherit from the ancestor".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthByEnv {
    pub configs: HashMap<String, SavedAuthConfig>,
}

impl AuthByEnv {
    /// The config this node defines for `env_name`, if any.
    pub fn for_env(&self, env_name: &str) -> Option<&SavedAuthConfig> {
        self.configs.get(env_name)
    }
}

/// Resolve a single `SavedAuthConfig` to concrete credentials.
/// - `None` → `Ok(None)` (unauthenticated).
/// - `EnvVar` → reads `std::env`; missing var → `CoreError::Auth`.
/// - `OAuth2ClientCredentials` → `CoreError::NotImplemented` (deferred).
pub fn resolve_auth(config: &SavedAuthConfig) -> Result<Option<AuthCredentials>, CoreError> {
    match config {
        SavedAuthConfig::None => Ok(None),
        SavedAuthConfig::EnvVar(c) => {
            let secret = std::env::var(&c.env_var)
                .map_err(|_| CoreError::Auth(format!("env var `{}` not set", c.env_var)))?;
            Ok(Some(AuthCredentials {
                header_name: c.header_name.clone(),
                header_value: format!("{}{}", c.prefix, secret),
            }))
        }
        SavedAuthConfig::OAuth2ClientCredentials(_) => {
            Err(CoreError::NotImplemented("oauth2 token fetch".into()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_resolves_to_no_credentials() {
        assert_eq!(resolve_auth(&SavedAuthConfig::None).unwrap(), None);
    }

    #[test]
    fn env_var_reads_secret_and_applies_prefix() {
        // Unique var name to avoid cross-test contamination.
        let var = "HANDSHAKER_TEST_AUTH_TASK3";
        std::env::set_var(var, "s3cr3t");
        let cfg = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: var.to_string(),
            header_name: "authorization".to_string(),
            prefix: "Bearer ".to_string(),
        });
        let creds = resolve_auth(&cfg).unwrap().unwrap();
        assert_eq!(creds.header_name, "authorization");
        assert_eq!(creds.header_value, "Bearer s3cr3t");
        std::env::remove_var(var);
    }

    #[test]
    fn env_var_missing_is_auth_error() {
        let cfg = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "HANDSHAKER_DEFINITELY_UNSET_VAR_XYZ".to_string(),
            header_name: "authorization".to_string(),
            prefix: "Bearer ".to_string(),
        });
        match resolve_auth(&cfg).unwrap_err() {
            CoreError::Auth(m) => assert!(m.contains("not set")),
            other => panic!("expected Auth, got {other:?}"),
        }
    }

    #[test]
    fn oauth2_is_not_implemented() {
        let cfg = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret_env_var: "SECRET".into(),
            scopes: vec![],
        });
        assert!(matches!(resolve_auth(&cfg).unwrap_err(), CoreError::NotImplemented(_)));
    }

    #[test]
    fn auth_by_env_serde_round_trip() {
        let mut abe = AuthByEnv::default();
        abe.configs.insert("prod".into(), SavedAuthConfig::None);
        let json = serde_json::to_string(&abe).unwrap();
        let back: AuthByEnv = serde_json::from_str(&json).unwrap();
        assert_eq!(abe, back);
    }
}
```

- [ ] **Step 3: Run the auth tests**

Run: `cargo test -p handshaker-core auth::`
Expected: PASS (5 tests).

> Note: `env_var_reads_secret_and_applies_prefix` mutates process env. It uses a unique var name and cleans up, so it is safe under `cargo test`'s parallel runner.

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/auth/mod.rs crates/handshaker-core/src/lib.rs
git commit -m "feat(core): auth config types + resolve_auth"
```

---

## Task 4: `collections` model + `ids` + `tree`

**Files:**
- Create: `crates/handshaker-core/src/collections/mod.rs`
- Create: `crates/handshaker-core/src/collections/ids.rs`
- Create: `crates/handshaker-core/src/collections/tree.rs`
- Modify: `crates/handshaker-core/src/lib.rs`

> This task creates `collections/mod.rs` declaring ALL submodules, but only `ids`, `tree`, and the model types are written here. `resolve`, `store`, `in_memory`, `file_store` are stubbed as empty in this task's `mod.rs` declaration and filled in Tasks 5–6. To keep the crate compiling, declare submodules only as each file is created — see Step 1.

- [ ] **Step 1: Declare the module (only ids + tree for now)**

In `crates/handshaker-core/src/lib.rs`, add `pub mod collections;` after `pub mod auth;`:

```rust
pub mod auth;
pub mod collections;
pub mod env;
pub mod error;
pub mod grpc;
pub mod persist;
pub mod vars;
```

- [ ] **Step 2: Write `collections/ids.rs`**

Create `crates/handshaker-core/src/collections/ids.rs`:

```rust
//! Opaque UUID-v7 identifiers for collections and items. v7 is time-ordered, so
//! ids sort by creation; tests must NOT assert specific values (design §R8) —
//! construct `ItemId(Uuid::from_u128(n))` when a fixed id is needed.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CollectionId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ItemId(pub Uuid);

#[allow(clippy::new_without_default)]
impl CollectionId {
    /// Fresh time-ordered id.
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

#[allow(clippy::new_without_default)]
impl ItemId {
    /// Fresh time-ordered id.
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique() {
        assert_ne!(ItemId::new(), ItemId::new());
        assert_ne!(CollectionId::new(), CollectionId::new());
    }

    #[test]
    fn id_serializes_as_string() {
        let id = ItemId(Uuid::from_u128(1));
        let json = serde_json::to_string(&id).unwrap();
        assert!(json.starts_with('"') && json.ends_with('"'), "got {json}");
        let back: ItemId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, back);
    }
}
```

- [ ] **Step 3: Write `collections/mod.rs` (model types; declare ids + tree)**

Create `crates/handshaker-core/src/collections/mod.rs`:

```rust
//! Postman-style recursive collections (master spec §5.5).
//!
//! A `Collection` owns a tree of `Item`s (`Folder` | `SavedRequest`). Folders
//! group items and carry auth-by-env; variables exist only at env + collection
//! scope (master §5.2 — no per-folder variables). Endpoints are `{{var}}`
//! templates resolved to a `GrpcTarget` at send time.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::auth::{AuthByEnv, AuthCredentials};
use crate::grpc::GrpcTarget;

pub mod ids;
pub mod tree;

pub use ids::{CollectionId, ItemId};

/// Root entity. Carries collection-scope variables, root auth, and TLS defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Collection {
    pub id: CollectionId,
    pub name: String,
    pub items: Vec<Item>,
    pub variables: HashMap<String, String>,
    pub auth_by_env: AuthByEnv,
    pub default_tls: bool,
    pub skip_tls_verify: bool,
}

/// A node in the tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Item {
    Folder(Folder),
    Request(SavedRequest),
}

/// User grouping. Carries auth-by-env only (no variables — master §5.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Folder {
    pub id: ItemId,
    pub name: String,
    pub items: Vec<Item>,
    pub auth_by_env: AuthByEnv,
}

/// A saved request: address template + service/method + body/metadata templates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedRequest {
    pub id: ItemId,
    pub name: String,
    pub address_template: String,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: HashMap<String, String>,
    pub auth_by_env: AuthByEnv,
    pub tls_override: Option<bool>,
}

/// Fully-resolved request, ready to invoke. Output of `resolve::resolve_request`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveRequest {
    pub target: GrpcTarget,
    pub service: String,
    pub method: String,
    pub body_json: String,
    pub metadata: HashMap<String, String>,
    pub auth: Option<AuthCredentials>,
}

impl Item {
    pub fn id(&self) -> ItemId {
        match self {
            Item::Folder(f) => f.id,
            Item::Request(r) => r.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Item::Folder(f) => &f.name,
            Item::Request(r) => &r.name,
        }
    }

    pub fn set_name(&mut self, name: String) {
        match self {
            Item::Folder(f) => f.name = name,
            Item::Request(r) => r.name = name,
        }
    }
}
```

- [ ] **Step 4: Write `collections/tree.rs` with implementation + tests**

Create `crates/handshaker-core/src/collections/tree.rs`:

```rust
//! Pure tree operations over a collection's `Vec<Item>`. All operate by `ItemId`
//! and recurse into folders. Idempotent where the IPC contract promises it
//! (design §5).

use crate::error::CoreError;

use super::ids::ItemId;
use super::{Folder, Item};

/// A removed item plus where it lived, for undo (`collection_restore_item`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemSnapshot {
    pub item: Item,
    /// Parent folder id, or `None` if it was a root child.
    pub parent: Option<ItemId>,
    pub position: usize,
}

/// DFS for an item by id (immutable).
pub fn find_item(items: &[Item], id: ItemId) -> Option<&Item> {
    for it in items {
        if it.id() == id {
            return Some(it);
        }
        if let Item::Folder(f) = it {
            if let Some(found) = find_item(&f.items, id) {
                return Some(found);
            }
        }
    }
    None
}

/// DFS for an item by id (mutable).
pub fn find_item_mut(items: &mut [Item], id: ItemId) -> Option<&mut Item> {
    for it in items.iter_mut() {
        if it.id() == id {
            return Some(it);
        }
        if let Item::Folder(f) = it {
            if let Some(found) = find_item_mut(&mut f.items, id) {
                return Some(found);
            }
        }
    }
    None
}

/// Locate `id`: returns `(parent_folder_id_or_None_for_root, position)`.
fn locate(items: &[Item], id: ItemId, current_parent: Option<ItemId>) -> Option<(Option<ItemId>, usize)> {
    if let Some(pos) = items.iter().position(|it| it.id() == id) {
        return Some((current_parent, pos));
    }
    for it in items {
        if let Item::Folder(f) = it {
            if let Some(res) = locate(&f.items, id, Some(f.id)) {
                return Some(res);
            }
        }
    }
    None
}

/// Borrow the container `Vec` that holds direct children of `parent` (or root).
fn container_mut<'a>(items: &'a mut Vec<Item>, parent: Option<ItemId>) -> Result<&'a mut Vec<Item>, CoreError> {
    match parent {
        None => Ok(items),
        Some(pid) => match find_item_mut(items, pid) {
            Some(Item::Folder(f)) => Ok(&mut f.items),
            Some(Item::Request(_)) => Err(CoreError::InvalidTarget(format!("parent {pid:?} is a request, not a folder"))),
            None => Err(CoreError::InvalidTarget(format!("parent folder {pid:?} not found"))),
        },
    }
}

/// Append `item` under `parent` (or root). Idempotent: if `item.id()` already
/// exists anywhere in the tree, this is a no-op `Ok`.
pub fn add_item(items: &mut Vec<Item>, parent: Option<ItemId>, item: Item) -> Result<(), CoreError> {
    if find_item(items, item.id()).is_some() {
        return Ok(());
    }
    let container = container_mut(items, parent)?;
    container.push(item);
    Ok(())
}

/// Rename an item. Missing → `InvalidTarget`. Idempotent (same name → `Ok`).
pub fn rename_item(items: &mut [Item], id: ItemId, name: String) -> Result<(), CoreError> {
    match find_item_mut(items, id) {
        Some(it) => {
            it.set_name(name);
            Ok(())
        }
        None => Err(CoreError::InvalidTarget(format!("item {id:?} not found"))),
    }
}

/// Remove an item, returning a snapshot for undo. Missing → `None` (idempotent
/// at the command layer).
pub fn delete_item(items: &mut Vec<Item>, id: ItemId) -> Option<ItemSnapshot> {
    let (parent, pos) = locate(items, id, None)?;
    let container = match parent {
        None => &mut *items,
        Some(pid) => match find_item_mut(items, pid) {
            Some(Item::Folder(f)) => &mut f.items,
            _ => return None,
        },
    };
    let item = container.remove(pos);
    Some(ItemSnapshot { item, parent, position: pos })
}

/// Re-insert a previously-removed item at `parent`/`pos` (position clamped).
pub fn restore_item(items: &mut Vec<Item>, item: Item, parent: Option<ItemId>, pos: usize) -> Result<(), CoreError> {
    let container = container_mut(items, parent)?;
    let clamped = pos.min(container.len());
    container.insert(clamped, item);
    Ok(())
}

/// Detach `id` and reinsert at `pos` under `new_parent`. Rejects moving a folder
/// into itself or one of its descendants.
pub fn move_item(items: &mut Vec<Item>, id: ItemId, new_parent: Option<ItemId>, pos: usize) -> Result<(), CoreError> {
    if let Some(np) = new_parent {
        if np == id {
            return Err(CoreError::InvalidTarget("cannot move a folder into itself".into()));
        }
        if let Some(Item::Folder(f)) = find_item(items, id) {
            if find_item(&f.items, np).is_some() {
                return Err(CoreError::InvalidTarget("cannot move a folder into its own descendant".into()));
            }
        }
        // Validate destination is a folder.
        match find_item(items, np) {
            Some(Item::Folder(_)) => {}
            Some(Item::Request(_)) => return Err(CoreError::InvalidTarget("new parent is not a folder".into())),
            None => return Err(CoreError::InvalidTarget("new parent not found".into())),
        }
    }
    let snap = delete_item(items, id)
        .ok_or_else(|| CoreError::InvalidTarget(format!("item {id:?} not found")))?;
    restore_item(items, snap.item, new_parent, pos)
}

/// Deep-clone the subtree rooted at `id` with FRESH ids throughout; insert as the
/// next sibling. Returns the new root id.
pub fn duplicate_item(items: &mut Vec<Item>, id: ItemId) -> Result<ItemId, CoreError> {
    let (parent, pos) = locate(items, id, None)
        .ok_or_else(|| CoreError::InvalidTarget(format!("item {id:?} not found")))?;
    let mut clone = find_item(items, id).expect("located above").clone();
    let new_root_id = reassign_ids(&mut clone);
    let container = match parent {
        None => &mut *items,
        Some(pid) => match find_item_mut(items, pid) {
            Some(Item::Folder(f)) => &mut f.items,
            _ => return Err(CoreError::InvalidTarget("parent vanished".into())),
        },
    };
    container.insert(pos + 1, clone);
    Ok(new_root_id)
}

/// Recursively assign fresh ids to an item and all descendants; return the root's.
fn reassign_ids(item: &mut Item) -> ItemId {
    match item {
        Item::Folder(f) => {
            f.id = ItemId::new();
            for child in &mut f.items {
                reassign_ids(child);
            }
            f.id
        }
        Item::Request(r) => {
            r.id = ItemId::new();
            r.id
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthByEnv;
    use crate::collections::SavedRequest;
    use std::collections::HashMap;
    use uuid::Uuid;

    fn iid(n: u128) -> ItemId {
        ItemId(Uuid::from_u128(n))
    }

    fn req(id: ItemId, name: &str) -> Item {
        Item::Request(SavedRequest {
            id,
            name: name.to_string(),
            address_template: "{{host}}".into(),
            service: "svc".into(),
            method: "M".into(),
            body_template: "{}".into(),
            metadata: HashMap::new(),
            auth_by_env: AuthByEnv::default(),
            tls_override: None,
        })
    }

    fn folder(id: ItemId, name: &str, items: Vec<Item>) -> Item {
        Item::Folder(Folder {
            id,
            name: name.to_string(),
            items,
            auth_by_env: AuthByEnv::default(),
        })
    }

    #[test]
    fn add_at_root_and_under_folder() {
        let mut items = vec![folder(iid(1), "f", vec![])];
        add_item(&mut items, None, req(iid(2), "r2")).unwrap();
        add_item(&mut items, Some(iid(1)), req(iid(3), "r3")).unwrap();
        assert_eq!(items.len(), 2);
        assert!(find_item(&items, iid(3)).is_some());
    }

    #[test]
    fn add_is_idempotent_on_duplicate_id() {
        let mut items = vec![req(iid(1), "r")];
        add_item(&mut items, None, req(iid(1), "r-again")).unwrap();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn add_under_request_parent_is_invalid() {
        let mut items = vec![req(iid(1), "r")];
        let err = add_item(&mut items, Some(iid(1)), req(iid(2), "x")).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn rename_sets_name() {
        let mut items = vec![req(iid(1), "old")];
        rename_item(&mut items, iid(1), "new".into()).unwrap();
        assert_eq!(find_item(&items, iid(1)).unwrap().name(), "new");
    }

    #[test]
    fn delete_returns_snapshot_and_restore_reinserts() {
        let mut items = vec![req(iid(1), "a"), req(iid(2), "b"), req(iid(3), "c")];
        let snap = delete_item(&mut items, iid(2)).unwrap();
        assert_eq!(snap.position, 1);
        assert_eq!(snap.parent, None);
        assert_eq!(items.len(), 2);
        restore_item(&mut items, snap.item, snap.parent, snap.position).unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[1].id(), iid(2));
    }

    #[test]
    fn delete_missing_is_none() {
        let mut items = vec![req(iid(1), "a")];
        assert!(delete_item(&mut items, iid(99)).is_none());
    }

    #[test]
    fn move_across_folders() {
        let mut items = vec![folder(iid(1), "f1", vec![req(iid(2), "r")]), folder(iid(3), "f2", vec![])];
        move_item(&mut items, iid(2), Some(iid(3)), 0).unwrap();
        // r is now under f2, not f1.
        if let Item::Folder(f1) = &items[0] {
            assert!(f1.items.is_empty());
        } else {
            panic!();
        }
        if let Item::Folder(f2) = &items[1] {
            assert_eq!(f2.items[0].id(), iid(2));
        } else {
            panic!();
        }
    }

    #[test]
    fn move_folder_into_own_descendant_is_rejected() {
        let mut items = vec![folder(iid(1), "outer", vec![folder(iid(2), "inner", vec![])])];
        let err = move_item(&mut items, iid(1), Some(iid(2)), 0).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn duplicate_makes_fresh_ids_at_every_depth() {
        let mut items = vec![folder(iid(1), "f", vec![req(iid(2), "r")])];
        let new_root = duplicate_item(&mut items, iid(1)).unwrap();
        assert_eq!(items.len(), 2);
        assert_ne!(new_root, iid(1));
        // The duplicated subtree's child id differs from the original's child id.
        if let Item::Folder(dup) = find_item(&items, new_root).unwrap() {
            assert_ne!(dup.items[0].id(), iid(2));
        } else {
            panic!("duplicate root is not a folder");
        }
    }
}
```

- [ ] **Step 5: Run the collections tree + ids tests**

Run: `cargo test -p handshaker-core collections::`
Expected: PASS (ids: 2, tree: 10).

- [ ] **Step 6: Commit**

```bash
git add crates/handshaker-core/src/collections/ crates/handshaker-core/src/lib.rs
git commit -m "feat(core): collections model + ids + pure tree ops"
```

---

## Task 5: `collections::resolve`

**Files:**
- Create: `crates/handshaker-core/src/collections/resolve.rs`
- Modify: `crates/handshaker-core/src/collections/mod.rs` (declare + re-export)

- [ ] **Step 1: Declare + re-export in `collections/mod.rs`**

In `crates/handshaker-core/src/collections/mod.rs`, add to the submodule declarations:

```rust
pub mod ids;
pub mod resolve;
pub mod tree;

pub use ids::{CollectionId, ItemId};
pub use resolve::resolve_request;
```

- [ ] **Step 2: Write `collections/resolve.rs` with implementation + tests**

Create `crates/handshaker-core/src/collections/resolve.rs`:

```rust
//! Turn a `SavedRequest` + its folder ancestors + collection + active env into a
//! fully-resolved `EffectiveRequest` (master spec §5.5, three-step walk).
//!
//! Pure except for the `std::env` read inside auth resolution → fully testable.

use std::collections::HashMap;

use crate::auth::{resolve_auth, AuthByEnv};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::GrpcTarget;
use crate::vars::{resolve_string, VariableSet};

use super::{Collection, EffectiveRequest, Folder, SavedRequest};

/// Resolve one request. `ancestors` is the folder chain from OUTERMOST → INNERMOST
/// (the `Collection` is passed separately; only folders appear here).
/// `active_env` is `None` for "No environment".
pub fn resolve_request(
    request: &SavedRequest,
    ancestors: &[&Folder],
    collection: &Collection,
    active_env: Option<&Environment>,
) -> Result<EffectiveRequest, CoreError> {
    // --- 1. Variables (priority env > collection) ---
    let empty = HashMap::new();
    let env_vars = active_env.map(|e| &e.variables).unwrap_or(&empty);
    let vars = VariableSet { env: env_vars, collection: &collection.variables };

    let address = resolve_string(&request.address_template, &vars)?;
    let body_json = resolve_string(&request.body_template, &vars)?;
    let mut metadata = HashMap::with_capacity(request.metadata.len());
    for (k, v) in &request.metadata {
        // Keys are literal; only values are templated.
        metadata.insert(k.clone(), resolve_string(v, &vars)?);
    }

    // --- 2. TLS ---
    let tls = request.tls_override.unwrap_or(collection.default_tls);
    let target = GrpcTarget::new(address, tls, collection.skip_tls_verify)?;

    // --- 3. Auth (nearest node defining a config for the active env wins) ---
    let auth = match active_env {
        None => None,
        Some(env) => resolve_auth_chain(request, ancestors, collection, &env.name)?,
    };

    Ok(EffectiveRequest {
        target,
        service: request.service.clone(),
        method: request.method.clone(),
        body_json,
        metadata,
        auth,
    })
}

/// Walk Request → innermost Folder → … → Collection; resolve the first node that
/// defines a config for `env_name`. No node defines one → unauthenticated (`None`).
fn resolve_auth_chain(
    request: &SavedRequest,
    ancestors: &[&Folder],
    collection: &Collection,
    env_name: &str,
) -> Result<Option<crate::auth::AuthCredentials>, CoreError> {
    let mut chain: Vec<&AuthByEnv> = Vec::with_capacity(ancestors.len() + 2);
    chain.push(&request.auth_by_env);
    for folder in ancestors.iter().rev() {
        chain.push(&folder.auth_by_env);
    }
    chain.push(&collection.auth_by_env);

    for abe in chain {
        if let Some(cfg) = abe.for_env(env_name) {
            return resolve_auth(cfg);
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{EnvVarAuthConfig, SavedAuthConfig};
    use crate::collections::ids::{CollectionId, ItemId};
    use crate::collections::Item;
    use uuid::Uuid;

    fn env(name: &str, kv: &[(&str, &str)]) -> Environment {
        Environment {
            name: name.to_string(),
            variables: kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        }
    }

    fn base_collection(vars: &[(&str, &str)]) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(1)),
            name: "c".into(),
            items: vec![],
            variables: vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            auth_by_env: AuthByEnv::default(),
            default_tls: false,
            skip_tls_verify: false,
        }
    }

    fn base_request() -> SavedRequest {
        SavedRequest {
            id: ItemId(Uuid::from_u128(2)),
            name: "r".into(),
            address_template: "{{host}}".into(),
            service: "pkg.Svc".into(),
            method: "Do".into(),
            body_template: r#"{"id":"{{uid}}"}"#.into(),
            metadata: HashMap::new(),
            auth_by_env: AuthByEnv::default(),
            tls_override: None,
        }
    }

    #[test]
    fn resolves_address_and_body_env_over_collection() {
        let coll = base_collection(&[("host", "coll:1"), ("uid", "cuid")]);
        let active = env("prod", &[("host", "api:443")]);
        let mut req = base_request();
        req.metadata.insert("x-trace".into(), "{{uid}}".into());
        let eff = resolve_request(&req, &[], &coll, Some(&active)).unwrap();
        assert_eq!(eff.target.address, "api:443"); // env wins
        assert_eq!(eff.body_json, r#"{"id":"cuid"}"#); // collection fills uid
        assert_eq!(eff.metadata.get("x-trace"), Some(&"cuid".to_string()));
    }

    #[test]
    fn unresolved_variable_errors() {
        let coll = base_collection(&[]);
        let active = env("prod", &[]);
        let req = base_request(); // {{host}} unresolved
        match resolve_request(&req, &[], &coll, Some(&active)).unwrap_err() {
            CoreError::UnresolvedVariable { name } => assert!(name == "host" || name == "uid"),
            other => panic!("expected UnresolvedVariable, got {other:?}"),
        }
    }

    #[test]
    fn variable_cycle_errors() {
        let mut coll = base_collection(&[]);
        coll.variables.insert("a".into(), "{{b}}".into());
        coll.variables.insert("b".into(), "{{a}}".into());
        let active = env("prod", &[]);
        let mut req = base_request();
        req.address_template = "{{a}}".into();
        req.body_template = "{}".into();
        assert!(matches!(
            resolve_request(&req, &[], &coll, Some(&active)).unwrap_err(),
            CoreError::VariableCycle { .. }
        ));
    }

    #[test]
    fn tls_override_beats_collection_default() {
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.default_tls = false;
        let active = env("prod", &[]);
        let mut req = base_request();
        req.tls_override = Some(true);
        let eff = resolve_request(&req, &[], &coll, Some(&active)).unwrap();
        assert!(eff.target.tls);
    }

    #[test]
    fn auth_nearest_some_wins_request_over_collection() {
        let var = "HANDSHAKER_TEST_AUTH_TASK5_REQ";
        std::env::set_var(var, "rtoken");
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.auth_by_env.configs.insert(
            "prod".into(),
            SavedAuthConfig::EnvVar(EnvVarAuthConfig {
                env_var: "SHOULD_NOT_BE_USED".into(),
                header_name: "authorization".into(),
                prefix: "Bearer ".into(),
            }),
        );
        let mut req = base_request();
        req.auth_by_env.configs.insert(
            "prod".into(),
            SavedAuthConfig::EnvVar(EnvVarAuthConfig {
                env_var: var.into(),
                header_name: "authorization".into(),
                prefix: "Bearer ".into(),
            }),
        );
        let active = env("prod", &[]);
        let eff = resolve_request(&req, &[], &coll, Some(&active)).unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer rtoken");
        std::env::remove_var(var);
    }

    #[test]
    fn auth_falls_back_to_folder_then_collection() {
        let var = "HANDSHAKER_TEST_AUTH_TASK5_FOLDER";
        std::env::set_var(var, "ftoken");
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let folder = Folder {
            id: ItemId(Uuid::from_u128(9)),
            name: "f".into(),
            items: vec![],
            auth_by_env: {
                let mut a = AuthByEnv::default();
                a.configs.insert(
                    "prod".into(),
                    SavedAuthConfig::EnvVar(EnvVarAuthConfig {
                        env_var: var.into(),
                        header_name: "authorization".into(),
                        prefix: "Bearer ".into(),
                    }),
                );
                a
            },
        };
        let req = base_request(); // no auth on request
        let active = env("prod", &[]);
        let eff = resolve_request(&req, &[&folder], &coll, Some(&active)).unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer ftoken");
        std::env::remove_var(var);
    }

    #[test]
    fn no_auth_config_anywhere_is_unauthenticated() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let req = base_request();
        let eff = resolve_request(&req, &[], &coll, Some(&active)).unwrap();
        assert!(eff.auth.is_none());
    }

    #[test]
    fn no_active_env_means_no_auth_and_empty_env_vars() {
        // host comes from collection; no env → env map empty, auth skipped.
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let req = base_request();
        let eff = resolve_request(&req, &[], &coll, None).unwrap();
        assert_eq!(eff.target.address, "h:1");
        assert!(eff.auth.is_none());
    }

    // Silence unused import warning when Item is only used in other test modules.
    #[allow(dead_code)]
    fn _uses_item(_: &Item) {}
}
```

- [ ] **Step 3: Run the resolve tests**

Run: `cargo test -p handshaker-core collections::resolve`
Expected: PASS (8 tests).

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/collections/resolve.rs crates/handshaker-core/src/collections/mod.rs
git commit -m "feat(core): resolve_request inheritance walk"
```

---

## Task 6: `CollectionStore` + in-memory + file store + integration test

**Files:**
- Create: `crates/handshaker-core/src/collections/store.rs`
- Create: `crates/handshaker-core/src/collections/in_memory.rs`
- Create: `crates/handshaker-core/src/collections/file_store.rs`
- Create: `crates/handshaker-core/tests/collections_persistence.rs`
- Modify: `crates/handshaker-core/src/collections/mod.rs` (declare + re-export)

- [ ] **Step 1: Declare + re-export in `collections/mod.rs`**

In `crates/handshaker-core/src/collections/mod.rs`, extend the submodule block:

```rust
pub mod file_store;
pub mod ids;
pub mod in_memory;
pub mod resolve;
pub mod store;
pub mod tree;

pub use file_store::FileCollectionStore;
pub use ids::{CollectionId, ItemId};
pub use in_memory::InMemoryCollectionStore;
pub use resolve::resolve_request;
pub use store::CollectionStore;
```

- [ ] **Step 2: Write `collections/store.rs`**

Create `crates/handshaker-core/src/collections/store.rs`:

```rust
//! Storage abstraction for collections. CRUD by whole `Collection`; tree edits
//! happen in the command layer (get → mutate via `tree` → upsert), keeping
//! per-collection writes atomic. Implementations: [`super::InMemoryCollectionStore`],
//! [`super::FileCollectionStore`].

use crate::error::CoreError;

use super::ids::CollectionId;
use super::Collection;

pub trait CollectionStore: Send + Sync {
    fn list(&self) -> Vec<Collection>;
    fn get(&self, id: CollectionId) -> Option<Collection>;
    fn upsert(&self, collection: Collection) -> Result<(), CoreError>;
    /// Idempotent: deleting a missing id returns `Ok`.
    fn delete(&self, id: CollectionId) -> Result<(), CoreError>;
}
```

- [ ] **Step 3: Write `collections/in_memory.rs` with tests**

Create `crates/handshaker-core/src/collections/in_memory.rs`:

```rust
//! In-memory `CollectionStore` (tests + `AppState::default()`).

use std::collections::HashMap;
use std::sync::RwLock;

use crate::error::CoreError;

use super::ids::CollectionId;
use super::store::CollectionStore;
use super::Collection;

pub struct InMemoryCollectionStore {
    inner: RwLock<HashMap<CollectionId, Collection>>,
}

impl InMemoryCollectionStore {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }
}

impl Default for InMemoryCollectionStore {
    fn default() -> Self {
        Self::new()
    }
}

impl CollectionStore for InMemoryCollectionStore {
    fn list(&self) -> Vec<Collection> {
        self.inner.read().expect("collection store poisoned").values().cloned().collect()
    }

    fn get(&self, id: CollectionId) -> Option<Collection> {
        self.inner.read().expect("collection store poisoned").get(&id).cloned()
    }

    fn upsert(&self, collection: Collection) -> Result<(), CoreError> {
        self.inner.write().expect("collection store poisoned").insert(collection.id, collection);
        Ok(())
    }

    fn delete(&self, id: CollectionId) -> Result<(), CoreError> {
        self.inner.write().expect("collection store poisoned").remove(&id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthByEnv;
    use crate::collections::ids::ItemId;
    use uuid::Uuid;

    fn coll(id: u128, name: &str) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(id)),
            name: name.into(),
            items: vec![],
            variables: HashMap::new(),
            auth_by_env: AuthByEnv::default(),
            default_tls: false,
            skip_tls_verify: false,
        }
    }

    #[test]
    fn upsert_get_round_trip() {
        let s = InMemoryCollectionStore::new();
        s.upsert(coll(1, "a")).unwrap();
        assert_eq!(s.get(CollectionId(Uuid::from_u128(1))).unwrap().name, "a");
    }

    #[test]
    fn delete_is_idempotent() {
        let s = InMemoryCollectionStore::new();
        s.delete(CollectionId(Uuid::from_u128(7))).unwrap(); // missing → Ok
    }

    // touch ItemId so the import is used if later edits remove the only reference.
    #[allow(dead_code)]
    fn _uses_item_id(_: ItemId) {}
}
```

- [ ] **Step 4: Write `collections/file_store.rs` with tests**

Create `crates/handshaker-core/src/collections/file_store.rs`:

```rust
//! Disk-backed `CollectionStore`: one `<dir>/<uuid>.json` per collection, written
//! atomically (temp+rename). Reads serve from an in-memory mirror; the mirror is
//! updated only after a successful write (clone-then-commit, design §R7).

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use crate::error::CoreError;
use crate::persist::{atomic_write_json, read_json, Envelope};

use super::ids::CollectionId;
use super::store::CollectionStore;
use super::Collection;

pub struct FileCollectionStore {
    dir: PathBuf,
    inner: RwLock<HashMap<CollectionId, Collection>>,
}

impl FileCollectionStore {
    /// Load every `*.json` under `dir` (creating `dir` if absent).
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
            let c: Collection = read_json(&path)?;
            map.insert(c.id, c);
        }
        Ok(Self { dir, inner: RwLock::new(map) })
    }

    fn file_path(&self, id: CollectionId) -> PathBuf {
        self.dir.join(format!("{}.json", id.0))
    }
}

impl CollectionStore for FileCollectionStore {
    fn list(&self) -> Vec<Collection> {
        self.inner.read().expect("collection store poisoned").values().cloned().collect()
    }

    fn get(&self, id: CollectionId) -> Option<Collection> {
        self.inner.read().expect("collection store poisoned").get(&id).cloned()
    }

    fn upsert(&self, collection: Collection) -> Result<(), CoreError> {
        let path = self.file_path(collection.id);
        let mut guard = self.inner.write().expect("collection store poisoned");
        atomic_write_json(&path, &Envelope::new(collection.clone()))?;
        guard.insert(collection.id, collection);
        Ok(())
    }

    fn delete(&self, id: CollectionId) -> Result<(), CoreError> {
        let path = self.file_path(id);
        let mut guard = self.inner.write().expect("collection store poisoned");
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| CoreError::Persistence(format!("remove {}: {e}", path.display())))?;
        }
        guard.remove(&id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthByEnv;
    use uuid::Uuid;

    fn coll(id: u128, name: &str) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(id)),
            name: name.into(),
            items: vec![],
            variables: HashMap::new(),
            auth_by_env: AuthByEnv::default(),
            default_tls: false,
            skip_tls_verify: false,
        }
    }

    #[test]
    fn upsert_creates_file_and_reload_sees_it() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        store.upsert(coll(1, "a")).unwrap();
        store.upsert(coll(2, "b")).unwrap();

        // Two files on disk.
        let json_count = std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|e| e.as_ref().unwrap().path().extension().and_then(|s| s.to_str()) == Some("json"))
            .count();
        assert_eq!(json_count, 2);

        // Reload sees both.
        drop(store);
        let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        assert_eq!(store2.list().len(), 2);
    }

    #[test]
    fn delete_removes_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        store.upsert(coll(1, "a")).unwrap();
        store.delete(CollectionId(Uuid::from_u128(1))).unwrap();
        assert!(store.get(CollectionId(Uuid::from_u128(1))).is_none());
        let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        assert!(store2.list().is_empty());
    }

    #[test]
    fn corrupt_file_is_persistence_error_not_panic() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join(format!("{}.json", Uuid::from_u128(3)));
        std::fs::write(&bad, b"{ not valid json").unwrap();
        let err = FileCollectionStore::load(dir.path().to_path_buf()).unwrap_err();
        assert!(matches!(err, CoreError::Persistence(_)));
    }
}
```

- [ ] **Step 5: Write the integration test**

Create `crates/handshaker-core/tests/collections_persistence.rs`:

```rust
//! End-to-end: build a collection with a folder + request, mutate via tree ops
//! through a FileCollectionStore on a TempDir, drop + reconstruct, assert the
//! tree survived. Mirrors the style of `tests/vars_end_to_end.rs`.

use std::collections::HashMap;

use handshaker_core::auth::AuthByEnv;
use handshaker_core::collections::ids::{CollectionId, ItemId};
use handshaker_core::collections::store::CollectionStore;
use handshaker_core::collections::{tree, Collection, Folder, Item, SavedRequest};
use handshaker_core::collections::FileCollectionStore;
use uuid::Uuid;

fn request(id: u128, name: &str) -> Item {
    Item::Request(SavedRequest {
        id: ItemId(Uuid::from_u128(id)),
        name: name.into(),
        address_template: "{{host}}".into(),
        service: "pkg.Svc".into(),
        method: "Do".into(),
        body_template: "{}".into(),
        metadata: HashMap::new(),
        auth_by_env: AuthByEnv::default(),
        tls_override: None,
    })
}

#[test]
fn collection_tree_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();

    let cid = CollectionId(Uuid::from_u128(100));
    let mut coll = Collection {
        id: cid,
        name: "My API".into(),
        items: vec![Item::Folder(Folder {
            id: ItemId(Uuid::from_u128(1)),
            name: "Users".into(),
            items: vec![],
            auth_by_env: AuthByEnv::default(),
        })],
        variables: HashMap::new(),
        auth_by_env: AuthByEnv::default(),
        default_tls: false,
        skip_tls_verify: false,
    };

    // Add a request under the folder, then persist.
    tree::add_item(&mut coll.items, Some(ItemId(Uuid::from_u128(1))), request(2, "GetUser")).unwrap();
    store.upsert(coll).unwrap();

    // "Restart".
    drop(store);
    let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
    let reloaded = store2.get(cid).unwrap();

    // Folder + nested request survived.
    let found = tree::find_item(&reloaded.items, ItemId(Uuid::from_u128(2)));
    assert!(found.is_some(), "nested request should survive restart");
    assert_eq!(found.unwrap().name(), "GetUser");
}
```

- [ ] **Step 6: Run the store + integration tests**

Run: `cargo test -p handshaker-core collections::in_memory collections::file_store` then `cargo test -p handshaker-core --test collections_persistence`
Expected: PASS (in_memory: 2, file_store: 3, integration: 1).

- [ ] **Step 7: Commit**

```bash
git add crates/handshaker-core/src/collections/ crates/handshaker-core/tests/collections_persistence.rs
git commit -m "feat(core): CollectionStore + in-memory + file store + integration test"
```

---

## Task 7: `ContractCache` + `activate()` rewire

**Files:**
- Create: `crates/handshaker-core/src/grpc/contract_cache.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs:17-22`
- Modify: `crates/handshaker-core/src/grpc/contract.rs`
- Modify: 6 test files (`tests/contract_activate.rs`, `tests/invoke_unary.rs`, `tests/invoke_skeleton.rs`, `tests/invoke_status.rs`, `tests/invoke_trailers.rs`, `tests/invoke_live.rs`)

- [ ] **Step 1: Write `grpc/contract_cache.rs` with unit tests**

Create `crates/handshaker-core/src/grpc/contract_cache.rs`:

```rust
//! Descriptor (contract) cache keyed by `(address, tls)` (master spec §5.8). Lets
//! `activate()` skip reflection when the contract for an endpoint is already known.
//! `skip_verify` is deliberately NOT part of the key (it does not change the
//! contract). Session-only — not persisted.

use std::collections::HashMap;
use std::sync::RwLock;

use prost_reflect::DescriptorPool;

use crate::grpc::catalog::ServiceCatalog;
use crate::grpc::connection::GrpcTarget;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ContractKey {
    pub address: String,
    pub tls: bool,
}

impl ContractKey {
    pub fn from_target(t: &GrpcTarget) -> Self {
        Self { address: t.address.clone(), tls: t.tls }
    }
}

/// A cached contract: the assembled descriptor pool + projected catalog.
#[derive(Clone)]
pub struct CachedContract {
    pub pool: DescriptorPool,
    pub catalog: ServiceCatalog,
    pub fetched_at: std::time::SystemTime,
}

pub trait ContractCache: Send + Sync {
    fn get(&self, key: &ContractKey) -> Option<CachedContract>;
    fn put(&self, key: ContractKey, contract: CachedContract);
    fn invalidate(&self, key: &ContractKey);
}

pub struct InMemoryContractCache {
    inner: RwLock<HashMap<ContractKey, CachedContract>>,
}

impl InMemoryContractCache {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }
}

impl Default for InMemoryContractCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ContractCache for InMemoryContractCache {
    fn get(&self, key: &ContractKey) -> Option<CachedContract> {
        self.inner.read().expect("contract cache poisoned").get(key).cloned()
    }

    fn put(&self, key: ContractKey, contract: CachedContract) {
        self.inner.write().expect("contract cache poisoned").insert(key, contract);
    }

    fn invalidate(&self, key: &ContractKey) {
        self.inner.write().expect("contract cache poisoned").remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(addr: &str, tls: bool) -> ContractKey {
        ContractKey { address: addr.into(), tls }
    }

    fn sample_contract() -> CachedContract {
        CachedContract {
            pool: DescriptorPool::new(),
            catalog: ServiceCatalog { services: vec![] },
            fetched_at: std::time::SystemTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn key_ignores_skip_verify_but_distinguishes_tls() {
        let t1 = GrpcTarget::new("h:1", true, false).unwrap();
        let t2 = GrpcTarget::new("h:1", true, true).unwrap();
        let t3 = GrpcTarget::new("h:1", false, false).unwrap();
        assert_eq!(ContractKey::from_target(&t1), ContractKey::from_target(&t2));
        assert_ne!(ContractKey::from_target(&t1), ContractKey::from_target(&t3));
    }

    #[test]
    fn put_get_invalidate() {
        let cache = InMemoryContractCache::new();
        let k = key("h:1", false);
        assert!(cache.get(&k).is_none());
        cache.put(k.clone(), sample_contract());
        assert!(cache.get(&k).is_some());
        cache.invalidate(&k);
        assert!(cache.get(&k).is_none());
    }
}
```

> Verify the `ServiceCatalog { services: vec![] }` literal matches the real struct field. From `grpc/catalog.rs` the catalog is `ServiceCatalog { services: Vec<ServiceEntry> }`. If the field is private or named differently, build it via `build_catalog(&DescriptorPool::new())` instead.

- [ ] **Step 2: Re-export from `grpc/mod.rs`**

In `crates/handshaker-core/src/grpc/mod.rs`, add the module + re-export:

```rust
pub mod catalog;
pub mod connection;
pub mod contract;
pub mod contract_cache;
pub mod descriptor;
pub mod invoke;
pub mod reflection;
pub mod transport;

pub use catalog::{build_catalog, MethodEntry, ServiceCatalog, ServiceEntry};
pub use connection::{GrpcConnection, GrpcTarget};
pub use contract::activate;
pub use contract_cache::{CachedContract, ContractCache, ContractKey, InMemoryContractCache};
pub use descriptor::build_pool;
pub use invoke::{build_request_skeleton, invoke_unary, UnaryOutcome};
pub use transport::{GrpcTransport, TonicChannel, TonicTransport};
```

- [ ] **Step 3: Rewire `activate()`**

Replace the body of `crates/handshaker-core/src/grpc/contract.rs` with:

```rust
//! Top-level orchestration: open channel → (cache hit?) → run reflection → build
//! pool → build catalog → cache. On a cache hit, reflection is skipped entirely.

use std::sync::Arc;

use crate::error::CoreError;
use crate::grpc::catalog::build_catalog;
use crate::grpc::connection::{GrpcConnection, GrpcTarget};
use crate::grpc::contract_cache::{CachedContract, ContractCache, ContractKey};
use crate::grpc::descriptor::build_pool;
use crate::grpc::reflection::list_and_fetch_files;
use crate::grpc::transport::GrpcTransport;

/// Open a channel to `target`. If `cache` already holds the contract for
/// `(address, tls)`, build the connection from the cached pool/catalog and skip
/// reflection. Otherwise reflect, build, and populate the cache.
///
/// The channel is always opened fresh (it is per-connection, never cached).
pub async fn activate(
    target: GrpcTarget,
    transport: Arc<dyn GrpcTransport>,
    cache: &dyn ContractCache,
) -> Result<GrpcConnection, CoreError> {
    let key = ContractKey::from_target(&target);
    let channel = transport.channel(&target).await?;

    if let Some(cached) = cache.get(&key) {
        return Ok(GrpcConnection {
            target,
            transport,
            channel,
            pool: cached.pool,
            catalog: cached.catalog,
        });
    }

    // clone — TonicChannel is cheap to Clone (Arc internally); reflection consumes
    // its copy, the original stays in GrpcConnection for subsequent invokes.
    let (_services_listed, files) = list_and_fetch_files(channel.clone()).await?;
    let pool = build_pool(files)?;
    let catalog = build_catalog(&pool);

    cache.put(
        key,
        CachedContract {
            pool: pool.clone(),
            catalog: catalog.clone(),
            fetched_at: std::time::SystemTime::now(),
        },
    );

    Ok(GrpcConnection { target, transport, channel, pool, catalog })
}
```

- [ ] **Step 4: Update the 6 integration-test call sites**

In each of these files, add a cache before the `activate(...)` call and pass it. The cache can be created inline.

`tests/contract_activate.rs` has TWO `activate` calls. For each call site across all 6 files, change:

```rust
    let conn = activate(target, transport).await.expect("activate");
```

to:

```rust
    let cache = handshaker_core::grpc::InMemoryContractCache::new();
    let conn = activate(target, transport, &cache).await.expect("activate");
```

(Preserve each call's existing `.expect("...")` message — only insert the `cache` line and the `, &cache` argument.) The full set of lines to update:
- `tests/invoke_unary.rs:16`
- `tests/invoke_skeleton.rs:16` and `:33`
- `tests/invoke_status.rs:20`
- `tests/invoke_trailers.rs:24`
- `tests/invoke_live.rs:31`
- `tests/contract_activate.rs:13` and `:34`

- [ ] **Step 5: Write the cache-behavior integration test**

Create `crates/handshaker-core/tests/contract_cache.rs`:

```rust
//! `activate()` cache behavior, proven against real in-process servers.

mod common;

use std::sync::Arc;

use handshaker_core::grpc::{
    activate, build_catalog, ContractCache, ContractKey, GrpcTarget, InMemoryContractCache,
    TonicTransport,
};
use prost::Message;
use prost_reflect::DescriptorPool;

#[tokio::test]
async fn cache_hit_skips_reflection() {
    // A BARE server exposes NO reflection. If activate() consults the pre-populated
    // cache it succeeds; if it tried to reflect it would fail. So success proves the hit.
    let (addr, _shutdown) = common::spawn_bare_server().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let key = ContractKey::from_target(&target);

    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_set(
        Message::decode(&common::fixture_descriptor_set_bytes()[..]).unwrap(),
    )
    .unwrap();
    let catalog = build_catalog(&pool);

    let cache = InMemoryContractCache::new();
    cache.put(
        key,
        handshaker_core::grpc::CachedContract {
            pool,
            catalog,
            fetched_at: std::time::SystemTime::UNIX_EPOCH,
        },
    );

    let conn = activate(target, Arc::new(TonicTransport::new()), &cache)
        .await
        .expect("cache hit should let activate succeed against a reflection-less server");
    assert!(conn.catalog.services.iter().any(|s| s.full_name == "test.Echo"));
}

#[tokio::test]
async fn cache_miss_populates_then_invalidate_clears() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let key = ContractKey::from_target(&target);
    let cache = InMemoryContractCache::new();

    assert!(cache.get(&key).is_none());
    let _conn = activate(target.clone(), Arc::new(TonicTransport::new()), &cache)
        .await
        .expect("activate");
    assert!(cache.get(&key).is_some(), "cache miss should populate");

    cache.invalidate(&key);
    assert!(cache.get(&key).is_none(), "invalidate should clear");
}
```

- [ ] **Step 6: Run the contract-cache + regression tests**

Run: `cargo test -p handshaker-core contract_cache` then `cargo test -p handshaker-core --test contract_activate --test contract_cache`
Expected: PASS (unit: 2, contract_cache integration: 2, contract_activate still green).

Then the full core suite: `cargo test -p handshaker-core`
Expected: PASS (all invoke_* tests compile with the new `activate` arg).

- [ ] **Step 7: Commit**

```bash
git add crates/handshaker-core/src/grpc/ crates/handshaker-core/tests/
git commit -m "feat(core): ContractCache + activate() cache consult"
```

---

## Task 8: `AppState` fields + `with_data_dir` + production wiring

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs:71-80`
- Modify: `src-tauri/src/commands/env.rs:117-122` (test `build_state`)

- [ ] **Step 1: Add fields + `with_data_dir` to `state.rs`**

Replace the entire contents of `src-tauri/src/state.rs` with:

```rust
//! Tauri-side app state. Fields land per plans #2-#6.

use std::path::Path;
use std::sync::Arc;

use handshaker_core::collections::{CollectionStore, FileCollectionStore, InMemoryCollectionStore};
use handshaker_core::env::file_store::FileEnvironmentStore;
use handshaker_core::env::in_memory::InMemoryEnvironmentStore;
use handshaker_core::env::EnvironmentStore;
use handshaker_core::error::CoreError;
use handshaker_core::grpc::{ContractCache, GrpcConnection, InMemoryContractCache};
use tokio::sync::{Mutex, RwLock};

pub struct AppState {
    /// At most one active gRPC connection per spec §4.
    pub connection: Mutex<Option<Arc<GrpcConnection>>>,
    /// Environment store. Cold boot: empty.
    pub env_store: Arc<dyn EnvironmentStore>,
    /// Active environment name; `None` ≡ "No environment" (Postman-style).
    pub active_env: RwLock<Option<String>>,
    /// Collection store (plan #6). Cold boot: empty.
    pub collection_store: Arc<dyn CollectionStore>,
    /// Descriptor cache (plan #6). Session-only, not persisted.
    pub contract_cache: Arc<dyn ContractCache>,
}

impl Default for AppState {
    /// In-memory everything. Used by tests.
    fn default() -> Self {
        Self {
            connection: Mutex::new(None),
            env_store: Arc::new(InMemoryEnvironmentStore::new()),
            active_env: RwLock::new(None),
            collection_store: Arc::new(InMemoryCollectionStore::new()),
            contract_cache: Arc::new(InMemoryContractCache::new()),
        }
    }
}

impl AppState {
    /// Production constructor: file-backed env + collection stores rooted at `data_dir`.
    /// The contract cache is always in-memory (session-only).
    pub fn with_data_dir(data_dir: &Path) -> Result<Self, CoreError> {
        let env_store = FileEnvironmentStore::load(data_dir.join("environments.json"))?;
        let collection_store = FileCollectionStore::load(data_dir.join("collections"))?;
        Ok(Self {
            connection: Mutex::new(None),
            env_store: Arc::new(env_store),
            active_env: RwLock::new(None),
            collection_store: Arc::new(collection_store),
            contract_cache: Arc::new(InMemoryContractCache::new()),
        })
    }
}
```

- [ ] **Step 2: Fix the env-command test `build_state`**

In `src-tauri/src/commands/env.rs`, the test helper builds an `AppState` struct literal that now misses two fields. Update the imports in the test module (near line 97) to add:

```rust
    use handshaker_core::collections::in_memory::InMemoryCollectionStore;
    use handshaker_core::grpc::InMemoryContractCache;
```

And update the struct literal at the end of `build_state` (currently the `AppState { connection, env_store, active_env }` block) to:

```rust
        AppState {
            connection: Mutex::new(None),
            env_store: Arc::new(store),
            active_env: RwLock::new(active.map(|s| s.to_string())),
            collection_store: Arc::new(InMemoryCollectionStore::new()),
            contract_cache: Arc::new(InMemoryContractCache::new()),
        }
```

- [ ] **Step 3: Wire production state in `run()`**

In `src-tauri/src/lib.rs`, add `use tauri::Manager;` to the imports (after `use tauri_specta::{...};`):

```rust
use tauri::Manager;
```

Replace the `tauri::Builder` block (currently `.manage(AppState::default())` + `.setup(...)`) with:

```rust
    tauri::Builder::default()
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app_data_dir");
            let state = AppState::with_data_dir(&data_dir)
                .expect("initialize AppState from data dir");
            app.manage(state);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```

> Note: `AppState` is now managed inside `.setup()` (it needs the `AppHandle` to resolve the per-OS data dir). Tauri runs `setup` before any command can fire, so `State<'_, AppState>` is always populated. The `.manage(AppState::default())` line is removed.

- [ ] **Step 4: Verify the shell compiles + env tests pass**

Run: `cargo test -p handshaker`
Expected: PASS (env command tests compile with the two new fields).

Also confirm the whole workspace still builds: `cargo build --workspace`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs src-tauri/src/commands/env.rs
git commit -m "feat(tauri): AppState collection_store + contract_cache + file-backed wiring"
```

---

## Task 9: `ipc/collection.rs` DTOs + conversions

**Files:**
- Create: `src-tauri/src/ipc/collection.rs`
- Modify: `src-tauri/src/ipc/mod.rs:1-5`

> UUID ids cross IPC as strings, so conversions can fail (bad UUID). We therefore use explicit fallible `into_core(self) -> Result<_, CoreError>` / infallible `from_core(core) -> Self` methods rather than the `From` trait (unlike `ipc/env.rs`, whose fields never need parsing).

- [ ] **Step 1: Declare the module**

In `src-tauri/src/ipc/mod.rs`, add `pub mod collection;`:

```rust
pub mod catalog;
pub mod collection;
pub mod env;
pub mod error;
pub mod invoke;
pub mod vars;
```

- [ ] **Step 2: Write `ipc/collection.rs`**

Create `src-tauri/src/ipc/collection.rs`:

```rust
//! IPC DTOs for collections. All ids cross as strings (UUID). Conversions to core
//! are fallible (bad UUID → `InvalidTarget`); conversions from core are total.
//!
//! `ItemIpc` is a `#[serde(tag = "type")]` tagged union — the frontend (#3)
//! discriminates on `type` ("folder" | "request").

use std::collections::HashMap;

use handshaker_core::auth::{
    AuthByEnv, AuthCredentials, EnvVarAuthConfig, OAuth2ClientCredentialsConfig, SavedAuthConfig,
};
use handshaker_core::collections::ids::{CollectionId, ItemId};
use handshaker_core::collections::tree::ItemSnapshot;
use handshaker_core::collections::{Collection, Folder, Item, SavedRequest};
use handshaker_core::error::CoreError;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

// --- id parsing helpers -----------------------------------------------------

fn parse_collection_id(s: &str) -> Result<CollectionId, CoreError> {
    Uuid::parse_str(s)
        .map(CollectionId)
        .map_err(|e| CoreError::InvalidTarget(format!("bad collection id `{s}`: {e}")))
}

fn parse_item_id(s: &str) -> Result<ItemId, CoreError> {
    Uuid::parse_str(s)
        .map(ItemId)
        .map_err(|e| CoreError::InvalidTarget(format!("bad item id `{s}`: {e}")))
}

// --- auth DTOs --------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SavedAuthConfigIpc {
    None,
    EnvVar { env_var: String, header_name: String, prefix: String },
    Oauth2ClientCredentials {
        token_url: String,
        client_id: String,
        client_secret_env_var: String,
        scopes: Vec<String>,
    },
}

impl SavedAuthConfigIpc {
    pub fn from_core(c: SavedAuthConfig) -> Self {
        match c {
            SavedAuthConfig::None => Self::None,
            SavedAuthConfig::EnvVar(e) => Self::EnvVar {
                env_var: e.env_var,
                header_name: e.header_name,
                prefix: e.prefix,
            },
            SavedAuthConfig::OAuth2ClientCredentials(o) => Self::Oauth2ClientCredentials {
                token_url: o.token_url,
                client_id: o.client_id,
                client_secret_env_var: o.client_secret_env_var,
                scopes: o.scopes,
            },
        }
    }

    pub fn into_core(self) -> SavedAuthConfig {
        match self {
            Self::None => SavedAuthConfig::None,
            Self::EnvVar { env_var, header_name, prefix } => {
                SavedAuthConfig::EnvVar(EnvVarAuthConfig { env_var, header_name, prefix })
            }
            Self::Oauth2ClientCredentials { token_url, client_id, client_secret_env_var, scopes } => {
                SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
                    token_url,
                    client_id,
                    client_secret_env_var,
                    scopes,
                })
            }
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct AuthByEnvIpc {
    pub configs: HashMap<String, SavedAuthConfigIpc>,
}

impl AuthByEnvIpc {
    pub fn from_core(a: AuthByEnv) -> Self {
        Self {
            configs: a.configs.into_iter().map(|(k, v)| (k, SavedAuthConfigIpc::from_core(v))).collect(),
        }
    }

    pub fn into_core(self) -> AuthByEnv {
        AuthByEnv {
            configs: self.configs.into_iter().map(|(k, v)| (k, v.into_core())).collect(),
        }
    }
}

// --- item DTOs --------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FolderIpc {
    pub id: String,
    pub name: String,
    pub items: Vec<ItemIpc>,
    pub auth_by_env: AuthByEnvIpc,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SavedRequestIpc {
    pub id: String,
    pub name: String,
    pub address_template: String,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: HashMap<String, String>,
    pub auth_by_env: AuthByEnvIpc,
    pub tls_override: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ItemIpc {
    Folder(FolderIpc),
    Request(SavedRequestIpc),
}

impl ItemIpc {
    pub fn from_core(item: Item) -> Self {
        match item {
            Item::Folder(f) => Self::Folder(FolderIpc {
                id: f.id.0.to_string(),
                name: f.name,
                items: f.items.into_iter().map(ItemIpc::from_core).collect(),
                auth_by_env: AuthByEnvIpc::from_core(f.auth_by_env),
            }),
            Item::Request(r) => Self::Request(SavedRequestIpc {
                id: r.id.0.to_string(),
                name: r.name,
                address_template: r.address_template,
                service: r.service,
                method: r.method,
                body_template: r.body_template,
                metadata: r.metadata,
                auth_by_env: AuthByEnvIpc::from_core(r.auth_by_env),
                tls_override: r.tls_override,
            }),
        }
    }

    pub fn into_core(self) -> Result<Item, CoreError> {
        match self {
            Self::Folder(f) => {
                let items = f.items.into_iter().map(ItemIpc::into_core).collect::<Result<Vec<_>, _>>()?;
                Ok(Item::Folder(Folder {
                    id: parse_item_id(&f.id)?,
                    name: f.name,
                    items,
                    auth_by_env: f.auth_by_env.into_core(),
                }))
            }
            Self::Request(r) => Ok(Item::Request(SavedRequest {
                id: parse_item_id(&r.id)?,
                name: r.name,
                address_template: r.address_template,
                service: r.service,
                method: r.method,
                body_template: r.body_template,
                metadata: r.metadata,
                auth_by_env: r.auth_by_env.into_core(),
                tls_override: r.tls_override,
            })),
        }
    }
}

// --- collection DTOs --------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionIpc {
    pub id: String,
    pub name: String,
    pub items: Vec<ItemIpc>,
    pub variables: HashMap<String, String>,
    pub auth_by_env: AuthByEnvIpc,
    pub default_tls: bool,
    pub skip_tls_verify: bool,
}

impl CollectionIpc {
    pub fn from_core(c: Collection) -> Self {
        Self {
            id: c.id.0.to_string(),
            name: c.name,
            items: c.items.into_iter().map(ItemIpc::from_core).collect(),
            variables: c.variables,
            auth_by_env: AuthByEnvIpc::from_core(c.auth_by_env),
            default_tls: c.default_tls,
            skip_tls_verify: c.skip_tls_verify,
        }
    }

    pub fn into_core(self) -> Result<Collection, CoreError> {
        let items = self.items.into_iter().map(ItemIpc::into_core).collect::<Result<Vec<_>, _>>()?;
        Ok(Collection {
            id: parse_collection_id(&self.id)?,
            name: self.name,
            items,
            variables: self.variables,
            auth_by_env: self.auth_by_env.into_core(),
            default_tls: self.default_tls,
            skip_tls_verify: self.skip_tls_verify,
        })
    }
}

/// Lightweight list entry (id + name only) for `collection_list`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionMetaIpc {
    pub id: String,
    pub name: String,
}

/// Undo payload returned by `collection_delete_item`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ItemSnapshotIpc {
    pub item: ItemIpc,
    pub parent_id: Option<String>,
    pub position: u32,
}

impl ItemSnapshotIpc {
    pub fn from_core(s: ItemSnapshot) -> Self {
        Self {
            item: ItemIpc::from_core(s.item),
            parent_id: s.parent.map(|p| p.0.to_string()),
            position: s.position as u32,
        }
    }
}

// `AuthCredentials` is resolve-time only (never crosses collection IPC in #1).
// Re-exported here so #2 can build an `EffectiveRequest` DTO without re-importing.
pub type AuthCredentialsCore = AuthCredentials;

#[cfg(test)]
mod tests {
    use super::*;
    use handshaker_core::auth::AuthByEnv as CoreAuthByEnv;

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
                    metadata: HashMap::new(),
                    auth_by_env: CoreAuthByEnv::default(),
                    tls_override: Some(true),
                })],
                auth_by_env: CoreAuthByEnv::default(),
            })],
            variables: HashMap::new(),
            auth_by_env: CoreAuthByEnv::default(),
            default_tls: false,
            skip_tls_verify: false,
        }
    }

    #[test]
    fn collection_round_trips_through_ipc() {
        let original = sample_collection();
        let ipc = CollectionIpc::from_core(original.clone());
        let back = ipc.into_core().unwrap();
        assert_eq!(original, back);
    }

    #[test]
    fn bad_uuid_is_invalid_target() {
        let ipc = CollectionIpc {
            id: "not-a-uuid".into(),
            name: "c".into(),
            items: vec![],
            variables: HashMap::new(),
            auth_by_env: AuthByEnvIpc::default(),
            default_tls: false,
            skip_tls_verify: false,
        };
        assert!(matches!(ipc.into_core().unwrap_err(), CoreError::InvalidTarget(_)));
    }
}
```

> If specta rejects the `#[serde(tag = "type")]` newtype-variant union for `ItemIpc` at compile time (R4), fall back to struct variants inlining `FolderIpc`/`SavedRequestIpc` fields. Confirm the emitted TS shape during Task 11's `pnpm lint`.

- [ ] **Step 3: Run the IPC conversion tests**

Run: `cargo test -p handshaker ipc::collection`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ipc/collection.rs src-tauri/src/ipc/mod.rs
git commit -m "feat(tauri): collection IPC DTOs + fallible conversions"
```

---

## Task 10: `commands/collection.rs` + registration + grpc.rs threading

**Files:**
- Create: `src-tauri/src/commands/collection.rs`
- Modify: `src-tauri/src/commands/mod.rs:1-5`
- Modify: `src-tauri/src/commands/grpc.rs` (thread `contract_cache` into `activate`)
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Declare the module**

In `src-tauri/src/commands/mod.rs`, add `pub mod collection;`:

```rust
pub mod collection;
pub mod env;
pub mod events;
pub mod grpc;
pub mod meta;
pub mod vars;
```

- [ ] **Step 2: Write `commands/collection.rs` (impl methods + command wrappers + tests)**

Create `src-tauri/src/commands/collection.rs`:

```rust
//! Collection IPC commands (master spec §6.2). Each `#[tauri::command]` is a thin
//! wrapper over an `impl AppState` method (Plan #4b convention) so the logic is
//! unit-testable without Tauri's `State<'_, T>` plumbing — see the `#[cfg(test)]`
//! block at the bottom.

use std::collections::HashMap;

use handshaker_core::collections::ids::{CollectionId, ItemId};
use handshaker_core::collections::{tree, Item};
use handshaker_core::error::CoreError;
use tauri::State;
use uuid::Uuid;

use crate::ipc::collection::{
    CollectionIpc, CollectionMetaIpc, ItemIpc, ItemSnapshotIpc, SavedAuthConfigIpc,
};
use crate::ipc::error::IpcError;
use crate::state::AppState;

fn parse_collection_id(s: &str) -> Result<CollectionId, CoreError> {
    Uuid::parse_str(s)
        .map(CollectionId)
        .map_err(|e| CoreError::InvalidTarget(format!("bad collection id `{s}`: {e}")))
}

fn parse_item_id(s: &str) -> Result<ItemId, CoreError> {
    Uuid::parse_str(s)
        .map(ItemId)
        .map_err(|e| CoreError::InvalidTarget(format!("bad item id `{s}`: {e}")))
}

fn parse_opt_item_id(s: Option<String>) -> Result<Option<ItemId>, CoreError> {
    s.map(|v| parse_item_id(&v)).transpose()
}

impl AppState {
    fn require_collection(&self, id: CollectionId) -> Result<handshaker_core::collections::Collection, CoreError> {
        self.collection_store
            .get(id)
            .ok_or_else(|| CoreError::InvalidTarget(format!("no collection {id:?}")))
    }

    pub fn collection_list_impl(&self) -> Vec<CollectionMetaIpc> {
        self.collection_store
            .list()
            .into_iter()
            .map(|c| CollectionMetaIpc { id: c.id.0.to_string(), name: c.name })
            .collect()
    }

    pub fn collection_get_impl(&self, id: &str) -> Result<CollectionIpc, CoreError> {
        let cid = parse_collection_id(id)?;
        Ok(CollectionIpc::from_core(self.require_collection(cid)?))
    }

    pub fn collection_upsert_impl(&self, collection: CollectionIpc) -> Result<(), CoreError> {
        let core = collection.into_core()?;
        self.collection_store.upsert(core)
    }

    pub fn collection_delete_impl(&self, id: &str) -> Result<(), CoreError> {
        let cid = parse_collection_id(id)?;
        self.collection_store.delete(cid)
    }

    pub fn collection_set_variables_impl(&self, id: &str, vars: HashMap<String, String>) -> Result<(), CoreError> {
        let cid = parse_collection_id(id)?;
        let mut c = self.require_collection(cid)?;
        c.variables = vars;
        self.collection_store.upsert(c)
    }

    pub fn collection_add_item_impl(&self, collection_id: &str, parent_id: Option<String>, item: ItemIpc) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let parent = parse_opt_item_id(parent_id)?;
        let core_item = item.into_core()?;
        let mut c = self.require_collection(cid)?;
        tree::add_item(&mut c.items, parent, core_item)?;
        self.collection_store.upsert(c)
    }

    pub fn collection_rename_item_impl(&self, collection_id: &str, item_id: &str, name: String) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let mut c = self.require_collection(cid)?;
        tree::rename_item(&mut c.items, iid, name)?;
        self.collection_store.upsert(c)
    }

    pub fn collection_move_item_impl(&self, collection_id: &str, item_id: &str, new_parent_id: Option<String>, position: u32) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let new_parent = parse_opt_item_id(new_parent_id)?;
        let mut c = self.require_collection(cid)?;
        tree::move_item(&mut c.items, iid, new_parent, position as usize)?;
        self.collection_store.upsert(c)
    }

    pub fn collection_duplicate_item_impl(&self, collection_id: &str, item_id: &str) -> Result<String, CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let mut c = self.require_collection(cid)?;
        let new_id = tree::duplicate_item(&mut c.items, iid)?;
        self.collection_store.upsert(c)?;
        Ok(new_id.0.to_string())
    }

    pub fn collection_delete_item_impl(&self, collection_id: &str, item_id: &str) -> Result<Option<ItemSnapshotIpc>, CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let iid = parse_item_id(item_id)?;
        let mut c = self.require_collection(cid)?;
        match tree::delete_item(&mut c.items, iid) {
            Some(snap) => {
                self.collection_store.upsert(c)?;
                Ok(Some(ItemSnapshotIpc::from_core(snap)))
            }
            None => Ok(None), // idempotent: nothing to delete
        }
    }

    pub fn collection_restore_item_impl(&self, collection_id: &str, snapshot: ItemSnapshotIpc, parent_id: Option<String>, position: u32) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let parent = parse_opt_item_id(parent_id)?;
        let item = snapshot.item.into_core()?;
        let mut c = self.require_collection(cid)?;
        tree::restore_item(&mut c.items, item, parent, position as usize)?;
        self.collection_store.upsert(c)
    }

    pub fn auth_set_for_env_impl(&self, collection_id: &str, item_id: Option<String>, env_name: String, config: Option<SavedAuthConfigIpc>) -> Result<(), CoreError> {
        let cid = parse_collection_id(collection_id)?;
        let mut c = self.require_collection(cid)?;
        let abe = match item_id {
            None => &mut c.auth_by_env,
            Some(s) => {
                let iid = parse_item_id(&s)?;
                match tree::find_item_mut(&mut c.items, iid) {
                    Some(Item::Folder(f)) => &mut f.auth_by_env,
                    Some(Item::Request(r)) => &mut r.auth_by_env,
                    None => return Err(CoreError::InvalidTarget(format!("item {iid:?} not found"))),
                }
            }
        };
        match config {
            Some(cfg) => {
                abe.configs.insert(env_name, cfg.into_core());
            }
            None => {
                abe.configs.remove(&env_name); // reset to inherited
            }
        }
        self.collection_store.upsert(c)
    }
}

// --- command wrappers -------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn collection_list(state: State<'_, AppState>) -> Result<Vec<CollectionMetaIpc>, IpcError> {
    Ok(state.collection_list_impl())
}

#[tauri::command]
#[specta::specta]
pub async fn collection_get(state: State<'_, AppState>, id: String) -> Result<CollectionIpc, IpcError> {
    state.collection_get_impl(&id).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_upsert(state: State<'_, AppState>, collection: CollectionIpc) -> Result<(), IpcError> {
    state.collection_upsert_impl(collection).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_delete(state: State<'_, AppState>, id: String) -> Result<(), IpcError> {
    state.collection_delete_impl(&id).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_set_variables(state: State<'_, AppState>, id: String, vars: HashMap<String, String>) -> Result<(), IpcError> {
    state.collection_set_variables_impl(&id, vars).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_add_item(state: State<'_, AppState>, collection_id: String, parent_id: Option<String>, item: ItemIpc) -> Result<(), IpcError> {
    state.collection_add_item_impl(&collection_id, parent_id, item).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_rename_item(state: State<'_, AppState>, collection_id: String, item_id: String, name: String) -> Result<(), IpcError> {
    state.collection_rename_item_impl(&collection_id, &item_id, name).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_move_item(state: State<'_, AppState>, collection_id: String, item_id: String, new_parent_id: Option<String>, position: u32) -> Result<(), IpcError> {
    state.collection_move_item_impl(&collection_id, &item_id, new_parent_id, position).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_duplicate_item(state: State<'_, AppState>, collection_id: String, item_id: String) -> Result<String, IpcError> {
    state.collection_duplicate_item_impl(&collection_id, &item_id).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_delete_item(state: State<'_, AppState>, collection_id: String, item_id: String) -> Result<Option<ItemSnapshotIpc>, IpcError> {
    state.collection_delete_item_impl(&collection_id, &item_id).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_restore_item(state: State<'_, AppState>, collection_id: String, snapshot: ItemSnapshotIpc, parent_id: Option<String>, position: u32) -> Result<(), IpcError> {
    state.collection_restore_item_impl(&collection_id, snapshot, parent_id, position).map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn auth_set_for_env(state: State<'_, AppState>, collection_id: String, item_id: Option<String>, env_name: String, config: Option<SavedAuthConfigIpc>) -> Result<(), IpcError> {
    state.auth_set_for_env_impl(&collection_id, item_id, env_name, config).map_err(IpcError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::collection::{AuthByEnvIpc, FolderIpc, SavedRequestIpc};

    fn empty_collection_ipc(id: u128, name: &str) -> CollectionIpc {
        CollectionIpc {
            id: Uuid::from_u128(id).to_string(),
            name: name.into(),
            items: vec![],
            variables: HashMap::new(),
            auth_by_env: AuthByEnvIpc::default(),
            default_tls: false,
            skip_tls_verify: false,
        }
    }

    fn request_ipc(id: u128, name: &str) -> ItemIpc {
        ItemIpc::Request(SavedRequestIpc {
            id: Uuid::from_u128(id).to_string(),
            name: name.into(),
            address_template: "{{host}}".into(),
            service: "svc".into(),
            method: "M".into(),
            body_template: "{}".into(),
            metadata: HashMap::new(),
            auth_by_env: AuthByEnvIpc::default(),
            tls_override: None,
        })
    }

    fn folder_ipc(id: u128, name: &str) -> ItemIpc {
        ItemIpc::Folder(FolderIpc {
            id: Uuid::from_u128(id).to_string(),
            name: name.into(),
            items: vec![],
            auth_by_env: AuthByEnvIpc::default(),
        })
    }

    fn cid(id: u128) -> String {
        Uuid::from_u128(id).to_string()
    }

    #[test]
    fn upsert_then_get_round_trips_tree() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, folder_ipc(10, "f")).unwrap();
        state.collection_add_item_impl(&cid(1), Some(cid(10)), request_ipc(20, "r")).unwrap();
        let got = state.collection_get_impl(&cid(1)).unwrap();
        assert_eq!(got.items.len(), 1); // the folder
    }

    #[test]
    fn add_item_idempotent_on_dup_id_and_bad_parent_errors() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        // dup id → Ok, no growth
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r2")).unwrap();
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 1);
        // bad parent → InvalidTarget
        let err = state.collection_add_item_impl(&cid(1), Some(cid(999)), request_ipc(21, "x")).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn delete_collection_is_idempotent() {
        let state = AppState::default();
        state.collection_delete_impl(&cid(404)).unwrap(); // missing → Ok
    }

    #[test]
    fn move_item_rejects_cyclic_move() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, folder_ipc(10, "outer")).unwrap();
        state.collection_add_item_impl(&cid(1), Some(cid(10)), folder_ipc(11, "inner")).unwrap();
        let err = state.collection_move_item_impl(&cid(1), &cid(10), Some(cid(11)), 0).unwrap_err();
        assert!(matches!(err, CoreError::InvalidTarget(_)));
    }

    #[test]
    fn duplicate_grows_tree_and_returns_new_id() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        let new_id = state.collection_duplicate_item_impl(&cid(1), &cid(20)).unwrap();
        assert_ne!(new_id, cid(20));
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 2);
    }

    #[test]
    fn delete_item_returns_snapshot_then_restore() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        state.collection_add_item_impl(&cid(1), None, request_ipc(20, "r")).unwrap();
        let snap = state.collection_delete_item_impl(&cid(1), &cid(20)).unwrap().unwrap();
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 0);
        state.collection_restore_item_impl(&cid(1), snap, None, 0).unwrap();
        assert_eq!(state.collection_get_impl(&cid(1)).unwrap().items.len(), 1);
        // deleting a missing item → Ok(None)
        assert!(state.collection_delete_item_impl(&cid(1), &cid(999)).unwrap().is_none());
    }

    #[test]
    fn auth_set_for_env_root_node_and_clear() {
        let state = AppState::default();
        state.collection_upsert_impl(empty_collection_ipc(1, "c")).unwrap();
        let cfg = SavedAuthConfigIpc::EnvVar {
            env_var: "TOK".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
        };
        // set collection-root auth (item_id = None)
        state.auth_set_for_env_impl(&cid(1), None, "prod".into(), Some(cfg)).unwrap();
        let got = state.collection_get_impl(&cid(1)).unwrap();
        assert!(got.auth_by_env.configs.contains_key("prod"));
        // clear it (config = None)
        state.auth_set_for_env_impl(&cid(1), None, "prod".into(), None).unwrap();
        let got = state.collection_get_impl(&cid(1)).unwrap();
        assert!(!got.auth_by_env.configs.contains_key("prod"));
    }
}
```

- [ ] **Step 3: Run the command tests**

Run: `cargo test -p handshaker commands::collection`
Expected: PASS (7 tests).

- [ ] **Step 4: Thread `contract_cache` into `commands/grpc.rs`**

In `src-tauri/src/commands/grpc.rs`, add the import for `ContractKey` to the existing `use handshaker_core::grpc::{...}` line:

```rust
use handshaker_core::grpc::{activate, ContractKey, GrpcTarget, TonicTransport};
```

In `grpc_connect`, change:

```rust
    let conn = activate(target, transport).await?;
```

to:

```rust
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
```

In `grpc_refresh_contract`, invalidate the cache before re-activating so refresh always re-reflects. Change:

```rust
    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport).await?;
```

to:

```rust
    let transport = Arc::new(TonicTransport::new());
    state.contract_cache.invalidate(&ContractKey::from_target(&target));
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
```

- [ ] **Step 5: Register the commands in `lib.rs`**

In `src-tauri/src/lib.rs`, add the import block (after the `use commands::env::{...};` line):

```rust
use commands::collection::{
    auth_set_for_env, collection_add_item, collection_delete, collection_delete_item,
    collection_duplicate_item, collection_get, collection_list, collection_move_item,
    collection_rename_item, collection_restore_item, collection_set_variables, collection_upsert,
};
```

Add them to the `collect_commands![...]` macro (after `vars_resolve,`):

```rust
            vars_resolve,
            collection_list,
            collection_get,
            collection_upsert,
            collection_delete,
            collection_set_variables,
            collection_add_item,
            collection_rename_item,
            collection_move_item,
            collection_duplicate_item,
            collection_delete_item,
            collection_restore_item,
            auth_set_for_env,
```

- [ ] **Step 6: Build the shell**

Run: `cargo test -p handshaker`
Expected: PASS (all command tests, grpc.rs threads the cache, registration compiles).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/collection.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/grpc.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): collection commands + register + thread contract cache"
```

---

## Task 11: Regenerate bindings + `client.ts` wrappers

**Files:**
- Regenerate: `src/ipc/bindings.ts`
- Modify: `src/ipc/client.ts`

- [ ] **Step 1: Regenerate the TypeScript bindings**

Run: `cargo run -p handshaker --bin export-bindings`
Expected: prints `wrote .../src/ipc/bindings.ts`. The new `Collection*`/`Item*`/`AuthByEnvIpc`/`SavedAuthConfigIpc`/`ItemSnapshotIpc`/`CollectionMetaIpc` types and the new commands appear in the file.

- [ ] **Step 2: Inspect the generated `ItemIpc` union shape (R4)**

Open `src/ipc/bindings.ts` and find the generated `ItemIpc` type. Confirm it is a discriminated union on `type` (e.g. `({ type: "folder" } & FolderIpc) | ({ type: "request" } & SavedRequestIpc)` or an inlined equivalent). If specta emitted something `tsc` rejects, switch `ItemIpc` to struct variants in `ipc/collection.rs` (note in Task 9 Step 2) and re-run Step 1.

- [ ] **Step 3: Add typed wrappers to `client.ts`**

In `src/ipc/client.ts`, extend the type import (add to the existing `import type {...}` block):

```ts
  CollectionIpc,
  CollectionMetaIpc,
  ItemIpc,
  ItemSnapshotIpc,
  SavedAuthConfigIpc,
```

Add these wrapper functions before the `export const ipc = {` block:

```ts
export async function collectionList(): Promise<CollectionMetaIpc[]> {
  const r = await commands.collectionList();
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionGet(id: string): Promise<CollectionIpc> {
  const r = await commands.collectionGet(id);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionUpsert(collection: CollectionIpc): Promise<void> {
  const r = await commands.collectionUpsert(collection);
  if (r.status === "error") throw r.error;
}

export async function collectionDelete(id: string): Promise<void> {
  const r = await commands.collectionDelete(id);
  if (r.status === "error") throw r.error;
}

export async function collectionSetVariables(id: string, vars: Record<string, string>): Promise<void> {
  const r = await commands.collectionSetVariables(id, vars);
  if (r.status === "error") throw r.error;
}

export async function collectionAddItem(collectionId: string, parentId: string | null, item: ItemIpc): Promise<void> {
  const r = await commands.collectionAddItem(collectionId, parentId, item);
  if (r.status === "error") throw r.error;
}

export async function collectionRenameItem(collectionId: string, itemId: string, name: string): Promise<void> {
  const r = await commands.collectionRenameItem(collectionId, itemId, name);
  if (r.status === "error") throw r.error;
}

export async function collectionMoveItem(collectionId: string, itemId: string, newParentId: string | null, position: number): Promise<void> {
  const r = await commands.collectionMoveItem(collectionId, itemId, newParentId, position);
  if (r.status === "error") throw r.error;
}

export async function collectionDuplicateItem(collectionId: string, itemId: string): Promise<string> {
  const r = await commands.collectionDuplicateItem(collectionId, itemId);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionDeleteItem(collectionId: string, itemId: string): Promise<ItemSnapshotIpc | null> {
  const r = await commands.collectionDeleteItem(collectionId, itemId);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionRestoreItem(collectionId: string, snapshot: ItemSnapshotIpc, parentId: string | null, position: number): Promise<void> {
  const r = await commands.collectionRestoreItem(collectionId, snapshot, parentId, position);
  if (r.status === "error") throw r.error;
}

export async function authSetForEnv(collectionId: string, itemId: string | null, envName: string, config: SavedAuthConfigIpc | null): Promise<void> {
  const r = await commands.authSetForEnv(collectionId, itemId, envName, config);
  if (r.status === "error") throw r.error;
}
```

Add each new function to the `ipc` object literal (after `varsResolve,`):

```ts
  collectionList,
  collectionGet,
  collectionUpsert,
  collectionDelete,
  collectionSetVariables,
  collectionAddItem,
  collectionRenameItem,
  collectionMoveItem,
  collectionDuplicateItem,
  collectionDeleteItem,
  collectionRestoreItem,
  authSetForEnv,
```

> The generated command function names are tauri-specta's camelCase of the Rust command (`collection_list` → `commands.collectionList`). If a generated name differs, match it. Args are positional in the generated bindings (see existing `grpcBuildRequestSkeleton(service, method)`).

- [ ] **Step 4: Lint the frontend**

Run: `pnpm lint`
Expected: PASS (tsc clean). If the `ItemIpc`/`HashMap` (`Partial<{...}>`) shapes cause type errors in the wrappers, adjust the wrapper parameter types to match the generated shape (these wrappers are exercised for real in sub-project #2).

- [ ] **Step 5: Commit**

```bash
git add src/ipc/bindings.ts src/ipc/client.ts
git commit -m "feat(ipc): regenerate bindings + collection client wrappers"
```

---

## Task 12: Full workspace test + manual persistence smoke

**Files:** none (verification only)

- [ ] **Step 1: Full workspace test**

Run: `cargo test --workspace`
Expected: PASS — the prior ~83 tests plus all new core + shell tests (persist 5, env::file_store 4, auth 5, collections ids 2 / tree 10 / resolve 8 / in_memory 2 / file_store 3, integration 1, contract_cache unit 2 + integration 2, ipc::collection 2, commands::collection 7, ipc::error exhaustive bumped).

- [ ] **Step 2: Frontend lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Manual persistence smoke (acceptance #1)**

Run: `pnpm tauri dev`. In the devtools console:

```js
await window.__TAURI__.core.invoke("collection_upsert", { collection: { id: "00000000-0000-7000-8000-000000000001", name: "Smoke", items: [], variables: {}, authByEnv: { configs: {} }, defaultTls: false, skipTlsVerify: false } })
await window.__TAURI__.core.invoke("collection_list")  // → [{ id: "...0001", name: "Smoke" }]
```

Close the app, relaunch `pnpm tauri dev`, and call `collection_list` again — the "Smoke" collection must still be there (disk-backed). Then confirm `environments.json` and `collections/` exist under the app data dir (Windows: `%APPDATA%/<bundle-id>` or the path printed by adding a temporary `console.log(await window.__TAURI__.path.appDataDir())`).

> The exact invoke arg casing (`authByEnv` vs `auth_by_env`) follows tauri-specta's serde rename — check the generated `bindings.ts` `commands.collectionUpsert` signature if the manual call rejects an argument. This smoke is throwaway; do not commit any temporary dev button.

- [ ] **Step 4: Final commit (if any smoke-driven tweaks were needed)**

```bash
git add -A
git commit -m "chore: plan #6 backend foundation — verified persistence smoke"
```

(Skip if Step 3 required no code changes.)

---

## Spec Coverage

| Spec section | Task(s) |
|---|---|
| §1.1 `persist/` primitive | Task 1 |
| §1.1 `FileEnvironmentStore` | Task 2 |
| §3.1 auth types (master §5.3) | Task 3 |
| §3.1 collection model + ids; §5 tree ops | Task 4 |
| §4 resolution engine | Task 5 |
| §1.1 `CollectionStore`/in-memory/file + §8.3 integration | Task 6 |
| §1.1/§7.3 `ContractCache` + `activate()` rewire | Task 7 |
| §2.2 `AppState` fields + `with_data_dir` + run() wiring | Task 8 |
| §3.3 IPC DTOs | Task 9 |
| §7.1 IPC commands + §7.3 grpc.rs threading | Task 10 |
| §2.3 bindings regen + client wrappers | Task 11 |
| §1 acceptance #1 cold-boot persistence; §8 full suite | Task 12 |
| §3.4 `CoreError::Persistence` + `IpcError` | Task 0 |
| §1.2 out-of-scope (UI, lazy-connect, OAuth2 fetch, streaming, keyring) | Not implemented — deferred to #2/#3 by design |

**Notes on deferrals honored:** OAuth2 resolution stays `NotImplemented` (Task 3); no `grpc_invoke_oneshot`; no events added (Task 10 registers commands only); no React component changes (Task 11 touches only `client.ts` + regenerated `bindings.ts`).
