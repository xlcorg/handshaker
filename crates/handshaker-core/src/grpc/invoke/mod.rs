//! Dynamic unary invoke API.
//!
//! - `UnaryOutcome` — single result type for one unary RPC: status + JSON response +
//!   trailing metadata + timing.
//! - `invoke_unary` — added in Task 9. Task 3 only defines the type.

use std::collections::HashMap;

/// Outcome of one unary call. `status_code == 0` means success (`response_json` is `Some`).
/// Any other code is a normal non-OK gRPC status (`response_json` is `None`); in that case
/// `status_message` carries `{Code}: {message}` (e.g. `"NOT_FOUND: user does not exist"`).
///
/// Client-side failures (transport / encode / decode) are returned as `Err(CoreError)`,
/// not as `UnaryOutcome` with non-zero `status_code`. See Plan #3 §6.
#[derive(Debug, Clone)]
pub struct UnaryOutcome {
    pub status_code: i32,
    pub status_message: String,
    pub response_json: Option<String>,
    pub trailing_metadata: HashMap<String, String>,
    pub elapsed_ms: u64,
}
