//! Auth-resolution IPC commands. `None`/`EnvVar` resolve synchronously in core;
//! `OAuth2` routes through the session token provider (`AppState::oauth2_provider`).

use handshaker_core::auth::{materialize_env_var, pick_auth_config, SavedAuthConfig};
use tauri::State;

use crate::ipc::auth::{AuthCredentialsIpc, OAuth2TokenInfoIpc};
use crate::ipc::collection::{parse_collection_id, SavedAuthConfigIpc};
use crate::ipc::error::IpcError;
use crate::ipc::invoke::SendCtxIpc;
use crate::state::AppState;
use handshaker_core::error::CoreError;

impl AppState {
    pub async fn auth_resolve_impl(
        &self,
        config: SavedAuthConfigIpc,
    ) -> Result<Option<AuthCredentialsIpc>, CoreError> {
        match config.into_core() {
            SavedAuthConfig::OAuth2ClientCredentials(c) => {
                let creds = self.oauth2_provider.header_for(&c).await?;
                Ok(Some(AuthCredentialsIpc::from_core(creds)))
            }
            SavedAuthConfig::None => Ok(None),
            SavedAuthConfig::EnvVar(c) => Ok(Some(AuthCredentialsIpc::from_core(materialize_env_var(&c)?))),
        }
    }

    pub async fn auth_oauth2_fetch_token_impl(
        &self,
        config: SavedAuthConfigIpc,
    ) -> Result<OAuth2TokenInfoIpc, CoreError> {
        match config.into_core() {
            SavedAuthConfig::OAuth2ClientCredentials(c) => {
                let resp = self.oauth2_provider.force_fetch(&c).await?;
                Ok(OAuth2TokenInfoIpc {
                    access_token: resp.access_token,
                    expires_in_secs: resp.expires_in_secs as u32,
                })
            }
            _ => Err(CoreError::InvalidTarget(
                "auth_oauth2_fetch_token requires an oauth2 config".into(),
            )),
        }
    }

    pub fn auth_invalidate_impl(&self, config: SavedAuthConfigIpc) {
        if let SavedAuthConfig::OAuth2ClientCredentials(c) = config.into_core() {
            self.oauth2_provider.invalidate(&c);
        }
    }

    /// "Which auth wins" — the single core pick (`pick_auth_config`), fed the
    /// request-level auth plus the collection's auth (looked up via `ctx.collection_id`)
    /// and the active-env name from `ctx`. The Auth tab and history snapshot (and, since
    /// Slice 5, `grpc_send` itself via `resolve_request`) all agree with this one pick —
    /// the TS `pickEffectiveAuth` copy it used to mirror is gone.
    pub async fn auth_effective_impl(
        &self,
        step_auth: SavedAuthConfigIpc,
        ctx: SendCtxIpc,
    ) -> Result<SavedAuthConfigIpc, CoreError> {
        let collection_auth = ctx
            .collection_id
            .as_deref()
            .and_then(|id| parse_collection_id(id).ok())
            .and_then(|cid| self.collection_store.get(cid))
            .map(|c| c.auth);
        let req = step_auth.into_core();
        let picked = pick_auth_config(&req, collection_auth.as_ref(), ctx.env_name.as_deref());
        Ok(SavedAuthConfigIpc::from_core(picked.cloned().unwrap_or(SavedAuthConfig::None)))
    }
}

