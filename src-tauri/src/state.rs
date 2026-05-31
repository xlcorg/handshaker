//! Tauri-side app state. Fields land per plans #2-#6.

use std::path::Path;
use std::sync::Arc;

use handshaker_core::collections::{CollectionStore, FileCollectionStore, InMemoryCollectionStore};
use handshaker_core::env::file_store::FileEnvironmentStore;
use handshaker_core::env::in_memory::InMemoryEnvironmentStore;
use handshaker_core::env::EnvironmentStore;
use handshaker_core::error::CoreError;
use handshaker_core::grpc::{ContractCache, InMemoryContractCache};
use tokio::sync::RwLock;

pub struct AppState {
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
            env_store: Arc::new(env_store),
            active_env: RwLock::new(None),
            collection_store: Arc::new(collection_store),
            contract_cache: Arc::new(InMemoryContractCache::new()),
        })
    }
}
