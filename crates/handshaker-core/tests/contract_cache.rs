//! `activate()` cache behavior, proven against real in-process servers.

mod common;

use std::sync::Arc;

use handshaker_core::grpc::{
    activate, build_catalog, build_pool_set, ContractCache, ContractKey, FileContractCache,
    GrpcTarget, InMemoryContractCache, TonicTransport,
};
use prost::Message;

#[tokio::test]
async fn cache_hit_skips_reflection() {
    // A BARE server exposes NO reflection. If activate() consults the pre-populated
    // cache it succeeds; if it tried to reflect it would fail. So success proves the hit.
    let (addr, _shutdown) = common::spawn_bare_server().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let key = ContractKey::from_target(&target);

    let set: prost_types::FileDescriptorSet =
        Message::decode(&common::fixture_descriptor_set_bytes()[..]).unwrap();
    let pools = build_pool_set(&set.file).unwrap();
    let catalog = build_catalog(&pools);

    let cache = InMemoryContractCache::new();
    cache.put(
        key,
        handshaker_core::grpc::CachedContract {
            files: Arc::new(set.file),
            pools,
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

/// The whole chain that keeps a restart cheap: `activate` writes the raw corpus it
/// reflected into a disk-backed cache, and the next launch rebuilds every pool from it.
///
/// Only the two ends are ever unit-tested (`activate` against an in-memory cache;
/// `FileContractCache` against a hand-built `CachedContract`), so nothing else notices if
/// `activate` stops storing the corpus: `build_pool_set(&[])` would reject each entry on
/// load, every endpoint would silently re-reflect on every start, and no test would fail.
/// The duplicate-symbol server is the demanding case — its contract needs several pools,
/// so a reload that restored only one would be caught here too.
#[tokio::test]
async fn activate_populates_a_disk_cache_that_survives_a_restart() {
    let (addr, _shutdown) = common::spawn_reflection_server_v1_with_duplicate_symbol().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let key = ContractKey::from_target(&target);
    let dir = tempfile::tempdir().unwrap();

    let cache = FileContractCache::load(dir.path().to_path_buf()).expect("load empty cache");
    assert!(cache.get(&key).is_none(), "a fresh directory holds nothing");
    let conn = activate(target, Arc::new(TonicTransport::new()), &cache)
        .await
        .expect("activate against the duplicate-symbol server");
    // 3, not 2: `build_v1()` also registers tonic-reflection's own descriptors, so the
    // reflection service itself is a third root the crawl reaches.
    assert_eq!(conn.pools.pool_count(), 3, "two conflicting services plus the reflection one");
    drop(cache);

    // A second launch over the same directory: no server call, everything from disk.
    let reloaded = FileContractCache::load(dir.path().to_path_buf()).expect("reload cache");
    let got = reloaded.get(&key).expect("the entry activate wrote must survive a restart");
    assert_eq!(got.pools.pool_count(), 3, "every pool is rebuilt, not just the first");
    assert!(got.pools.for_service("dupes.SvcA").is_some());
    assert!(got.pools.for_service("dupes.SvcB").is_some());
    assert_eq!(got.catalog, conn.catalog);
}
