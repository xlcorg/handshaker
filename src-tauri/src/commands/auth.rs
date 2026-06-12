//! Auth-resolution IPC commands. `None`/`EnvVar` resolve synchronously in core;
//! `OAuth2` routes through the session token provider (`AppState::oauth2_provider`).

use handshaker_core::auth::{resolve_auth, SavedAuthConfig};
use tauri::State;

use crate::ipc::auth::{AuthCredentialsIpc, OAuth2TokenInfoIpc};
use crate::ipc::collection::SavedAuthConfigIpc;
use crate::ipc::error::IpcError;
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
            other => Ok(resolve_auth(&other)?.map(AuthCredentialsIpc::from_core)),
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
}
