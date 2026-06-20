use specta::Type;
use tauri::State;

use crate::ipc::error::IpcError;
use crate::state::AppState;

/// Smoke-command: returns version from Cargo.toml. Proves tauri-specta wiring works.
#[tauri::command]
#[specta::specta]
pub fn app_version() -> AppVersion {
    AppVersion {
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[derive(serde::Serialize, Type)]
pub struct AppVersion {
    pub version: String,
}

/// Drain the files quarantined as corrupt during startup load. The frontend calls this
/// once on mount to show a "recovered from a corrupt file" notice; it returns each path
/// only once (subsequent calls are empty), so the notice shows a single time per launch.
#[tauri::command]
#[specta::specta]
pub async fn startup_recovery_take(state: State<'_, AppState>) -> Result<Vec<String>, IpcError> {
    Ok(state.take_recovered())
}
