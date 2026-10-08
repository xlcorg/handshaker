//! The Send spine — one home for "request/draft + collection + env → executed call +
//! send report" (extends ADR-0001: the whole spine, not just resolve, lives in core).
//!
//! Order inside [`Sender::send`]: resolve pipeline → builtin expansion (body + user
//! metadata VALUES only) → inject materialized auth header → activate via contract
//! cache → invoke → on gRPC status 16 with an OAuth2 pick, refresh and retry once.
//! Expansion runs BEFORE header injection, so a materialized auth header is a fact,
//! not a template — it is never expanded. Cancel and timeout are the calling layer's
//! concern, not part of the spine.
//!
//! [`Sender::open_stream`] shares the prefix (resolve → builtins → auth → activate) with
//! `send` through [`Sender::prepare`] and then hands the call to the **Stream call**
//! actor (`crate::stream`, ADR-0002). Only the stream path honors
//! `CallOptions::phase_timeout` — unary deadlines stay the calling layer's race.

use std::collections::HashMap;
use std::sync::Arc;

use crate::auth::{OAuth2ClientCredentialsConfig, SavedAuthConfig, TokenSource};
use crate::collections::{Collection, SavedRequest};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::invoke::{CallOptions, UnaryOutcome};
use crate::grpc::{ContractCache, GrpcConnection, GrpcTransport};
use crate::stream::{MethodKind, StreamCall, StreamEvents};
use crate::vars::builtins::BuiltinGenerator;

/// gRPC status 16 — the only status that triggers token-cache invalidation.
pub(crate) const GRPC_UNAUTHENTICATED: i32 = 16;

