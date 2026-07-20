//! Dynamic unary invoke API.
//!
//! - `UnaryOutcome` — single result type for one unary RPC: status + JSON response +
//!   trailing metadata + timing.
//! - `invoke_unary` — execute a unary RPC on an already-connected `GrpcConnection`.

use std::collections::HashMap;

use crate::error::CoreError;
use crate::grpc::connection::GrpcConnection;
use crate::grpc::transport::DynamicCodec;

pub(crate) mod skeleton;
pub mod schema;
mod well_known;
mod lenient;
mod status_details;
pub use schema::{
    build_message_schema_from_pool, EnumNode, EnumValueNode, FieldNode, FieldValueKind,
    MessageNode, MessageSchema, MessageSide,
};
pub use status_details::{
    extract_status_details, FieldViolation, HelpLink, PreconditionViolation, QuotaViolation,
    StatusDetail,
};

/// Per-call invoke options — one growing value threaded UI→transport instead of
/// positional params. `request_id` is NOT here (cancel key, separate lifecycle).
#[derive(Debug, Clone, Copy)]
pub struct CallOptions {
    /// Max decode/encode message size in bytes (`usize::MAX` = unlimited).
    pub max_message_bytes: usize,
}

/// Outcome of one unary call. `status_code == 0` means success (`response_json` is `Some`).
/// Any other code is a normal non-OK gRPC status (`response_json` is `None`); in that case
/// `status_message` carries the server's raw status message (e.g. `"user does not exist"`);
/// the code itself is in `status_code`.
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
    /// Decoded google.rpc structured error details (empty on success / when none).
    pub status_details: Vec<StatusDetail>,
    pub elapsed_ms: u64,
}

/// Build a JSON skeleton for the request body of the given method.
///
/// Used by the UI when the user clicks a method in the catalog — populates the request
/// body editor with default values.
pub fn build_request_skeleton(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    build_request_skeleton_from_pool(&connection.pool, service, method)
}

