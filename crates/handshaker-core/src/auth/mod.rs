//! Auth configuration + resolution (master spec §5.3 / §5.4).
//!
//! Secret handling differs per auth kind: an `EnvVar` config names an OS
//! environment variable (read at resolve time, never persisted as plaintext —
//! master §4 line 143), whereas OAuth2 client-credentials fields (including
//! `client_secret`) are `{{var}}` templates resolved in core before reaching
//! the async token provider (see `collections::resolve::resolve_request`).
//! `materialize_env_var` handles the `EnvVar` case synchronously; OAuth2
//! materializes through the async `TokenSource` seam — there is no sync
//! `resolve_auth` for it.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::CoreError;

pub mod oauth2;

pub use oauth2::{StaticTokenSource, TokenSource};

/// Whether an auth config scoped to `environments` is active under `active_env`.
/// Empty list ⇒ always active. Otherwise the active env name must be listed
/// ("No environment" ⇒ `None` ⇒ not listed ⇒ inactive).
pub fn auth_active_for_env(environments: &[String], active_env: Option<&str>) -> bool {
    environments.is_empty() || active_env.is_some_and(|e| environments.iter().any(|x| x == e))
}

pub fn pick_auth_config<'a>(
    request_auth: &'a RequestAuth,
    collection_auth: Option<&'a SavedAuthConfig>,
    active_env: Option<&str>,
) -> Option<&'a SavedAuthConfig> {
    match request_auth {
        RequestAuth::Override(SavedAuthConfig::None) => None,
        RequestAuth::Override(cfg) if scheme_active(cfg, active_env) => Some(cfg),
        RequestAuth::Override(_) | RequestAuth::Inherit => {
            active_collection(collection_auth, active_env)
        }
    }
}

fn scheme_active(cfg: &SavedAuthConfig, active_env: Option<&str>) -> bool {
    let envs = match cfg {
        SavedAuthConfig::None => return false,
        SavedAuthConfig::EnvVar(c) => &c.environments,
        SavedAuthConfig::OAuth2ClientCredentials(c) => &c.environments,
    };
    auth_active_for_env(envs, active_env)
}

fn active_collection<'a>(
    collection_auth: Option<&'a SavedAuthConfig>,
    active_env: Option<&str>,
) -> Option<&'a SavedAuthConfig> {
    let cfg = collection_auth?;
    scheme_active(cfg, active_env).then_some(cfg)
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

