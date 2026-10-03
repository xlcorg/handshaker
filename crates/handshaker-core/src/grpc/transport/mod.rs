//! Transport abstraction. Tonic-specific channel lives in `tonic_impl`.
//!
//! Three methods: `channel(...)` opens an HTTP/2 connection (Plan #2), `unary_dynamic(...)`
//! runs one unary RPC (Plan #3), `stream_dynamic(...)` opens a **Stream call** of any
//! kind over raw message bytes (ADR-0002). Nothing tonic-typed leaks out of the trait:
//! the stream side speaks `Bytes`, `StreamStart` and `StreamEnd`.

pub mod tonic_impl;
pub mod codec;

use std::collections::HashMap;
use std::pin::Pin;

use bytes::Bytes;
use futures_util::Stream;

use crate::error::CoreError;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::invoke::{CallOptions, StatusDetail};

/// Re-export so callers don't reach into `tonic::transport` directly.
pub type TonicChannel = tonic::transport::Channel;

/// Outbound messages of a stream call, already encoded. Ending the stream is the
/// half-close (there is no separate API on the wire). Server-streaming = `once(bytes)`.
pub type OutboundStream = Pin<Box<dyn Stream<Item = Bytes> + Send>>;

/// Inbound messages of a stream call as raw encoded bytes. The stream yields exactly one
/// `Err(StreamEnd)` — the **Stream end** (OK or non-OK) — as its last item and then
/// `None`; dropping it before that cancels the call on the wire (h2 `RST_STREAM`).
pub type InboundStream = Pin<Box<dyn Stream<Item = Result<Bytes, StreamEnd>> + Send>>;

/// **Stream start**: the server's initial metadata plus the inbound stream.
pub struct StreamStart {
    /// Response headers (ASCII only; `-bin` keys skipped).
    pub headers: HashMap<String, String>,
    pub inbound: InboundStream,
}

/// **Stream end**: the final gRPC status of a stream call — the unary outcome minus the
/// body. `status_code == 0` is a clean OK end; anything else is the server's (or the
/// transport's) status. Trailers-only responses arrive as a `StreamEnd` with no messages
/// before it.
#[derive(Debug, Clone)]
pub struct StreamEnd {
    pub status_code: i32,
    pub status_message: String,
    pub status_details: Vec<StatusDetail>,
    pub trailing_metadata: HashMap<String, String>,
}

impl StreamEnd {
    pub fn ok(trailing_metadata: HashMap<String, String>) -> Self {
        Self {
            status_code: 0,
            status_message: "OK".into(),
            status_details: Vec::new(),
            trailing_metadata,
        }
    }
}

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

    /// Open a **Stream call** of any kind on an already-open channel. Always tonic
    /// `Grpc::streaming()` over the raw-bytes `RawCodec` underneath (the transport's
    /// detail — core never sees a codec here) — the method kind only decides what feeds
    /// `outbound` (core's job): `once(body)` for server-streaming, a channel for
    /// client/bidi.
    ///
    /// The `await` resolves at **Stream start** (initial metadata received). A non-OK
    /// status at that point (trailers-only, dead channel → UNAVAILABLE) is still
    /// `Ok(StreamStart)` whose inbound yields the `StreamEnd` at once. `Err(CoreError)`
    /// covers client-side failures only (channel not ready, bad path/metadata).
    ///
    /// No `grpc-timeout` header is sent; deadlines are the caller's timers.
    async fn stream_dynamic(
        &self,
        channel: TonicChannel,
        method_path: String,
        outbound: OutboundStream,
        metadata: HashMap<String, String>,
        opts: CallOptions,
    ) -> Result<StreamStart, CoreError>;
}

pub use tonic_impl::TonicTransport;
pub use codec::{DynamicCodec, RawCodec};

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
