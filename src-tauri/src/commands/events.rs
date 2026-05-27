//! Tauri-specta events emitted by the gRPC subsystem.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

/// Emitted whenever the active connection's contract has been (re)built.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ContractUpdated {
    /// Stable key identifying the target whose contract just refreshed.
    pub target_key: String,
}

/// Emitted on connect / disconnect.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ConnectionStateChanged {
    pub connected: bool,
    pub target: Option<TargetSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TargetSummary {
    pub address: String,
    pub tls: bool,
    pub skip_verify: bool,
}

impl From<&handshaker_core::grpc::GrpcTarget> for TargetSummary {
    fn from(t: &handshaker_core::grpc::GrpcTarget) -> Self {
        Self {
            address: t.address.clone(),
            tls: t.tls,
            skip_verify: t.skip_verify,
        }
    }
}
