//! Contract load. A probe reads the cache and dials only on a miss. Send opens
//! one channel after the same lookup and reflects on that channel when the
//! cache misses.

use std::sync::Arc;

use crate::error::CoreError;
use crate::grpc::catalog::build_catalog;
use crate::grpc::connection::{GrpcConnection, GrpcTarget};
use crate::grpc::contract_cache::{CachedContract, ContractCache, ContractKey};
use crate::grpc::descriptor::build_pool_set;
use crate::grpc::reflection::list_and_fetch_files;
use crate::grpc::transport::{GrpcTransport, TonicChannel};

pub async fn activate(
    target: GrpcTarget,
    transport: Arc<dyn GrpcTransport>,
    cache: &dyn ContractCache,
) -> Result<GrpcConnection, CoreError> {
    let key = ContractKey::from_target(&target);
    if let Some(cached) = cache.get(&key) {
        let channel = transport.channel(&target).await?;
        return Ok(connection(target, transport, channel, cached));
    }
    let channel = transport.channel(&target).await?;
    let cached = reflect(channel.clone()).await?;
    cache.put(key, cached.clone());
    Ok(connection(target, transport, channel, cached))
}

pub(crate) async fn load_contract(
    target: &GrpcTarget,
    transport: &dyn GrpcTransport,
    cache: &dyn ContractCache,
) -> Result<(CachedContract, bool), CoreError> {
    let key = ContractKey::from_target(target);
    if let Some(cached) = cache.get(&key) {
        return Ok((cached, false));
    }
    let channel = transport.channel(target).await?;
    let cached = reflect(channel).await?;
    cache.put(key, cached.clone());
    Ok((cached, true))
}

async fn reflect(channel: TonicChannel) -> Result<CachedContract, CoreError> {
    let (_services_listed, files) = list_and_fetch_files(channel).await?;
    let pools = build_pool_set(&files)?;
    let catalog = build_catalog(&pools);
    Ok(CachedContract {
        files: Arc::new(files),
        pools,
        catalog,
        fetched_at: std::time::SystemTime::now(),
    })
}

fn connection(
    target: GrpcTarget,
    transport: Arc<dyn GrpcTransport>,
    channel: TonicChannel,
    cached: CachedContract,
) -> GrpcConnection {
    GrpcConnection {
        target,
        transport,
        channel,
        pools: cached.pools,
        catalog: cached.catalog,
    }
}
