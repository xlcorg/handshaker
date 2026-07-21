//! Turn a `SavedRequest` + collection + active env into a fully-resolved
//! `EffectiveRequest`. Auth resolves request → collection (folders carry none).
//!
//! Pure except for the `std::env` read inside `EnvVar` auth and the `TokenSource`
//! call for OAuth2 → fully testable via `StaticTokenSource`.

use std::collections::HashMap;

use crate::auth::{materialize_env_var, pick_auth_config, OAuth2ClientCredentialsConfig, SavedAuthConfig, TokenSource};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::GrpcTarget;
use crate::vars::{resolve_template_with_diagnostics, VariableSet};

use super::{Collection, EffectiveRequest, SavedRequest};

/// Resolve one request. `collection` is `None` for an unbound draft (no collection
/// vars, no collection auth, TLS defaults `false`/`false`). `active_env` is `None`
/// for "No environment". `tokens` materializes an OAuth2 header if the picked auth
/// config is OAuth2 (real `Oauth2TokenProvider` in production, `StaticTokenSource`
/// in tests).
pub async fn resolve_request(
    request: &SavedRequest,
    collection: Option<&Collection>,
    active_env: Option<&Environment>,
    tokens: &dyn TokenSource,
) -> Result<EffectiveRequest, CoreError> {
    // --- 1. Variables (priority env > collection) ---
    // VariableSet borrows `&HashMap` (resolution is order-agnostic). The stored
    // maps are now IndexMap, so convert here — the maps are tiny.
    let env_vars: HashMap<String, String> = active_env
        .map(|e| e.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    let collection_vars: HashMap<String, String> = collection
        .map(|c| c.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    let vars = VariableSet { env: &env_vars, collection: &collection_vars };

    let mut acc = ResolveAcc::default();
    let address = acc.take(&request.address_template, &vars);
    let body_json = acc.take(&request.body_template, &vars);
    let mut metadata = HashMap::with_capacity(request.metadata.len());
    for row in &request.metadata {
        if !row.enabled {
            continue; // disabled rows are not sent
        }
        // Keys are literal; only values are templated. Last enabled row wins on dup key.
        metadata.insert(row.key.clone(), acc.take(&row.value, &vars));
    }

    // --- 2. Auth pick + oauth field resolve (into the SAME accumulator, so an
    // unresolved oauth var is reported alongside body/metadata vars, before any
    // network/env side-effect). ---
    let collection_auth = collection.map(|c| &c.auth);
    let picked =
        pick_auth_config(&request.auth, collection_auth, active_env.map(|e| e.name.as_str())).cloned();

    let resolved_oauth = match &picked {
        Some(SavedAuthConfig::OAuth2ClientCredentials(c)) => Some(OAuth2ClientCredentialsConfig {
            token_url: acc.take(&c.token_url, &vars),
            client_id: acc.take(&c.client_id, &vars),
            client_secret: acc.take(&c.client_secret, &vars),
            scopes: c.scopes.iter().map(|s| acc.take(s, &vars)).collect(),
            header_name: c.header_name.clone(),
            prefix: c.prefix.clone(),
            environments: c.environments.clone(),
        }),
        _ => None,
    };

    if let Some(err) = acc.into_failure() {
        return Err(err); // no network/env side-effects on failure
    }

    // --- 3. TLS ---
    let default_tls = collection.map_or(false, |c| c.default_tls);
    let skip_verify = collection.map_or(false, |c| c.skip_tls_verify);
    let tls = request.tls_override.unwrap_or(default_tls);
    let target = GrpcTarget::new(address, tls, skip_verify)?;

    // --- 4. Auth materialize (nearest active config already picked above) ---
    let picked_auth = picked.clone();
    let (auth, invalidate_oauth) = match picked {
        None => (None, None),
        Some(SavedAuthConfig::None) => (None, None), // unreachable via pick
        Some(SavedAuthConfig::EnvVar(c)) => (Some(materialize_env_var(&c)?), None),
        Some(SavedAuthConfig::OAuth2ClientCredentials(_)) => {
            let cfg = resolved_oauth.expect("oauth picked ⇒ resolved config present");
            let creds = tokens.header_for(&cfg).await?;
            (Some(creds), Some(cfg))
        }
    };

    Ok(EffectiveRequest {
        target,
        service: request.service.clone(),
        method: request.method.clone(),
        body_json,
        metadata,
        auth,
        invalidate_oauth,
        picked_auth,
    })
}

/// Accumulates unresolved vars (deduped, encounter order) + first cycle across fields.
#[derive(Default)]
struct ResolveAcc {
    unresolved: Vec<String>,
    cycle: Option<Vec<String>>,
}

impl ResolveAcc {
    fn take(&mut self, template: &str, vars: &VariableSet<'_>) -> String {
        let report = resolve_template_with_diagnostics(template, vars);
        for v in report.unresolved_vars {
            if !self.unresolved.iter().any(|n| n == &v) {
                self.unresolved.push(v);
            }
        }
        if self.cycle.is_none() {
            self.cycle = report.cycle_chain;
        }
        report.resolved
    }

    fn into_failure(self) -> Option<CoreError> {
        if self.cycle.is_some() || !self.unresolved.is_empty() {
            Some(CoreError::ResolveFailed { unresolved: self.unresolved, cycle: self.cycle })
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{AuthCredentials, EnvVarAuthConfig, OAuth2ClientCredentialsConfig, SavedAuthConfig, StaticTokenSource, TokenSource};
    use crate::collections::ids::{CollectionId, ItemId};
    use crate::collections::MetadataRow;
    use crate::error::CoreError;
    use async_trait::async_trait;
    use indexmap::IndexMap;
    use uuid::Uuid;

    fn static_tokens(value: &str) -> StaticTokenSource {
        StaticTokenSource {
            header: AuthCredentials { header_name: "authorization".into(), header_value: value.into() },
        }
    }

    fn env(name: &str, kv: &[(&str, &str)]) -> Environment {
        Environment {
            name: name.to_string(),
            variables: kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            color: None,
        }
    }

    fn base_collection(vars: &[(&str, &str)]) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(1)),
            name: "c".into(),
            items: vec![],
            variables: vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
            links: vec![],
        }
    }

    fn base_request() -> SavedRequest {
        SavedRequest {
            id: ItemId(Uuid::from_u128(2)),
            name: "r".into(),
            address_template: "{{host}}".into(),
            service: "pkg.Svc".into(),
            method: "Do".into(),
            body_template: r#"{"id":"{{uid}}"}"#.into(),
            metadata: vec![],
            auth: SavedAuthConfig::None,
            tls_override: None,
            last_used_at: None,
            use_count: 0,
        }
    }

    fn env_var_auth(env_var: &str) -> SavedAuthConfig {
        SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: env_var.into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        })
    }

    struct FakeTokens;
    #[async_trait]
    impl TokenSource for FakeTokens {
        async fn header_for(
            &self,
            _cfg: &OAuth2ClientCredentialsConfig,
        ) -> Result<AuthCredentials, CoreError> {
            Ok(AuthCredentials { header_name: "authorization".into(), header_value: "Bearer t".into() })
        }
        fn invalidate(&self, _cfg: &OAuth2ClientCredentialsConfig) {}
    }

    fn req_with_auth(auth: SavedAuthConfig) -> SavedRequest {
        SavedRequest {
            id: ItemId(Uuid::from_u128(1)),
            name: "r".into(),
            address_template: "h:50051".into(),
            service: "pkg.Svc".into(),
            method: "Do".into(),
            body_template: "{}".into(),
            metadata: vec![],
            auth,
            tls_override: None,
            last_used_at: None,
            use_count: 0,
        }
    }

    fn oauth_template() -> SavedAuthConfig {
        SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret: "{{sec}}".into(),
            scopes: vec![],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        })
    }

    fn env_with_sec() -> Environment {
        let mut variables = IndexMap::new();
        variables.insert("sec".to_string(), "s3cr3t".to_string());
        Environment { name: "dev".into(), variables, color: None }
    }

    fn coll_with_auth(auth: SavedAuthConfig) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(9)),
            name: "C".into(),
            items: vec![],
            variables: IndexMap::new(),
            auth,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
            links: vec![],
        }
    }

    #[tokio::test]
    async fn resolves_address_and_body_env_over_collection() {
        let coll = base_collection(&[("host", "coll:1"), ("uid", "cuid")]);
        let active = env("prod", &[("host", "api:443")]);
        let mut req = base_request();
        req.metadata = vec![MetadataRow {
            key: "x-trace".into(),
            value: "{{uid}}".into(),
            enabled: true,
        }];
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert_eq!(eff.target.address, "api:443"); // env wins
        assert_eq!(eff.body_json, r#"{"id":"cuid"}"#); // collection fills uid
        assert_eq!(eff.metadata.get("x-trace"), Some(&"cuid".to_string()));
    }

    #[tokio::test]
    async fn disabled_metadata_row_is_skipped() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let mut req = base_request();
        req.metadata = vec![
            MetadataRow { key: "on".into(), value: "1".into(), enabled: true },
            MetadataRow { key: "off".into(), value: "2".into(), enabled: false },
        ];
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert_eq!(eff.metadata.get("on"), Some(&"1".to_string()));
        assert!(eff.metadata.get("off").is_none());
    }

    #[tokio::test]
    async fn resolve_failure_reports_all_unresolved_at_once() {
        let coll = base_collection(&[]); // nothing defined
        let active = env("prod", &[]);
        let mut req = base_request();
        req.address_template = "{{host}}".into();
        req.body_template = r#"{"id":"{{uid}}","x":"{{host}}"}"#.into();
        req.metadata = vec![MetadataRow { key: "k".into(), value: "{{tok}}".into(), enabled: true }];
        let tokens = static_tokens("Bearer X");
        match resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap_err() {
            CoreError::ResolveFailed { unresolved, cycle } => {
                assert_eq!(cycle, None);
                // deduped, encounter order across address, body, metadata
                assert_eq!(unresolved, vec!["host".to_string(), "uid".to_string(), "tok".to_string()]);
            }
            other => panic!("expected ResolveFailed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn resolve_failure_reports_cycle() {
        let mut coll = base_collection(&[]);
        coll.variables.insert("a".into(), "{{b}}".into());
        coll.variables.insert("b".into(), "{{a}}".into());
        let active = env("prod", &[]);
        let mut req = base_request();
        req.address_template = "{{a}}".into();
        req.body_template = "{}".into();
        let tokens = static_tokens("Bearer X");
        match resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap_err() {
            CoreError::ResolveFailed { cycle: Some(chain), .. } => {
                assert_eq!(chain.first(), chain.last());
            }
            other => panic!("expected ResolveFailed cycle, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn builtin_in_body_is_not_unresolved() {
        let coll = base_collection(&[("host", "h:1")]);
        let active = env("prod", &[]);
        let mut req = base_request();
        req.body_template = r#"{"id":"{{$guid}}"}"#.into();
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert_eq!(eff.body_json, r#"{"id":"{{$guid}}"}"#); // left literal for send-time expansion
    }

    #[tokio::test]
    async fn tls_override_beats_collection_default() {
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.default_tls = false;
        let active = env("prod", &[]);
        let mut req = base_request();
        req.tls_override = Some(true);
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert!(eff.target.tls);
    }

    #[tokio::test]
    async fn auth_nearest_some_wins_request_over_collection() {
        let var = "HANDSHAKER_TEST_AUTH_TASK5_REQ";
        std::env::set_var(var, "rtoken");
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.auth = env_var_auth("SHOULD_NOT_BE_USED");
        let mut req = base_request();
        req.auth = env_var_auth(var);
        let active = env("prod", &[]);
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer rtoken");
        std::env::remove_var(var);
    }

    #[tokio::test]
    async fn auth_falls_back_to_collection() {
        let var = "HANDSHAKER_TEST_AUTH_TASK5_COLL";
        std::env::set_var(var, "ctoken");
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.auth = env_var_auth(var);
        let req = base_request(); // no auth on request → collection's used
        let active = env("prod", &[]);
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer ctoken");
        std::env::remove_var(var);
    }

    #[tokio::test]
    async fn no_auth_config_anywhere_is_unauthenticated() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let req = base_request();
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert!(eff.auth.is_none());
    }

    #[tokio::test]
    async fn no_active_env_means_empty_env_vars() {
        // host comes from collection; no env → env map empty.
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let req = base_request();
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), None, &tokens).await.unwrap();
        assert_eq!(eff.target.address, "h:1");
        assert!(eff.auth.is_none());
    }

    #[tokio::test]
    async fn collection_auth_scoped_to_prod_is_skipped_in_other_env() {
        use crate::auth::EnvVarAuthConfig;

        std::env::set_var("HS_TEST_PROD_TOKEN", "secret");
        // Build a collection whose auth is a prod-scoped env-var Bearer config.
        let mut collection = base_collection(&[("host", "h:1"), ("uid", "u")]);
        collection.auth = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "HS_TEST_PROD_TOKEN".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec!["prod".into()],
        });
        let request = base_request(); // auth: SavedAuthConfig::None

        let dev = env("dev", &[]);
        let prod = env("prod", &[]);
        let tokens = static_tokens("Bearer X");

        // dev ⇒ gated out ⇒ no auth header.
        let eff_dev = resolve_request(&request, Some(&collection), Some(&dev), &tokens).await.unwrap();
        assert!(eff_dev.auth.is_none());
        // prod ⇒ active ⇒ header present.
        let eff_prod = resolve_request(&request, Some(&collection), Some(&prod), &tokens).await.unwrap();
        assert_eq!(eff_prod.auth.unwrap().header_value, "Bearer secret");

        std::env::remove_var("HS_TEST_PROD_TOKEN");
    }

    #[tokio::test]
    async fn resolves_unbound_draft_with_no_collection() {
        // No collection: empty collection vars, no collection auth, verify on (skip=false).
        let active = env("prod", &[("host", "api:443")]);
        let mut req = base_request();
        req.address_template = "{{host}}".into();
        req.body_template = "{}".into();
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, None, Some(&active), &tokens).await.unwrap();
        assert_eq!(eff.target.address, "api:443");
        assert!(!eff.target.skip_verify);
        assert!(eff.auth.is_none());
    }

    #[tokio::test]
    async fn oauth_config_wins_and_is_materialized_via_token_source() {
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.auth = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret: "sec".into(),
            scopes: vec![],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let active = env("prod", &[]);
        let req = base_request();
        let tokens = static_tokens("Bearer TOK");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert_eq!(eff.auth.unwrap().header_value, "Bearer TOK");
        assert!(eff.invalidate_oauth.is_some());
    }

    #[tokio::test]
    async fn oauth_fields_resolve_against_vars_before_token_source() {
        // client_secret is a {{var}} — resolved in core, so the cache key uses the value.
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u"), ("sec", "S3CRET")]);
        coll.auth = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret: "{{sec}}".into(),
            scopes: vec![],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let active = env("prod", &[]);
        let req = base_request();
        let tokens = static_tokens("Bearer TOK");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert_eq!(eff.invalidate_oauth.unwrap().client_secret, "S3CRET"); // resolved, not "{{sec}}"
    }

    #[tokio::test]
    async fn unresolved_var_in_oauth_field_is_resolve_failure() {
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.auth = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "{{missing_url}}".into(),
            client_id: "cid".into(),
            client_secret: "sec".into(),
            scopes: vec![],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let active = env("prod", &[]);
        let req = base_request();
        let tokens = static_tokens("Bearer TOK");
        match resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap_err() {
            CoreError::ResolveFailed { unresolved, .. } => {
                assert!(unresolved.contains(&"missing_url".to_string()));
            }
            other => panic!("expected ResolveFailed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn bound_draft_honors_collection_skip_tls_verify() {
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.default_tls = true;
        coll.skip_tls_verify = true;
        let active = env("prod", &[]);
        let req = base_request();
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert!(eff.target.tls);
        assert!(eff.target.skip_verify); // was hardcoded false on the old frontend Send path
    }

    #[tokio::test]
    async fn none_tls_override_inherits_collection_default_tls() {
        // The frozen-TLS bug: a saved request with tls_override=None must inherit the
        // collection's default_tls, not fall back to plaintext.
        let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        coll.default_tls = true;
        let active = env("prod", &[]);
        let mut req = base_request();
        req.tls_override = None;
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert!(eff.target.tls); // inherited from collection.default_tls
    }

    #[tokio::test]
    async fn picked_auth_is_request_config_in_template_form() {
        let req = req_with_auth(oauth_template());
        let env = env_with_sec();
        let eff = resolve_request(&req, None, Some(&env), &FakeTokens).await.unwrap();
        // Template form: client_secret stays "{{sec}}", never the resolved value.
        assert_eq!(eff.picked_auth, Some(oauth_template()));
    }

    #[tokio::test]
    async fn picked_auth_falls_back_to_collection_config() {
        let req = req_with_auth(SavedAuthConfig::None);
        let coll = coll_with_auth(oauth_template());
        let env = env_with_sec();
        let eff = resolve_request(&req, Some(&coll), Some(&env), &FakeTokens).await.unwrap();
        assert_eq!(eff.picked_auth, Some(oauth_template()));
    }

    #[tokio::test]
    async fn picked_auth_none_when_env_gate_skips_all_configs() {
        let mut auth = oauth_template();
        if let SavedAuthConfig::OAuth2ClientCredentials(c) = &mut auth {
            c.environments = vec!["prod".into()];
        }
        let req = req_with_auth(auth);
        let env = Environment { name: "dev".into(), variables: IndexMap::new(), color: None };
        let eff = resolve_request(&req, None, Some(&env), &FakeTokens).await.unwrap();
        assert_eq!(eff.picked_auth, None);
        assert!(eff.auth.is_none());
    }

    #[tokio::test]
    async fn picked_auth_none_when_unauthenticated() {
        let req = req_with_auth(SavedAuthConfig::None);
        let eff = resolve_request(&req, None, None, &FakeTokens).await.unwrap();
        assert_eq!(eff.picked_auth, None);
    }
}
