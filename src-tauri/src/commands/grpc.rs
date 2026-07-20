//! gRPC commands — thin wrappers around `handshaker_core::grpc::*`. NO business logic.
//!
//! Lazy connect-on-Send model (plan-06b): no held connection. The `ContractCache`
//! holds pools/catalogs between calls; a `GrpcConnection` lives only for the duration
//! of one `grpc_send` (or a `grpc_describe` cache miss) and is dropped after.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;

use handshaker_core::auth::{OAuth2ClientCredentialsConfig, TokenSource};
use handshaker_core::collections::{resolve_request, ItemId, SavedRequest};
use handshaker_core::grpc::{
    activate, build_message_schema_from_pool, build_request_skeleton_from_pool, invoke_unary,
    CallOptions, ContractKey, GrpcTarget, TonicTransport,
};
use tauri::{AppHandle, State};
use tauri_specta::Event;
use uuid::Uuid;

use crate::commands::events::ContractUpdated;
use crate::ipc::{
    CallOptionsIpc, GrpcTargetIpc, InvokeOutcomeIpc, InvokeRequest, IpcError, MessageSchemaIpc,
    MessageSideIpc, SendCtxIpc, SendDraftIpc, SendReportIpc, ServiceCatalogIpc,
};
use crate::state::{AppState, InFlight};

/// Map the IPC byte limit to tonic's `usize`. The sentinel `0` means "no limit"
/// (the slider's Unlimited stop) → `usize::MAX`; any finite value passes through.
pub(crate) fn resolve_max_message_size(raw: u32) -> usize {
    if raw == 0 {
        usize::MAX
    } else {
        raw as usize
    }
}

/// Stable string key for the `ContractUpdated` event. Mirrors `ContractKey`'s
/// key-space (address + tls only; `skip_verify` is intentionally excluded —
/// it does not change the contract).
fn target_key(t: &GrpcTarget) -> String {
    format!("{}|tls={}", t.address, t.tls)
}

/// Cache-first contract describe. On a cache hit, returns the cached catalog
/// WITHOUT opening a channel (auto-reflect-on-blur fires often). On a miss,
/// `activate()` reflects + populates the cache, then the connection is dropped.
///
/// The reflecting path (miss only — a hit returns instantly with nothing to abort)
/// runs under `race_cancel_timeout`, so it honors the caller's deadline and can be
/// cancelled by `grpc_cancel(request_id)`, exactly like `grpc_send`.
#[tauri::command]
#[specta::specta]
pub async fn grpc_describe(
    app: AppHandle,
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    request_id: String,
    timeout_ms: u32,
) -> Result<ServiceCatalogIpc, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(cached.catalog.into());
    }

    let cache = state.contract_cache.clone();
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        let catalog: ServiceCatalogIpc = conn.catalog.clone().into();
        ContractUpdated { target_key: target_key(&conn.target) }
            .emit(&app)
            .ok();
        Ok::<ServiceCatalogIpc, IpcError>(catalog)
        // conn dropped here.
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}

/// Manual refresh: invalidate the cache entry then re-reflect. Like `grpc_describe`,
/// the re-reflection runs under `race_cancel_timeout` (deadline + `grpc_cancel`).
#[tauri::command]
#[specta::specta]
pub async fn grpc_refresh_contract(
    app: AppHandle,
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    request_id: String,
    timeout_ms: u32,
) -> Result<ServiceCatalogIpc, IpcError> {
    let target = target.into_core()?;
    state
        .contract_cache
        .invalidate(&ContractKey::from_target(&target));
    let cache = state.contract_cache.clone();
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        let catalog: ServiceCatalogIpc = conn.catalog.clone().into();
        ContractUpdated { target_key: target_key(&conn.target) }
            .emit(&app)
            .ok();
        Ok::<ServiceCatalogIpc, IpcError>(catalog)
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}

/// Build a JSON skeleton from the cached pool. On a cache miss, activate first.
///
/// The reflecting path (miss only) runs under `race_cancel_timeout`, so it honors the
/// caller's deadline and can be cancelled by `grpc_cancel(request_id)` — otherwise a
/// slow/unreachable endpoint would hang this command with no bound and no cancel path.
#[tauri::command]
#[specta::specta]
pub async fn grpc_build_request_skeleton(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    service: String,
    method: String,
    request_id: String,
    timeout_ms: u32,
) -> Result<String, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(build_request_skeleton_from_pool(&cached.pool, &service, &method)?);
    }
    let cache = state.contract_cache.clone();
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        Ok::<String, IpcError>(build_request_skeleton_from_pool(&conn.pool, &service, &method)?)
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}

