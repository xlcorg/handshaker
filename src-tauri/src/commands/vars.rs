//! Variable substitution IPC command. See spec §5.1.

use std::collections::HashMap;

use handshaker_core::vars::{resolve_template_with_diagnostics, VariableSet};
use tauri::State;

use crate::ipc::error::IpcError;
use crate::ipc::vars::ResolutionReportIpc;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn vars_resolve(
    state: State<'_, AppState>,
    template: String,
) -> Result<ResolutionReportIpc, IpcError> {
    let active = state.active_env.read().await.clone();
    let env_owned = state
        .env_store
        .get(&active)
        .map(|e| e.variables)
        .unwrap_or_default();
    let collection_owned: HashMap<String, String> = HashMap::new(); // populated in Plan #6
    let vars = VariableSet {
        env: &env_owned,
        collection: &collection_owned,
    };
    Ok(resolve_template_with_diagnostics(&template, &vars).into())
}
