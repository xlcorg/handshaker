//! Dynamic unary invoke API.
//!
//! - `UnaryOutcome` — single result type for one unary RPC: status + JSON response +
//!   trailing metadata + timing.
//! - `invoke_unary` — execute a unary RPC on an already-connected `GrpcConnection`.

use std::collections::HashMap;

use crate::error::CoreError;
use crate::grpc::connection::GrpcConnection;
use crate::grpc::descriptor::PoolSet;
use crate::grpc::transport::DynamicCodec;
use crate::stream::MethodKind;

pub(crate) mod skeleton;
pub mod schema;
mod well_known;
mod lenient;
mod status_details;
pub use schema::{
    build_message_schema_from_pools, EnumNode, EnumValueNode, FieldNode, FieldValueKind,
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
    /// Stream calls only: the "Request deadline" pref as a bound on each of the two
    /// phases of a stream call (Open → connected; half-close → stream start). `None` =
    /// unbounded. Unary ignores it — its deadline is the calling layer's race. No
    /// `grpc-timeout` header is ever derived from it.
    pub phase_timeout: Option<std::time::Duration>,
}

/// Outcome of one unary call. `status_code == 0` means success (`response_json` is `Some`).
/// Any other code is a normal non-OK gRPC status (`response_json` is `None`); in that case
/// `status_message` carries the server's raw status message (e.g. `"user does not exist"`);
/// the code itself is in `status_code`.
///
/// Client-side failures (transport / encode / decode) are returned as `Err(CoreError)`,
/// not as `UnaryOutcome` with non-zero `status_code`. See the design spec
/// (`docs/archive/specs/2026-05-27-plan-03-dynamic-invoke-design.md`) §6 for the
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

/// The one descriptor lookup every call path shares (unary invoke, skeleton, stream
/// open): `service` → `method` on the connection's pool set. Not found →
/// `ServiceNotFound` / `MethodNotFound`. Call paths gate on the kind through
/// [`find_method_of_kind`]; the skeleton / schema readers use this bare form.
pub(crate) fn find_method(
    pools: &PoolSet,
    service: &str,
    method: &str,
) -> Result<prost_reflect::MethodDescriptor, CoreError> {
    let svc = pools
        .for_service(service)
        .and_then(|p| p.get_service_by_name(service))
        .ok_or_else(|| CoreError::ServiceNotFound {
            service: service.to_string(),
        })?;
    let found = svc.methods().find(|m| m.name() == method);
    found.ok_or_else(|| CoreError::MethodNotFound {
        service: service.to_string(),
        method: method.to_string(),
    })
}

/// The **kind gate** — [`find_method`] plus the **Method kind** check every call path runs
/// before the call reaches the wire (the channel may already be open and reflection may
/// have run): `expected` is the kind the caller's path implies
/// (`invoke_unary` → `Unary`, `open_stream` → the kind the UI chose); a descriptor whose
/// kind differs is refused with `MethodKindMismatch { expected, actual }`. A stale UI can
/// never truncate a stream through the wrong path (tonic drops extra messages silently).
pub(crate) fn find_method_of_kind(
    pools: &PoolSet,
    service: &str,
    method: &str,
    expected: MethodKind,
) -> Result<prost_reflect::MethodDescriptor, CoreError> {
    let m = find_method(pools, service, method)?;
    let actual = MethodKind::of(&m);
    if actual != expected {
        return Err(CoreError::MethodKindMismatch {
            service: service.to_string(),
            method: method.to_string(),
            expected,
            actual,
        });
    }
    Ok(m)
}

