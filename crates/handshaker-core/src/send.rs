//! The Send spine — one home for "request/draft + collection + env → executed call +
//! send report" (extends ADR-0001: the whole spine, not just resolve, lives in core).
//!
//! Order inside [`Sender::send`]: resolve pipeline → builtin expansion (body + user
//! metadata VALUES only) → inject materialized auth header → activate via contract
//! cache → invoke → on gRPC status 16 with an OAuth2 pick, invalidate that token.
//! Expansion runs BEFORE header injection, so a materialized auth header is a fact,
//! not a template — it is never expanded. Cancel and timeout are the calling layer's
//! concern, not part of the spine.

use std::sync::Arc;

use crate::auth::{SavedAuthConfig, TokenSource};
use crate::collections::{Collection, SavedRequest};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::invoke::{CallOptions, UnaryOutcome};
use crate::grpc::{ContractCache, GrpcTransport};
use crate::vars::builtins::BuiltinGenerator;

/// gRPC status 16 — the only status that triggers token-cache invalidation.
const GRPC_UNAUTHENTICATED: i32 = 16;

/// Outcome of one Send plus the facts the pipeline used: the auth config that won
/// the pick in **template** form (secrets never materialized into the report) and
/// the TLS mode actually used.
#[derive(Debug, Clone)]
pub struct SendReport {
    pub outcome: UnaryOutcome,
    /// The winning auth config, as stored (templates intact); `None` = unauthenticated.
    pub auth_used: Option<SavedAuthConfig>,
    /// TLS actually used for the call (after override/collection-default resolution).
    pub tls_used: bool,
}

/// The Send spine behind one seam. Owns its four adapters — transport, token source,
/// contract cache, builtin generator — so every composition invariant is testable
/// with in-process fakes.
pub struct Sender {
    transport: Arc<dyn GrpcTransport>,
    tokens: Arc<dyn TokenSource>,
    cache: Arc<dyn ContractCache>,
    builtins: Arc<dyn BuiltinGenerator + Send + Sync>,
}

impl Sender {
    pub fn new(
        transport: Arc<dyn GrpcTransport>,
        tokens: Arc<dyn TokenSource>,
        cache: Arc<dyn ContractCache>,
        builtins: Arc<dyn BuiltinGenerator + Send + Sync>,
    ) -> Self {
        Self { transport, tokens, cache, builtins }
    }

