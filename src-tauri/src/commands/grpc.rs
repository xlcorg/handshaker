//! gRPC commands — thin wrappers around `handshaker_core::grpc::*`. NO business logic.
//!
//! Lazy connect-on-Send model (plan-06b): no held connection. The `ContractCache`
//! holds pools/catalogs between calls; a `GrpcConnection` lives only for the duration
//! of one `grpc_send` (or a `grpc_describe` cache miss) and is dropped after.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;

use handshaker_core::collections::{ItemId, SavedRequest};
use handshaker_core::grpc::{
    activate, build_message_schema_from_pool, build_request_skeleton_from_pool, CallOptions,
    ContractKey, GrpcTarget, TonicTransport,
};
use tauri::{AppHandle, State};
use tauri_specta::Event;
use uuid::Uuid;

use crate::commands::events::ContractUpdated;
use crate::ipc::{
    CallOptionsIpc, GrpcTargetIpc, InvokeOutcomeIpc, IpcError, MessageSchemaIpc, MessageSideIpc,
    SendCtxIpc, SendDraftIpc, SendReportIpc, ServiceCatalogIpc,
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

/// Live Send — an ADAPTER over the core `Sender` (the whole spine lives in core):
/// parse ctx references → read collection/env from the stores → run the shared
/// `Sender` under the cancel/timeout race → map the core report and errors to
/// wire form.
///
/// Non-OK gRPC status arrives in `SendReportIpc.outcome.status_code`, NOT as
/// `Err`. `Err` covers resolve failure (`UnresolvedVars`) and client-side
/// failures (transport / encode / decode).
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

    let timeout_ms = opts.timeout_ms;
    let call_opts = CallOptions { max_message_bytes: resolve_max_message_size(opts.max_message_bytes) };
    let sender = state.sender.clone();
    let work = async move {
        let report = sender
            .send(&saved, collection.as_ref(), active_env.as_ref(), call_opts)
            .await?;
        let outcome: InvokeOutcomeIpc = report.outcome.into();
        Ok(SendReportIpc::from_parts(outcome, report.auth_used, report.tls_used))
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
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
    use crate::ipc::invoke::SendDraftIpc;
    use crate::ipc::{IpcError, SendCtxIpc};
    use crate::state::InFlight;
    use std::collections::HashMap;
    use std::time::Duration;

    /// Draft whose address is the `{{host}}` template — resolvable only when the
    /// ctx-referenced store provides `host`.
    fn host_template_draft() -> SendDraftIpc {
        SendDraftIpc {
            address_template: "{{host}}".into(), tls_override: None,
            service: "pkg.Svc".into(), method: "Do".into(),
            body_template: "{}".into(), metadata: vec![],
            auth: SavedAuthConfigIpc::None,
        }
    }

    fn quick_opts() -> CallOptionsIpc {
        CallOptionsIpc { timeout_ms: 1000, max_message_bytes: 0 }
    }

    #[tokio::test]
    async fn grpc_send_unresolved_var_returns_unresolved_vars_error() {
        let state = AppState::default(); // empty stores ⇒ {{host}} unresolvable
        let ctx = SendCtxIpc { collection_id: None, env_name: None };
        let opts = quick_opts();
        let draft = host_template_draft();
        let err = grpc_send_impl(&state, draft, ctx, "rid".into(), opts).await.unwrap_err();
        match err {
            IpcError::UnresolvedVars { unresolved, .. } => assert_eq!(unresolved, vec!["host"]),
            other => panic!("got {other:?}"),
        }
    }

    /// `host` → a portless address: it resolves fine, then fails target validation
    /// with `InvalidTarget` — the no-network signal that the store was consulted
    /// (an unread store would leave `{{host}}` unresolved instead).
    fn portless_host_vars() -> indexmap::IndexMap<String, String> {
        let mut variables = indexmap::IndexMap::new();
        variables.insert("host".to_string(), "portless-address".to_string());
        variables
    }

    fn assert_store_var_resolved(err: IpcError) {
        match err {
            IpcError::InvalidTarget { message } => {
                assert!(message.contains("portless-address"), "{message}")
            }
            other => panic!("expected InvalidTarget (var resolved from store), got {other:?}"),
        }
    }

    /// The ctx carries a collection REFERENCE; the command must read the collection
    /// from the store.
    #[tokio::test]
    async fn grpc_send_reads_collection_from_store_by_ctx_reference() {
        let state = AppState::default();
        let id = handshaker_core::collections::ids::CollectionId(uuid::Uuid::from_u128(7));
        let collection = handshaker_core::collections::Collection {
            id,
            name: "c".into(),
            items: vec![],
            variables: portless_host_vars(),
            auth: handshaker_core::auth::SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
            links: vec![],
        };
        state.collection_store.upsert(collection).unwrap();

        let ctx = SendCtxIpc { collection_id: Some(id.0.to_string()), env_name: None };
        let opts = quick_opts();
        let draft = host_template_draft();
        let err = grpc_send_impl(&state, draft, ctx, "rid".into(), opts).await.unwrap_err();
        assert_store_var_resolved(err);
    }

    /// Same for the environment REFERENCE: `env_name` in the ctx must be read from
    /// the env store and its variables fed into resolve.
    #[tokio::test]
    async fn grpc_send_reads_environment_from_store_by_ctx_reference() {
        let state = AppState::default();
        let env = handshaker_core::env::Environment {
            name: "dev".into(),
            variables: portless_host_vars(),
            color: None,
        };
        state.env_store.upsert(env).unwrap();

        let ctx = SendCtxIpc { collection_id: None, env_name: Some("dev".into()) };
        let opts = quick_opts();
        let draft = host_template_draft();
        let err = grpc_send_impl(&state, draft, ctx, "rid".into(), opts).await.unwrap_err();
        assert_store_var_resolved(err);
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

}
