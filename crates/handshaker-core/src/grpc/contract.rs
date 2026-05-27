//! Top-level orchestration: open channel → run reflection → build pool → build catalog.

use std::sync::Arc;

use crate::error::CoreError;
use crate::grpc::catalog::build_catalog;
use crate::grpc::connection::{GrpcConnection, GrpcTarget};
use crate::grpc::descriptor::build_pool;
use crate::grpc::reflection::list_and_fetch_files;
use crate::grpc::transport::GrpcTransport;

/// Open a channel to `target`, retrieve the contract via reflection (v1 → v1alpha fallback),
/// and return a ready-to-use `GrpcConnection`.
pub async fn activate(
    target: GrpcTarget,
    transport: Arc<dyn GrpcTransport>,
) -> Result<GrpcConnection, CoreError> {
    let channel = transport.channel(&target).await?;
    // clone — TonicChannel is cheap to Clone (Arc internally); reflection consumes its copy,
    // and the original stays in GrpcConnection for subsequent invokes.
    let (_services_listed, files) = list_and_fetch_files(channel.clone()).await?;
    let pool = build_pool(files)?;
    let catalog = build_catalog(&pool);
    Ok(GrpcConnection {
        target,
        transport,
        channel,
        pool,
        catalog,
    })
}
