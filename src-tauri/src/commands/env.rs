//! Environment IPC commands. See spec §5.1.

use handshaker_core::env::Environment;
use tauri::State;

use crate::ipc::env::EnvironmentIpc;
use crate::ipc::error::IpcError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn env_list(state: State<'_, AppState>) -> Result<Vec<EnvironmentIpc>, IpcError> {
    Ok(state.env_store.list().into_iter().map(EnvironmentIpc::from).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn env_active_get(state: State<'_, AppState>) -> Result<String, IpcError> {
    Ok(state.active_env.read().await.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn env_active_set(state: State<'_, AppState>, name: String) -> Result<(), IpcError> {
    // Validate that the named env exists. Missing → InvalidTarget.
    if state.env_store.get(&name).is_none() {
        return Err(handshaker_core::error::CoreError::InvalidTarget(format!(
            "no such env: `{name}`"
        ))
        .into());
    }
    *state.active_env.write().await = name;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn env_upsert(state: State<'_, AppState>, env: EnvironmentIpc) -> Result<(), IpcError> {
    state.env_store.upsert(Environment::from(env)).map_err(IpcError::from)
}
