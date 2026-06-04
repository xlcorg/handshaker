//! Auth-resolution IPC command (Plan #5, Phase B). Thin total wrapper over core
//! `resolve_auth`: `None → Ok(None)`, `EnvVar` reads the OS env var at call time
//! (never persists plaintext, master §10), `OAuth2 → NotImplemented`.

use handshaker_core::auth::resolve_auth;

use crate::ipc::auth::AuthCredentialsIpc;
use crate::ipc::collection::SavedAuthConfigIpc;
use crate::ipc::error::IpcError;

#[tauri::command]
#[specta::specta]
pub async fn auth_resolve(
    config: SavedAuthConfigIpc,
) -> Result<Option<AuthCredentialsIpc>, IpcError> {
    let core = config.into_core();
    let creds = resolve_auth(&core).map_err(IpcError::from)?;
    Ok(creds.map(AuthCredentialsIpc::from_core))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn none_resolves_to_no_header() {
        assert!(auth_resolve(SavedAuthConfigIpc::None).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn env_var_resolves_to_prefixed_header() {
        let var = "HANDSHAKER_TEST_AUTH_RESOLVE_CMD";
        std::env::set_var(var, "tok123");
        let cfg = SavedAuthConfigIpc::EnvVar {
            env_var: var.into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
        };
        let out = auth_resolve(cfg).await.unwrap().unwrap();
        assert_eq!(out.header_name, "authorization");
        assert_eq!(out.header_value, "Bearer tok123");
        std::env::remove_var(var);
    }

    #[tokio::test]
    async fn oauth2_is_not_implemented() {
        let cfg = SavedAuthConfigIpc::Oauth2ClientCredentials {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret_env_var: "SECRET".into(),
            scopes: vec![],
        };
        assert!(matches!(auth_resolve(cfg).await.unwrap_err(), IpcError::NotImplemented { .. }));
    }
}
