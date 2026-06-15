//! gRPC commands — thin wrappers around `handshaker_core::grpc::*`. NO business logic.
//!
//! Lazy connect-on-Send model (plan-06b): no held connection. The `ContractCache`
//! holds pools/catalogs between calls; a `GrpcConnection` lives only for the duration
//! of one `grpc_invoke_oneshot` (or a `grpc_describe` cache miss) and is dropped after.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;

use handshaker_core::grpc::{
    activate, build_message_schema_from_pool, build_request_skeleton_from_pool, invoke_unary,
    ContractKey, GrpcTarget, TonicTransport,
};
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::commands::events::ContractUpdated;
use crate::ipc::{
    GrpcTargetIpc, InvokeOutcomeIpc, InvokeRequest, IpcError, MessageSchemaIpc, MessageSideIpc,
    ServiceCatalogIpc,
};
use crate::state::{AppState, InFlight};

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
/// cancelled by `grpc_cancel(request_id)`, exactly like `grpc_invoke_oneshot`.
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
#[tauri::command]
#[specta::specta]
pub async fn grpc_build_request_skeleton(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    service: String,
    method: String,
) -> Result<String, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(build_request_skeleton_from_pool(&cached.pool, &service, &method)?);
    }
    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    Ok(build_request_skeleton_from_pool(&conn.pool, &service, &method)?)
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
) -> Result<MessageSchemaIpc, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(build_message_schema_from_pool(&cached.pool, &service, &method, side.into())?.into());
    }
    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    Ok(build_message_schema_from_pool(&conn.pool, &service, &method, side.into())?.into())
}

/// Sentinel transport messages classified on the frontend (Transport(msg) reuse — see the
/// Phase C decision). Kept as the C2<->C5/C6 contract.
const CANCELLED_MSG: &str = "request cancelled";
fn timed_out_msg(ms: u32) -> String {
    format!("request timed out after {ms}ms")
}

/// Removes the in-flight registry entry on scope exit (success / timeout / cancel / panic).
struct DeregisterGuard<'a> {
    map: &'a InFlight,
    id: String,
}
impl Drop for DeregisterGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut g) = self.map.lock() {
            g.remove(&self.id);
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
    let _guard = DeregisterGuard { map: in_flight, id: request_id };

    tokio::select! {
        biased;
        _ = notify.notified() => Err(IpcError::Transport { message: CANCELLED_MSG.to_string() }),
        r = tokio::time::timeout(Duration::from_millis(timeout_ms as u64), work) => match r {
            Ok(inner) => inner,
            Err(_) => Err(IpcError::Transport { message: timed_out_msg(timeout_ms) }),
        },
    }
}

/// One-shot unary invoke: activate (channel required) → invoke → drop.
///
/// Non-OK gRPC status arrives in `InvokeOutcomeIpc.status_code`, NOT as `Err`.
/// `Err` is only for client-side failures (transport / encode / decode).
/// The descriptor pool is reused from the `ContractCache` when present; only the channel is opened fresh per call.
#[tauri::command]
#[specta::specta]
pub async fn grpc_invoke_oneshot(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    request: InvokeRequest,
    request_id: String,
    timeout_ms: u32,
) -> Result<InvokeOutcomeIpc, IpcError> {
    let target = target.into_core()?;
    let cache = state.contract_cache.clone();
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        let outcome = invoke_unary(
            &conn,
            &request.service,
            &request.method,
            &request.request_json,
            request.metadata,
        )
        .await?;
        Ok::<InvokeOutcomeIpc, IpcError>(outcome.into())
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
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

    use crate::ipc::IpcError;
    use crate::state::InFlight;
    use std::collections::HashMap;
    use std::time::Duration;

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
            Err(IpcError::Transport { message }) => assert!(message.contains("timed out"), "{message}"),
            other => panic!("expected timeout Transport, got {other:?}"),
        }
        assert!(m.lock().unwrap().is_empty(), "registry entry removed on timeout");
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
            Err(IpcError::Transport { message }) => assert!(message.contains("cancelled"), "{message}"),
            other => panic!("expected cancelled Transport, got {other:?}"),
        }
        assert!(m.lock().unwrap().is_empty(), "registry entry removed on cancel");
    }
}