#[tauri::command]
#[specta::specta]
pub async fn auth_resolve(
    state: State<'_, AppState>,
    config: SavedAuthConfigIpc,
) -> Result<Option<AuthCredentialsIpc>, IpcError> {
    state.auth_resolve_impl(config).await.map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn auth_oauth2_fetch_token(
    state: State<'_, AppState>,
    config: SavedAuthConfigIpc,
) -> Result<OAuth2TokenInfoIpc, IpcError> {
    state.auth_oauth2_fetch_token_impl(config).await.map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn auth_invalidate(
    state: State<'_, AppState>,
    config: SavedAuthConfigIpc,
) -> Result<(), IpcError> {
    state.auth_invalidate_impl(config);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn auth_effective(
    state: State<'_, AppState>,
    step_auth: SavedAuthConfigIpc,
    ctx: SendCtxIpc,
) -> Result<SavedAuthConfigIpc, IpcError> {
    state.auth_effective_impl(step_auth, ctx).await.map_err(IpcError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[tokio::test]
    async fn none_resolves_to_no_header() {
        let state = AppState::default();
        assert!(state.auth_resolve_impl(SavedAuthConfigIpc::None).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn env_var_resolves_to_prefixed_header() {
        let var = "HANDSHAKER_TEST_AUTH_RESOLVE_CMD";
        std::env::set_var(var, "tok123");
        let state = AppState::default();
        let cfg = SavedAuthConfigIpc::EnvVar {
            env_var: var.into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        };
        let out = state.auth_resolve_impl(cfg).await.unwrap().unwrap();
        assert_eq!(out.header_name, "authorization");
        assert_eq!(out.header_value, "Bearer tok123");
        std::env::remove_var(var);
    }

    #[tokio::test]
    async fn fetch_token_rejects_non_oauth2_config() {
        let state = AppState::default();
        let err = state.auth_oauth2_fetch_token_impl(SavedAuthConfigIpc::None).await.unwrap_err();
        assert!(matches!(err, handshaker_core::error::CoreError::InvalidTarget(_)));
    }

    #[tokio::test]
    async fn invalidate_is_a_noop_for_non_oauth2() {
        let state = AppState::default();
        state.auth_invalidate_impl(SavedAuthConfigIpc::None); // must not panic
    }

    use handshaker_core::collections::ids::CollectionId;
    use handshaker_core::collections::Collection;

    fn env_var_auth(name: &str, environments: Vec<String>) -> SavedAuthConfigIpc {
        SavedAuthConfigIpc::EnvVar {
            env_var: name.into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments,
        }
    }

    fn collection_with_auth(id: CollectionId, auth: SavedAuthConfig) -> Collection {
        Collection {
            id,
            name: "Notes".into(),
            items: vec![],
            variables: Default::default(),
            auth,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
        }
    }

    #[tokio::test]
    async fn effective_prefers_request_auth() {
        let state = AppState::default();
        let step = env_var_auth("R", vec![]);
        let out = state
            .auth_effective_impl(step, SendCtxIpc { collection_id: None, env_name: Some("prod".into()) })
            .await
            .unwrap();
        assert!(matches!(out, SavedAuthConfigIpc::EnvVar { env_var, .. } if env_var == "R"));
    }

    #[tokio::test]
    async fn effective_falls_back_to_collection_auth() {
        let state = AppState::default();
        let cid = CollectionId::new();
        let collection_auth = env_var_auth("C", vec![]).into_core();
        state.collection_store.upsert(collection_with_auth(cid, collection_auth)).unwrap();
        let out = state
            .auth_effective_impl(
                SavedAuthConfigIpc::None,
                SendCtxIpc { collection_id: Some(cid.0.to_string()), env_name: Some("prod".into()) },
            )
            .await
            .unwrap();
        assert!(matches!(out, SavedAuthConfigIpc::EnvVar { env_var, .. } if env_var == "C"));
    }

    #[tokio::test]
    async fn effective_gates_scoped_collection_auth_out_of_env() {
        let state = AppState::default();
        let cid = CollectionId::new();
        let collection_auth = env_var_auth("C", vec!["prod".into()]).into_core();
        state.collection_store.upsert(collection_with_auth(cid, collection_auth)).unwrap();
        let out = state
            .auth_effective_impl(
                SavedAuthConfigIpc::None,
                SendCtxIpc { collection_id: Some(cid.0.to_string()), env_name: Some("dev".into()) },
            )
            .await
            .unwrap();
        assert!(matches!(out, SavedAuthConfigIpc::None));
    }
}
