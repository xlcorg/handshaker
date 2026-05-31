mod common;

use std::sync::Arc;

use handshaker_core::grpc::{activate, GrpcTarget, TonicTransport};

#[tokio::test]
async fn activate_against_v1_server_yields_catalog() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport = Arc::new(TonicTransport::new());

    let cache = handshaker_core::grpc::InMemoryContractCache::new();
    let conn = activate(target, transport, &cache).await.expect("activate");

    assert!(conn.catalog.services.iter().any(|s| s.full_name == "test.Echo"));
    let echo = conn
        .catalog
        .services
        .iter()
        .find(|s| s.full_name == "test.Echo")
        .unwrap();
    assert_eq!(echo.methods.len(), 1);
    assert_eq!(echo.methods[0].path, "/test.Echo/Send");
    // Smoke: the pool resolves the input message.
    assert!(conn.pool.get_message_by_name("test.Ping").is_some());
}

#[tokio::test]
async fn activate_against_v1alpha_server_falls_back_and_succeeds() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1alpha().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport = Arc::new(TonicTransport::new());

    let cache = handshaker_core::grpc::InMemoryContractCache::new();
    let conn = activate(target, transport, &cache).await.expect("activate w/ fallback");

    assert!(conn.catalog.services.iter().any(|s| s.full_name == "test.Echo"));
}