/// Build the flat field-schema for a method's input or output message — drives autocomplete
/// and the contract view. Same cache discipline as `grpc_build_request_skeleton`: cache
/// hit → build from the pool; miss → `activate` first.
#[tauri::command]
#[specta::specta]
pub async fn grpc_message_schema(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    service: String,
    method: String,
    side: MessageSideIpc,
    request_id: String,
    timeout_ms: u32,
) -> Result<MessageSchemaIpc, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(build_message_schema_from_pool(&cached.pool, &service, &method, side.into())?.into());
    }
    let cache = state.contract_cache.clone();
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        Ok::<MessageSchemaIpc, IpcError>(
            build_message_schema_from_pool(&conn.pool, &service, &method, side.into())?.into(),
        )
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}

/// Removes the in-flight registry entry on scope exit (success / timeout / cancel / panic).
struct DeregisterGuard<'a> {
    map: &'a InFlight,
    id: String,
    notify: Arc<Notify>,
}
impl Drop for DeregisterGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut g) = self.map.lock() {
            // Remove only OUR entry: if a later request reused this id and overwrote the
            // slot, its `Notify` differs by identity — leave it so it stays cancelable.
            if g.get(&self.id).is_some_and(|n| Arc::ptr_eq(n, &self.notify)) {
                g.remove(&self.id);
            }
        }
    }
}

/// Race a unit of `work` against (a) a per-request cancel `Notify` and (b) a timeout.
/// Testable seam: the command builds `work` from the real activate+invoke; tests pass a
/// synthetic future. Generic over `T` so tests need no `InvokeOutcomeIpc` and no network.
pub(crate) async fn race_cancel_timeout<T, F>(
    in_flight: &InFlight,
    request_id: String,
    timeout_ms: u32,
    work: F,
) -> Result<T, IpcError>
where
    F: std::future::Future<Output = Result<T, IpcError>>,
{
    let notify = Arc::new(Notify::new());
    in_flight
        .lock()
        .expect("in_flight registry poisoned")
        .insert(request_id.clone(), notify.clone());
    let _guard = DeregisterGuard { map: in_flight, id: request_id, notify: notify.clone() };

    tokio::select! {
        biased;
        _ = notify.notified() => Err(IpcError::Cancelled),
        r = tokio::time::timeout(Duration::from_millis(timeout_ms as u64), work) => match r {
            Ok(inner) => inner,
            Err(_) => Err(IpcError::DeadlineExceeded { timeout_ms }),
        },
    }
}

/// Expand built-in dynamic variables (`{{$guid}}`, …) in the request body and each
/// metadata VALUE, in place. Per-occurrence: each `{{$name}}` gets a fresh value.
/// Metadata keys are left untouched. Generic over the generator for testability.
///
/// Note: the auth header is injected into `metadata` upstream (frontend `sendStep`)
/// before this runs, so an auth value literally containing `{{$guid}}` would also be
/// expanded. That's benign (real IdP tokens carry no `{{}}`); auth-FIELD resolution
/// (oauth2 config) remains a separate, out-of-scope concern.
fn expand_request_builtins(
    request: &mut InvokeRequest,
    gen: &impl handshaker_core::vars::builtins::BuiltinGenerator,
) {
    use handshaker_core::vars::builtins::expand_builtins;
    request.request_json = expand_builtins(&request.request_json, gen);
    for v in request.metadata.values_mut() {
        *v = expand_builtins(v, gen);
    }
}

/// On UNAUTHENTICATED (gRPC 16), drop the cached OAuth2 token so the next Send
/// fetches a fresh one (no auto-retry — design choice). No-op for other statuses
/// or when the effective auth wasn't OAuth2.
fn invalidate_on_unauthenticated(
    tokens: &dyn TokenSource,
    status_code: i32,
    oauth_config: Option<&OAuth2ClientCredentialsConfig>,
) {
    if status_code == 16 {
        if let Some(cfg) = oauth_config {
            tokens.invalidate(cfg);
        }
    }
}

