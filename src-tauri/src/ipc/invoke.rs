//! IPC wrapper types for unary invoke. handshaker-core stays specta-free —
//! `specta::Type` derive only here.

use handshaker_core::grpc::UnaryOutcome;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Type)]
pub struct InvokeRequest {
    pub service: String,
    pub method: String,
    pub request_json: String,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Serialize, Type)]
pub struct InvokeOutcomeIpc {
    pub status_code: i32,
    pub status_message: String,
    pub response_json: Option<String>,
    pub trailing_metadata: HashMap<String, String>,
    /// Elapsed time in milliseconds. Capped at u32::MAX (~49 days) for
    /// TypeScript compatibility (specta forbids u64 / BigInt at the IPC boundary).
    pub elapsed_ms: u32,
}

impl From<UnaryOutcome> for InvokeOutcomeIpc {
    fn from(o: UnaryOutcome) -> Self {
        Self {
            status_code: o.status_code,
            status_message: o.status_message,
            response_json: o.response_json,
            trailing_metadata: o.trailing_metadata,
            elapsed_ms: o.elapsed_ms.min(u64::from(u32::MAX)) as u32,
        }
    }
}
