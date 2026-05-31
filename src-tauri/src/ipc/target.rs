//! IPC target DTO. handshaker-core's `GrpcTarget` stays specta-free, so the
//! shell owns the specta-typed boundary type. `into_core` validates via
//! `GrpcTarget::new` (struct-literal / `Deserialize` construction bypasses
//! validation, so untrusted IPC payloads must route through it).

use handshaker_core::error::CoreError;
use handshaker_core::grpc::GrpcTarget;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GrpcTargetIpc {
    pub address: String,
    pub tls: bool,
    pub skip_verify: bool,
}

impl GrpcTargetIpc {
    /// Validate + convert to the core target. A bad `address` maps to
    /// `CoreError::InvalidTarget` → `IpcError::InvalidTarget`.
    pub fn into_core(self) -> Result<GrpcTarget, CoreError> {
        GrpcTarget::new(self.address, self.tls, self.skip_verify)
    }
}