/// **Rule 16**, in one place for both spines: on `UNAUTHENTICATED` drop the cached token
/// of the OAuth2 config that materialized this call's header (the *resolved* config, so
/// the next token lookup fetches fresh). Any other status, or a non-OAuth2 pick, is a no-op.
pub(crate) fn invalidate_on_unauthenticated(
    tokens: &dyn TokenSource,
    status_code: i32,
    resolved_oauth: Option<&OAuth2ClientCredentialsConfig>,
) {
    if status_code != GRPC_UNAUTHENTICATED {
        return;
    }
    if let Some(cfg) = resolved_oauth {
        tokens.invalidate(cfg);
    }
}

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
        // Unary keeps its deadline in the calling layer's race — no phase timer here.
        let p = self.prepare(request, collection, active_env, None, MethodKind::Unary).await?;

        let mut outcome = crate::grpc::invoke_unary(
            &p.conn,
            &p.service,
            &p.method,
            &p.body_json,
            p.metadata.clone(),
            opts,
        )
        .await?;

        invalidate_on_unauthenticated(
            self.tokens.as_ref(),
            outcome.status_code,
            p.invalidate_oauth.as_ref(),
        );

        if outcome.status_code == GRPC_UNAUTHENTICATED {
            if let Some(cfg) = p.invalidate_oauth.as_ref() {
                let refreshed = self.tokens.header_for(cfg).await?;
                let mut metadata = p.metadata;
                metadata.remove(&cfg.header_name);
                metadata.insert(refreshed.header_name, refreshed.header_value);
                outcome = crate::grpc::invoke_unary(
                    &p.conn,
                    &p.service,
                    &p.method,
                    &p.body_json,
                    metadata,
                    opts,
                )
                .await?;
                invalidate_on_unauthenticated(self.tokens.as_ref(), outcome.status_code, Some(cfg));
            }
        }

        Ok(SendReport {
            outcome,
            auth_used: p.auth_used,
            tls_used: p.tls_used,
        })
    }

    /// **Open** a stream call: the shared prefix (phase-1 deadline around activate),
    /// then — server-streaming only — the body is encoded once, and the call is handed to
    /// the stream actor. Resolves at `Opened` ("return-at-Opened", ADR-0002): `Ok(handle)`
    /// means the call is in flight and every later outcome arrives on `events`; `Err`
    /// covers pre-Open faults only (resolve, descriptor lookup, body, activate, deadline).
    ///
    /// `kind` is the kind the UI chose. The **kind gate** compares it with the descriptor's
    /// kind before the call reaches the wire (the channel may already be open and reflection
    /// may have run) — any difference is
    /// `MethodKindMismatch { expected: kind, actual }` (a stale UI can never truncate a
    /// stream through the wrong shape). On agreement the kind selects the outbound shape:
    /// server-streaming sends the body as its single outbound message and half-closes at
    /// Open; client / bidi send nothing at Open — the body is not even resolved (no
    /// `{{var}}` diagnosis, no built-in consumed) until `StreamCall::send_message`, which
    /// with `half_close` drives the channel-backed outbound. `Unary` is refused as a
    /// mismatch too (the stream path has no unary shape; `send` is the path).
    pub async fn open_stream(
        &self,
        request: &SavedRequest,
        collection: Option<&Collection>,
        active_env: Option<&Environment>,
        kind: MethodKind,
        opts: CallOptions,
        events: StreamEvents,
    ) -> Result<StreamCall, CoreError> {
        let p = self.prepare(request, collection, active_env, opts.phase_timeout, kind).await?;

        // The kind gate (shared lookup with the unary spine), then the shape.
        let m = crate::grpc::invoke::find_method_of_kind(&p.conn.pools, &p.service, &p.method, kind)?;
        let input_desc = m.input();
        let output_desc = m.output();
        // The (now descriptor-agreed) kind decides only what feeds the wire: server-streaming
        // sends the body as its single outbound message and is half-closed at once;
        // client/bidi open with an empty channel-backed outbound (Send message / Half-close
        // drive it).
        let (outbound, outbound_tx): (crate::grpc::transport::OutboundStream, _) = match kind {
            MethodKind::Server => {
                let (_, bytes) = encode_body(&input_desc, &p.body_json)?;
                (Box::pin(tokio_stream::once(bytes)), None)
            }
            MethodKind::Client | MethodKind::Bidi => {
                let (tx, rx) = tokio::sync::mpsc::channel(crate::stream::OUTBOUND_CAPACITY);
                (Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx)), Some(tx))
            }
            MethodKind::Unary => {
                // Agreed with the descriptor, yet the stream path cannot serve it: point
                // the caller at the unary path through the same structured error.
                return Err(CoreError::MethodKindMismatch {
                    service: p.service,
                    method: p.method,
                    expected: MethodKind::Unary,
                    actual: MethodKind::Unary,
                });
            }
        };

        let spec = crate::stream::StreamCallSpec {
            transport: self.transport.clone(),
            channel: p.conn.channel.clone(),
            method_path: format!("/{}/{}", p.service, p.method),
            input_desc,
            output_desc,
            outbound,
            outbound_tx,
            metadata: p.metadata,
            opts,
            kind,
            tokens: self.tokens.clone(),
            invalidate_oauth: p.invalidate_oauth,
            builtins: self.builtins.clone(),
            events,
        };
        Ok(crate::stream::spawn_stream_call(spec, p.auth_used, p.tls_used))
    }

    /// The shared prefix of both spines: resolve pipeline → builtin expansion → auth
    /// header injection → activate. `phase_timeout` bounds activate only (phase 1 of a
    /// stream call); expiry → `DeadlineExceeded`. For a client-streaming / bidi `kind`
    /// the body is left alone (nothing is sent at Open — it is resolved per Send message
    /// by [`expand_body`]); every other kind resolves and expands it here, so an
    /// unresolved body var joins the address/metadata diagnosis before any network use.
    async fn prepare(
        &self,
        request: &SavedRequest,
        collection: Option<&Collection>,
        active_env: Option<&Environment>,
        phase_timeout: Option<std::time::Duration>,
        kind: MethodKind,
    ) -> Result<Prepared, CoreError> {
        let two_way = matches!(kind, MethodKind::Client | MethodKind::Bidi);
        let tokens = self.tokens.as_ref();
        let eff = if two_way {
            crate::collections::resolve_request_without_body(request, collection, active_env, tokens).await?
        } else {
            crate::collections::resolve_request(request, collection, active_env, tokens).await?
        };

        let auth_used = eff.picked_auth;
        let tls_used = eff.target.tls;

        // Builtin expansion covers user-authored template fields only: the body and
        // metadata VALUES. It runs before auth-header injection (below), so the
        // materialized header can never be expanded. A two-way body is empty here and
        // stays so — no built-in of it is consumed at Open.
        let generator = self.builtins.as_ref();
        let body_json = if two_way {
            String::new()
        } else {
            crate::vars::builtins::expand_builtins(&eff.body_json, generator)
        };
        let mut metadata = eff.metadata;
        for value in metadata.values_mut() {
            *value = crate::vars::builtins::expand_builtins(value, generator);
        }

        // Inject the materialized auth header AFTER expansion: the header is a fact
        // as issued by the IdP/OS env — `{{$...}}`-looking text in it stays literal.
        if let Some(creds) = &eff.auth {
            metadata.insert(creds.header_name.clone(), creds.header_value.clone());
        }

        let conn = crate::stream::with_phase_timeout(
            phase_timeout,
            crate::grpc::activate(eff.target, self.transport.clone(), self.cache.as_ref()),
        )
        .await?;

        Ok(Prepared {
            conn,
            service: eff.service,
            method: eff.method,
            body_json,
            metadata,
            auth_used,
            tls_used,
            invalidate_oauth: eff.invalidate_oauth,
        })
    }
}

