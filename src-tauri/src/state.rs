//! Tauri-side app state. Fields land per plans #2-#6.

use std::sync::Arc;

use handshaker_core::grpc::GrpcConnection;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    /// At most one active gRPC connection per spec §4.
    pub connection: Mutex<Option<Arc<GrpcConnection>>>,
    // plan #5: pub env_store: Arc<dyn EnvironmentStore>,
    // plan #6: pub collection_store: Arc<dyn CollectionStore>,
}
