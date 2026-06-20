//! Variable substitution IPC command. See spec §5.1 and
//! docs/superpowers/specs/2026-06-13-collection-vars-resolve-design.md.

use std::collections::HashMap;

use handshaker_core::vars::{resolve_template_with_diagnostics, ResolutionReport, VariableSet};
use tauri::State;

use crate::ipc::collection::parse_collection_id;
use crate::ipc::error::IpcError;
use crate::ipc::vars::{ResolutionReportIpc, VarsResolveCtxIpc};
use crate::state::AppState;

impl AppState {
    /// Inner logic for `vars_resolve`. Env vars: `ctx.env_vars` overlay, else the
    /// active environment, else empty. Collection vars: `ctx.collection_vars`
    /// overlay, else a store lookup by `ctx.collection_id` (unknown id ⇒ empty),
    /// else empty. `ctx = None` keeps the historical behaviour exactly.
    pub async fn vars_resolve_impl(
        &self,
        template: &str,
        ctx: Option<VarsResolveCtxIpc>,
    ) -> ResolutionReport {
        let ctx = ctx.unwrap_or_default();
        let env_owned: HashMap<String, String> = match ctx.env_vars {
            Some(vars) => vars,
            None => {
                let active = self.active_env.read().await.clone();
                active
                    .as_deref()
                    .and_then(|n| self.env_store.get(n))
                    .map(|e| e.variables.into_iter().collect())
                    .unwrap_or_default()
            }
        };
        let collection_owned: HashMap<String, String> = match ctx.collection_vars {
            Some(vars) => vars,
            None => ctx
                .collection_id
                .as_deref()
                .and_then(|id| parse_collection_id(id).ok())
                .and_then(|cid| self.collection_store.get(cid))
                .map(|c| c.variables.into_iter().collect())
                .unwrap_or_default(),
        };
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
    ctx: Option<VarsResolveCtxIpc>,
) -> Result<ResolutionReportIpc, IpcError> {
    Ok(state.vars_resolve_impl(&template, ctx).await.into())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use handshaker_core::auth::SavedAuthConfig;
    use handshaker_core::collections::ids::CollectionId;
    use handshaker_core::collections::Collection;

    use super::*;
    use crate::ipc::vars::VarsResolveCtxIpc;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[tokio::test]
    async fn vars_resolve_treats_active_none_as_empty_var_set() {
        let state = AppState::default(); // active = None, stores empty
        let report = state.vars_resolve_impl(r#"{"k":"{{x}}"}"#, None).await;
        assert_eq!(report.unresolved_vars, vec!["x".to_string()]);
        assert!(report.cycle_chain.is_none());
        assert_eq!(report.resolved, r#"{"k":"{{x}}"}"#);
    }

    #[tokio::test]
    async fn ctx_overlays_resolve_collection_var_against_env_var() {
        let state = AppState::default();
        let ctx = VarsResolveCtxIpc {
            collection_id: None,
            collection_vars: Some(map(&[("uri-root", "{{notes-api-root}}")])),
            env_vars: Some(map(&[("notes-api-root", "https://api.example.com")])),
        };
        let report = state.vars_resolve_impl("{{uri-root}}/v1/notes", Some(ctx)).await;
        assert_eq!(report.resolved, "https://api.example.com/v1/notes");
        assert!(report.unresolved_vars.is_empty());
    }

    #[tokio::test]
    async fn ctx_collection_id_reads_vars_from_store() {
        let state = AppState::default();
        let cid = CollectionId::new();
        state
            .collection_store
            .upsert(Collection {
                id: cid,
                name: "Notes".into(),
                items: vec![],
                variables: map(&[("uri-root", "{{notes-api-root}}")]).into_iter().collect(),
                auth: SavedAuthConfig::None,
                default_tls: false,
                skip_tls_verify: false,
                pinned: false,
                description: None,
                created_at: 0.0,
                expanded: false,
            })
            .unwrap();
        let ctx = VarsResolveCtxIpc {
            collection_id: Some(cid.0.to_string()),
            collection_vars: None,
            env_vars: Some(map(&[("notes-api-root", "https://api.example.com")])),
        };
        let report = state.vars_resolve_impl("{{uri-root}}", Some(ctx)).await;
        assert_eq!(report.resolved, "https://api.example.com");
        assert!(report.unresolved_vars.is_empty());
    }

    #[tokio::test]
    async fn ctx_unknown_collection_id_is_empty_map_not_error() {
        let state = AppState::default();
        let ctx = VarsResolveCtxIpc {
            collection_id: Some("not-a-uuid".into()),
            collection_vars: None,
            env_vars: None,
        };
        let report = state.vars_resolve_impl("{{x}}", Some(ctx)).await;
        assert_eq!(report.unresolved_vars, vec!["x".to_string()]);
    }
}