/// **Template → wire-ready JSON**, the per-message half of the body step: `{{var}}`
/// resolve against the collection/env of this moment (the whole `ResolveFailed`
/// diagnosis, as at Open) then fresh built-ins. Used by **Send message**; Open of a unary /
/// server-streaming call runs the same two steps inside [`Sender::prepare`], where the
/// body shares one accumulator with address and metadata.
pub(crate) fn expand_body(
    body_template: &str,
    collection: Option<&Collection>,
    active_env: Option<&Environment>,
    builtins: &dyn BuiltinGenerator,
) -> Result<String, CoreError> {
    let body_json = crate::collections::resolve_body(body_template, collection, active_env)?;
    Ok(crate::vars::builtins::expand_builtins(&body_json, builtins))
}

/// **Wire-ready JSON → encoded message**, the one encode step of both stream shapes:
/// parse with the method's input type (`EncodeRequest` on a bad body), encode to the raw
/// bytes the transport and the Stream store take. Server-streaming runs it once at Open,
/// Send message per message.
pub(crate) fn encode_body(
    input_desc: &prost_reflect::MessageDescriptor,
    body_json: &str,
) -> Result<(prost_reflect::DynamicMessage, bytes::Bytes), CoreError> {
    use prost::Message as _;
    let msg = crate::grpc::invoke::parse_request_json(input_desc.clone(), body_json)?;
    let bytes = bytes::Bytes::from(msg.encode_to_vec());
    Ok((msg, bytes))
}

/// Output of the shared prefix: an activated connection plus the wire-ready request
/// facts (expanded body — empty for a two-way kind — and metadata with the auth header
/// injected).
struct Prepared {
    conn: GrpcConnection,
    service: String,
    method: String,
    body_json: String,
    metadata: HashMap<String, String>,
    auth_used: Option<SavedAuthConfig>,
    tls_used: bool,
    invalidate_oauth: Option<OAuth2ClientCredentialsConfig>,
}

