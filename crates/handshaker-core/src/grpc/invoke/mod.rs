//! Dynamic unary invoke API.
//!
//! - `UnaryOutcome` — single result type for one unary RPC: status + JSON response +
//!   trailing metadata + timing.
//! - `invoke_unary` — added in Task 9. Task 3 only defines the type.

use std::collections::HashMap;

use crate::error::CoreError;
use crate::grpc::connection::GrpcConnection;

pub(crate) mod skeleton;

/// Outcome of one unary call. `status_code == 0` means success (`response_json` is `Some`).
/// Any other code is a normal non-OK gRPC status (`response_json` is `None`); in that case
/// `status_message` carries `{Code}: {message}` (e.g. `"NOT_FOUND: user does not exist"`).
///
/// Client-side failures (transport / encode / decode) are returned as `Err(CoreError)`,
/// not as `UnaryOutcome` with non-zero `status_code`. See the design spec
/// (`docs/superpowers/specs/2026-05-27-plan-03-dynamic-invoke-design.md`) §6 for the
/// full invoke flow.
#[derive(Debug, Clone)]
pub struct UnaryOutcome {
    pub status_code: i32,
    pub status_message: String,
    pub response_json: Option<String>,
    pub trailing_metadata: HashMap<String, String>,
    pub elapsed_ms: u64,
}

/// Build a pretty-printed JSON skeleton for a method's input message.
///
/// Used by the UI when the user clicks a method in the catalog — populates the request
/// body editor with default values.
pub fn build_request_skeleton(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    let svc = connection
        .pool
        .get_service_by_name(service)
        .ok_or_else(|| CoreError::ServiceNotFound {
            service: service.to_string(),
        })?;
    let m = svc
        .methods()
        .find(|m| m.name() == method)
        .ok_or_else(|| CoreError::MethodNotFound {
            service: service.to_string(),
            method: method.to_string(),
        })?;
    let input_desc = m.input();
    let value = skeleton::build_default_json_skeleton(&input_desc);
    serde_json::to_string_pretty(&value).map_err(|e| CoreError::EncodeRequest(e.to_string()))
}
