//! Shared gRPC test support (`#[cfg(test)]`-only): the fake transport and fixture
//! connection previously private to the invoke unit tests, reusable by any test
//! module inside `handshaker-core` that needs to drive invoke-level code without
//! a network (not visible cross-crate; the upcoming Send module lives in core).
//!
//! The `tonic` channel below is inert fixture wiring — `GrpcConnection` requires
//! the field, but `FakeTransport` never touches it. The "tonic-free outside
//! `grpc/transport`" invariant is about production code paths.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use prost::Message as _;
use prost_reflect::{DescriptorPool, DynamicMessage};
use tokio::sync::Mutex;

use crate::error::CoreError;
use crate::grpc::connection::{GrpcConnection, GrpcTarget};
use crate::grpc::invoke::{CallOptions, UnaryOutcome};
use crate::grpc::transport::{DynamicCodec, GrpcTransport, TonicChannel};

/// Fixture pool with `test.Echo / Send` schema (Ping → Pong).
pub fn fixture_pool() -> DescriptorPool {
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
/// `channel()` is unused by invoke-level tests (all logic happens before transport).
#[derive(Default)]
pub struct FakeTransport {
    pub outcome: Mutex<Option<Result<UnaryOutcome, CoreError>>>,
    pub last_path: Mutex<Option<String>>,
    pub last_metadata: Mutex<Option<HashMap<String, String>>>,
    pub last_max_bytes: Mutex<Option<usize>>,
}

impl FakeTransport {
    pub fn with_outcome(o: Result<UnaryOutcome, CoreError>) -> Arc<Self> {
        let t = Arc::new(Self::default());
        *t.outcome.try_lock().unwrap() = Some(o);
        t
    }
}

#[async_trait]
impl GrpcTransport for FakeTransport {
    async fn channel(&self, _target: &GrpcTarget) -> Result<TonicChannel, CoreError> {
        Err(CoreError::NotImplemented("FakeTransport.channel".into()))
    }

    async fn unary_dynamic(
        &self,
        _channel: TonicChannel,
        method_path: String,
        _codec: DynamicCodec,
        _request: DynamicMessage,
        metadata: HashMap<String, String>,
        opts: CallOptions,
    ) -> Result<UnaryOutcome, CoreError> {
        *self.last_path.lock().await = Some(method_path);
        *self.last_metadata.lock().await = Some(metadata);
        *self.last_max_bytes.lock().await = Some(opts.max_message_bytes);
        self.outcome.lock().await.take().expect("outcome set")
    }
}

/// A `GrpcConnection` over the fixture pool and the given (usually fake) transport.
pub fn fake_connection(transport: Arc<dyn GrpcTransport>) -> GrpcConnection {
    let pool = fixture_pool();
    let catalog = crate::grpc::catalog::build::build_catalog(&pool);
    // Lazy channel to a bogus address — never used by FakeTransport, but the field must exist.
    let channel = tonic::transport::Channel::from_static("http://127.0.0.1:1").connect_lazy();
    GrpcConnection {
        target: GrpcTarget::new("127.0.0.1:1", false, false).unwrap(),
        transport,
        channel,
        pool,
        catalog,
    }
}

// No `#[cfg(test)]` needed — the whole module is already test-gated in `grpc/mod.rs`.
mod tests {
    use super::*;
    use crate::grpc::invoke::invoke_unary;

    /// AC (#12): a core test OUTSIDE the invoke module composes the fake transport
    /// with invoke-level code and gets the canned outcome back.
    #[tokio::test]
    async fn fake_transport_drives_invoke_level_code_with_canned_outcome() {
        let canned = UnaryOutcome {
            status_code: 0,
            status_message: "OK".into(),
            response_json: Some(r#"{"id":"echo"}"#.into()),
            trailing_metadata: HashMap::new(),
            status_details: Vec::new(),
            elapsed_ms: 7,
        };
        let t = FakeTransport::with_outcome(Ok(canned));
        let conn = fake_connection(t);

        let opts = CallOptions { max_message_bytes: usize::MAX };
        let outcome = invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"hi"}"#, HashMap::new(), opts)
            .await
            .expect("invoke");
        assert_eq!(outcome.status_code, 0);
        assert_eq!(outcome.response_json.as_deref(), Some(r#"{"id":"echo"}"#));
    }
}
