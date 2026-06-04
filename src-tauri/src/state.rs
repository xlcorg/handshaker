//! Tauri-side app state. Fields land per plans #2-#6.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use handshaker_core::collections::{CollectionStore, FileCollectionStore, InMemoryCollectionStore};
use handshaker_core::env::file_store::FileEnvironmentStore;
use handshaker_core::env::in_memory::InMemoryEnvironmentStore;
use handshaker_core::env::EnvironmentStore;
use handshaker_core::error::CoreError;
use handshaker_core::grpc::{ContractCache, InMemoryContractCache};
use tokio::sync::{Notify, RwLock};

/// Per-request cancel registry: `request_id` → `Notify` fired by `grpc_cancel`.
/// std `Mutex` — locked only for insert/remove/lookup, never across `.await`.
pub type InFlight = Mutex<HashMap<String, Arc<Notify>>>;

pub struct AppState {
    /// Environment store. Cold boot: empty.
    pub env_store: Arc<dyn EnvironmentStore>,
    /// Active environment name; `None` ≡ "No environment" (Postman-style).
    pub active_env: RwLock<Option<String>>,
    /// Collection store (plan #6). Cold boot: empty.
    pub collection_store: Arc<dyn CollectionStore>,
    /// Descriptor cache (plan #6). Session-only, not persisted.
    pub contract_cache: Arc<dyn ContractCache>,
    /// In-flight gRPC requests: `request_id` → cancellation `Notify`.
    pub in_flight: InFlight,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            env_store: Arc::new(InMemoryEnvironmentStore::new()),
            active_env: RwLock::new(None),
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
        Ok(Self {
            env_store: Arc::new(env_store),
            active_env: RwLock::new(None),
            collection_store: Arc::new(collection_store),
            contract_cache: Arc::new(InMemoryContractCache::new()),
            in_flight: Mutex::new(HashMap::new()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_has_empty_in_flight_registry() {
        let s = AppState::default();
        assert!(s.in_flight.lock().unwrap().is_empty());
    }
}
