//! Variable substitution IPC command. See spec §5.1.

use std::collections::HashMap;

use handshaker_core::vars::{resolve_template_with_diagnostics, ResolutionReport, VariableSet};
use tauri::State;

use crate::ipc::error::IpcError;
use crate::ipc::vars::ResolutionReportIpc;
use crate::state::AppState;

impl AppState {
    /// Inner logic for `vars_resolve`. When `active_env` is `None`, resolves
    /// against an empty env var map (so every `{{var}}` in the template ends
    /// up in `unresolved_vars`).
    pub async fn vars_resolve_impl(&self, template: &str) -> ResolutionReport {
        let active = self.active_env.read().await.clone();
        let env_owned = active
            .as_deref()
            .and_then(|n| self.env_store.get(n))
            .map(|e| e.variables)
            .unwrap_or_default();
        let collection_owned: HashMap<String, String> = HashMap::new(); // populated in Plan #6
        let vars = VariableSet {
            env: &env_owned,
            collection: &collection_owned,
        };
        resolve_template_with_diagnostics(template, &vars)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn vars_resolve(
    state: State<'_, AppState>,
    template: String,
) -> Result<ResolutionReportIpc, IpcError> {
    Ok(state.vars_resolve_impl(&template).await.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn vars_resolve_treats_active_none_as_empty_var_set() {
        let state = AppState::default(); // active = None, store empty
        let report = state.vars_resolve_impl(r#"{"k":"{{x}}"}"#).await;
        // The template has one var; with no active env, it lands in unresolved.
        assert_eq!(report.unresolved_vars, vec!["x".to_string()]);
        assert!(report.cycle_chain.is_none());
        // resolved is the template verbatim (no substitution happened).
        assert_eq!(report.resolved, r#"{"k":"{{x}}"}"#);
    }
}
