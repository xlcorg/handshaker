//! Auth configuration + resolution (master spec §5.3 / §5.4).
//!
//! Secret handling differs per auth kind: an `EnvVar` config names an OS
//! environment variable (read at resolve time, never persisted as plaintext —
//! master §4 line 143), whereas OAuth2 client-credentials fields (including
//! `client_secret`) are `{{var}}` templates resolved by the frontend before
//! reaching the async token provider. Sync `resolve_auth` handles `None`/`EnvVar`;
//! its OAuth2 arm returns `CoreError::NotImplemented` (the live path is
//! `oauth2::Oauth2TokenProvider`).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::CoreError;

pub mod oauth2;

/// Whether an auth config scoped to `environments` is active under `active_env`.
/// Empty list ⇒ always active. Otherwise the active env name must be listed
/// ("No environment" ⇒ `None` ⇒ not listed ⇒ inactive).
pub fn auth_active_for_env(environments: &[String], active_env: Option<&str>) -> bool {
    environments.is_empty() || active_env.is_some_and(|e| environments.iter().any(|x| x == e))
}

/// Pure pick: nearest active non-`None` config wins along request → collection.
/// A config scoped to environments not including `active_env` is skipped (treated
/// as absent). Returns the winning config by reference, or `None` (unauthenticated).
/// This is the single home of the auth-pick rule — UI asks via IPC, never re-derives.
pub fn pick_auth_config<'a>(
    request_auth: &'a SavedAuthConfig,
    collection_auth: Option<&'a SavedAuthConfig>,
    active_env: Option<&str>,
) -> Option<&'a SavedAuthConfig> {
    for cfg in [Some(request_auth), collection_auth].into_iter().flatten() {
        let envs: &[String] = match cfg {
            SavedAuthConfig::None => continue,
            SavedAuthConfig::EnvVar(c) => &c.environments,
            SavedAuthConfig::OAuth2ClientCredentials(c) => &c.environments,
        };
        if auth_active_for_env(envs, active_env) {
            return Some(cfg);
        }
    }
    None
}

fn default_auth_header_name() -> String {
    "authorization".to_string()
}
fn default_auth_prefix() -> String {
    "Bearer ".to_string()
}

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
    /// Environments this config applies to. Empty ⇒ all (see `auth_active_for_env`).
    #[serde(default)]
    pub environments: Vec<String>,
}

/// OAuth2 client-credentials config. All string fields are `{{var}}` templates,
/// resolved on the frontend before reaching the token provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuth2ClientCredentialsConfig {
    pub token_url: String,
    pub client_id: String,
    /// The client secret value (a `{{var}}` template), NOT an env-var name.
    pub client_secret: String,
    pub scopes: Vec<String>,
    /// Header to set on the request (default `authorization`).
    #[serde(default = "default_auth_header_name")]
    pub header_name: String,
    /// Prefix prepended to the access token (default `Bearer `).
    #[serde(default = "default_auth_prefix")]
    pub prefix: String,
    /// Environments this config applies to. Empty ⇒ all.
    #[serde(default)]
    pub environments: Vec<String>,
}

/// One auth strategy for a node, per active environment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SavedAuthConfig {
    /// Explicitly unauthenticated — stops inheritance (Postman "No Auth").
    None,
    EnvVar(EnvVarAuthConfig),
    #[serde(rename = "oauth2_client_credentials")]
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
            // Sync resolution is not supported; the live path goes through
            // `auth::oauth2::Oauth2TokenProvider` (async) via the IPC command.
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
            environments: vec![],
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
            environments: vec![],
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
            client_secret: "SECRET".into(),
            scopes: vec![],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
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

    #[test]
    fn oauth2_config_defaults_fill_header_prefix_and_envs() {
        // A pre-existing JSON without the new fields must still deserialize.
        let json = r#"{"kind":"oauth2_client_credentials","token_url":"u","client_id":"c","client_secret":"s","scopes":[]}"#;
        let cfg: SavedAuthConfig = serde_json::from_str(json).unwrap();
        match cfg {
            SavedAuthConfig::OAuth2ClientCredentials(c) => {
                assert_eq!(c.header_name, "authorization");
                assert_eq!(c.prefix, "Bearer ");
                assert!(c.environments.is_empty());
                assert_eq!(c.client_secret, "s");
            }
            other => panic!("expected oauth2, got {other:?}"),
        }
    }

    #[test]
    fn oauth2_variant_tag_is_pinned() {
        let cfg = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "u".into(), client_id: "c".into(), client_secret: "s".into(),
            scopes: vec![], header_name: "authorization".into(), prefix: "Bearer ".into(),
            environments: vec![],
        });
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains(r#""kind":"oauth2_client_credentials""#), "got {json}");
    }

    #[test]
    fn env_var_config_environments_default_empty() {
        let json = r#"{"kind":"env_var","env_var":"V","header_name":"authorization","prefix":"Bearer "}"#;
        let cfg: SavedAuthConfig = serde_json::from_str(json).unwrap();
        match cfg {
            SavedAuthConfig::EnvVar(c) => assert!(c.environments.is_empty()),
            other => panic!("expected env_var, got {other:?}"),
        }
    }

    #[test]
    fn auth_active_for_env_rules() {
        // empty list ⇒ always active
        assert!(auth_active_for_env(&[], None));
        assert!(auth_active_for_env(&[], Some("prod")));
        // scoped ⇒ active only when the active env is listed
        let prod = vec!["prod".to_string()];
        assert!(auth_active_for_env(&prod, Some("prod")));
        assert!(!auth_active_for_env(&prod, Some("dev")));
        assert!(!auth_active_for_env(&prod, None)); // "No environment"
    }

    #[test]
    fn pick_prefers_request_over_collection() {
        let req = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "R".into(), header_name: "authorization".into(),
            prefix: "Bearer ".into(), environments: vec![],
        });
        let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "C".into(), header_name: "authorization".into(),
            prefix: "Bearer ".into(), environments: vec![],
        });
        let picked = pick_auth_config(&req, Some(&coll), Some("prod")).unwrap();
        match picked {
            SavedAuthConfig::EnvVar(c) => assert_eq!(c.env_var, "R"),
            other => panic!("expected request env_var, got {other:?}"),
        }
    }

    #[test]
    fn pick_falls_back_to_collection_when_request_none() {
        let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "C".into(), header_name: "authorization".into(),
            prefix: "Bearer ".into(), environments: vec![],
        });
        let picked = pick_auth_config(&SavedAuthConfig::None, Some(&coll), None).unwrap();
        assert!(matches!(picked, SavedAuthConfig::EnvVar(c) if c.env_var == "C"));
    }

    #[test]
    fn pick_gates_scoped_config_out_of_other_env() {
        let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "C".into(), header_name: "authorization".into(),
            prefix: "Bearer ".into(), environments: vec!["prod".into()],
        });
        assert!(pick_auth_config(&SavedAuthConfig::None, Some(&coll), Some("dev")).is_none());
        assert!(pick_auth_config(&SavedAuthConfig::None, Some(&coll), None).is_none()); // "No environment"
        assert!(pick_auth_config(&SavedAuthConfig::None, Some(&coll), Some("prod")).is_some());
    }

    #[test]
    fn pick_none_everywhere_is_none() {
        assert!(pick_auth_config(&SavedAuthConfig::None, Some(&SavedAuthConfig::None), Some("prod")).is_none());
        assert!(pick_auth_config(&SavedAuthConfig::None, None, Some("prod")).is_none());
    }
}
