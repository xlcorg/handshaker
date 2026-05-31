//! gRPC commands — thin wrappers around `handshaker_core::grpc::*`. NO business logic.
//!
//! Lazy connect-on-Send model (plan-06b): no held connection. The `ContractCache`
//! holds pools/catalogs between calls; a `GrpcConnection` lives only for the duration
//! of one `grpc_invoke_oneshot` (or a `grpc_describe` cache miss) and is dropped after.

use std::sync::Arc;

use handshaker_core::grpc::{
    activate, build_request_skeleton_from_pool, invoke_unary, ContractKey, GrpcTarget,
    TonicTransport,
};
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::commands::events::ContractUpdated;
use crate::ipc::{GrpcTargetIpc, InvokeOutcomeIpc, InvokeRequest, IpcError, ServiceCatalogIpc};
use crate::state::AppState;

/// Stable string key for the `ContractUpdated` event. Mirrors `ContractKey`'s
/// key-space (address + tls only; `skip_verify` is intentionally excluded —
/// it does not change the contract).
fn target_key(t: &GrpcTarget) -> String {
    format!("{}|tls={}", t.address, t.tls)
}

/// Cache-first contract describe. On a cache hit, returns the cached catalog
/// WITHOUT opening a channel (auto-reflect-on-blur fires often). On a miss,
/// `activate()` reflects + populates the cache, then the connection is dropped.
#[tauri::command]
#[specta::specta]
pub async fn grpc_describe(
    app: AppHandle,
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
) -> Result<ServiceCatalogIpc, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(cached.catalog.into());
    }

    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    let catalog: ServiceCatalogIpc = conn.catalog.clone().into();
    ContractUpdated { target_key: target_key(&conn.target) }
        .emit(&app)
        .ok();
    Ok(catalog)
    // conn dropped here.
}

/// Manual refresh: invalidate the cache entry then re-reflect.
#[tauri::command]
#[specta::specta]
pub async fn grpc_refresh_contract(
    app: AppHandle,
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
) -> Result<ServiceCatalogIpc, IpcError> {
    let target = target.into_core()?;
    state
        .contract_cache
        .invalidate(&ContractKey::from_target(&target));
    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    let catalog: ServiceCatalogIpc = conn.catalog.clone().into();
    ContractUpdated { target_key: target_key(&conn.target) }
        .emit(&app)
        .ok();
    Ok(catalog)
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
) -> Result<InvokeOutcomeIpc, IpcError> {
    let target = target.into_core()?;
    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    let outcome = invoke_unary(
        &conn,
        &request.service,
        &request.method,
        &request.request_json,
        request.metadata,
    )
    .await?;
    Ok(outcome.into())
    // conn dropped here.
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
}
