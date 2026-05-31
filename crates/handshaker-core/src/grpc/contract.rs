//! Top-level orchestration: open channel → (cache hit?) → run reflection → build
//! pool → build catalog → cache. On a cache hit, reflection is skipped entirely.

use std::sync::Arc;

use crate::error::CoreError;
use crate::grpc::catalog::build_catalog;
use crate::grpc::connection::{GrpcConnection, GrpcTarget};
use crate::grpc::contract_cache::{CachedContract, ContractCache, ContractKey};
use crate::grpc::descriptor::build_pool;
use crate::grpc::reflection::list_and_fetch_files;
use crate::grpc::transport::GrpcTransport;

/// Open a channel to `target`. If `cache` already holds the contract for
/// `(address, tls)`, build the connection from the cached pool/catalog and skip
/// reflection. Otherwise reflect, build, and populate the cache.
///
/// The channel is always opened fresh (it is per-connection, never cached).
pub async fn activate(
    target: GrpcTarget,
    transport: Arc<dyn GrpcTransport>,
    cache: &dyn ContractCache,
) -> Result<GrpcConnection, CoreError> {
    let key = ContractKey::from_target(&target);
    let channel = transport.channel(&target).await?;

    if let Some(cached) = cache.get(&key) {
        return Ok(GrpcConnection {
            target,
            transport,
            channel,
            pool: cached.pool,
            catalog: cached.catalog,
        });
    }

    // clone — TonicChannel is cheap to Clone (Arc internally); reflection consumes
    // its copy, the original stays in GrpcConnection for subsequent invokes.
    let (_services_listed, files) = list_and_fetch_files(channel.clone()).await?;
    let pool = build_pool(files)?;
    let catalog = build_catalog(&pool);

    cache.put(
        key,
        CachedContract {
            pool: pool.clone(),
            catalog: catalog.clone(),
            fetched_at: std::time::SystemTime::now(),
        },
    );

    Ok(GrpcConnection { target, transport, channel, pool, catalog })
}
