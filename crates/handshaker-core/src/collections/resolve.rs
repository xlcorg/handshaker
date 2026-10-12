//! One resolve session, two drivers. [`Resolution`] runs every `{{var}}` of a request
//! through one accumulator and hands back [`Slot`]s; only a [`Settled`] session reads
//! them or materializes auth. `resolve_request` drives it for gRPC, and
//! `http::request::prepare` for HTTP. Auth resolves request → collection (folders carry
//! none).
//!
//! Pure except for the `std::env` read inside `EnvVar` auth and the `TokenSource`
//! call for OAuth2 → fully testable via `StaticTokenSource`.

use std::collections::HashMap;

use crate::auth::{
    materialize_env_var, pick_auth_config, AuthCredentials, OAuth2ClientCredentialsConfig, SavedAuthConfig,
    TokenSource,
};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::GrpcTarget;
use crate::vars::{resolve_template_with_diagnostics, VariableSet};

use super::{Collection, EffectiveRequest, GrpcTemplate, MetadataRow};

/// A resolved text, readable once from the [`Settled`] session that issued it. Not
/// `Clone`, so no half-resolved string escapes a failed resolve.
#[derive(Debug)]
pub(crate) struct Slot(usize);

/// One resolve, protocol-neutral. `settle` is the gate: only a `Settled` can read a slot
/// or materialize auth, so a request that does not resolve never reads an env var or
/// fetches a token.
pub(crate) struct Resolution<'a> {
    vars: ResolveVars,
    acc: ResolveAcc,
    texts: Vec<String>,
    collection: Option<&'a Collection>,
    active_env: Option<&'a Environment>,
}

impl<'a> Resolution<'a> {
    /// Variables: env over collection. `None` collection = unbound draft.
    pub(crate) fn begin(collection: Option<&'a Collection>, active_env: Option<&'a Environment>) -> Self {
        Self {
            vars: variable_set(collection, active_env),
            acc: ResolveAcc::default(),
            texts: Vec::new(),
            collection,
            active_env,
        }
    }

    pub(crate) fn take(&mut self, template: &str) -> Slot {
        let resolved = self.acc.take(template, &self.vars.as_set());
        self.texts.push(resolved);
        Slot(self.texts.len() - 1)
    }

    /// Enabled rows with a non-empty key, in authored order. Keys literal, values
    /// resolved. Disabled and keyless rows are skipped before resolve, so their vars are
    /// never reported.
    pub(crate) fn rows(&mut self, rows: &[MetadataRow]) -> Vec<(String, Slot)> {
        sendable(rows).map(|row| (row.key.clone(), self.take(&row.value))).collect()
    }

    /// [`Self::rows`] with the key resolved too, for rows that become URL-encoded pairs
    /// (query params, form fields).
    pub(crate) fn pairs(&mut self, rows: &[MetadataRow]) -> Vec<(Slot, Slot)> {
        sendable(rows).map(|row| (self.take(&row.key), self.take(&row.value))).collect()
    }

    /// Request then collection, env-gated. An OAuth2 pick's token_url, client_id,
    /// client_secret and scopes resolve into this accumulator, so an unresolved one is
    /// reported alongside the request's own vars.
    pub(crate) fn pick_auth(&mut self, request_auth: &SavedAuthConfig) -> AuthPick {
        let collection_auth = self.collection.map(|c| &c.auth);
        let picked =
            pick_auth_config(request_auth, collection_auth, self.active_env.map(|e| e.name.as_str())).cloned();
        let oauth = match &picked {
            Some(SavedAuthConfig::OAuth2ClientCredentials(c)) => Some(OAuthSlots {
                token_url: self.take(&c.token_url),
                client_id: self.take(&c.client_id),
                client_secret: self.take(&c.client_secret),
                scopes: c.scopes.iter().map(|s| self.take(s)).collect(),
            }),
            _ => None,
        };
        AuthPick { picked, oauth }
    }

    /// `Err(ResolveFailed { unresolved, cycle })`, or the settled session.
    pub(crate) fn settle(self) -> Result<Settled<'a>, CoreError> {
        match self.acc.into_failure() {
            Some(err) => Err(err),
            None => Ok(Settled { texts: self.texts, collection: self.collection }),
        }
    }
}

fn sendable(rows: &[MetadataRow]) -> impl Iterator<Item = &MetadataRow> {
    rows.iter().filter(|row| row.enabled && !row.key.is_empty())
}

/// The auth pick, before materialization. Only `Settled::materialize` consumes it.
pub(crate) struct AuthPick {
    picked: Option<SavedAuthConfig>,
    oauth: Option<OAuthSlots>,
}

struct OAuthSlots {
    token_url: Slot,
    client_id: Slot,
    client_secret: Slot,
    scopes: Vec<Slot>,
}

pub(crate) struct Settled<'a> {
    texts: Vec<String>,
    collection: Option<&'a Collection>,
}

