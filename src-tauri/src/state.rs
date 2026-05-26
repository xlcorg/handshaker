//! Tauri-side app state. Fields land per plans #2-#6.

#[derive(Default)]
pub struct AppState {
    // plan #2: pub connection: Mutex<Option<GrpcConnection>>,
    // plan #5: pub env_store: Arc<dyn EnvironmentStore>,
    // plan #6: pub collection_store: Arc<dyn CollectionStore>,
}
