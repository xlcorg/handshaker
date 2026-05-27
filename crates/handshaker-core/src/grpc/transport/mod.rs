//! Transport abstraction. Tonic-specific channel lives in `tonic_impl`.
//!
//! The trait surface stays minimal in Plan #2: only `channel(...)` for opening an HTTP/2
//! connection. `unary_dynamic(...)` joins in Plan #3 (dynamic invoke).

pub mod tonic_impl;
pub mod codec;

use crate::error::CoreError;
use crate::grpc::connection::GrpcTarget;

/// Re-export so callers don't reach into `tonic::transport` directly.
pub type TonicChannel = tonic::transport::Channel;

#[async_trait::async_trait]
pub trait GrpcTransport: Send + Sync {
    /// Open a fresh HTTP/2 channel to `target`.
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError>;
}

pub use tonic_impl::TonicTransport;
pub use codec::DynamicCodec;
