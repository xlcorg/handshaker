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
    expires_in: Option<f64>,
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
        expires_in_secs: raw.expires_in.map(|v| v as u64).unwrap_or(DEFAULT_EXPIRES_IN_SECS),
    })
}

/// Skew subtracted from expiry — a token within this window of expiring is refetched.
const EXPIRY_SKEW: Duration = Duration::from_secs(30);

/// Cache identity = the resolved credentials that determine which token you get.
/// `header_name`/`prefix` are deliberately excluded (they shape the header, not the token).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    token_url: String,
    client_id: String,
    client_secret: String,
    scopes: Vec<String>,
}

impl From<&OAuth2ClientCredentialsConfig> for CacheKey {
    fn from(c: &OAuth2ClientCredentialsConfig) -> Self {
        Self {
            token_url: c.token_url.clone(),
            client_id: c.client_id.clone(),
            client_secret: c.client_secret.clone(),
            scopes: c.scopes.clone(),
        }
    }
}

pub struct CachedToken {
    pub access_token: String,
    pub expires_at: Instant,
}

/// In-memory token store. Pure: callers inject `now`; no wall clock here.
#[derive(Default)]
pub struct TokenCache {
    entries: HashMap<CacheKey, CachedToken>,
}

impl TokenCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// The cached token for `key`, but only if it stays valid for more than the skew.
    pub fn get_fresh(&self, key: &CacheKey, now: Instant) -> Option<&CachedToken> {
        self.entries
            .get(key)
            .filter(|t| t.expires_at.saturating_duration_since(now) > EXPIRY_SKEW)
    }

    pub fn put(&mut self, key: CacheKey, token: CachedToken) {
        self.entries.insert(key, token);
    }

    pub fn invalidate(&mut self, key: &CacheKey) {
        self.entries.remove(key);
    }
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
    fn parse_ok_accepts_fractional_expires_in() {
        // Some IdPs emit expires_in as a JSON float; truncate to whole seconds.
        let r = parse_token_response(200, r#"{"access_token":"tok","expires_in":1800.0}"#).unwrap();
        assert_eq!(r.access_token, "tok");
        assert_eq!(r.expires_in_secs, 1800);
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

    fn key(secret: &str) -> CacheKey {
        let mut c = cfg();
        c.client_secret = secret.into();
        CacheKey::from(&c)
    }

    #[test]
    fn fresh_token_is_returned_when_far_from_expiry() {
        let mut cache = TokenCache::new();
        let base = Instant::now();
        cache.put(key("s"), CachedToken { access_token: "tok".into(), expires_at: base + Duration::from_secs(100) });
        // 100s out, well beyond the 30s skew.
        assert_eq!(cache.get_fresh(&key("s"), base).map(|t| t.access_token.as_str()), Some("tok"));
    }

    #[test]
    fn token_within_skew_is_treated_as_stale() {
        let mut cache = TokenCache::new();
        let base = Instant::now();
        cache.put(key("s"), CachedToken { access_token: "tok".into(), expires_at: base + Duration::from_secs(100) });
        // now = base + 80s ⇒ 20s remaining ⇒ < 30s skew ⇒ stale.
        assert!(cache.get_fresh(&key("s"), base + Duration::from_secs(80)).is_none());
    }

    #[test]
    fn cache_key_ignores_header_and_prefix() {
        let mut a = cfg();
        a.header_name = "x-auth".into();
        a.prefix = "".into();
        let b = cfg(); // default header/prefix, same url/id/secret/scopes
        assert_eq!(CacheKey::from(&a), CacheKey::from(&b));
        // ...but secret DOES change the key:
        let mut c = cfg();
        c.client_secret = "other".into();
        assert_ne!(CacheKey::from(&a), CacheKey::from(&c));
    }

    #[test]
    fn invalidate_removes_entry() {
        let mut cache = TokenCache::new();
        let base = Instant::now();
        cache.put(key("s"), CachedToken { access_token: "tok".into(), expires_at: base + Duration::from_secs(100) });
        cache.invalidate(&key("s"));
        assert!(cache.get_fresh(&key("s"), base).is_none());
    }
}
