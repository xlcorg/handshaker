mod common;

use std::sync::Arc;

use handshaker_core::grpc::{
    activate, build_request_skeleton_from_pools, GrpcTarget, TonicTransport,
};

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
    // Smoke: the service's pool resolves the input message.
    assert!(conn
        .pools
        .for_service("test.Echo")
        .unwrap()
        .get_message_by_name("test.Ping")
        .is_some());
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

#[tokio::test]
async fn activate_survives_a_duplicate_symbol_server() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1_with_duplicate_symbol().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport = Arc::new(TonicTransport::new());

    let cache = handshaker_core::grpc::InMemoryContractCache::new();
    let conn = activate(target, transport, &cache)
        .await
        .expect("a duplicate symbol must not cost the whole endpoint");

    assert!(conn.catalog.services.iter().any(|s| s.full_name == "dupes.SvcA"));
    assert!(conn.catalog.services.iter().any(|s| s.full_name == "dupes.SvcB"));

    // Each service resolves its own copy of the shared DTO.
    let a = conn.pools.for_service("dupes.SvcA").unwrap();
    let b = conn.pools.for_service("dupes.SvcB").unwrap();
    assert!(a
        .get_message_by_name("dupes.SharedDto")
        .unwrap()
        .get_field_by_name("a_only")
        .is_some());
    assert!(b
        .get_message_by_name("dupes.SharedDto")
        .unwrap()
        .get_field_by_name("b_only")
        .is_some());

    // ...and the routing holds through the chain the UI actually reaches, not just through
    // `for_service` on its own: a skeleton is built per service, each from ITS OWN pool.
    // This is the user-visible outcome of the bug report — can the service be USED. Every
    // other skeleton/schema test feeds a `PoolSet::from_pool`, where any pool would do.
    let sk_a = build_request_skeleton_from_pools(&conn.pools, "dupes.SvcA", "Call")
        .expect("skeleton for SvcA");
    assert!(sk_a.contains("a_only") && !sk_a.contains("b_only"), "got {sk_a}");
    let sk_b = build_request_skeleton_from_pools(&conn.pools, "dupes.SvcB", "Call")
        .expect("skeleton for SvcB");
    assert!(sk_b.contains("b_only"), "got {sk_b}");
}