    /// Run the full spine for one request. A resolve failure returns the whole
    /// diagnosis before any network or OS-environment side effect; a non-OK gRPC
    /// status is a value in the report (`outcome.status_code != 0`), not an error.
    pub async fn send(
        &self,
        request: &SavedRequest,
        collection: Option<&Collection>,
        active_env: Option<&Environment>,
        opts: CallOptions,
    ) -> Result<SendReport, CoreError> {
        let eff = crate::collections::resolve_request(
            request,
            collection,
            active_env,
            self.tokens.as_ref(),
        )
        .await?;

        let auth_used = eff.picked_auth;
        let tls_used = eff.target.tls;

        // Builtin expansion covers user-authored template fields only: the body and
        // metadata VALUES. It runs before auth-header injection (below), so the
        // materialized header can never be expanded.
        let generator = self.builtins.as_ref();
        let body_json = crate::vars::builtins::expand_builtins(&eff.body_json, generator);
        let mut metadata = eff.metadata;
        for value in metadata.values_mut() {
            *value = crate::vars::builtins::expand_builtins(value, generator);
        }

        // Inject the materialized auth header AFTER expansion: the header is a fact
        // as issued by the IdP/OS env — `{{$...}}`-looking text in it stays literal.
        if let Some(creds) = &eff.auth {
            metadata.insert(creds.header_name.clone(), creds.header_value.clone());
        }

        let conn =
            crate::grpc::activate(eff.target, self.transport.clone(), self.cache.as_ref()).await?;
        let outcome = crate::grpc::invoke_unary(
            &conn,
            &eff.service,
            &eff.method,
            &body_json,
            metadata,
            opts,
        )
        .await?;

        // On UNAUTHENTICATED drop the cached token of the config that materialized
        // this send's header — the next Send fetches fresh. No auto-retry (design choice).
        if outcome.status_code == GRPC_UNAUTHENTICATED {
            if let Some(cfg) = &eff.invalidate_oauth {
                self.tokens.invalidate(cfg);
            }
        }

        Ok(SendReport { outcome, auth_used, tls_used })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use indexmap::IndexMap;
    use uuid::Uuid;

    use super::*;
    use crate::auth::{
        AuthCredentials, OAuth2ClientCredentialsConfig, SavedAuthConfig, StaticTokenSource,
    };
    use crate::collections::ids::ItemId;
    use crate::grpc::testing::{fixture_cached_contract, FakeTransport};
    use crate::grpc::{ContractKey, InMemoryContractCache};

    /// Fixture request against the `test.Echo / Send` schema of `fixture_pool()`.
    fn fixture_request(tls: bool) -> SavedRequest {
        SavedRequest {
            id: ItemId(Uuid::from_u128(1)),
            name: "r".into(),
            address_template: "127.0.0.1:1".into(),
            service: "test.Echo".into(),
            method: "Send".into(),
            body_template: r#"{"id":"hi"}"#.into(),
            metadata: vec![],
            auth: SavedAuthConfig::None,
            tls_override: Some(tls),
            last_used_at: None,
            use_count: 0,
        }
    }

    /// Contract cache pre-seeded for the fixture target — `activate` skips reflection.
    fn seeded_cache(tls: bool) -> Arc<InMemoryContractCache> {
        let cache = Arc::new(InMemoryContractCache::new());
        let key = ContractKey { address: "127.0.0.1:1".into(), tls };
        cache.put(key, fixture_cached_contract());
        cache
    }

    fn unlimited_opts() -> CallOptions {
        CallOptions { max_message_bytes: usize::MAX }
    }

    fn ok_outcome() -> UnaryOutcome {
        UnaryOutcome {
            status_code: 0,
            status_message: "OK".into(),
            response_json: Some(r#"{"id":"echo"}"#.into()),
            trailing_metadata: HashMap::new(),
            status_details: Vec::new(),
            elapsed_ms: 7,
        }
    }

    fn unauthenticated_outcome() -> UnaryOutcome {
        UnaryOutcome {
            status_code: 16,
            status_message: "UNAUTHENTICATED".into(),
            response_json: None,
            trailing_metadata: HashMap::new(),
            status_details: Vec::new(),
            elapsed_ms: 3,
        }
    }

    /// Token source that hands out a fixed header and records every `invalidate` call
    /// with the exact config it was given.
    struct RecordingTokens {
        header: AuthCredentials,
        invalidated: std::sync::Mutex<Vec<OAuth2ClientCredentialsConfig>>,
    }
    impl RecordingTokens {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                header: AuthCredentials {
                    header_name: "authorization".into(),
                    header_value: "Bearer tok".into(),
                },
                invalidated: std::sync::Mutex::new(Vec::new()),
            })
        }
    }
    #[async_trait::async_trait]
    impl crate::auth::TokenSource for RecordingTokens {
        async fn header_for(
            &self,
            _cfg: &OAuth2ClientCredentialsConfig,
        ) -> Result<AuthCredentials, CoreError> {
            Ok(self.header.clone())
        }
        fn invalidate(&self, cfg: &OAuth2ClientCredentialsConfig) {
            self.invalidated.lock().unwrap().push(cfg.clone());
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

    fn static_tokens(value: &str) -> Arc<StaticTokenSource> {
        Arc::new(StaticTokenSource {
            header: AuthCredentials {
                header_name: "authorization".into(),
                header_value: value.into(),
            },
        })
    }

    /// Generator with no builtins — for tests where expansion is irrelevant.
    struct NoBuiltins;
    impl BuiltinGenerator for NoBuiltins {
        fn generate(&self, _name: &str) -> Option<String> {
            None
        }
    }

    /// Deterministic `$guid` generator: `G0`, `G1`, … — a fresh value per call, so
    /// per-occurrence freshness shows up as distinct values.
    struct SeqGuids(std::sync::atomic::AtomicU32);
    impl SeqGuids {
        fn new() -> Arc<Self> {
            Arc::new(Self(std::sync::atomic::AtomicU32::new(0)))
        }
    }
    impl BuiltinGenerator for SeqGuids {
        fn generate(&self, name: &str) -> Option<String> {
            if name != "$guid" {
                return None;
            }
            let i = self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Some(format!("G{i}"))
        }
    }

    #[tokio::test]
    async fn report_carries_outcome_auth_in_template_form_and_tls_used() {
        let mut request = fixture_request(true);
        request.auth = oauth_template();
        let env = env_with_sec();
        let transport = FakeTransport::with_outcome(Ok(ok_outcome()));
        let cache = seeded_cache(true);
        let sender = Sender::new(
            transport.clone(),
            static_tokens("Bearer tok"),
            cache,
            Arc::new(NoBuiltins),
        );

        let report = sender
            .send(&request, None, Some(&env), unlimited_opts())
            .await
            .expect("send");

        assert_eq!(report.outcome.status_code, 0);
        assert_eq!(report.outcome.response_json.as_deref(), Some(r#"{"id":"echo"}"#));
        // Template form: the winning config as stored — `{{sec}}` intact, no secrets.
        assert_eq!(report.auth_used, Some(oauth_template()));
        assert!(report.tls_used);
    }

    #[tokio::test]
    async fn resolve_failure_returns_full_diagnosis_and_never_touches_transport() {
        let mut request = fixture_request(false);
        request.address_template = "{{host}}".into();
        request.body_template = r#"{"id":"{{uid}}"}"#.into();
        let transport = FakeTransport::with_outcome(Ok(ok_outcome()));
        let sender = Sender::new(
            transport.clone(),
            static_tokens("Bearer tok"),
            seeded_cache(false),
            Arc::new(NoBuiltins),
        );

        let err = sender
            .send(&request, None, None, unlimited_opts())
            .await
            .expect_err("unresolved vars must fail the send");

        match err {
            CoreError::ResolveFailed { unresolved, cycle } => {
                assert_eq!(unresolved, vec!["host", "uid"]); // ALL vars, encounter order
                assert_eq!(cycle, None);
            }
            other => panic!("expected ResolveFailed, got {other:?}"),
        }
        let channel_calls = transport.channel_calls.load(std::sync::atomic::Ordering::Relaxed);
        assert_eq!(channel_calls, 0, "no channel opened on resolve failure");
        assert!(transport.last_path.lock().await.is_none(), "no invoke on resolve failure");
    }

    #[tokio::test]
    async fn builtins_expand_fresh_per_occurrence_in_body_and_metadata_values() {
        let mut request = fixture_request(false);
        request.body_template = r#"{"id":"{{$guid}}-{{$guid}}"}"#.into();
        request.metadata = vec![crate::collections::MetadataRow {
            key: "x-trace".into(),
            value: "{{$guid}}".into(),
            enabled: true,
        }];
        let transport = FakeTransport::with_outcome(Ok(ok_outcome()));
        let sender = Sender::new(
            transport.clone(),
            static_tokens("Bearer tok"),
            seeded_cache(false),
            SeqGuids::new(),
        );

        sender.send(&request, None, None, unlimited_opts()).await.expect("send");

        let request_sent = transport.last_request.lock().await.clone().expect("request captured");
        let id_field = request_sent.get_field_by_name("id").expect("id field");
        let id = id_field.as_str().expect("string field").to_string();
        let (a, b) = id.split_once('-').expect("two occurrences in body");
        let metadata_sent = transport.last_metadata.lock().await.clone().expect("metadata captured");
        let trace = metadata_sent.get("x-trace").expect("metadata value sent").clone();

        for v in [a, b, trace.as_str()] {
            assert!(v.starts_with('G'), "expanded, not literal: {v}");
        }
        assert_ne!(a, b, "each body occurrence gets a fresh value");
        assert_ne!(trace, a);
        assert_ne!(trace, b, "metadata value is fresh too");

        // Freshness is per SEND, not per request: the same request sent again gets
        // new values for every occurrence.
        *transport.outcome.lock().await = Some(Ok(ok_outcome()));
        sender.send(&request, None, None, unlimited_opts()).await.expect("second send");
        let second_request = transport.last_request.lock().await.clone().expect("request captured");
        let second_id_field = second_request.get_field_by_name("id").expect("id field");
        let second_id = second_id_field.as_str().expect("string field").to_string();
        let second_metadata =
            transport.last_metadata.lock().await.clone().expect("metadata captured");
        let second_trace = second_metadata.get("x-trace").expect("metadata value sent");
        assert_ne!(second_id, id, "body values are fresh on the next send");
        assert_ne!(second_trace, &trace, "metadata values are fresh on the next send");
    }

    #[tokio::test]
    async fn materialized_auth_header_goes_out_literally_never_expanded() {
        let mut request = fixture_request(false);
        request.auth = oauth_template();
        request.metadata = vec![crate::collections::MetadataRow {
            key: "x-trace".into(),
            value: "{{$guid}}".into(),
            enabled: true,
        }];
        let env = env_with_sec();
        let transport = FakeTransport::with_outcome(Ok(ok_outcome()));
        // A real token that happens to contain `{{$...}}`-looking text — a fact, not a template.
        let sender = Sender::new(
            transport.clone(),
            static_tokens("Bearer {{$guid}}"),
            seeded_cache(false),
            SeqGuids::new(),
        );

        sender.send(&request, None, Some(&env), unlimited_opts()).await.expect("send");

        let metadata_sent = transport.last_metadata.lock().await.clone().expect("metadata captured");
        let auth_header = metadata_sent.get("authorization").expect("auth header injected");
        assert_eq!(auth_header, "Bearer {{$guid}}", "header is literal, not expanded");
        let trace = metadata_sent.get("x-trace").expect("user metadata sent");
        assert_eq!(trace, "G0", "user metadata value IS expanded");
    }

    #[tokio::test]
    async fn status_16_with_oauth2_pick_invalidates_exactly_the_resolved_config() {
        let mut request = fixture_request(false);
        request.auth = oauth_template();
        let env = env_with_sec();
        let transport = FakeTransport::with_outcome(Ok(unauthenticated_outcome()));
        let tokens = RecordingTokens::new();
        let sender = Sender::new(
            transport,
            tokens.clone(),
            seeded_cache(false),
            Arc::new(NoBuiltins),
        );

        let report = sender.send(&request, None, Some(&env), unlimited_opts()).await.expect("send");
        assert_eq!(report.outcome.status_code, 16, "non-OK status is a value, not an error");

        let invalidated = tokens.invalidated.lock().unwrap().clone();
        let expected_resolved = OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret: "s3cr3t".into(), // `{{sec}}` resolved — invalidation targets THIS token
            scopes: vec![],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        };
        assert_eq!(invalidated, vec![expected_resolved]);
    }

    #[tokio::test]
    async fn non_16_outcome_does_not_invalidate() {
        let mut request = fixture_request(false);
        request.auth = oauth_template();
        let env = env_with_sec();
        let transport = FakeTransport::with_outcome(Ok(ok_outcome()));
        let tokens = RecordingTokens::new();
        let sender = Sender::new(
            transport,
            tokens.clone(),
            seeded_cache(false),
            Arc::new(NoBuiltins),
        );

        sender.send(&request, None, Some(&env), unlimited_opts()).await.expect("send");

        assert!(tokens.invalidated.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn status_16_with_non_oauth2_pick_does_not_invalidate() {
        let var = "HANDSHAKER_TEST_SEND_ENVVAR_AUTH";
        std::env::set_var(var, "s3cr3t");
        let mut request = fixture_request(false);
        request.auth = SavedAuthConfig::EnvVar(crate::auth::EnvVarAuthConfig {
            env_var: var.into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        let transport = FakeTransport::with_outcome(Ok(unauthenticated_outcome()));
        let tokens = RecordingTokens::new();
        let sender = Sender::new(
            transport,
            tokens.clone(),
            seeded_cache(false),
            Arc::new(NoBuiltins),
        );

        let report = sender.send(&request, None, None, unlimited_opts()).await.expect("send");
        std::env::remove_var(var);

        assert_eq!(report.outcome.status_code, 16);
        assert!(tokens.invalidated.lock().unwrap().is_empty());
    }
}