/// OAuth2 client-credentials config. String fields are `{{var}}` templates. Core
/// resolves them before the token source sees them; the resolved client secret does
/// not cross back to the frontend.
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SavedAuthConfig {
    None,
    EnvVar(EnvVarAuthConfig),
    #[serde(rename = "oauth2_client_credentials")]
    OAuth2ClientCredentials(OAuth2ClientCredentialsConfig),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum RequestAuth {
    #[default]
    Inherit,
    Override(SavedAuthConfig),
}

impl RequestAuth {
    pub fn from_grpc(auth: &SavedAuthConfig) -> Self {
        match auth {
            SavedAuthConfig::None => RequestAuth::Inherit,
            other => RequestAuth::Override(other.clone()),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum RequestAuthFile {
    #[serde(rename = "none")]
    Inherit,
    Off,
    EnvVar(EnvVarAuthConfig),
    #[serde(rename = "oauth2_client_credentials")]
    OAuth2ClientCredentials(OAuth2ClientCredentialsConfig),
}

impl From<RequestAuthFile> for RequestAuth {
    fn from(file: RequestAuthFile) -> Self {
        match file {
            RequestAuthFile::Inherit => RequestAuth::Inherit,
            RequestAuthFile::Off => RequestAuth::Override(SavedAuthConfig::None),
            RequestAuthFile::EnvVar(cfg) => RequestAuth::Override(SavedAuthConfig::EnvVar(cfg)),
            RequestAuthFile::OAuth2ClientCredentials(cfg) => {
                RequestAuth::Override(SavedAuthConfig::OAuth2ClientCredentials(cfg))
            }
        }
    }
}

impl Serialize for RequestAuth {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            RequestAuth::Inherit => RequestAuthFile::Inherit.serialize(serializer),
            RequestAuth::Override(SavedAuthConfig::None) => {
                RequestAuthFile::Off.serialize(serializer)
            }
            RequestAuth::Override(cfg) => cfg.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for RequestAuth {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        RequestAuthFile::deserialize(deserializer).map(RequestAuth::from)
    }
}

/// Read the secret named by `cfg.env_var` from the OS env and build `prefix + secret`.
pub fn materialize_env_var(cfg: &EnvVarAuthConfig) -> Result<AuthCredentials, CoreError> {
    let secret = std::env::var(&cfg.env_var)
        .map_err(|_| CoreError::Auth(format!("env var `{}` not set", cfg.env_var)))?;
    Ok(AuthCredentials {
        header_name: cfg.header_name.clone(),
        header_value: format!("{}{}", cfg.prefix, secret),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_var_reads_secret_and_applies_prefix() {
        // Unique var name to avoid cross-test contamination.
        let var = "HANDSHAKER_TEST_AUTH_TASK3";
        std::env::set_var(var, "s3cr3t");
        let cfg = EnvVarAuthConfig {
            env_var: var.to_string(),
            header_name: "authorization".to_string(),
            prefix: "Bearer ".to_string(),
            environments: vec![],
        };
        let creds = materialize_env_var(&cfg).unwrap();
        assert_eq!(creds.header_name, "authorization");
        assert_eq!(creds.header_value, "Bearer s3cr3t");
        std::env::remove_var(var);
    }

    #[test]
    fn env_var_missing_is_auth_error() {
        let cfg = EnvVarAuthConfig {
            env_var: "HANDSHAKER_DEFINITELY_UNSET_VAR_XYZ".to_string(),
            header_name: "authorization".to_string(),
            prefix: "Bearer ".to_string(),
            environments: vec![],
        };
        match materialize_env_var(&cfg).unwrap_err() {
            CoreError::Auth(m) => assert!(m.contains("not set")),
            other => panic!("expected Auth, got {other:?}"),
        }
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
            env_var: "R".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "C".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let req = RequestAuth::Override(req);
        let picked = pick_auth_config(&req, Some(&coll), Some("prod")).unwrap();
        match picked {
            SavedAuthConfig::EnvVar(c) => assert_eq!(c.env_var, "R"),
            other => panic!("expected request env_var, got {other:?}"),
        }
    }

    #[test]
    fn pick_falls_back_to_collection_when_request_none() {
        let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "C".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let req = RequestAuth::Inherit;
        let picked = pick_auth_config(&req, Some(&coll), None).unwrap();
        assert!(matches!(picked, SavedAuthConfig::EnvVar(c) if c.env_var == "C"));
    }

    #[test]
    fn pick_gates_scoped_config_out_of_other_env() {
        let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "C".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec!["prod".into()],
        });
        assert!(pick_auth_config(&RequestAuth::Inherit, Some(&coll), Some("dev")).is_none());
        assert!(pick_auth_config(&RequestAuth::Inherit, Some(&coll), None).is_none());
        assert!(pick_auth_config(&RequestAuth::Inherit, Some(&coll), Some("prod")).is_some());
    }

    #[test]
    fn pick_none_everywhere_is_none() {
        let req = RequestAuth::Inherit;
        let none = SavedAuthConfig::None;
        assert!(pick_auth_config(&req, Some(&none), Some("prod")).is_none());
        assert!(pick_auth_config(&req, None, Some("prod")).is_none());
    }

    #[test]
    fn pick_explicit_none_ignores_the_collection() {
        let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "C".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let off = RequestAuth::Override(SavedAuthConfig::None);
        assert!(pick_auth_config(&off, Some(&coll), Some("prod")).is_none());
    }

    #[test]
    fn pick_inactive_override_falls_through_to_the_collection() {
        let req = RequestAuth::Override(SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "R".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec!["prod".into()],
        }));
        let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "C".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let picked = pick_auth_config(&req, Some(&coll), Some("dev")).unwrap();
        assert!(matches!(picked, SavedAuthConfig::EnvVar(c) if c.env_var == "C"));
    }

    #[test]
    fn request_auth_file_keeps_schemes_and_splits_none_from_off() {
        let bearer = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "TOK".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let stored = RequestAuth::Override(bearer);
        let json = serde_json::to_value(&stored).unwrap();
        assert_eq!(json["kind"], "env_var");
        assert_eq!(serde_json::from_value::<RequestAuth>(json).unwrap(), stored);
        assert_eq!(
            serde_json::to_value(RequestAuth::Inherit).unwrap(),
            serde_json::json!({ "kind": "none" })
        );
        assert_eq!(
            serde_json::from_str::<RequestAuth>(r#"{"kind":"none"}"#).unwrap(),
            RequestAuth::Inherit
        );
        assert_eq!(
            serde_json::to_value(RequestAuth::Override(SavedAuthConfig::None)).unwrap(),
            serde_json::json!({ "kind": "off" })
        );
        assert_eq!(
            serde_json::from_str::<RequestAuth>(r#"{"kind":"off"}"#).unwrap(),
            RequestAuth::Override(SavedAuthConfig::None)
        );
    }
}
