//! Transport abstraction. Tonic-specific channel lives in `tonic_impl`.
//!
//! The trait surface stays minimal in Plan #2: only `channel(...)` for opening an HTTP/2
//! connection. `unary_dynamic(...)` joins in Plan #3 (dynamic invoke).

pub mod tonic_impl;
pub mod codec;

use crate::error::CoreError;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::invoke::CallOptions;

/// Re-export so callers don't reach into `tonic::transport` directly.
pub type TonicChannel = tonic::transport::Channel;

#[async_trait::async_trait]
pub trait GrpcTransport: Send + Sync {
    /// Open an HTTP/2 channel to `target`. Plan #2.
    async fn channel(&self, target: &GrpcTarget) -> Result<TonicChannel, CoreError>;

    /// Execute a unary RPC on an already-open channel. Plan #3 — signature from master spec §5.6.
    ///
    /// - `channel` is taken by value (cheap Clone from `GrpcConnection.channel`).
    /// - `method_path` — `/package.Service/Method`.
    /// - `request_codec` — `DynamicCodec` with both descriptors.
    /// - `request` — already-parsed DynamicMessage (JSON parsing is invoke_unary's job).
    /// - `metadata` — ASCII keys; binary (`-bin` suffix) is rejected as `EncodeRequest`.
    /// - `opts` — per-call invoke options (e.g. max decode/encode message size).
    ///
    /// Returns `UnaryOutcome` for ALL gRPC responses, including non-OK status.
    /// `Err(CoreError)` only for client-side failures (channel ready fail, encode/decode).
    async fn unary_dynamic(
        &self,
        channel: TonicChannel,
        method_path: String,
        request_codec: DynamicCodec,
        request: prost_reflect::DynamicMessage,
        metadata: std::collections::HashMap<String, String>,
        opts: CallOptions,
    ) -> Result<crate::grpc::UnaryOutcome, CoreError>;
}

pub use tonic_impl::TonicTransport;
pub use codec::DynamicCodec;

#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-only check: the trait must expose `unary_dynamic` with the exact signature
    /// from master spec §5.6.
    #[allow(dead_code)]
    async fn _trait_has_unary_dynamic<T: GrpcTransport>(
        t: &T,
        channel: TonicChannel,
        method_path: String,
        request_codec: crate::grpc::transport::DynamicCodec,
        request: prost_reflect::DynamicMessage,
        metadata: std::collections::HashMap<String, String>,
        opts: CallOptions,
    ) -> Result<crate::grpc::UnaryOutcome, crate::error::CoreError> {
        t.unary_dynamic(channel, method_path, request_codec, request, metadata, opts).await
    }
}
