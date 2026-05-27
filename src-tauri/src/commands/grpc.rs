//! gRPC commands — thin wrappers around `handshaker_core::grpc::*`. NO business logic.

use std::sync::Arc;

use handshaker_core::grpc::{activate, GrpcTarget, ServiceCatalog, TonicTransport};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::commands::events::{ConnectionStateChanged, ContractUpdated, TargetSummary};
use crate::ipc::IpcError;
use crate::state::AppState;

#[derive(Debug, Deserialize, Type)]
pub struct ConnectInput {
    pub address: String,
    pub tls: bool,
    pub skip_verify: bool,
}

#[derive(Debug, Serialize, Type)]
pub struct ConnectOutcome {
    pub target: TargetSummary,
    pub catalog: ServiceCatalog,
}

fn target_key(t: &GrpcTarget) -> String {
    format!(
        "{}|tls={}|skip_verify={}",
        t.address, t.tls, t.skip_verify
    )
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ConnectInput,
) -> Result<ConnectOutcome, IpcError> {
    let target = GrpcTarget::new(input.address, input.tls, input.skip_verify)?;
    let transport = Arc::new(TonicTransport::new());

    let conn = activate(target.clone(), transport).await?;
    let summary: TargetSummary = (&conn.target).into();
    let key = target_key(&conn.target);
    let catalog = conn.catalog.clone();

    {
        let mut slot = state.connection.lock().await;
        *slot = Some(Arc::new(conn));
    }

    ContractUpdated {
        target_key: key.clone(),
    }
    .emit(&app)
    .ok();
    ConnectionStateChanged {
        connected: true,
        target: Some(summary.clone()),
    }
    .emit(&app)
    .ok();

    Ok(ConnectOutcome {
        target: summary,
        catalog,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), IpcError> {
    let mut slot = state.connection.lock().await;
    *slot = None;
    ConnectionStateChanged {
        connected: false,
        target: None,
    }
    .emit(&app)
    .ok();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_refresh_contract(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ServiceCatalog, IpcError> {
    let target = {
        let slot = state.connection.lock().await;
        let conn = slot.as_ref().ok_or(IpcError::NotConnected)?;
        conn.target.clone()
    };

    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target.clone(), transport).await?;
    let catalog = conn.catalog.clone();
    let key = target_key(&conn.target);

    {
        let mut slot = state.connection.lock().await;
        *slot = Some(Arc::new(conn));
    }

    ContractUpdated { target_key: key }.emit(&app).ok();
    Ok(catalog)
}

// Smoke unit tests — we can't easily spin a Tauri app in cargo test, so only test
// the pure helper.
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
