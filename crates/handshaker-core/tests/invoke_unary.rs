mod common;

use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::invoke::invoke_unary;
use handshaker_core::grpc::transport::TonicTransport;
use std::collections::HashMap;
use std::sync::Arc;

#[tokio::test]
async fn echo_send_returns_pong_with_echoed_id() {
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig::default()).await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let cache = handshaker_core::grpc::InMemoryContractCache::new();
    let conn = activate(target, transport, &cache).await.expect("activate");

    let outcome = invoke_unary(
        &conn,
        "test.Echo",
        "Send",
        r#"{"id":"hello"}"#,
        HashMap::new(),
        usize::MAX,
    )
    .await
    .expect("invoke");

    assert_eq!(outcome.status_code, 0, "status: {}", outcome.status_message);
    let json = outcome.response_json.expect("response_json present");
    let v: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
    assert_eq!(v["id"], serde_json::json!("hello"));
    assert_eq!(v["echoed"], serde_json::json!("echo: hello"));
    // elapsed_ms can be 0 on fast machines — just ensure the field exists.
    let _ = outcome.elapsed_ms;
}