/// Parse a request body (proto3 JSON, lenient trailing commas) into a `DynamicMessage`
/// of `input_desc`. Fail → `EncodeRequest`. Shared by unary invoke and stream open.
pub(crate) fn parse_request_json(
    input_desc: prost_reflect::MessageDescriptor,
    request_json: &str,
) -> Result<prost_reflect::DynamicMessage, CoreError> {
    let cleaned = lenient::strip_trailing_commas(request_json);
    let mut deserializer = serde_json::Deserializer::from_str(&cleaned);
    let msg = prost_reflect::DynamicMessage::deserialize(input_desc, &mut deserializer)
        .map_err(|e| CoreError::EncodeRequest(e.to_string()))?;
    // Consume trailing whitespace / catch trailing junk.
    deserializer
        .end()
        .map_err(|e| CoreError::EncodeRequest(e.to_string()))?;
    Ok(msg)
}

/// Serialize a decoded message to JSON the way the response viewer expects: fields at
/// their proto3 default value are **emitted** (prost-reflect's canonical JSON would omit
/// them, hiding zero-valued response fields — Postman / grpcurl show them) and field
/// names are the proto (snake_case) names, matching the Contract tab and the request
/// body. `pretty` picks the body view's indented form; compact is for previews.
/// See <https://docs.rs/prost-reflect/latest/prost_reflect/struct.SerializeOptions.html>.
pub(crate) fn message_to_json(
    msg: &prost_reflect::DynamicMessage,
    pretty: bool,
) -> Result<String, CoreError> {
    let options = prost_reflect::SerializeOptions::new()
        .skip_default_fields(false)
        .use_proto_field_name(true);
    let mut buf = Vec::new();
    let result = if pretty {
        let mut ser = serde_json::Serializer::pretty(&mut buf);
        msg.serialize_with_options(&mut ser, &options)
    } else {
        let mut ser = serde_json::Serializer::new(&mut buf);
        msg.serialize_with_options(&mut ser, &options)
    };
    result.map_err(|e| CoreError::DecodeResponse(e.to_string()))?;
    String::from_utf8(buf).map_err(|e| CoreError::DecodeResponse(e.to_string()))
}

/// The same proto3-JSON mapping as [`message_to_json`] (defaults emitted, proto field
/// names) as a `serde_json::Value` — for callers that compose several messages into one
/// document (Save messages: one array, pretty-printed as a whole).
pub(crate) fn message_to_json_value(
    msg: &prost_reflect::DynamicMessage,
) -> Result<serde_json::Value, CoreError> {
    let options = prost_reflect::SerializeOptions::new()
        .skip_default_fields(false)
        .use_proto_field_name(true);
    msg.serialize_with_options(serde_json::value::Serializer, &options)
        .map_err(|e| CoreError::DecodeResponse(e.to_string()))
}

/// Build a JSON skeleton for the request body of the given method, from a live connection.
///
/// Convenience wrapper over `build_request_skeleton_from_pools` for callers that already
/// hold a `GrpcConnection` — today only integration tests. The UI reaches the same code
/// through the `grpc_build_request_skeleton` command, which calls the pool-set variant
/// directly on both its cache-hit and its activate branch.
pub fn build_request_skeleton(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    build_request_skeleton_from_pools(&connection.pools, service, method)
}

/// Build a pretty-printed JSON skeleton for a method's input message, from a pool set.
///
/// Pool-set-based variant so callers without a live `GrpcConnection` (e.g. the lazy
/// connect-on-Send command surface) can build a skeleton straight from a cached
/// contract.
pub fn build_request_skeleton_from_pools(
    pools: &PoolSet,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    let m = find_method(pools, service, method)?;
    let input_desc = m.input();
    let value = skeleton::build_default_json_skeleton(&input_desc);
    serde_json::to_string_pretty(&value).map_err(|e| CoreError::EncodeRequest(e.to_string()))
}

