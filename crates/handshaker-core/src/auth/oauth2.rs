//! OAuth2 client-credentials token fetch + cache.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::auth::{AuthCredentials, OAuth2ClientCredentialsConfig};
use crate::error::CoreError;

const DEFAULT_EXPIRES_IN_SECS: u64 = 300;

/// Parsed, validated token-endpoint response.
#[derive(Debug)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in_secs: u64,
}

#[derive(Deserialize)]
struct RawTokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct RawTokenError {
    error: Option<String>,
    error_description: Option<String>,
}

/// `application/x-www-form-urlencoded` pairs for a client-credentials request.
/// `scope` (space-joined) is omitted when there are no scopes.
fn token_request_form(cfg: &OAuth2ClientCredentialsConfig) -> Vec<(&'static str, String)> {
    let mut form = vec![
        ("grant_type", "client_credentials".to_string()),
        ("client_id", cfg.client_id.clone()),
        ("client_secret", cfg.client_secret.clone()),
    ];
    if !cfg.scopes.is_empty() {
        form.push(("scope", cfg.scopes.join(" ")));
    }
    form
}

/// Parse a token-endpoint response. Non-2xx → `Auth` with the IdP `error`/`error_description`
/// when present; 2xx without `access_token` → `Auth`; missing `expires_in` → 300s.
/// `token_type` is ignored (the header prefix is user-configured).
fn parse_token_response(status: u16, body: &str) -> Result<TokenResponse, CoreError> {
    if !(200..300).contains(&status) {
        let detail = serde_json::from_str::<RawTokenError>(body)
            .ok()
            .and_then(|e| {
                let code = e.error?;
                Some(match e.error_description {
                    Some(d) => format!("{code}: {d}"),
                    None => code,
                })
            })
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(CoreError::Auth(format!(
            "oauth2 token request failed ({status}): {detail}"
        )));
    }
    let raw: RawTokenResponse = serde_json::from_str(body)
        .map_err(|e| CoreError::Auth(format!("oauth2 token response parse error: {e}")))?;
    let access_token = raw
        .access_token
        .ok_or_else(|| CoreError::Auth("oauth2 token response missing access_token".into()))?;
    Ok(TokenResponse {
        access_token,
        expires_in_secs: raw.expires_in.unwrap_or(DEFAULT_EXPIRES_IN_SECS),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> OAuth2ClientCredentialsConfig {
        OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret: "sec".into(),
            scopes: vec!["a".into(), "b".into()],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        }
    }

    #[test]
    fn form_body_has_grant_and_space_joined_scope() {
        let form = token_request_form(&cfg());
        assert!(form.contains(&("grant_type", "client_credentials".to_string())));
        assert!(form.contains(&("client_id", "cid".to_string())));
        assert!(form.contains(&("client_secret", "sec".to_string())));
        assert!(form.contains(&("scope", "a b".to_string())));
    }

    #[test]
    fn form_body_omits_scope_when_empty() {
        let mut c = cfg();
        c.scopes.clear();
        let form = token_request_form(&c);
        assert!(!form.iter().any(|(k, _)| *k == "scope"));
    }

    #[test]
    fn parse_ok_reads_token_and_expiry() {
        let body = r#"{"access_token":"tok","expires_in":1800,"token_type":"Bearer"}"#;
        let r = parse_token_response(200, body).unwrap();
        assert_eq!(r.access_token, "tok");
        assert_eq!(r.expires_in_secs, 1800);
    }

    #[test]
    fn parse_ok_defaults_missing_expiry_to_300() {
        let r = parse_token_response(200, r#"{"access_token":"tok"}"#).unwrap();
        assert_eq!(r.expires_in_secs, 300);
    }

    #[test]
    fn parse_ok_ignores_token_type() {
        // token_type other than Bearer is accepted (prefix is user-configured).
        let r = parse_token_response(200, r#"{"access_token":"tok","token_type":"mac"}"#).unwrap();
        assert_eq!(r.access_token, "tok");
    }

    #[test]
    fn parse_missing_access_token_is_auth_error() {
        let err = parse_token_response(200, r#"{"expires_in":60}"#).unwrap_err();
        assert!(matches!(err, CoreError::Auth(_)));
    }

    #[test]
    fn parse_error_status_surfaces_idp_error_fields() {
        let body = r#"{"error":"invalid_client","error_description":"bad secret"}"#;
        let err = parse_token_response(401, body).unwrap_err();
        match err {
            CoreError::Auth(m) => {
                assert!(m.contains("invalid_client"));
                assert!(m.contains("bad secret"));
                assert!(m.contains("401"));
            }
            other => panic!("expected Auth, got {other:?}"),
        }
    }
}
