mod common;

use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::invoke::invoke_unary;
use handshaker_core::grpc::transport::TonicTransport;
use std::collections::HashMap;
use std::sync::Arc;

#[tokio::test]
async fn server_not_found_appears_as_status_code_5() {
    let config = common::EchoConfig {
        return_status: Some(5), // NOT_FOUND
        trailers: HashMap::new(),
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
        r#"{"id":"x"}"#,
        HashMap::new(),
        usize::MAX,
    )
    .await
    .expect("invoke (status != OK is Ok, not Err)");

    assert_eq!(outcome.status_code, 5);
    assert!(
        outcome.status_message.contains("NotFound") || outcome.status_message.contains("NOT_FOUND"),
        "status_message = {}",
        outcome.status_message
    );
    assert!(outcome.response_json.is_none());
}
