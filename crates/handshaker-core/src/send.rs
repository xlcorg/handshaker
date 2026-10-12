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
//!
//! [`Sender::send_http`] runs the same order for a plain HTTP request
//! (`crate::http::request::prepare`), and shares the unauthenticated rule with `send`
//! through [`Sender::retry_unauthenticated`].

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use crate::auth::{AuthCredentials, OAuth2ClientCredentialsConfig, SavedAuthConfig, TokenSource};
use crate::collections::{CallAuth, Collection, GrpcTemplate, HttpTemplate};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::invoke::{CallOptions, UnaryOutcome};
use crate::grpc::{ContractCache, GrpcConnection, GrpcTransport};
use crate::http::{HttpCallOptions, HttpResponse, HttpTransport};
use crate::stream::{MethodKind, StreamCall, StreamEvents};
use crate::vars::builtins::BuiltinGenerator;

/// gRPC status 16: the server rejected the call's credential.
pub(crate) const GRPC_UNAUTHENTICATED: i32 = 16;
/// HTTP 401: the server rejected the request's credential. 403 is authorization, not
/// authentication, and is not a rejection here.
pub(crate) const HTTP_UNAUTHORIZED: u16 = 401;

/// Drop the cached token behind this call's header when the server rejected it (the
/// *resolved* config, so the next token lookup fetches fresh). The stream path calls this
/// on gRPC status 16; [`Sender::retry_unauthenticated`] calls it for both unary paths. A
/// non-OAuth2 pick is a no-op.
pub(crate) fn invalidate_on_rejection(
    tokens: &dyn TokenSource,
    rejected: bool,
    resolved_oauth: Option<&OAuth2ClientCredentialsConfig>,
) {
    if let (true, Some(cfg)) = (rejected, resolved_oauth) {
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

/// One HTTP Send's response plus the auth config that won the pick, in **template** form
/// (secrets never materialized into the report). `None` = unauthenticated.
#[derive(Debug, Clone)]
pub struct HttpSendReport {
    pub response: HttpResponse,
    pub auth_used: Option<SavedAuthConfig>,
}

/// The Send spine behind one seam. Owns its adapters (gRPC transport, HTTP transport,
/// token source, contract cache, builtin generator) so every composition invariant is
/// testable with in-process fakes.
pub struct Sender {
    grpc: Arc<dyn GrpcTransport>,
    http: Arc<dyn HttpTransport>,
    tokens: Arc<dyn TokenSource>,
    cache: Arc<dyn ContractCache>,
    builtins: Arc<dyn BuiltinGenerator + Send + Sync>,
}

impl Sender {
    pub fn new(
        grpc: Arc<dyn GrpcTransport>,
        http: Arc<dyn HttpTransport>,
        tokens: Arc<dyn TokenSource>,
        cache: Arc<dyn ContractCache>,
        builtins: Arc<dyn BuiltinGenerator + Send + Sync>,
    ) -> Self {
        Self { grpc, http, tokens, cache, builtins }
    }

    /// Run the full spine for one request. A resolve failure returns the whole
    /// diagnosis before any network or OS-environment side effect; a non-OK gRPC
    /// status is a value in the report (`outcome.status_code != 0`), not an error.
    pub async fn send(
        &self,
        request: &GrpcTemplate,
        collection: Option<&Collection>,
        active_env: Option<&Environment>,
        opts: CallOptions,
    ) -> Result<SendReport, CoreError> {
        // Unary keeps its deadline in the calling layer's race — no phase timer here.
        let Prepared { conn, service, method, body_json, metadata, auth, tls_used } =
            self.prepare(request, collection, active_env, None, MethodKind::Unary).await?;
        let invoke = |metadata| crate::grpc::invoke_unary(&conn, &service, &method, &body_json, metadata, opts);

        let first = invoke(metadata.clone()).await?;
        let outcome = self
            .retry_unauthenticated(&auth, first, |o| o.status_code == GRPC_UNAUTHENTICATED, |fresh| {
                let mut metadata = metadata;
                metadata.insert(fresh.header_name, fresh.header_value);
                invoke(metadata)
            })
            .await?;

        Ok(SendReport { outcome, auth_used: auth.into_picked(), tls_used })
    }

    /// The HTTP spine: `http::request::prepare` → transport → unauthenticated rule. A
    /// resolve or URL failure returns before any network use. Any HTTP status is a value
    /// in the report. Cancel and timeout belong to the caller's race.
    pub async fn send_http(
        &self,
        request: &HttpTemplate,
        collection: Option<&Collection>,
        active_env: Option<&Environment>,
        opts: HttpCallOptions,
    ) -> Result<HttpSendReport, CoreError> {
        let crate::http::request::Prepared { request, auth } = crate::http::request::prepare(
            request,
            collection,
            active_env,
            self.tokens.as_ref(),
            self.builtins.as_ref(),
        )
        .await?;

        let first = self.http.send(request.clone(), opts).await?;
        let response = self
            .retry_unauthenticated(&auth, first, |r| r.status == HTTP_UNAUTHORIZED, |fresh| {
                self.http.send(request.with_auth(Some(&fresh)), opts)
            })
            .await?;

        Ok(HttpSendReport { response, auth_used: auth.into_picked() })
    }

    /// **Rule unauthenticated**, the one home for both unary paths. When `rejected(&first)`
    /// and the header came from an OAuth2 pick: drop the cached token, fetch a fresh
    /// header, and run `attempt` once more with it. A second rejection drops that token
    /// too and is returned as-is. Env-var and no-auth picks return `first` untouched,
    /// since re-reading an env var cannot change the answer. The request body is already
    /// buffered and the server refused the credential before acting, so replaying any
    /// method is safe.
    async fn retry_unauthenticated<T, Fut>(
        &self,
        auth: &CallAuth,
        first: T,
        rejected: fn(&T) -> bool,
        attempt: impl FnOnce(AuthCredentials) -> Fut,
    ) -> Result<T, CoreError>
    where
        Fut: Future<Output = Result<T, CoreError>>,
    {
        let tokens = self.tokens.as_ref();
        let Some(cfg) = auth.oauth().filter(|_| rejected(&first)) else {
            return Ok(first);
        };
        invalidate_on_rejection(tokens, true, Some(cfg));
        let fresh = tokens.header_for(cfg).await?;
        let second = attempt(fresh).await?;
        invalidate_on_rejection(tokens, rejected(&second), Some(cfg));
        Ok(second)
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
        request: &GrpcTemplate,
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

        let invalidate_oauth = p.auth.oauth().cloned();
        let spec = crate::stream::StreamCallSpec {
            transport: self.grpc.clone(),
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
            invalidate_oauth,
            builtins: self.builtins.clone(),
            events,
        };
        Ok(crate::stream::spawn_stream_call(spec, p.auth.into_picked(), p.tls_used))
    }

    /// The shared prefix of both spines: resolve pipeline → builtin expansion → auth
    /// header injection → activate. `phase_timeout` bounds activate only (phase 1 of a
    /// stream call); expiry → `DeadlineExceeded`. For a client-streaming / bidi `kind`
    /// the body is left alone (nothing is sent at Open — it is resolved per Send message
    /// by [`expand_body`]); every other kind resolves and expands it here, so an
    /// unresolved body var joins the address/metadata diagnosis before any network use.
    async fn prepare(
        &self,
        request: &GrpcTemplate,
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
        if let Some(creds) = eff.auth.header() {
            metadata.insert(creds.header_name.clone(), creds.header_value.clone());
        }

        let conn = crate::stream::with_phase_timeout(
            phase_timeout,
            crate::grpc::activate(eff.target, self.grpc.clone(), self.cache.as_ref()),
        )
        .await?;

        Ok(Prepared {
            conn,
            service: eff.service,
            method: eff.method,
            body_json,
            metadata,
            auth: eff.auth,
            tls_used,
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
    auth: CallAuth,
    tls_used: bool,
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use indexmap::IndexMap;

    use super::*;
    use crate::auth::{
        AuthCredentials, OAuth2ClientCredentialsConfig, SavedAuthConfig, StaticTokenSource,
    };
    use crate::grpc::testing::{fixture_cached_contract, FakeTransport};
    use crate::grpc::{ContractKey, InMemoryContractCache};
    use crate::http::testing::FakeHttpTransport;

    /// An HTTP transport for gRPC-only tests: it has no scripted reply.
    pub(crate) fn no_http() -> Arc<FakeHttpTransport> {
        FakeHttpTransport::replying([])
    }

    /// Fixture request against the `test.Echo / Send` schema of `fixture_pool()`.
    pub(crate) fn fixture_request(tls: bool) -> GrpcTemplate {
        GrpcTemplate {
            address_template: "127.0.0.1:1".into(),
            service: "test.Echo".into(),
            method: "Send".into(),
            body_template: r#"{"id":"hi"}"#.into(),
            metadata: vec![],
            auth: SavedAuthConfig::None,
            tls_override: Some(tls),
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
            no_http(),
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
            no_http(),
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
            no_http(),
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
            no_http(),
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
                no_http(),
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
            no_http(),
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
            no_http(),
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
            no_http(),
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
            no_http(),
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
            no_http(),
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
            no_http(),
            tokens.clone(),
            seeded_cache(false),
            Arc::new(NoBuiltins),
        );

        let report = sender.send(&request, None, None, unlimited_opts()).await.expect("send");
        std::env::remove_var(var);

        assert_eq!(report.outcome.status_code, 16);
        assert!(tokens.invalidated.lock().unwrap().is_empty());
    }

    mod send_http {
        use std::sync::atomic::{AtomicU32, Ordering};

        use super::*;
        use crate::collections::MetadataRow;
        use crate::http::testing::{status_response, FakeHttpTransport};
        use crate::http::{HttpBody, HttpMethod};

        /// Hands out `Bearer stale` until the first invalidation, `Bearer fresh` after.
        #[derive(Default)]
        struct RotatingTokens {
            invalidations: AtomicU32,
            header_calls: AtomicU32,
        }

        #[async_trait::async_trait]
        impl TokenSource for RotatingTokens {
            async fn header_for(&self, _cfg: &OAuth2ClientCredentialsConfig) -> Result<AuthCredentials, CoreError> {
                self.header_calls.fetch_add(1, Ordering::SeqCst);
                let token = if self.invalidations.load(Ordering::SeqCst) == 0 { "stale" } else { "fresh" };
                Ok(AuthCredentials { header_name: "authorization".into(), header_value: format!("Bearer {token}") })
            }

            fn invalidate(&self, _cfg: &OAuth2ClientCredentialsConfig) {
                self.invalidations.fetch_add(1, Ordering::SeqCst);
            }
        }

        fn row(key: &str, value: &str) -> MetadataRow {
            MetadataRow { key: key.into(), value: value.into(), enabled: true }
        }

        fn order(auth: SavedAuthConfig) -> HttpTemplate {
            HttpTemplate {
                method: HttpMethod::Post,
                url_template: "https://api.test/orders".into(),
                query: vec![],
                headers: vec![],
                body: HttpBody::Json { text: r#"{"sku":"a"}"#.into() },
                auth,
            }
        }

        fn sender(http: Arc<FakeHttpTransport>, tokens: Arc<dyn TokenSource>) -> Sender {
            Sender::new(
                FakeTransport::with_outcome(Ok(ok_outcome())),
                http,
                tokens,
                seeded_cache(false),
                Arc::new(NoBuiltins),
            )
        }

        fn unlimited() -> HttpCallOptions {
            HttpCallOptions { max_body_bytes: usize::MAX }
        }

        /// Tauri polls commands on a multi-threaded runtime, so the future must be `Send`.
        #[tokio::test]
        async fn runs_on_a_spawned_task() {
            let http = FakeHttpTransport::replying([Ok(status_response(204))]);
            let sender = sender(http, Arc::new(RotatingTokens::default()));
            let t = order(SavedAuthConfig::None);

            let report = tokio::spawn(async move { sender.send_http(&t, None, None, unlimited()).await })
                .await
                .unwrap()
                .unwrap();

            assert_eq!(report.response.status, 204);
        }

        #[tokio::test]
        async fn unresolved_vars_fail_with_one_diagnosis_before_any_exchange_or_token_fetch() {
            let http = FakeHttpTransport::replying([Ok(status_response(200))]);
            let tokens = Arc::new(RotatingTokens::default());
            let mut t = order(oauth_template());
            t.url_template = "{{base}}/orders".into();
            t.query = vec![row("dry", "{{dry}}")];
            t.headers = vec![row("x-trace", "{{trace}}")];
            t.body = HttpBody::Form { fields: vec![row("sku", "{{sku}}")] };

            let err = sender(http.clone(), tokens.clone())
                .send_http(&t, None, None, unlimited())
                .await
                .unwrap_err();

            match err {
                CoreError::ResolveFailed { unresolved, cycle } => {
                    assert_eq!(unresolved, vec!["base", "dry", "trace", "sku", "sec"]);
                    assert_eq!(cycle, None);
                }
                other => panic!("expected ResolveFailed, got {other:?}"),
            }
            assert_eq!(http.sent().len(), 0);
            assert_eq!(tokens.header_calls.load(Ordering::SeqCst), 0);
        }

        #[tokio::test]
        async fn an_invalid_url_fails_before_any_exchange_or_token_fetch() {
            let http = FakeHttpTransport::replying([Ok(status_response(200))]);
            let tokens = Arc::new(RotatingTokens::default());
            let mut t = order(oauth_template());
            t.url_template = "api.test/orders?key={{sec}}".into();

            let err = sender(http.clone(), tokens.clone())
                .send_http(&t, None, Some(&env_with_sec()), unlimited())
                .await
                .unwrap_err();

            assert_eq!(err.to_string(), "invalid URL: missing scheme");
            assert_eq!(http.sent().len(), 0);
            assert_eq!(tokens.header_calls.load(Ordering::SeqCst), 0);
        }

        #[tokio::test]
        async fn a_401_with_oauth_resends_once_with_the_fresh_header_and_the_same_body() {
            let http = FakeHttpTransport::replying([Ok(status_response(401)), Ok(status_response(201))]);
            let tokens = Arc::new(RotatingTokens::default());

            let report = sender(http.clone(), tokens.clone())
                .send_http(&order(oauth_template()), None, Some(&env_with_sec()), unlimited())
                .await
                .unwrap();

            assert_eq!(report.response.status, 201);
            assert_eq!(report.auth_used, Some(oauth_template()));
            let sent = http.sent();
            assert_eq!(sent.len(), 2);
            assert_eq!(sent[0].header("authorization"), Some("Bearer stale"));
            assert_eq!(sent[1].header("authorization"), Some("Bearer fresh"));
            assert_eq!(sent[1].method, HttpMethod::Post);
            assert_eq!(sent[1].url, "https://api.test/orders");
            assert_eq!(sent[1].body, Some(bytes::Bytes::from(r#"{"sku":"a"}"#)));
            assert_eq!(tokens.invalidations.load(Ordering::SeqCst), 1);
        }

        #[tokio::test]
        async fn a_second_401_is_returned_without_a_third_send() {
            let http = FakeHttpTransport::replying([
                Ok(status_response(401)),
                Ok(status_response(401)),
                Ok(status_response(200)),
            ]);
            let tokens = Arc::new(RotatingTokens::default());

            let report = sender(http.clone(), tokens.clone())
                .send_http(&order(oauth_template()), None, Some(&env_with_sec()), unlimited())
                .await
                .unwrap();

            assert_eq!(report.response.status, 401);
            assert_eq!(http.sent().len(), 2);
            assert_eq!(tokens.invalidations.load(Ordering::SeqCst), 2);
        }

        #[tokio::test]
        async fn a_401_with_env_var_auth_is_returned_without_a_retry() {
            let var = "HANDSHAKER_TEST_SEND_HTTP_ENVVAR_AUTH";
            std::env::set_var(var, "s3cr3t");
            let http = FakeHttpTransport::replying([Ok(status_response(401)), Ok(status_response(200))]);
            let tokens = Arc::new(RotatingTokens::default());
            let auth = SavedAuthConfig::EnvVar(crate::auth::EnvVarAuthConfig {
                env_var: var.into(),
                header_name: "x-api-key".into(),
                prefix: String::new(),
                environments: vec![],
            });

            let report =
                sender(http.clone(), tokens.clone()).send_http(&order(auth), None, None, unlimited()).await.unwrap();
            std::env::remove_var(var);

            assert_eq!(report.response.status, 401);
            let sent = http.sent();
            assert_eq!(sent.len(), 1);
            assert_eq!(sent[0].header("x-api-key"), Some("s3cr3t"));
            assert_eq!(tokens.invalidations.load(Ordering::SeqCst), 0);
        }

        #[tokio::test]
        async fn a_403_with_oauth_is_returned_without_a_retry_or_invalidation() {
            let http = FakeHttpTransport::replying([Ok(status_response(403)), Ok(status_response(200))]);
            let tokens = Arc::new(RotatingTokens::default());

            let report = sender(http.clone(), tokens.clone())
                .send_http(&order(oauth_template()), None, Some(&env_with_sec()), unlimited())
                .await
                .unwrap();

            assert_eq!(report.response.status, 403);
            assert_eq!(http.sent().len(), 1);
            assert_eq!(tokens.invalidations.load(Ordering::SeqCst), 0);
        }

        #[tokio::test]
        async fn a_500_is_a_response_value_and_skip_verify_comes_from_the_collection() {
            let http = FakeHttpTransport::replying([Ok(status_response(500))]);
            let coll = crate::collections::Collection {
                id: crate::collections::CollectionId(uuid::Uuid::from_u128(1)),
                name: "c".into(),
                items: vec![],
                variables: IndexMap::from([
                    ("base".to_string(), "https://api.test".to_string()),
                    ("dry".to_string(), "yes".to_string()),
                ]),
                auth: SavedAuthConfig::None,
                default_tls: false,
                skip_tls_verify: true,
                pinned: false,
                description: None,
                created_at: 0.0,
                expanded: false,
                links: vec![],
            };
            let mut t = order(SavedAuthConfig::None);
            t.url_template = "{{base}}/orders?page=1".into();
            t.query = vec![row("dry", "{{dry}}")];

            let report = sender(http.clone(), static_tokens("t"))
                .send_http(&t, Some(&coll), None, unlimited())
                .await
                .unwrap();

            assert_eq!(report.response.status, 500);
            assert_eq!(report.auth_used, None);
            let sent = http.sent();
            assert_eq!(sent[0].url, "https://api.test/orders?page=1&dry=yes");
            assert!(sent[0].skip_verify);
        }
    }
}
