//! Auth configuration + resolution (master spec §5.3 / §5.4).
//!
//! Secrets are NEVER stored as plaintext: an `EnvVar` config names an OS
//! environment variable, read at resolve time (master §4 line 143). OAuth2
//! client-credentials token fetch is deferred (master §5.4) — it parses and
//! persists, but resolution returns `CoreError::NotImplemented`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::CoreError;

/// A resolved header to attach to a request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthCredentials {
    pub header_name: String,
    pub header_value: String,
}

/// Read a secret from an OS env var by NAME; build `header_name: prefix + secret`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvVarAuthConfig {
    /// Name of the OS env var holding the secret (e.g. `API_TOKEN`).
    pub env_var: String,
    /// Header to set (e.g. `authorization`).
    pub header_name: String,
    /// Prefix prepended to the secret value (e.g. `Bearer `).
    pub prefix: String,
}

/// OAuth2 client-credentials config. Token fetch is deferred (master §5.4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuth2ClientCredentialsConfig {
    pub token_url: String,
    pub client_id: String,
    /// Env-var NAME holding the client secret (never plaintext).
    pub client_secret_env_var: String,
    pub scopes: Vec<String>,
}

/// One auth strategy for a node, per active environment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SavedAuthConfig {
    /// Explicitly unauthenticated — stops inheritance (Postman "No Auth").
    None,
    EnvVar(EnvVarAuthConfig),
    OAuth2ClientCredentials(OAuth2ClientCredentialsConfig),
}

/// Per-environment auth map carried by Collection / Folder / Request.
///
/// A key present (even `SavedAuthConfig::None`) means "this node defines auth for
/// that env" and stops inheritance. A key absent means "inherit from the ancestor".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthByEnv {
    pub configs: HashMap<String, SavedAuthConfig>,
}

impl AuthByEnv {
    /// The config this node defines for `env_name`, if any.
    pub fn for_env(&self, env_name: &str) -> Option<&SavedAuthConfig> {
        self.configs.get(env_name)
    }
}

/// Resolve a single `SavedAuthConfig` to concrete credentials.
/// - `None` → `Ok(None)` (unauthenticated).
/// - `EnvVar` → reads `std::env`; missing var → `CoreError::Auth`.
/// - `OAuth2ClientCredentials` → `CoreError::NotImplemented` (deferred).
pub fn resolve_auth(config: &SavedAuthConfig) -> Result<Option<AuthCredentials>, CoreError> {
    match config {
        SavedAuthConfig::None => Ok(None),
        SavedAuthConfig::EnvVar(c) => {
            let secret = std::env::var(&c.env_var)
                .map_err(|_| CoreError::Auth(format!("env var `{}` not set", c.env_var)))?;
            Ok(Some(AuthCredentials {
                header_name: c.header_name.clone(),
                header_value: format!("{}{}", c.prefix, secret),
            }))
        }
        SavedAuthConfig::OAuth2ClientCredentials(_) => {
            Err(CoreError::NotImplemented("oauth2 token fetch".into()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_resolves_to_no_credentials() {
        assert_eq!(resolve_auth(&SavedAuthConfig::None).unwrap(), None);
    }

    #[test]
    fn env_var_reads_secret_and_applies_prefix() {
        // Unique var name to avoid cross-test contamination.
        let var = "HANDSHAKER_TEST_AUTH_TASK3";
        std::env::set_var(var, "s3cr3t");
        let cfg = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: var.to_string(),
            header_name: "authorization".to_string(),
            prefix: "Bearer ".to_string(),
        });
        let creds = resolve_auth(&cfg).unwrap().unwrap();
        assert_eq!(creds.header_name, "authorization");
        assert_eq!(creds.header_value, "Bearer s3cr3t");
        std::env::remove_var(var);
    }

    #[test]
    fn env_var_missing_is_auth_error() {
        let cfg = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "HANDSHAKER_DEFINITELY_UNSET_VAR_XYZ".to_string(),
            header_name: "authorization".to_string(),
            prefix: "Bearer ".to_string(),
        });
        match resolve_auth(&cfg).unwrap_err() {
            CoreError::Auth(m) => assert!(m.contains("not set")),
            other => panic!("expected Auth, got {other:?}"),
        }
    }

    #[test]
    fn oauth2_is_not_implemented() {
        let cfg = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret_env_var: "SECRET".into(),
            scopes: vec![],
        });
        assert!(matches!(resolve_auth(&cfg).unwrap_err(), CoreError::NotImplemented(_)));
    }

    #[test]
    fn auth_by_env_serde_round_trip() {
        let mut abe = AuthByEnv::default();
        abe.configs.insert("prod".into(), SavedAuthConfig::None);
        let json = serde_json::to_string(&abe).unwrap();
        let back: AuthByEnv = serde_json::from_str(&json).unwrap();
        assert_eq!(abe, back);
    }
}