impl Settled<'_> {
    pub(crate) fn text(&mut self, slot: Slot) -> String {
        std::mem::take(&mut self.texts[slot.0])
    }

    pub(crate) fn default_tls(&self) -> bool {
        self.collection.is_some_and(|c| c.default_tls)
    }

    pub(crate) fn skip_verify(&self) -> bool {
        self.collection.is_some_and(|c| c.skip_tls_verify)
    }

    /// EnvVar reads the OS env var; OAuth2 asks `tokens` with the resolved config.
    pub(crate) async fn materialize(&mut self, pick: AuthPick, tokens: &dyn TokenSource) -> Result<CallAuth, CoreError> {
        let AuthPick { picked, oauth } = pick;
        let (header, oauth) = match (&picked, oauth) {
            (Some(SavedAuthConfig::EnvVar(c)), _) => (Some(materialize_env_var(c)?), None),
            (Some(SavedAuthConfig::OAuth2ClientCredentials(c)), Some(slots)) => {
                let cfg = OAuth2ClientCredentialsConfig {
                    token_url: self.text(slots.token_url),
                    client_id: self.text(slots.client_id),
                    client_secret: self.text(slots.client_secret),
                    scopes: slots.scopes.into_iter().map(|s| self.text(s)).collect(),
                    header_name: c.header_name.clone(),
                    prefix: c.prefix.clone(),
                    environments: c.environments.clone(),
                };
                (Some(tokens.header_for(&cfg).await?), Some(cfg))
            }
            _ => (None, None),
        };
        Ok(CallAuth { header, oauth, picked })
    }
}

/// The auth a call carries: the header to send, the resolved OAuth2 config whose cached
/// token the unauthenticated rule may drop, and the pick in **template** form for the
/// report (resolved secrets never reach it). Built only by `Settled::materialize`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CallAuth {
    header: Option<AuthCredentials>,
    oauth: Option<OAuth2ClientCredentialsConfig>,
    picked: Option<SavedAuthConfig>,
}

impl CallAuth {
    pub(crate) fn header(&self) -> Option<&AuthCredentials> {
        self.header.as_ref()
    }

    pub(crate) fn oauth(&self) -> Option<&OAuth2ClientCredentialsConfig> {
        self.oauth.as_ref()
    }

    pub(crate) fn into_picked(self) -> Option<SavedAuthConfig> {
        self.picked
    }
}

/// Resolve one request. `collection` is `None` for an unbound draft (no collection
/// vars, no collection auth, TLS defaults `false`/`false`). `active_env` is `None`
/// for "No environment". `tokens` materializes an OAuth2 header if the picked auth
/// config is OAuth2 (real `Oauth2TokenProvider` in production, `StaticTokenSource`
/// in tests).
pub(crate) async fn resolve_request(
    request: &GrpcTemplate,
    collection: Option<&Collection>,
    active_env: Option<&Environment>,
    tokens: &dyn TokenSource,
) -> Result<EffectiveRequest, CoreError> {
    resolve_request_scoped(request, collection, active_env, tokens, true).await
}

/// [`resolve_request`] minus the body — **Open** of a client-streaming / bidi call, where
/// nothing is sent at Open and the body is resolved per **Send message** instead
/// ([`resolve_body`]). Address, metadata and auth resolve and materialize exactly as in
/// `resolve_request`; `body_json` comes back empty and is never sent.
pub(crate) async fn resolve_request_without_body(
    request: &GrpcTemplate,
    collection: Option<&Collection>,
    active_env: Option<&Environment>,
    tokens: &dyn TokenSource,
) -> Result<EffectiveRequest, CoreError> {
    resolve_request_scoped(request, collection, active_env, tokens, false).await
}

async fn resolve_request_scoped(
    request: &GrpcTemplate,
    collection: Option<&Collection>,
    active_env: Option<&Environment>,
    tokens: &dyn TokenSource,
    with_body: bool,
) -> Result<EffectiveRequest, CoreError> {
    let mut r = Resolution::begin(collection, active_env);
    let address = r.take(&request.address_template);
    let body = with_body.then(|| r.take(&request.body_template));
    let metadata = r.rows(&request.metadata);
    let pick = r.pick_auth(&request.auth);
    let mut s = r.settle()?;

    let tls = request.tls_override.unwrap_or(s.default_tls());
    let target = GrpcTarget::new(s.text(address), tls, s.skip_verify())?;
    let body_json = body.map(|b| s.text(b)).unwrap_or_default();
    // Last enabled row wins on a duplicate key.
    let metadata: HashMap<String, String> = metadata.into_iter().map(|(k, v)| (k, s.text(v))).collect();
    let auth = s.materialize(pick, tokens).await?;

    Ok(EffectiveRequest {
        target,
        service: request.service.clone(),
        method: request.method.clone(),
        body_json,
        metadata,
        auth,
    })
}

