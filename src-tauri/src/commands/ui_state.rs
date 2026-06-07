//! App-settings IPC commands: read/write the persisted [`UiStateIpc`] envelope
//! (sort key + active request). Thin wrappers over
//! [`AppState::ui_state_store`] — see [`crate::commands::collection`] for the
//! `#[tauri::command]` convention.

use tauri::State;

use crate::ipc::error::IpcError;
use crate::ipc::ui_state::UiStateIpc;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app_settings_get(state: State<'_, AppState>) -> Result<UiStateIpc, IpcError> {
    Ok(UiStateIpc::from_core(state.ui_state_store.get()))
}

/// Replaces the entire persisted UI state — callers send the complete object, not a partial patch.
#[tauri::command]
#[specta::specta]
pub async fn app_settings_set(state: State<'_, AppState>, patch: UiStateIpc) -> Result<(), IpcError> {
    state.ui_state_store.set(patch.into_core()).map_err(IpcError::from)
}
