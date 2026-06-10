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
pub use schema::{
    build_message_schema_from_pool, EnumNode, FieldNode, FieldValueKind, MessageNode,
    MessageSchema, MessageSide,
};

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

    let mut deserializer = serde_json::Deserializer::from_str(request_json);
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
        .unary_dynamic(connection.channel.clone(), path, codec, request_msg, metadata)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::CoreError;
    use crate::grpc::transport::{DynamicCodec, GrpcTransport, TonicChannel};
    use async_trait::async_trait;
    use prost::Message as _;
    use prost_reflect::{DescriptorPool, DynamicMessage};
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    /// Fixture pool with `test.Echo / Send` schema (Ping → Pong).
    fn fixture_pool() -> DescriptorPool {
        use prost_types::{field_descriptor_proto::Type as Ty, *};
        let ping = DescriptorProto {
            name: Some("Ping".into()),
            field: vec![FieldDescriptorProto {
                name: Some("id".into()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let pong = DescriptorProto {
            name: Some("Pong".into()),
            field: vec![FieldDescriptorProto {
                name: Some("id".into()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let service = ServiceDescriptorProto {
            name: Some("Echo".into()),
            method: vec![MethodDescriptorProto {
                name: Some("Send".into()),
                input_type: Some(".test.Ping".into()),
                output_type: Some(".test.Pong".into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("t.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![ping, pong],
            service: vec![service],
            ..Default::default()
        };
        let set = FileDescriptorSet { file: vec![file] };
        let mut buf = Vec::new();
        set.encode(&mut buf).unwrap();
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(FileDescriptorSet::decode(&buf[..]).unwrap())
            .unwrap();
        pool
    }

    /// Test seam — captures the last `unary_dynamic` call and returns a canned outcome.
    /// `channel()` is unused by invoke unit tests (all logic happens before transport).
    #[derive(Default)]
    struct FakeTransport {
        outcome: Mutex<Option<Result<UnaryOutcome, CoreError>>>,
        last_path: Mutex<Option<String>>,
        last_metadata: Mutex<Option<HashMap<String, String>>>,
    }

    impl FakeTransport {
        fn with_outcome(o: Result<UnaryOutcome, CoreError>) -> Arc<Self> {
            let t = Arc::new(Self::default());
            *t.outcome.try_lock().unwrap() = Some(o);
            t
        }
    }

    #[async_trait]
    impl GrpcTransport for FakeTransport {
        async fn channel(
            &self,
            _target: &crate::grpc::connection::GrpcTarget,
        ) -> Result<TonicChannel, CoreError> {
            Err(CoreError::NotImplemented("FakeTransport.channel".into()))
        }

        async fn unary_dynamic(
            &self,
            _channel: TonicChannel,
            method_path: String,
            _codec: DynamicCodec,
            _request: DynamicMessage,
            metadata: HashMap<String, String>,
        ) -> Result<UnaryOutcome, CoreError> {
            *self.last_path.lock().await = Some(method_path);
            *self.last_metadata.lock().await = Some(metadata);
            self.outcome.lock().await.take().expect("outcome set")
        }
    }

    fn fake_connection(transport: Arc<dyn GrpcTransport>) -> crate::grpc::connection::GrpcConnection
    {
        let pool = fixture_pool();
        let catalog = crate::grpc::catalog::build::build_catalog(&pool);
        // Lazy channel to a bogus address — never used by FakeTransport, but the field must exist.
        let channel = tonic::transport::Channel::from_static("http://127.0.0.1:1").connect_lazy();
        crate::grpc::connection::GrpcConnection {
            target: crate::grpc::connection::GrpcTarget::new("127.0.0.1:1", false, false).unwrap(),
            transport,
            channel,
            pool,
            catalog,
        }
    }

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
        let err = invoke_unary(&conn, "no.Such", "Send", "{}", HashMap::new())
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
        let err = invoke_unary(&conn, "test.Echo", "Nope", "{}", HashMap::new())
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
        let err = invoke_unary(&conn, "test.Echo", "Send", "not json {", HashMap::new())
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
            elapsed_ms: 42,
        };
        let t = FakeTransport::with_outcome(Ok(canned.clone()));
        let captured = t.clone();
        let conn = fake_connection(t);

        let mut metadata = HashMap::new();
        metadata.insert("x-request-id".into(), "abc".into());

        let outcome = invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"hi"}"#, metadata)
            .await
            .expect("invoke");
        assert_eq!(outcome.status_code, 0);
        assert_eq!(outcome.response_json.as_deref(), Some(r#"{"id":"echo"}"#));
        assert_eq!(outcome.elapsed_ms, 42);

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
}