/// Live Send: resolve the draft through the core `resolve_request` pipeline (vars,
/// auth pick + materialize, TLS), then activate + invoke. Replaces the old
/// `grpc_invoke_oneshot`, which took an already-resolved `InvokeRequest` (the
/// now-deleted TS mirror did the resolving; that job now belongs to core).
///
/// Non-OK gRPC status arrives in `InvokeOutcomeIpc.status_code`, NOT as `Err`.
/// `Err` covers resolve failure (`UnresolvedVars`) and client-side failures
/// (transport / encode / decode). On a 16 UNAUTHENTICATED outcome with an OAuth2
/// auth pick, the cached token is invalidated so the next Send fetches fresh — no
/// automatic retry.
pub(crate) async fn grpc_send_impl(
    state: &AppState,
    draft: SendDraftIpc,
    ctx: SendCtxIpc,
    request_id: String,
    opts: CallOptionsIpc,
) -> Result<SendReportIpc, IpcError> {
    // Read collection + active env from the stores (ctx carries references, not data).
    let collection = ctx
        .collection_id
        .as_deref()
        .and_then(|id| crate::ipc::collection::parse_collection_id(id).ok())
        .and_then(|cid| state.collection_store.get(cid));
    let active_env = ctx.env_name.as_deref().and_then(|n| state.env_store.get(n));

    // Build a SavedRequest view over the draft; the UI toggle is the tls override.
    let saved = SavedRequest {
        id: ItemId(Uuid::nil()),
        name: String::new(),
        address_template: draft.address_template,
        service: draft.service.clone(),
        method: draft.method.clone(),
        body_template: draft.body_template,
        metadata: draft.metadata.into_iter().map(|r| r.into_core()).collect(),
        auth: draft.auth.into_core(),
        tls_override: draft.tls_override,
        last_used_at: None,
        use_count: 0,
    };

    let tokens = state.token_source();
    let eff = resolve_request(&saved, collection.as_ref(), active_env.as_ref(), tokens.as_ref()).await?;

    // Send-report facts, captured before `eff` fields move into the work closure.
    let picked_auth = eff.picked_auth.clone();
    let tls_used = eff.target.tls;

    // Assemble InvokeRequest: effective body + metadata + auth header.
    let mut metadata = eff.metadata;
    if let Some(creds) = &eff.auth {
        metadata.insert(creds.header_name.clone(), creds.header_value.clone());
    }
    let mut request = InvokeRequest {
        service: eff.service,
        method: eff.method,
        request_json: eff.body_json,
        metadata,
    };
    let invalidate = eff.invalidate_oauth;
    let timeout_ms = opts.timeout_ms;
    let call_opts = CallOptions { max_message_bytes: resolve_max_message_size(opts.max_message_bytes) };
    let target = eff.target;
    let cache = state.contract_cache.clone();

    let outcome = {
        let work = async move {
            expand_request_builtins(&mut request, &handshaker_core::vars::builtins::SystemBuiltins);
            let transport = Arc::new(TonicTransport::new());
            let conn = activate(target, transport, cache.as_ref()).await?;
            let outcome = invoke_unary(
                &conn,
                &request.service,
                &request.method,
                &request.request_json,
                request.metadata,
                call_opts,
            )
            .await?;
            Ok::<InvokeOutcomeIpc, IpcError>(outcome.into())
        };
        race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await?
    };

    // On 16 UNAUTHENTICATED drop the cached oauth token; next Send fetches fresh. No retry.
    invalidate_on_unauthenticated(tokens.as_ref(), outcome.status_code, invalidate.as_ref());
    Ok(SendReportIpc::from_parts(outcome, picked_auth, tls_used))
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_send(
    state: State<'_, AppState>,
    draft: SendDraftIpc,
    ctx: SendCtxIpc,
    request_id: String,
    opts: CallOptionsIpc,
) -> Result<SendReportIpc, IpcError> {
    grpc_send_impl(&state, draft, ctx, request_id, opts).await
}

/// Fire the cancel `Notify` for an in-flight `request_id`. No-op if unknown (already
/// finished or never started). Uses `notify_one()` so a cancel racing the `select!` first
/// poll still stores a permit.
#[tauri::command]
#[specta::specta]
pub async fn grpc_cancel(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), IpcError> {
    if let Some(n) = state
        .in_flight
        .lock()
        .expect("in_flight registry poisoned")
        .get(&request_id)
    {
        n.notify_one();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_key_is_stable_for_equivalent_target() {
        let a = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        let b = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        assert_eq!(target_key(&a), target_key(&b));
    }

    #[test]
    fn target_key_differs_on_tls_flag() {
        let a = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        let b = GrpcTarget::new("api.prod:8443", false, false).unwrap();
        assert_ne!(target_key(&a), target_key(&b));
    }

    use crate::ipc::collection::SavedAuthConfigIpc;
    use crate::ipc::invoke::{InvokeRequest, SendDraftIpc};
    use crate::ipc::{IpcError, SendCtxIpc};
    use crate::state::InFlight;
    use handshaker_core::vars::builtins::BuiltinGenerator;
    use std::collections::HashMap;
    use std::time::Duration;

    #[tokio::test]
    async fn grpc_send_unresolved_var_returns_unresolved_vars_error() {
        let state = AppState::default(); // empty stores ⇒ {{host}} unresolvable
        let draft = SendDraftIpc {
            address_template: "{{host}}".into(), tls_override: None,
            service: "pkg.Svc".into(), method: "Do".into(),
            body_template: "{}".into(), metadata: vec![],
            auth: SavedAuthConfigIpc::None,
        };
        let opts = CallOptionsIpc { timeout_ms: 1000, max_message_bytes: 0 };
        let err = grpc_send_impl(&state, draft, SendCtxIpc { collection_id: None, env_name: None },
            "rid".into(), opts).await.unwrap_err();
        match err {
            IpcError::UnresolvedVars { unresolved, .. } => assert_eq!(unresolved, vec!["host"]),
            other => panic!("got {other:?}"),
        }
    }

    fn empty_in_flight() -> InFlight {
        std::sync::Mutex::new(HashMap::new())
    }

    #[tokio::test]
    async fn race_passes_through_success_and_cleans_up() {
        let m = empty_in_flight();
        let r = race_cancel_timeout(&m, "id1".to_string(), 1000, async {
            Ok::<i32, IpcError>(7)
        })
        .await;
        assert_eq!(r.unwrap(), 7);
        assert!(m.lock().unwrap().is_empty(), "registry entry removed on success");
    }

    #[tokio::test]
    async fn race_times_out_when_work_exceeds_budget() {
        let m = empty_in_flight();
        let work = async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            Ok::<i32, IpcError>(1)
        };
        match race_cancel_timeout(&m, "id2".to_string(), 50, work).await {
            Err(IpcError::DeadlineExceeded { timeout_ms }) => assert_eq!(timeout_ms, 50),
            other => panic!("expected DeadlineExceeded, got {other:?}"),
        }
        assert!(m.lock().unwrap().is_empty(), "registry entry removed on timeout");
    }

    #[tokio::test]
    async fn duplicate_id_cleanup_keeps_the_later_registration_cancelable() {
        // Two in-flight calls reuse the same request_id: B registers after A and
        // overwrites the slot. When A finishes, its guard must remove ONLY its own
        // entry (ptr-eq), leaving B cancelable. The old by-id removal clobbered B,
        // so cancelling it did nothing and it timed out instead of cancelling.
        let m = empty_in_flight();
        let id = "dup";

        let a_registered = Arc::new(Notify::new());
        let release_a = Arc::new(Notify::new());
        let b_registered = Arc::new(Notify::new());
        let a_done = Arc::new(Notify::new());

        // A: signals once registered, then blocks until released, then completes. The
        // work future owns its clones; the driver futures below borrow the originals.
        let work_a = {
            let (a_registered, release_a) = (a_registered.clone(), release_a.clone());
            async move {
                a_registered.notify_one();
                release_a.notified().await;
                Ok::<i32, IpcError>(1)
            }
        };
        // B: registers only after A (so it overwrites A's slot), then waits to be cancelled.
        let work_b = {
            let b_registered = b_registered.clone();
            async move {
                b_registered.notify_one();
                std::future::pending::<()>().await;
                Ok::<i32, IpcError>(2)
            }
        };

        let a_future = async {
            let r = race_cancel_timeout(&m, id.to_string(), 60_000, work_a).await;
            a_done.notify_one();
            r
        };
        let b_future = async {
            a_registered.notified().await;
            race_cancel_timeout(&m, id.to_string(), 2_000, work_b).await
        };

        let orchestrator = async {
            b_registered.notified().await; // both registered; map[id] now holds B's notify
            release_a.notify_one(); // let A finish → A's DeregisterGuard drops
            a_done.notified().await; // A's guard has dropped
            // Cancel by id, mirroring grpc_cancel.
            if let Some(n) = m.lock().unwrap().get(id).cloned() {
                n.notify_one();
            }
        };

        let (_a, b, _o) = tokio::join!(a_future, b_future, orchestrator);
        match b {
            Err(IpcError::Cancelled) => {}
            other => panic!("expected B cancelled, got {other:?}"),
        }
    }

    #[test]
    fn resolve_max_message_size_maps_zero_to_unlimited() {
        assert_eq!(resolve_max_message_size(0), usize::MAX);
    }

    #[test]
    fn resolve_max_message_size_passes_finite_value_through() {
        assert_eq!(resolve_max_message_size(16 * 1024 * 1024), 16 * 1024 * 1024usize);
    }

    #[test]
    fn call_options_ipc_maps_zero_bytes_to_unlimited() {
        let core = CallOptions { max_message_bytes: resolve_max_message_size(0) };
        assert_eq!(core.max_message_bytes, usize::MAX);
    }

    #[tokio::test]
    async fn race_cancels_when_notified_and_cleans_up() {
        let m = empty_in_flight();
        let id = "cancel-me".to_string();
        let work = std::future::pending::<Result<i32, IpcError>>();

        // Concurrent canceller on the same task (no spawn -> no 'static bound): wait until
        // the race registers its Notify, then fire notify_one().
        let canceller = async {
            loop {
                if let Some(n) = m.lock().unwrap().get(&id).cloned() {
                    n.notify_one();
                    break;
                }
                tokio::task::yield_now().await;
            }
        };

        let (raced, _) = tokio::join!(
            race_cancel_timeout(&m, id.clone(), 60_000, work),
            canceller,
        );
        match raced {
            Err(IpcError::Cancelled) => {}
            other => panic!("expected cancelled, got {other:?}"),
        }
        assert!(m.lock().unwrap().is_empty(), "registry entry removed on cancel");
    }

    struct FakeGen;
    impl BuiltinGenerator for FakeGen {
        fn generate(&self, name: &str) -> Option<String> {
            match name {
                "$guid" => Some("GUID".into()),
                _ => None,
            }
        }
    }

    #[test]
    fn expands_builtins_in_body_and_metadata() {
        let mut req = InvokeRequest {
            service: "s".into(),
            method: "m".into(),
            request_json: r#"{"id":"{{$guid}}","k":"{{kept}}"}"#.into(),
            metadata: HashMap::from([("x-id".into(), "{{$guid}}".into())]),
        };
        expand_request_builtins(&mut req, &FakeGen);
        assert_eq!(req.request_json, r#"{"id":"GUID","k":"{{kept}}"}"#);
        assert_eq!(req.metadata.get("x-id").unwrap(), "GUID");
    }

    struct RecordingTokens {
        invalidated: std::sync::Mutex<Vec<String>>,
    }
    impl RecordingTokens {
        fn new() -> Self {
            Self { invalidated: std::sync::Mutex::new(Vec::new()) }
        }
    }
    #[async_trait::async_trait]
    impl handshaker_core::auth::TokenSource for RecordingTokens {
        async fn header_for(
            &self,
            _cfg: &OAuth2ClientCredentialsConfig,
        ) -> Result<handshaker_core::auth::AuthCredentials, handshaker_core::error::CoreError> {
            unreachable!("header_for not exercised by these tests")
        }
        fn invalidate(&self, cfg: &OAuth2ClientCredentialsConfig) {
            self.invalidated.lock().unwrap().push(cfg.client_id.clone());
        }
    }

    fn oauth_cfg(client_id: &str) -> OAuth2ClientCredentialsConfig {
        OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: client_id.into(),
            client_secret: "shh".into(),
            scopes: vec![],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        }
    }

    #[test]
    fn invalidate_on_unauthenticated_invalidates_when_status_16_and_oauth_config_present() {
        let tokens = RecordingTokens::new();
        let cfg = oauth_cfg("client-a");
        invalidate_on_unauthenticated(&tokens, 16, Some(&cfg));
        assert_eq!(tokens.invalidated.lock().unwrap().as_slice(), ["client-a"]);
    }

    #[test]
    fn invalidate_on_unauthenticated_is_noop_without_oauth_config() {
        let tokens = RecordingTokens::new();
        invalidate_on_unauthenticated(&tokens, 16, None);
        assert!(tokens.invalidated.lock().unwrap().is_empty());
    }

    #[test]
    fn invalidate_on_unauthenticated_is_noop_for_non_16_status() {
        let tokens = RecordingTokens::new();
        let cfg = oauth_cfg("client-b");
        invalidate_on_unauthenticated(&tokens, 0, Some(&cfg));
        assert!(tokens.invalidated.lock().unwrap().is_empty());
    }
}