/// Build a pretty-printed JSON skeleton for a method's input message, from a pool.
///
/// Pool-based variant so callers without a live `GrpcConnection` (e.g. the lazy
/// connect-on-Send command surface) can build a skeleton straight from a cached
/// descriptor pool.
pub fn build_request_skeleton_from_pool(
    pool: &prost_reflect::DescriptorPool,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    let svc = pool
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

/// Execute a unary RPC.
///
/// 1. Resolves `service`/`method` from `connection.pool`. Not found → `ServiceNotFound` / `MethodNotFound`.
/// 2. Checks the method is unary (not streaming). Streaming → `NotImplemented`.
/// 3. Parses `request_json` to a `DynamicMessage` via prost-reflect serde. Fail → `EncodeRequest`.
/// 4. Builds a `DynamicCodec` + path `/{service}/{method}`.
/// 5. Delegates to `connection.transport.unary_dynamic(...)`.
///
/// Returns `UnaryOutcome` as-is — non-OK gRPC status surfaces as `status_code != 0`, not `Err`.
pub async fn invoke_unary(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
    request_json: &str,
    metadata: HashMap<String, String>,
    opts: CallOptions,
) -> Result<UnaryOutcome, CoreError> {
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

    if m.is_client_streaming() || m.is_server_streaming() {
        return Err(CoreError::NotImplemented(format!(
            "streaming RPC not supported in MVP (method `{service}/{method}`)"
        )));
    }

    let input_desc = m.input();
    let output_desc = m.output();

    let cleaned = lenient::strip_trailing_commas(request_json);
    let mut deserializer = serde_json::Deserializer::from_str(&cleaned);
    let request_msg =
        prost_reflect::DynamicMessage::deserialize(input_desc.clone(), &mut deserializer)
            .map_err(|e| CoreError::EncodeRequest(e.to_string()))?;
    // Consume trailing whitespace / catch trailing junk.
    deserializer
        .end()
        .map_err(|e| CoreError::EncodeRequest(e.to_string()))?;

    let codec = DynamicCodec {
        request_descriptor: input_desc,
        response_descriptor: output_desc,
    };
    let path = format!("/{service}/{method}");

    connection
        .transport
        .unary_dynamic(connection.channel.clone(), path, codec, request_msg, metadata, opts)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::CoreError;
    use crate::grpc::testing::{fake_connection, fixture_pool, FakeTransport};
    use std::collections::HashMap;

    #[test]
    fn skeleton_from_pool_builds_for_known_method() {
        let pool = fixture_pool();
        let s = build_request_skeleton_from_pool(&pool, "test.Echo", "Send").expect("skeleton");
        assert!(s.contains("\"id\""), "got {s}");
    }

    #[test]
    fn skeleton_from_pool_unknown_service_errors() {
        let pool = fixture_pool();
        let err = build_request_skeleton_from_pool(&pool, "no.Such", "Send").unwrap_err();
        assert!(matches!(err, CoreError::ServiceNotFound { .. }), "got {err:?}");
    }

    #[tokio::test]
    async fn unknown_service_returns_service_not_found() {
        let t = FakeTransport::with_outcome(Err(CoreError::NotImplemented("unreached".into())));
        let conn = fake_connection(t);
        let err = invoke_unary(&conn, "no.Such", "Send", "{}", HashMap::new(), CallOptions { max_message_bytes: usize::MAX })
            .await
            .unwrap_err();
        assert!(
            matches!(err, CoreError::ServiceNotFound { ref service } if service == "no.Such"),
            "got {err:?}"
        );
    }

    #[tokio::test]
    async fn unknown_method_returns_method_not_found() {
        let t = FakeTransport::with_outcome(Err(CoreError::NotImplemented("unreached".into())));
        let conn = fake_connection(t);
        let err = invoke_unary(&conn, "test.Echo", "Nope", "{}", HashMap::new(), CallOptions { max_message_bytes: usize::MAX })
            .await
            .unwrap_err();
        assert!(
            matches!(err, CoreError::MethodNotFound { ref service, ref method }
                if service == "test.Echo" && method == "Nope"),
            "got {err:?}"
        );
    }

    #[tokio::test]
    async fn invalid_json_returns_encode_request() {
        let t = FakeTransport::with_outcome(Err(CoreError::NotImplemented("unreached".into())));
        let conn = fake_connection(t);
        let err = invoke_unary(&conn, "test.Echo", "Send", "not json {", HashMap::new(), CallOptions { max_message_bytes: usize::MAX })
            .await
            .unwrap_err();
        assert!(matches!(err, CoreError::EncodeRequest(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn happy_path_passes_path_and_metadata_to_transport() {
        let canned = UnaryOutcome {
            status_code: 0,
            status_message: "OK".into(),
            response_json: Some(r#"{"id":"echo"}"#.into()),
            trailing_metadata: HashMap::new(),
            status_details: Vec::new(),
            elapsed_ms: 42,
        };
        let t = FakeTransport::with_outcome(Ok(canned.clone()));
        let captured = t.clone();
        let conn = fake_connection(t);

        let mut metadata = HashMap::new();
        metadata.insert("x-request-id".into(), "abc".into());

        let outcome = invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"hi"}"#, metadata, CallOptions { max_message_bytes: usize::MAX })
            .await
            .expect("invoke");
        assert_eq!(outcome.status_code, 0);
        assert_eq!(outcome.response_json.as_deref(), Some(r#"{"id":"echo"}"#));
        assert_eq!(outcome.elapsed_ms, 42);
        assert!(outcome.status_details.is_empty());

        assert_eq!(
            captured.last_path.lock().await.as_deref(),
            Some("/test.Echo/Send")
        );
        assert_eq!(
            captured
                .last_metadata
                .lock()
                .await
                .as_ref()
                .unwrap()
                .get("x-request-id")
                .map(String::as_str),
            Some("abc")
        );
    }

    #[tokio::test]
    async fn forwards_max_message_bytes_to_transport() {
        let canned = UnaryOutcome {
            status_code: 0,
            status_message: "OK".into(),
            response_json: Some("{}".into()),
            trailing_metadata: HashMap::new(),
            status_details: Vec::new(),
            elapsed_ms: 1,
        };
        let t = FakeTransport::with_outcome(Ok(canned));
        let captured = t.clone();
        let conn = fake_connection(t);

        invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"x"}"#, HashMap::new(), CallOptions { max_message_bytes: 8 * 1024 * 1024 })
            .await
            .expect("invoke");

        assert_eq!(
            *captured.last_max_bytes.lock().await,
            Some(8 * 1024 * 1024),
            "invoke_unary must forward the byte limit to the transport"
        );
    }
}
