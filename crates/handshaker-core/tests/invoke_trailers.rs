mod common;

use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::invoke::{invoke_unary, CallOptions};
use handshaker_core::grpc::transport::TonicTransport;
use std::collections::HashMap;
use std::sync::Arc;

#[tokio::test]
async fn trailing_metadata_is_captured() {
    let mut trailers = HashMap::new();
    trailers.insert("x-trace-id".to_string(), "trace-123".to_string());
    trailers.insert("x-server-hostname".to_string(), "echo-1".to_string());

    let config = common::EchoConfig {
        return_status: None, // OK response
        trailers: trailers.clone(),
    };
    let (addr, _stop) = common::spawn_echo_server(config).await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let cache = handshaker_core::grpc::InMemoryContractCache::new();
    let conn = activate(target, transport, &cache).await.expect("activate");

    let outcome = invoke_unary(
        &conn,
        "test.Echo",
        "Send",
        r#"{"id":"trail"}"#,
        HashMap::new(),
        CallOptions { max_message_bytes: usize::MAX },
    )
    .await
    .expect("invoke");

    assert_eq!(outcome.status_code, 0);
    assert_eq!(
        outcome.trailing_metadata.get("x-trace-id").map(String::as_str),
        Some("trace-123")
    );
    assert_eq!(
        outcome
            .trailing_metadata
            .get("x-server-hostname")
            .map(String::as_str),
        Some("echo-1")
    );
}
