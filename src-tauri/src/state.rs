//! Tauri-side app state. Fields land per plans #2-#6.

use std::sync::Arc;

use handshaker_core::env::in_memory::InMemoryEnvironmentStore;
use handshaker_core::env::EnvironmentStore;
use handshaker_core::grpc::GrpcConnection;
use tokio::sync::{Mutex, RwLock};

pub struct AppState {
    /// At most one active gRPC connection per spec §4.
    pub connection: Mutex<Option<Arc<GrpcConnection>>>,
    /// Environment store, bootstrapped with a single "Default" env at startup.
    pub env_store: Arc<dyn EnvironmentStore>,
    /// Active environment name; updated by `env_active_set`. UI loads via `env_active_get`.
    pub active_env: RwLock<String>,
    // plan #6: pub collection_store: Arc<dyn CollectionStore>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            connection: Mutex::new(None),
            env_store: Arc::new(InMemoryEnvironmentStore::with_default()),
            active_env: RwLock::new("Default".to_string()),
        }
    }
}
