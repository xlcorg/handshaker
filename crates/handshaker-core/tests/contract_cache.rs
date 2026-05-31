//! `activate()` cache behavior, proven against real in-process servers.

mod common;

use std::sync::Arc;

use handshaker_core::grpc::{
    activate, build_catalog, ContractCache, ContractKey, GrpcTarget, InMemoryContractCache,
    TonicTransport,
};
use prost::Message;
use prost_reflect::DescriptorPool;

#[tokio::test]
async fn cache_hit_skips_reflection() {
    // A BARE server exposes NO reflection. If activate() consults the pre-populated
    // cache it succeeds; if it tried to reflect it would fail. So success proves the hit.
    let (addr, _shutdown) = common::spawn_bare_server().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let key = ContractKey::from_target(&target);

    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_set(
        Message::decode(&common::fixture_descriptor_set_bytes()[..]).unwrap(),
    )
    .unwrap();
    let catalog = build_catalog(&pool);

    let cache = InMemoryContractCache::new();
    cache.put(
        key,
        handshaker_core::grpc::CachedContract {
            pool,
            catalog,
            fetched_at: std::time::SystemTime::UNIX_EPOCH,
        },
    );

    let conn = activate(target, Arc::new(TonicTransport::new()), &cache)
        .await
        .expect("cache hit should let activate succeed against a reflection-less server");
    assert!(conn.catalog.services.iter().any(|s| s.full_name == "test.Echo"));
}

#[tokio::test]
async fn cache_miss_populates_then_invalidate_clears() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let key = ContractKey::from_target(&target);
    let cache = InMemoryContractCache::new();

    assert!(cache.get(&key).is_none());
    let _conn = activate(target.clone(), Arc::new(TonicTransport::new()), &cache)
        .await
        .expect("activate");
    assert!(cache.get(&key).is_some(), "cache miss should populate");

    cache.invalidate(&key);
    assert!(cache.get(&key).is_none(), "invalidate should clear");
}