/// Execute a unary RPC.
///
/// 1. Resolves `service`/`method` from `connection.pools`. Not found → `ServiceNotFound` / `MethodNotFound`.
/// 2. The kind gate: a streaming method → `MethodKindMismatch { expected: Unary, actual }`
///    (it belongs to `Sender::open_stream`), before the call reaches the wire (the channel
///    may already be open and reflection may have run).
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
    let m = find_method_of_kind(&connection.pools, service, method, MethodKind::Unary)?;

    let input_desc = m.input();
    let output_desc = m.output();

    let request_msg = parse_request_json(input_desc.clone(), request_json)?;

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
    use crate::stream::MethodKind;
    use std::collections::HashMap;

    #[test]
    fn skeleton_from_pool_builds_for_known_method() {
        let pools = PoolSet::from_pool(fixture_pool());
        let s = build_request_skeleton_from_pools(&pools, "test.Echo", "Send").expect("skeleton");
        assert!(s.contains("\"id\""), "got {s}");
    }

    #[test]
    fn skeleton_from_pool_unknown_service_errors() {
        let pools = PoolSet::from_pool(fixture_pool());
        let err = build_request_skeleton_from_pools(&pools, "no.Such", "Send").unwrap_err();
        assert!(matches!(err, CoreError::ServiceNotFound { .. }), "got {err:?}");
    }

    #[tokio::test]
    async fn unknown_service_returns_service_not_found() {
        let t = FakeTransport::with_outcome(Err(CoreError::NotImplemented("unreached".into())));
        let conn = fake_connection(t);
        let err = invoke_unary(&conn, "no.Such", "Send", "{}", HashMap::new(), CallOptions { max_message_bytes: usize::MAX, phase_timeout: None })
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
        let err = invoke_unary(&conn, "test.Echo", "Nope", "{}", HashMap::new(), CallOptions { max_message_bytes: usize::MAX, phase_timeout: None })
            .await
            .unwrap_err();
        assert!(
            matches!(err, CoreError::MethodNotFound { ref service, ref method }
                if service == "test.Echo" && method == "Nope"),
            "got {err:?}"
        );
    }

    /// The kind gate: the unary path on a streaming method is refused before the
    /// transport is touched — `expected` is the path used (unary), `actual` the
    /// descriptor's kind.
    #[tokio::test]
    async fn unary_path_on_a_streaming_method_is_a_kind_mismatch_and_never_reaches_the_transport() {
        for (method, actual) in [
            ("ServerStream", MethodKind::Server),
            ("ClientStream", MethodKind::Client),
            ("Bidi", MethodKind::Bidi),
        ] {
            let t = FakeTransport::with_outcome(Err(CoreError::NotImplemented("unreached".into())));
            let recorder = t.clone();
            let conn = fake_connection(t);
            let err = invoke_unary(&conn, "test.Echo", method, "{}", HashMap::new(), CallOptions { max_message_bytes: usize::MAX, phase_timeout: None })
                .await
                .unwrap_err();
            match err {
                CoreError::MethodKindMismatch { service, method: m, expected, actual: a } => {
                    assert_eq!((service.as_str(), m.as_str()), ("test.Echo", method));
                    assert_eq!(expected, MethodKind::Unary);
                    assert_eq!(a, actual);
                }
                other => panic!("got {other:?}"),
            }
            assert_eq!(recorder.unary_calls.load(std::sync::atomic::Ordering::Relaxed), 0, "{method}");
        }
    }

    #[tokio::test]
    async fn invalid_json_returns_encode_request() {
        let t = FakeTransport::with_outcome(Err(CoreError::NotImplemented("unreached".into())));
        let conn = fake_connection(t);
        let err = invoke_unary(&conn, "test.Echo", "Send", "not json {", HashMap::new(), CallOptions { max_message_bytes: usize::MAX, phase_timeout: None })
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

        let outcome = invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"hi"}"#, metadata, CallOptions { max_message_bytes: usize::MAX, phase_timeout: None })
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

        invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"x"}"#, HashMap::new(), CallOptions { max_message_bytes: 8 * 1024 * 1024, phase_timeout: None })
            .await
            .expect("invoke");

        assert_eq!(
            *captured.last_max_bytes.lock().await,
            Some(8 * 1024 * 1024),
            "invoke_unary must forward the byte limit to the transport"
        );
    }
}