#[cfg(test)]
pub(crate) mod tests {
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
    pub(crate) fn fixture_request(tls: bool) -> SavedRequest {
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
    pub(crate) fn seeded_cache(tls: bool) -> Arc<InMemoryContractCache> {
        let cache = Arc::new(InMemoryContractCache::new());
        let key = ContractKey { address: "127.0.0.1:1".into(), tls };
        cache.put(key, fixture_cached_contract());
        cache
    }

    fn unlimited_opts() -> CallOptions {
        CallOptions { max_message_bytes: usize::MAX, phase_timeout: None }
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
    pub(crate) struct RecordingTokens {
        header: AuthCredentials,
        pub(crate) invalidated: std::sync::Mutex<Vec<OAuth2ClientCredentialsConfig>>,
        retry_outcome: Option<(Arc<FakeTransport>, UnaryOutcome)>,
        /// How many times a header was materialized (`header_for`).
        pub(crate) header_calls: std::sync::atomic::AtomicU32,
    }
    impl RecordingTokens {
        pub(crate) fn new() -> Arc<Self> {
            Arc::new(Self {
                header: AuthCredentials {
                    header_name: "authorization".into(),
                    header_value: "Bearer tok".into(),
                },
                invalidated: std::sync::Mutex::new(Vec::new()),
                retry_outcome: None,
                header_calls: std::sync::atomic::AtomicU32::new(0),
            })
        }

        fn with_retry_outcome(transport: Arc<FakeTransport>, outcome: UnaryOutcome) -> Arc<Self> {
            let mut tokens = Self::new();
            Arc::get_mut(&mut tokens).unwrap().retry_outcome = Some((transport, outcome));
            tokens
        }
    }
    #[async_trait::async_trait]
    impl crate::auth::TokenSource for RecordingTokens {
        async fn header_for(
            &self,
            _cfg: &OAuth2ClientCredentialsConfig,
        ) -> Result<AuthCredentials, CoreError> {
            self.header_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(self.header.clone())
        }
        fn invalidate(&self, cfg: &OAuth2ClientCredentialsConfig) {
            self.invalidated.lock().unwrap().push(cfg.clone());
            if let Some((transport, outcome)) = &self.retry_outcome {
                *transport.outcome.try_lock().unwrap() = Some(Ok(outcome.clone()));
            }
        }
    }

    struct RefreshTokens {
        transport: Arc<FakeTransport>,
        next_outcome: UnaryOutcome,
        fail_on_refresh: bool,
        invalidations: std::sync::atomic::AtomicU32,
    }

    #[async_trait::async_trait]
    impl TokenSource for RefreshTokens {
        async fn header_for(
            &self,
            _cfg: &OAuth2ClientCredentialsConfig,
        ) -> Result<AuthCredentials, CoreError> {
            let invalidations = self.invalidations.load(std::sync::atomic::Ordering::SeqCst);
            if invalidations > 0 && self.fail_on_refresh {
                return Err(CoreError::Auth("refresh failed".into()));
            }
            let token = if invalidations == 0 { "stale" } else { "fresh" };
            Ok(AuthCredentials {
                header_name: "authorization".into(),
                header_value: format!("Bearer {token}"),
            })
        }

        fn invalidate(&self, _cfg: &OAuth2ClientCredentialsConfig) {
            self.invalidations
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            *self
                .transport
                .outcome
                .try_lock()
                .expect("prior call released outcome") = Some(Ok(self.next_outcome.clone()));
        }
    }

    #[tokio::test]
    async fn oauth_unauthenticated_refreshes_and_retries_the_same_send_once() {
        let mut request = fixture_request(false);
        request.auth = oauth_template();
        let transport = FakeTransport::with_outcome(Ok(unauthenticated_outcome()));
        let tokens = Arc::new(RefreshTokens {
            transport: transport.clone(),
            next_outcome: ok_outcome(),
            fail_on_refresh: false,
            invalidations: std::sync::atomic::AtomicU32::new(0),
        });
        let sender = Sender::new(
            transport.clone(),
            tokens.clone(),
            seeded_cache(false),
            Arc::new(NoBuiltins),
        );

        let report = sender
            .send(&request, None, Some(&env_with_sec()), unlimited_opts())
            .await
            .unwrap();

        assert_eq!(report.outcome.status_code, 0);
        assert_eq!(
            report.outcome.response_json.as_deref(),
            Some(r#"{"id":"echo"}"#)
        );
        assert_eq!(
            transport
                .unary_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            2
        );
        assert_eq!(
            transport.last_metadata.lock().await.as_ref().unwrap()["authorization"],
            "Bearer fresh"
        );
        assert_eq!(
            tokens
                .invalidations
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
    }

    #[tokio::test]
    async fn repeated_oauth_unauthenticated_stops_after_one_retry() {
        let mut request = fixture_request(false);
        request.auth = oauth_template();
        let transport = FakeTransport::with_outcome(Ok(unauthenticated_outcome()));
        let tokens = Arc::new(RefreshTokens {
            transport: transport.clone(),
            next_outcome: unauthenticated_outcome(),
            fail_on_refresh: false,
            invalidations: std::sync::atomic::AtomicU32::new(0),
        });
        let sender = Sender::new(
            transport.clone(),
            tokens.clone(),
            seeded_cache(false),
            Arc::new(NoBuiltins),
        );

        let report = sender
            .send(&request, None, Some(&env_with_sec()), unlimited_opts())
            .await
            .unwrap();

        assert_eq!(report.outcome.status_code, 16);
        assert_eq!(
            transport
                .unary_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            2
        );
        assert_eq!(
            tokens
                .invalidations
                .load(std::sync::atomic::Ordering::SeqCst),
            2
        );
    }

    #[tokio::test]
    async fn oauth_refresh_failure_returns_auth_error_without_retrying() {
        let mut request = fixture_request(false);
        request.auth = oauth_template();
        let transport = FakeTransport::with_outcome(Ok(unauthenticated_outcome()));
        let tokens = Arc::new(RefreshTokens {
            transport: transport.clone(),
            next_outcome: ok_outcome(),
            fail_on_refresh: true,
            invalidations: std::sync::atomic::AtomicU32::new(0),
        });
        let sender = Sender::new(
            transport.clone(),
            tokens.clone(),
            seeded_cache(false),
            Arc::new(NoBuiltins),
        );

        let err = sender
            .send(&request, None, Some(&env_with_sec()), unlimited_opts())
            .await
            .unwrap_err();

        assert!(matches!(err, CoreError::Auth(message) if message == "refresh failed"));
        assert_eq!(
            transport
                .unary_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
        assert_eq!(
            tokens
                .invalidations
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
    }

    pub(crate) fn oauth_template() -> SavedAuthConfig {
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

    pub(crate) fn env_with_sec() -> Environment {
        let mut variables = IndexMap::new();
        variables.insert("sec".to_string(), "s3cr3t".to_string());
        Environment { name: "dev".into(), variables, color: None }
    }

    pub(crate) fn static_tokens(value: &str) -> Arc<StaticTokenSource> {
        Arc::new(StaticTokenSource {
            header: AuthCredentials {
                header_name: "authorization".into(),
                header_value: value.into(),
            },
        })
    }

    /// Generator with no builtins — for tests where expansion is irrelevant.
    pub(crate) struct NoBuiltins;
    impl BuiltinGenerator for NoBuiltins {
        fn generate(&self, _name: &str) -> Option<String> {
            None
        }
    }

    /// Deterministic `$guid` generator: `G0`, `G1`, … — a fresh value per call, so
    /// per-occurrence freshness shows up as distinct values.
    pub(crate) struct SeqGuids(std::sync::atomic::AtomicU32);
    impl SeqGuids {
        pub(crate) fn new() -> Arc<Self> {
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

    /// The kind gate on the unary spine: a streaming method is refused after the shared
    /// prefix (the descriptor comes from activate) but before any wire call.
    #[tokio::test]
    async fn send_on_a_streaming_method_is_a_kind_mismatch_and_never_reaches_the_transport() {
        for (method, actual) in [
            ("ServerStream", MethodKind::Server),
            ("ClientStream", MethodKind::Client),
            ("Bidi", MethodKind::Bidi),
        ] {
            let transport = FakeTransport::with_outcome(Ok(ok_outcome()));
            let sender = Sender::new(
                transport.clone(),
                static_tokens("t"),
                seeded_cache(false),
                Arc::new(NoBuiltins),
            );
            let mut request = fixture_request(false);
            request.method = method.into();
            let err = sender.send(&request, None, None, unlimited_opts()).await.unwrap_err();
            assert!(
                matches!(&err, CoreError::MethodKindMismatch { service, method: m, expected: MethodKind::Unary, actual: a }
                    if service == "test.Echo" && m == method && *a == actual),
                "{method}: got {err:?}"
            );
            assert_eq!(transport.unary_calls.load(std::sync::atomic::Ordering::Relaxed), 0, "{method}");
            assert!(transport.last_path.lock().await.is_none(), "{method}");
        }
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
        let tokens = RecordingTokens::with_retry_outcome(transport.clone(), unauthenticated_outcome());
        let sender = Sender::new(
            transport.clone(),
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
        assert_eq!(invalidated, vec![expected_resolved.clone(), expected_resolved]);
        assert_eq!(transport.unary_calls.load(std::sync::atomic::Ordering::SeqCst), 2);
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