/// Body-only resolve for a **Send message** on an open stream call: the body template
/// against the env/collection vars of *this* moment, through the same accumulator as
/// [`resolve_request`] (every unresolved `{{var}}` reported at once, same
/// `ResolveFailed` diagnosis). No auth pick and no materialization — those happened at
/// Open and are not repeated per message.
pub(crate) fn resolve_body(
    body_template: &str,
    collection: Option<&Collection>,
    active_env: Option<&Environment>,
) -> Result<String, CoreError> {
    let mut r = Resolution::begin(collection, active_env);
    let body = r.take(body_template);
    Ok(r.settle()?.text(body))
}

/// The `{{var}}` sources of one resolve — env over collection — as owned maps.
/// `VariableSet` borrows `&HashMap`s (resolution is order-agnostic) while the stored maps
/// are `IndexMap`, so this is the one place they are converted; the maps are tiny.
struct ResolveVars {
    env: HashMap<String, String>,
    collection: HashMap<String, String>,
}

impl ResolveVars {
    fn as_set(&self) -> VariableSet<'_> {
        VariableSet { env: &self.env, collection: &self.collection }
    }
}

/// Collect the variables a resolve runs against: `None` collection = an unbound draft
/// (no collection vars), `None` env = "No environment".
fn variable_set(collection: Option<&Collection>, active_env: Option<&Environment>) -> ResolveVars {
    ResolveVars {
        env: active_env
            .map(|e| e.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default(),
        collection: collection
            .map(|c| c.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default(),
    }
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
    use crate::collections::ids::CollectionId;
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

    fn base_request() -> GrpcTemplate {
        GrpcTemplate {
            address_template: "{{host}}".into(),
            service: "pkg.Svc".into(),
            method: "Do".into(),
            body_template: r#"{"id":"{{uid}}"}"#.into(),
            metadata: vec![],
            auth: SavedAuthConfig::None,
            tls_override: None,
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

    fn req_with_auth(auth: SavedAuthConfig) -> GrpcTemplate {
        GrpcTemplate {
            address_template: "h:50051".into(),
            service: "pkg.Svc".into(),
            method: "Do".into(),
            body_template: "{}".into(),
            metadata: vec![],
            auth,
            tls_override: None,
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
    async fn disabled_and_keyless_metadata_rows_are_skipped() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let mut req = base_request();
        req.metadata = vec![
            MetadataRow { key: "on".into(), value: "1".into(), enabled: true },
            MetadataRow { key: "off".into(), value: "2".into(), enabled: false },
            MetadataRow { key: "".into(), value: "{{missing}}".into(), enabled: true },
        ];
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert_eq!(eff.metadata, HashMap::from([("on".to_string(), "1".to_string())]));
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
        assert_eq!(eff.auth.header().unwrap().header_value, "Bearer rtoken");
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
        assert_eq!(eff.auth.header().unwrap().header_value, "Bearer ctoken");
        std::env::remove_var(var);
    }

    #[tokio::test]
    async fn no_auth_config_anywhere_is_unauthenticated() {
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let active = env("prod", &[]);
        let req = base_request();
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
        assert!(eff.auth.header().is_none());
    }

    #[tokio::test]
    async fn no_active_env_means_empty_env_vars() {
        // host comes from collection; no env → env map empty.
        let coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
        let req = base_request();
        let tokens = static_tokens("Bearer X");
        let eff = resolve_request(&req, Some(&coll), None, &tokens).await.unwrap();
        assert_eq!(eff.target.address, "h:1");
        assert!(eff.auth.header().is_none());
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
        assert!(eff_dev.auth.header().is_none());
        // prod ⇒ active ⇒ header present.
        let eff_prod = resolve_request(&request, Some(&collection), Some(&prod), &tokens).await.unwrap();
        assert_eq!(eff_prod.auth.header().unwrap().header_value, "Bearer secret");

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
        assert!(eff.auth.header().is_none());
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
        assert_eq!(eff.auth.header().unwrap().header_value, "Bearer TOK");
        assert!(eff.auth.oauth().is_some());
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
        assert_eq!(eff.auth.oauth().unwrap().client_secret, "S3CRET"); // resolved, not "{{sec}}"
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
        assert_eq!(eff.auth.into_picked(), Some(oauth_template()));
    }

    #[tokio::test]
    async fn picked_auth_falls_back_to_collection_config() {
        let req = req_with_auth(SavedAuthConfig::None);
        let coll = coll_with_auth(oauth_template());
        let env = env_with_sec();
        let eff = resolve_request(&req, Some(&coll), Some(&env), &FakeTokens).await.unwrap();
        assert_eq!(eff.auth.into_picked(), Some(oauth_template()));
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
        assert!(eff.auth.header().is_none());
        assert_eq!(eff.auth.into_picked(), None);
    }

    #[tokio::test]
    async fn picked_auth_none_when_unauthenticated() {
        let req = req_with_auth(SavedAuthConfig::None);
        let eff = resolve_request(&req, None, None, &FakeTokens).await.unwrap();
        assert_eq!(eff.auth.into_picked(), None);
    }
}
