//! Shared gRPC test support: the fake transport and fixture connection, reusable by
//! any test module inside `handshaker-core` (`#[cfg(test)]`) and — behind the
//! `test-support` feature — by the IPC crate's tests, so `stream_open_impl` can run
//! over a scripted stream without a network.
//!
//! The `tonic` channel below is inert fixture wiring — `GrpcConnection` requires
//! the field, but `FakeTransport` never touches it. The "tonic-free outside
//! `grpc/transport`" invariant is about production code paths.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use prost::Message as _;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor, Value};
use tokio::sync::Mutex;

use crate::error::CoreError;
use crate::grpc::connection::{GrpcConnection, GrpcTarget};
use crate::grpc::invoke::{CallOptions, UnaryOutcome};
use crate::grpc::transport::{
    DynamicCodec, GrpcTransport, OutboundStream, StreamEnd, StreamStart, TonicChannel,
};
use bytes::Bytes;

/// Fixture pool with the `test.Echo` schema: `Send(Ping) → Pong`,
/// `ServerStream(Ping) → stream Pong`, `ClientStream(stream Ping) → Pong`,
/// `Bidi(stream Ping) → stream Pong` and `Download(Ping) → stream Chunk { name, data }`
/// (the one response type with a `bytes` field — Assemble's candidate).
pub fn fixture_pool() -> DescriptorPool {
    use prost_types::{field_descriptor_proto::Type as Ty, *};
    let ping = DescriptorProto {
        name: Some("Ping".into()),
        field: vec![FieldDescriptorProto {
            name: Some("id".into()),
            number: Some(1),
            r#type: Some(Ty::String as i32),
            ..Default::default()
        }],
        ..Default::default()
    };
    let pong = DescriptorProto {
        name: Some("Pong".into()),
        field: vec![FieldDescriptorProto {
            name: Some("id".into()),
            number: Some(1),
            r#type: Some(Ty::String as i32),
            ..Default::default()
        }],
        ..Default::default()
    };
    let chunk = DescriptorProto {
        name: Some("Chunk".into()),
        field: vec![
            FieldDescriptorProto {
                name: Some("name".into()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                ..Default::default()
            },
            FieldDescriptorProto {
                name: Some("data".into()),
                number: Some(2),
                r#type: Some(Ty::Bytes as i32),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let service = ServiceDescriptorProto {
        name: Some("Echo".into()),
        method: vec![
            MethodDescriptorProto {
                name: Some("Send".into()),
                input_type: Some(".test.Ping".into()),
                output_type: Some(".test.Pong".into()),
                ..Default::default()
            },
            MethodDescriptorProto {
                name: Some("ServerStream".into()),
                input_type: Some(".test.Ping".into()),
                output_type: Some(".test.Pong".into()),
                server_streaming: Some(true),
                ..Default::default()
            },
            MethodDescriptorProto {
                name: Some("ClientStream".into()),
                input_type: Some(".test.Ping".into()),
                output_type: Some(".test.Pong".into()),
                client_streaming: Some(true),
                ..Default::default()
            },
            MethodDescriptorProto {
                name: Some("Bidi".into()),
                input_type: Some(".test.Ping".into()),
                output_type: Some(".test.Pong".into()),
                client_streaming: Some(true),
                server_streaming: Some(true),
                ..Default::default()
            },
            MethodDescriptorProto {
                name: Some("Download".into()),
                input_type: Some(".test.Ping".into()),
                output_type: Some(".test.Chunk".into()),
                server_streaming: Some(true),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let file = FileDescriptorProto {
        name: Some("t.proto".into()),
        package: Some("test".into()),
        syntax: Some("proto3".into()),
        message_type: vec![ping, pong, chunk],
        service: vec![service],
        ..Default::default()
    };
    let set = FileDescriptorSet { file: vec![file] };
    let mut buf = Vec::new();
    set.encode(&mut buf).unwrap();
    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_set(FileDescriptorSet::decode(&buf[..]).unwrap())
        .unwrap();
    pool
}

/// Test seam — captures the last `unary_dynamic` call and returns a canned outcome.
/// `channel()` hands out an inert lazy channel (never connected) so `activate`-level
/// code composes with the fake; `channel_calls` counts those handouts so tests can
/// assert the transport was never touched.
#[derive(Default)]
pub struct FakeTransport {
    pub outcome: Mutex<Option<Result<UnaryOutcome, CoreError>>>,
    pub last_path: Mutex<Option<String>>,
    pub last_request: Mutex<Option<DynamicMessage>>,
    pub last_metadata: Mutex<Option<HashMap<String, String>>>,
    pub last_max_bytes: Mutex<Option<usize>>,
    pub channel_calls: AtomicU32,
    /// `unary_dynamic` calls made — 0 proves a refusal happened before the wire.
    pub unary_calls: AtomicU32,
    /// Script for the next `stream_dynamic` call (taken on use).
    pub stream_script: Mutex<Option<StreamScript>>,
    /// Outbound messages the last `stream_dynamic` call collected so far (raw encoded
    /// bytes), appended as the call's outbound stream yields them. `Some(vec![])` from
    /// the moment the call is made.
    pub last_outbound: Arc<Mutex<Option<Vec<Bytes>>>>,
    pub stream_calls: AtomicU32,
    /// Sleep inside `channel()` — lets tests expire the phase-1 (activate) deadline.
    pub channel_delay: Mutex<Option<std::time::Duration>>,
}

/// What a scripted `stream_dynamic` does: optionally wait for the half-close and/or
/// sleep (deadline tests), then hand back `headers` and an inbound stream replaying
/// `items`; with `hang` the inbound never ends after the items (cancel tests).
///
/// The outbound side is drained concurrently from the moment of the call (a channel-backed
/// outbound may be fed before and after stream start): every message lands in
/// `last_outbound`; with `echo` it is also yielded back as an inbound message (the fixture's
/// `Ping` and `Pong` share field 1, so the raw bytes decode as either); `end_on_half_close`
/// is yielded once the outbound stream ends. With `hold_outbound` the outbound side is
/// kept alive but never polled (a full channel stays full); `items_delay` postpones the
/// replay of `items` past stream start.
#[derive(Default)]
pub struct StreamScript {
    pub start_delay: Option<std::time::Duration>,
    /// Sleep before replaying `items` — lets a test act on the open call first.
    pub items_delay: Option<std::time::Duration>,
    /// Never poll the outbound stream (keep it alive, drain nothing).
    pub hold_outbound: bool,
    /// Resolve the `stream_dynamic` await (stream start) only after the outbound stream
    /// has ended — the shape of a server that answers after the client's half-close.
    pub start_after_half_close: bool,
    pub headers: HashMap<String, String>,
    pub items: Vec<Result<Bytes, StreamEnd>>,
    pub echo: bool,
    pub end_on_half_close: Option<StreamEnd>,
    pub hang: bool,
}

impl FakeTransport {
    pub fn with_outcome(o: Result<UnaryOutcome, CoreError>) -> Arc<Self> {
        let t = Arc::new(Self::default());
        *t.outcome.try_lock().unwrap() = Some(o);
        t
    }
}

#[async_trait]
impl GrpcTransport for FakeTransport {
    async fn channel(&self, _target: &GrpcTarget) -> Result<TonicChannel, CoreError> {
        self.channel_calls.fetch_add(1, Ordering::Relaxed);
        if let Some(d) = *self.channel_delay.lock().await {
            tokio::time::sleep(d).await;
        }
        // Inert lazy channel to a bogus address — `unary_dynamic` below never dials it.
        Ok(tonic::transport::Channel::from_static("http://127.0.0.1:1").connect_lazy())
    }

    async fn unary_dynamic(
        &self,
        _channel: TonicChannel,
        method_path: String,
        _codec: DynamicCodec,
        request: DynamicMessage,
        metadata: HashMap<String, String>,
        opts: CallOptions,
    ) -> Result<UnaryOutcome, CoreError> {
        self.unary_calls.fetch_add(1, Ordering::Relaxed);
        *self.last_path.lock().await = Some(method_path);
        *self.last_request.lock().await = Some(request);
        *self.last_metadata.lock().await = Some(metadata);
        *self.last_max_bytes.lock().await = Some(opts.max_message_bytes);
        self.outcome.lock().await.take().expect("outcome set")
    }

    async fn stream_dynamic(
        &self,
        _channel: TonicChannel,
        method_path: String,
        outbound: OutboundStream,
        metadata: HashMap<String, String>,
        opts: CallOptions,
    ) -> Result<StreamStart, CoreError> {
        use futures_util::StreamExt as _;
        self.stream_calls.fetch_add(1, Ordering::Relaxed);
        *self.last_path.lock().await = Some(method_path);
        *self.last_metadata.lock().await = Some(metadata);
        *self.last_max_bytes.lock().await = Some(opts.max_message_bytes);
        *self.last_outbound.lock().await = Some(Vec::new());
        let script = self.stream_script.lock().await.take().expect("stream script set");

        // Inbound = script items + (echoed outbound, end-on-half-close) as they happen.
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<Bytes, StreamEnd>>();
        let half_closed = Arc::new(tokio::sync::Notify::new());
        {
            let captured = self.last_outbound.clone();
            let half_closed = half_closed.clone();
            let (echo, end_on_half_close, items) = (script.echo, script.end_on_half_close, script.items);
            let (hold_outbound, items_delay) = (script.hold_outbound, script.items_delay);
            let tx_items = tx.clone();
            tokio::spawn(async move {
                let mut outbound = outbound;
                // Server-streaming's `once(body)` completes on the first poll, so the
                // captured outbound is complete before any scripted item is replayed.
                let drain = async {
                    if hold_outbound {
                        // Keep the outbound side alive without ever taking a message.
                        std::future::pending::<()>().await;
                    }
                    while let Some(b) = outbound.next().await {
                        captured.lock().await.get_or_insert_with(Vec::new).push(b.clone());
                        if echo {
                            let _ = tx.send(Ok(b));
                        }
                    }
                    half_closed.notify_one();
                    if let Some(end) = end_on_half_close {
                        let _ = tx.send(Err(end));
                    }
                };
                let replay = async {
                    if let Some(d) = items_delay {
                        tokio::time::sleep(d).await;
                    }
                    for item in items {
                        let _ = tx_items.send(item);
                    }
                };
                tokio::join!(drain, replay);
            });
        }

        if script.start_after_half_close {
            half_closed.notified().await;
        }
        if let Some(d) = script.start_delay {
            tokio::time::sleep(d).await;
        }
        let items = tokio_stream::wrappers::UnboundedReceiverStream::new(rx);
        let inbound: crate::grpc::transport::InboundStream = if script.hang {
            Box::pin(items.chain(futures_util::stream::pending()))
        } else {
            Box::pin(items)
        };
        Ok(StreamStart { headers: script.headers, inbound })
    }
}

/// One `DynamicMessage` of `desc` with `fields` set by name — the fixture-row builder
/// behind [`chunk_bytes`] and the per-schema row helpers of the stream tests.
pub fn dynamic_message<'a>(
    desc: MessageDescriptor,
    fields: impl IntoIterator<Item = (&'a str, Value)>,
) -> DynamicMessage {
    let mut m = DynamicMessage::new(desc);
    for (name, value) in fields {
        m.set_field_by_name(name, value);
    }
    m
}

/// `test.Chunk { name?, data? }` encoded — one inbound row of the `Download` fixture
/// stream (Save messages / Assemble tests in core and in the IPC crate).
pub fn chunk_bytes(name: Option<&str>, data: Option<&[u8]>) -> Bytes {
    let desc = fixture_pool().get_message_by_name("test.Chunk").unwrap();
    let fields = name
        .map(|n| ("name", Value::String(n.into())))
        .into_iter()
        .chain(data.map(|d| ("data", Value::Bytes(Bytes::copy_from_slice(d)))));
    Bytes::from(dynamic_message(desc, fields).encode_to_vec())
}

/// The raw corpus behind `fixture_pool()` — what a `CachedContract` persists.
pub fn fixture_files() -> Vec<prost_types::FileDescriptorProto> {
    fixture_pool().file_descriptor_protos().cloned().collect()
}

/// A `CachedContract` over the fixture pool — seed a `ContractCache` with it so
/// `activate` composes with `FakeTransport` without running reflection.
pub fn fixture_cached_contract() -> crate::grpc::contract_cache::CachedContract {
    let pools = crate::grpc::descriptor::PoolSet::from_pool(fixture_pool());
    let catalog = crate::grpc::catalog::build::build_catalog(&pools);
    crate::grpc::contract_cache::CachedContract {
        files: Arc::new(fixture_files()),
        pools,
        catalog,
        fetched_at: std::time::SystemTime::UNIX_EPOCH,
    }
}

/// A `GrpcConnection` over the fixture pool and the given (usually fake) transport.
pub fn fake_connection(transport: Arc<dyn GrpcTransport>) -> GrpcConnection {
    let pools = crate::grpc::descriptor::PoolSet::from_pool(fixture_pool());
    let catalog = crate::grpc::catalog::build::build_catalog(&pools);
    // Lazy channel to a bogus address — never used by FakeTransport, but the field must exist.
    let channel = tonic::transport::Channel::from_static("http://127.0.0.1:1").connect_lazy();
    GrpcConnection {
        target: GrpcTarget::new("127.0.0.1:1", false, false).unwrap(),
        transport,
        channel,
        pools,
        catalog,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grpc::invoke::invoke_unary;

    /// AC (#12): a core test OUTSIDE the invoke module composes the fake transport
    /// with invoke-level code and gets the canned outcome back.
    #[tokio::test]
    async fn fake_transport_drives_invoke_level_code_with_canned_outcome() {
        let canned = UnaryOutcome {
            status_code: 0,
            status_message: "OK".into(),
            response_json: Some(r#"{"id":"echo"}"#.into()),
            trailing_metadata: HashMap::new(),
            status_details: Vec::new(),
            elapsed_ms: 7,
        };
        let t = FakeTransport::with_outcome(Ok(canned));
        let conn = fake_connection(t);

        let opts = CallOptions { max_message_bytes: usize::MAX, phase_timeout: None };
        let outcome = invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"hi"}"#, HashMap::new(), opts)
            .await
            .expect("invoke");
        assert_eq!(outcome.status_code, 0);
        assert_eq!(outcome.response_json.as_deref(), Some(r#"{"id":"echo"}"#));
    }
}
