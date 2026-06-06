//! Tauri-side app state. Fields land per plans #2-#6.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use handshaker_core::collections::{CollectionStore, FileCollectionStore, InMemoryCollectionStore};
use handshaker_core::env::file_store::FileEnvironmentStore;
use handshaker_core::env::in_memory::InMemoryEnvironmentStore;
use handshaker_core::env::EnvironmentStore;
use handshaker_core::error::CoreError;
use handshaker_core::grpc::{ContractCache, FileContractCache, InMemoryContractCache};
use tokio::sync::{Notify, RwLock};

/// Per-request cancel registry: `request_id` → `Notify` fired by `grpc_cancel`.
/// std `Mutex` — locked only for insert/remove/lookup, never across `.await`.
pub type InFlight = Mutex<HashMap<String, Arc<Notify>>>;

pub struct AppState {
    /// Environment store. Cold boot: empty.
    pub env_store: Arc<dyn EnvironmentStore>,
    /// Active environment name; `None` ≡ "No environment" (Postman-style).
    pub active_env: RwLock<Option<String>>,
    /// Where the active-env selection is persisted. `None` ≡ in-memory only
    /// (`default()` / unit tests); `Some(path)` ≡ write-through to that file.
    pub active_env_path: Option<std::path::PathBuf>,
    /// Collection store (plan #6). Cold boot: empty.
    pub collection_store: Arc<dyn CollectionStore>,
    /// Descriptor/contract cache. File-backed in `load` (persists across restarts, B7);
    /// in-memory under `default()`.
    pub contract_cache: Arc<dyn ContractCache>,
    /// In-flight gRPC requests: `request_id` → cancellation `Notify`.
    pub in_flight: InFlight,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            env_store: Arc::new(InMemoryEnvironmentStore::new()),
            active_env: RwLock::new(None),
            active_env_path: None,
            collection_store: Arc::new(InMemoryCollectionStore::new()),
            contract_cache: Arc::new(InMemoryContractCache::new()),
            in_flight: Mutex::new(HashMap::new()),
        }
    }
}

impl AppState {
    pub fn load(data_dir: &Path) -> Result<Self, CoreError> {
        let environment_file = data_dir.join("environments.json");
        let env_store = FileEnvironmentStore::load(environment_file)?;
        let collection_store = FileCollectionStore::load(data_dir.join("collections"))?;

        // Restore the persisted active-env selection, validating it against the
        // store: a dangling pointer (env deleted out-of-band) collapses to None.
        let active_env_path = data_dir.join("active_env.json");
        let persisted: Option<String> =
            handshaker_core::persist::read_json_or_default(&active_env_path)?;
        let validated = match persisted {
            Some(name) if env_store.get(&name).is_some() => Some(name),
            _ => None,
        };

        Ok(Self {
            env_store: Arc::new(env_store),
            active_env: RwLock::new(validated),
            active_env_path: Some(active_env_path),
            collection_store: Arc::new(collection_store),
            contract_cache: Arc::new(FileContractCache::load(data_dir.join("contracts"))?),
            in_flight: Mutex::new(HashMap::new()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use handshaker_core::env::Environment;

    #[tokio::test]
    async fn active_env_persists_across_reload() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path()).unwrap();
        state
            .env_store
            .upsert(Environment { name: "prod".into(), variables: Default::default(), color: None })
            .unwrap();
        state.env_active_set_impl(Some("prod".into())).await.unwrap();

        // Simulate a restart.
        drop(state);
        let state2 = AppState::load(dir.path()).unwrap();
        assert_eq!(state2.env_active_get_impl().await, Some("prod".to_string()));
    }

    #[tokio::test]
    async fn stale_active_env_is_dropped_on_reload() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path()).unwrap();
        state
            .env_store
            .upsert(Environment { name: "prod".into(), variables: Default::default(), color: None })
            .unwrap();
        state.env_active_set_impl(Some("prod".into())).await.unwrap();
        // Env vanishes out-of-band (bypassing the active-delete guard).
        state.env_store.delete("prod").unwrap();

        drop(state);
        let state2 = AppState::load(dir.path()).unwrap();
        assert_eq!(state2.env_active_get_impl().await, None);
    }

    #[test]
    fn default_has_empty_in_flight_registry() {
        let s = AppState::default();
        assert!(s.in_flight.lock().unwrap().is_empty());
    }

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
    }
}
