//! Shared test helpers: a tiny hand-crafted `FileDescriptorSet` + in-process gRPC servers
//! that expose Server Reflection (v1, v1alpha, or none).
//!
//! Used by tests/reflection_*.rs and tests/contract_*.rs.

#![allow(dead_code)] // each integration-test binary uses a subset.

use prost::Message;
use prost_types::{
    field_descriptor_proto::Type as FieldType, DescriptorProto, FieldDescriptorProto,
    FileDescriptorProto, FileDescriptorSet, MethodDescriptorProto, ServiceDescriptorProto,
};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Build a minimal `FileDescriptorSet` containing one file:
///
/// ```proto
/// syntax = "proto3";
/// package test;
/// message Ping { string id = 1; }
/// message Pong { string id = 1; string echoed = 2; }
/// message Chunk { string name = 1; bytes data = 2; }
/// service Echo {
///   rpc Send (Ping) returns (Pong);
///   rpc ServerStream (Ping) returns (stream Pong);
///   rpc ClientStream (stream Ping) returns (Pong);
///   rpc Bidi (stream Ping) returns (stream Pong);
///   rpc Download (Ping) returns (stream Chunk);
/// }
/// ```
pub fn fixture_descriptor_set_bytes() -> Vec<u8> {
    let ping = DescriptorProto {
        name: Some("Ping".to_string()),
        field: vec![FieldDescriptorProto {
            name: Some("id".to_string()),
            number: Some(1),
            r#type: Some(FieldType::String as i32),
            ..Default::default()
        }],
        ..Default::default()
    };
    let pong = DescriptorProto {
        name: Some("Pong".to_string()),
        field: vec![
            FieldDescriptorProto {
                name: Some("id".to_string()),
                number: Some(1),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            },
            FieldDescriptorProto {
                name: Some("echoed".to_string()),
                number: Some(2),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let chunk = DescriptorProto {
        name: Some("Chunk".to_string()),
        field: vec![
            FieldDescriptorProto {
                name: Some("name".to_string()),
                number: Some(1),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            },
            FieldDescriptorProto {
                name: Some("data".to_string()),
                number: Some(2),
                r#type: Some(FieldType::Bytes as i32),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let service = ServiceDescriptorProto {
        name: Some("Echo".to_string()),
        method: vec![
            MethodDescriptorProto {
                name: Some("Send".to_string()),
                input_type: Some(".test.Ping".to_string()),
                output_type: Some(".test.Pong".to_string()),
                ..Default::default()
            },
            MethodDescriptorProto {
                name: Some("ServerStream".to_string()),
                input_type: Some(".test.Ping".to_string()),
                output_type: Some(".test.Pong".to_string()),
                server_streaming: Some(true),
                ..Default::default()
            },
            MethodDescriptorProto {
                name: Some("ClientStream".to_string()),
                input_type: Some(".test.Ping".to_string()),
                output_type: Some(".test.Pong".to_string()),
                client_streaming: Some(true),
                ..Default::default()
            },
            MethodDescriptorProto {
                name: Some("Bidi".to_string()),
                input_type: Some(".test.Ping".to_string()),
                output_type: Some(".test.Pong".to_string()),
                client_streaming: Some(true),
                server_streaming: Some(true),
                ..Default::default()
            },
            MethodDescriptorProto {
                name: Some("Download".to_string()),
                input_type: Some(".test.Ping".to_string()),
                output_type: Some(".test.Chunk".to_string()),
                server_streaming: Some(true),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let file = FileDescriptorProto {
        name: Some("test/echo.proto".to_string()),
        package: Some("test".to_string()),
        syntax: Some("proto3".to_string()),
        message_type: vec![ping, pong, chunk],
        service: vec![service],
        ..Default::default()
    };
    let set = FileDescriptorSet { file: vec![file] };
    let mut buf = Vec::new();
    set.encode(&mut buf).expect("encode FileDescriptorSet");
    buf
}

/// Spawn a tonic server exposing reflection over the v1 protocol.
/// Returns `(address, shutdown_sender)`. Drop the sender to stop the server.
///
/// The listener is bound before returning, so the address is ready for connections
/// immediately — no sleep needed.
pub async fn spawn_reflection_server_v1() -> (SocketAddr, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_descriptor_set_bytes())
        .build_v1()
        .expect("build v1 reflection service");

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .serve_with_incoming_shutdown(incoming, async {
                rx.await.ok();
            })
            .await;
    });
    (addr, tx)
}

/// Spawn a tonic server exposing reflection ONLY over the v1alpha protocol.
///
/// The listener is bound before returning, so the address is ready for connections
/// immediately — no sleep needed.
pub async fn spawn_reflection_server_v1alpha() -> (SocketAddr, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_descriptor_set_bytes())
        .build_v1alpha()
        .expect("build v1alpha reflection service");

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .serve_with_incoming_shutdown(incoming, async {
                rx.await.ok();
            })
            .await;
    });
    (addr, tx)
}

/// Build a `FileDescriptorSet` containing TWO files that exercise the
/// dependency-crawl path:
///
/// ```proto
/// // file: test/common.proto
/// syntax = "proto3";
/// package test;
/// message Header { string trace_id = 1; }
///
/// // file: test/echo_with_deps.proto
/// syntax = "proto3";
/// package test;
/// import "test/common.proto";
/// message PingX { Header h = 1; string id = 2; }
/// message PongX { Header h = 1; string echoed = 2; }
/// service EchoWithDeps { rpc Send (PingX) returns (PongX); }
/// ```
pub fn fixture_descriptor_set_with_deps_bytes() -> Vec<u8> {
    let header = DescriptorProto {
        name: Some("Header".to_string()),
        field: vec![FieldDescriptorProto {
            name: Some("trace_id".to_string()),
            number: Some(1),
            r#type: Some(FieldType::String as i32),
            ..Default::default()
        }],
        ..Default::default()
    };
    let common_file = FileDescriptorProto {
        name: Some("test/common.proto".to_string()),
        package: Some("test".to_string()),
        syntax: Some("proto3".to_string()),
        message_type: vec![header],
        ..Default::default()
    };

    let header_field = FieldDescriptorProto {
        name: Some("h".to_string()),
        number: Some(1),
        r#type: Some(FieldType::Message as i32),
        type_name: Some(".test.Header".to_string()),
        ..Default::default()
    };
    let ping_x = DescriptorProto {
        name: Some("PingX".to_string()),
        field: vec![
            header_field.clone(),
            FieldDescriptorProto {
                name: Some("id".to_string()),
                number: Some(2),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let pong_x = DescriptorProto {
        name: Some("PongX".to_string()),
        field: vec![
            header_field,
            FieldDescriptorProto {
                name: Some("echoed".to_string()),
                number: Some(2),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let echo_with_deps = ServiceDescriptorProto {
        name: Some("EchoWithDeps".to_string()),
        method: vec![MethodDescriptorProto {
            name: Some("Send".to_string()),
            input_type: Some(".test.PingX".to_string()),
            output_type: Some(".test.PongX".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    };
    let echo_file = FileDescriptorProto {
        name: Some("test/echo_with_deps.proto".to_string()),
        package: Some("test".to_string()),
        syntax: Some("proto3".to_string()),
        dependency: vec!["test/common.proto".to_string()],
        message_type: vec![ping_x, pong_x],
        service: vec![echo_with_deps],
        ..Default::default()
    };

    let set = FileDescriptorSet {
        file: vec![common_file, echo_file],
    };
    let mut buf = Vec::new();
    set.encode(&mut buf).expect("encode FileDescriptorSet");
    buf
}

/// Spawn a v1 reflection server hosting the multi-file fixture (forces dep crawl).
pub async fn spawn_reflection_server_v1_with_deps() -> (SocketAddr, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_descriptor_set_with_deps_bytes())
        .build_v1()
        .expect("build v1 reflection service");

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .serve_with_incoming_shutdown(incoming, async {
                rx.await.ok();
            })
            .await;
    });
    (addr, tx)
}

/// Build a `FileDescriptorSet` shaped like a code-first .NET server: two services in two
/// files, each carrying its OWN copy of a shared DTO message name.
///
/// ```proto
/// // file: dupes/a.proto      // file: dupes/b.proto
/// package dupes;              package dupes;
/// message SharedDto {         message SharedDto {
///   string a_only = 1; }        string b_only = 1; }
///
/// // and each file declares one service, identical but for its name:
/// service SvcA / SvcB { rpc Call (SharedDto) returns (SharedDto); }
/// ```
///
/// So `dupes.SharedDto` is defined twice, by two files that disagree about its fields —
/// while `dupes.SvcA` and `dupes.SvcB` stay distinct, which is what lets the reflection
/// crawl reach both copies.
pub fn fixture_duplicate_symbol_set_bytes() -> Vec<u8> {
    let build = |file: &str, svc: &str, field: &str| FileDescriptorProto {
        name: Some(file.to_string()),
        package: Some("dupes".to_string()),
        syntax: Some("proto3".to_string()),
        message_type: vec![DescriptorProto {
            name: Some("SharedDto".to_string()),
            field: vec![FieldDescriptorProto {
                name: Some(field.to_string()),
                number: Some(1),
                r#type: Some(FieldType::String as i32),
                ..Default::default()
            }],
            ..Default::default()
        }],
        service: vec![ServiceDescriptorProto {
            name: Some(svc.to_string()),
            method: vec![MethodDescriptorProto {
                name: Some("Call".to_string()),
                input_type: Some(".dupes.SharedDto".to_string()),
                output_type: Some(".dupes.SharedDto".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let set = FileDescriptorSet {
        file: vec![
            build("dupes/a.proto", "SvcA", "a_only"),
            build("dupes/b.proto", "SvcB", "b_only"),
        ],
    };
    let mut buf = Vec::new();
    set.encode(&mut buf).expect("encode FileDescriptorSet");
    buf
}

/// Spawn a v1 reflection server hosting the duplicate-symbol fixture.
///
/// `tonic-reflection` indexes symbols into a `HashMap` with last-write-wins and never
/// validates for duplicates, so it serves this conflicting set happily — which is what
/// makes the end-to-end test possible at all.
pub async fn spawn_reflection_server_v1_with_duplicate_symbol() -> (SocketAddr, oneshot::Sender<()>)
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_duplicate_symbol_set_bytes())
        .build_v1()
        .expect("build v1 reflection service");

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .serve_with_incoming_shutdown(incoming, async {
                rx.await.ok();
            })
            .await;
    });
    (addr, tx)
}

/// Spawn a tonic server with NO reflection service registered.
///
/// We register `tonic_health::server::HealthServer` as a "filler" so the listener
/// speaks full HTTP/2 + gRPC. Any request to a reflection path (v1 or v1alpha)
/// gets back a real gRPC `Unimplemented` status — exactly the condition the
/// reflection client's fallback logic must recognise as `ReflectionDisabled`.
///
/// Without a registered service tonic 0.14's `Server::serve_with_shutdown` is
/// 3-arg `(addr, svc, signal)`; only the `Router` returned by `add_service(svc)`
/// has the 2-arg `serve_with_shutdown(addr, signal)` we use here.
///
/// The listener is bound before returning, so the address is ready for connections
/// immediately — no sleep needed.
pub async fn spawn_bare_server() -> (SocketAddr, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    // The HealthReporter is dropped — we never publish health status updates;
    // its only purpose is to give us a non-reflection gRPC service so tonic's
    // Router returns `Unimplemented` for unmatched reflection paths.
    let (_reporter, health_service) = tonic_health::server::health_reporter();

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        let _ = tonic::transport::Server::builder()
            .add_service(health_service)
            .serve_with_incoming_shutdown(incoming, async {
                rx.await.ok();
            })
            .await;
    });
    (addr, tx)
}

// ---------------------------------------------------------------------------
// EchoServer — in-process gRPC server for invoke integration tests (Plan #3)
// ---------------------------------------------------------------------------

/// Behavior knobs for `EchoService` — used by invoke_status / invoke_trailers tests.
#[derive(Clone, Default, Debug)]
pub struct EchoConfig {
    pub required_unary_authorization: Option<String>,
    pub seen_unary_requests: Arc<std::sync::Mutex<Vec<(String, String)>>>,
    /// If `Some(code)`, `Echo.Send` returns a gRPC status with this code instead of OK.
    pub return_status: Option<i32>,
    /// Extra trailing metadata the server injects in the response.
    pub trailers: std::collections::HashMap<String, String>,
    /// `Echo.ServerStream`: how many `Pong { id, echoed: "echo: {id} #{n}" }` rows to
    /// stream before ending OK (`n` from 1).
    pub stream_count: u32,
    /// `Echo.ServerStream`: if `Some((k, code))`, stream `k` rows then end with `code`
    /// instead of OK. `k == 0` = trailers-only non-OK end.
    pub fail_after: Option<(u32, i32)>,
    /// `Echo.ServerStream`: pause before each row (lets a client cancel mid-stream).
    pub stream_delay: Option<std::time::Duration>,
    /// `Echo.ServerStream`: the request metadata the server received on its last call —
    /// lets a test assert what did (`authorization`) and did not (`grpc-timeout`) go out.
    pub seen_metadata: std::sync::Arc<std::sync::Mutex<Option<tonic::metadata::MetadataMap>>>,
    /// `Echo.ClientStream`: after the client's half-close, never answer (no headers, no
    /// status) — the shape a phase-2 deadline has to catch.
    pub client_stream_hang: bool,
    /// `Echo.Download`: the `name` every `Chunk` carries (omitted when empty).
    pub download_name: String,
    /// `Echo.Download`: one `Chunk { data }` per entry, in order, `stream_delay` before each.
    pub download_chunks: Vec<Vec<u8>>,
}

/// In-process gRPC server implementing `test.Echo/Send(Ping) → Pong { id, echoed }`,
/// `test.Echo/ServerStream(Ping) → stream Pong`, `test.Echo/ClientStream(stream Ping) →
/// Pong { echoed: "count: N" }` and `test.Echo/Bidi(stream Ping) → stream Pong` (one echo
/// per inbound Ping) via `tonic::server::Grpc<DynamicCodec>` (no tonic-build / static
/// stubs).
/// Also exposes reflection so the client under test can call `activate()` + `invoke` in one shot.
///
/// Returns `(addr, shutdown_sender)`. Drop the sender to stop the server.
pub async fn spawn_echo_server(config: EchoConfig) -> (SocketAddr, oneshot::Sender<()>) {
    spawn_echo_server_on("127.0.0.1:0", config).await
}

/// `spawn_echo_server` on an explicit bind address — the `echo_server` example uses a
/// fixed port so the app can be pointed at it for a live check.
pub async fn spawn_echo_server_on(
    bind: &str,
    config: EchoConfig,
) -> (SocketAddr, oneshot::Sender<()>) {
    use prost_reflect::DescriptorPool;

    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_set(
        prost::Message::decode(&fixture_descriptor_set_bytes()[..])
            .expect("decode fixture descriptor set"),
    )
    .expect("add fixture to DescriptorPool");

    let ping_desc = pool
        .get_message_by_name("test.Ping")
        .expect("test.Ping in pool");
    let pong_desc = pool
        .get_message_by_name("test.Pong")
        .expect("test.Pong in pool");
    let chunk_desc = pool
        .get_message_by_name("test.Chunk")
        .expect("test.Chunk in pool");

    let svc = EchoService {
        ping_desc,
        pong_desc,
        chunk_desc,
        config: std::sync::Arc::new(tokio::sync::Mutex::new(config)),
    };

    let listener = TcpListener::bind(bind).await.expect("bind echo server address");
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = oneshot::channel::<()>();

    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_descriptor_set_bytes())
        .build_v1()
        .expect("build v1 reflection service");

    tokio::spawn(async move {
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .add_service(svc)
            .serve_with_incoming_shutdown(incoming, async {
                rx.await.ok();
            })
            .await;
    });
    (addr, tx)
}

// ---------------------------------------------------------------------------
// EchoService internals
// ---------------------------------------------------------------------------

use std::sync::Arc;
use tokio::sync::Mutex;

/// Tower service that handles all HTTP/2 requests for the `test.Echo` service.
/// Dispatches `/test.Echo/Send` to `EchoHandler` (unary) and `/test.Echo/ServerStream`
/// to `ServerStreamHandler` via `tonic::server::Grpc`; anything else is `Unimplemented`.
#[derive(Clone)]
struct EchoService {
    ping_desc: prost_reflect::MessageDescriptor,
    pong_desc: prost_reflect::MessageDescriptor,
    chunk_desc: prost_reflect::MessageDescriptor,
    config: Arc<Mutex<EchoConfig>>,
}

impl tonic::server::NamedService for EchoService {
    const NAME: &'static str = "test.Echo";
}

impl tower::Service<http::Request<tonic::body::Body>> for EchoService {
    type Response = http::Response<tonic::body::Body>;
    type Error = std::convert::Infallible;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: http::Request<tonic::body::Body>) -> Self::Future {
        use handshaker_core::grpc::transport::DynamicCodec;
        use tonic::server::Grpc;

        // DynamicCodec's `response_descriptor` is what the decoder uses to construct the
        // DynamicMessage being parsed. On the server side, the decoder parses the incoming
        // REQUEST (Ping), so we put ping_desc in `response_descriptor`. The `request_descriptor`
        // field is unused by DynamicEncoder (DynamicMessage carries its own descriptor) — we
        // fill it with pong_desc for symmetry-of-naming with what the server actually emits.
        let codec = DynamicCodec {
            request_descriptor: self.pong_desc.clone(),
            response_descriptor: self.ping_desc.clone(),
        };
        let pong_desc = self.pong_desc.clone();
        let chunk_desc = self.chunk_desc.clone();
        let config = Arc::clone(&self.config);
        let path = req.uri().path().to_string();

        Box::pin(async move {
            let resp = match path.as_str() {
                "/test.Echo/Send" => {
                    Grpc::new(codec).unary(EchoHandler { pong_desc, config }, req).await
                }
                "/test.Echo/ServerStream" => {
                    Grpc::new(codec)
                        .server_streaming(ServerStreamHandler { pong_desc, config }, req)
                        .await
                }
                "/test.Echo/ClientStream" => {
                    Grpc::new(codec)
                        .client_streaming(ClientStreamHandler { pong_desc, config }, req)
                        .await
                }
                "/test.Echo/Bidi" => {
                    Grpc::new(codec).streaming(BidiHandler { pong_desc }, req).await
                }
                "/test.Echo/Download" => {
                    Grpc::new(codec)
                        .server_streaming(DownloadHandler { chunk_desc, config }, req)
                        .await
                }
                _ => tonic::Status::unimplemented(format!("no such method: {path}"))
                    .into_http(),
            };
            Ok(resp)
        })
    }
}

/// Implements `Echo.ServerStream`: streams `stream_count` Pongs (or `fail_after.0` rows
/// then a non-OK status), each `Pong { id, echoed: "echo: {id} #{n}" }`.
/// `tower::Service<tonic::Request<DynamicMessage>>` returning a `Response<Stream>`
/// auto-derives `tonic::server::ServerStreamingService`.
#[derive(Clone)]
struct ServerStreamHandler {
    pong_desc: prost_reflect::MessageDescriptor,
    config: Arc<Mutex<EchoConfig>>,
}

type PongStream = std::pin::Pin<
    Box<
        dyn tokio_stream::Stream<Item = Result<prost_reflect::DynamicMessage, tonic::Status>>
            + Send,
    >,
>;

impl tower::Service<tonic::Request<prost_reflect::DynamicMessage>> for ServerStreamHandler {
    type Response = tonic::Response<PongStream>;
    type Error = tonic::Status;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(
        &mut self,
        req: tonic::Request<prost_reflect::DynamicMessage>,
    ) -> Self::Future {
        use prost_reflect::{DynamicMessage, Value};

        let pong_desc = self.pong_desc.clone();
        let config = Arc::clone(&self.config);

        Box::pin(async move {
            let cfg = config.lock().await.clone();
            *cfg.seen_metadata.lock().unwrap() = Some(req.metadata().clone());
            let id = req
                .into_inner()
                .get_field_by_name("id")
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default();

            let (rows, fail_code) = match cfg.fail_after {
                Some((k, code)) => (k, Some(code)),
                None => (cfg.stream_count, None),
            };
            // Trailers-only: no body at all, the status (with the configured metadata as
            // its trailers) goes out in the HEADERS block.
            if rows == 0 {
                if let Some(code) = fail_code {
                    let code = tonic::Code::from(code);
                    let mut status =
                        tonic::Status::new(code, format!("injected stream error: {code:?}"));
                    for (k, v) in &cfg.trailers {
                        if let (Ok(key), Ok(val)) = (
                            tonic::metadata::AsciiMetadataKey::from_bytes(k.to_lowercase().as_bytes()),
                            tonic::metadata::AsciiMetadataValue::try_from(v.as_str()),
                        ) {
                            status.metadata_mut().insert(key, val);
                        }
                    }
                    return Err(status);
                }
            }

            let (tx, rx) =
                tokio::sync::mpsc::channel::<Result<DynamicMessage, tonic::Status>>(4);
            let delay = cfg.stream_delay;
            let trailers = cfg.trailers.clone();
            tokio::spawn(async move {
                for n in 1..=rows {
                    if let Some(d) = delay {
                        tokio::time::sleep(d).await;
                    }
                    let mut pong = DynamicMessage::new(pong_desc.clone());
                    pong.set_field_by_name("id", Value::String(id.clone()));
                    pong.set_field_by_name(
                        "echoed",
                        Value::String(format!("echo: {id} #{n}")),
                    );
                    if tx.send(Ok(pong)).await.is_err() {
                        return; // client went away (cancel) — stop producing
                    }
                }
                if let Some(code) = fail_code {
                    let code = tonic::Code::from(code);
                    // The configured metadata rides the failing status as trailers
                    // (the same "error details in trailers" shape real servers use).
                    let mut status =
                        tonic::Status::new(code, format!("injected stream error: {code:?}"));
                    for (k, v) in &trailers {
                        if let (Ok(key), Ok(val)) = (
                            tonic::metadata::AsciiMetadataKey::from_bytes(k.to_lowercase().as_bytes()),
                            tonic::metadata::AsciiMetadataValue::try_from(v.as_str()),
                        ) {
                            status.metadata_mut().insert(key, val);
                        }
                    }
                    let _ = tx.send(Err(status)).await;
                }
            });

            let stream: PongStream =
                Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx));
            let mut response = tonic::Response::new(stream);
            for (k, v) in &cfg.trailers {
                if let (Ok(key), Ok(val)) = (
                    tonic::metadata::AsciiMetadataKey::from_bytes(k.to_lowercase().as_bytes()),
                    tonic::metadata::AsciiMetadataValue::try_from(v.as_str()),
                ) {
                    response.metadata_mut().insert(key, val);
                }
            }
            Ok(response)
        })
    }
}

/// Implements `Echo.ClientStream`: drains the request stream, then answers once with
/// `Pong { id: <last id>, echoed: "count: N" }` — or never (`client_stream_hang`).
/// `tower::Service<tonic::Request<Streaming<DynamicMessage>>>` returning a
/// `Response<DynamicMessage>` auto-derives `tonic::server::ClientStreamingService`.
#[derive(Clone)]
struct ClientStreamHandler {
    pong_desc: prost_reflect::MessageDescriptor,
    config: Arc<Mutex<EchoConfig>>,
}

impl tower::Service<tonic::Request<tonic::Streaming<prost_reflect::DynamicMessage>>>
    for ClientStreamHandler
{
    type Response = tonic::Response<prost_reflect::DynamicMessage>;
    type Error = tonic::Status;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(
        &mut self,
        req: tonic::Request<tonic::Streaming<prost_reflect::DynamicMessage>>,
    ) -> Self::Future {
        use prost_reflect::{DynamicMessage, Value};

        let pong_desc = self.pong_desc.clone();
        let config = Arc::clone(&self.config);

        Box::pin(async move {
            let hang = config.lock().await.client_stream_hang;
            let mut inbound = req.into_inner();
            let mut count = 0u32;
            let mut last_id = String::new();
            while let Some(ping) = inbound.message().await? {
                count += 1;
                last_id = ping
                    .get_field_by_name("id")
                    .and_then(|v| v.as_str().map(str::to_owned))
                    .unwrap_or_default();
            }
            if hang {
                std::future::pending::<()>().await;
            }
            let mut pong = DynamicMessage::new(pong_desc);
            pong.set_field_by_name("id", Value::String(last_id));
            pong.set_field_by_name("echoed", Value::String(format!("count: {count}")));
            Ok(tonic::Response::new(pong))
        })
    }
}

/// Implements `Echo.Bidi`: answers with headers at once and echoes every inbound Ping as
/// `Pong { id, echoed: "echo: {id}" }`; the response stream ends OK when the request
/// stream ends (the client's half-close). `tower::Service<Request<Streaming<_>>>`
/// returning a `Response<Stream>` auto-derives `tonic::server::StreamingService`.
#[derive(Clone)]
struct BidiHandler {
    pong_desc: prost_reflect::MessageDescriptor,
}

impl tower::Service<tonic::Request<tonic::Streaming<prost_reflect::DynamicMessage>>> for BidiHandler {
    type Response = tonic::Response<PongStream>;
    type Error = tonic::Status;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(
        &mut self,
        req: tonic::Request<tonic::Streaming<prost_reflect::DynamicMessage>>,
    ) -> Self::Future {
        use prost_reflect::{DynamicMessage, Value};

        let pong_desc = self.pong_desc.clone();

        Box::pin(async move {
            let mut inbound = req.into_inner();
            let (tx, rx) = tokio::sync::mpsc::channel::<Result<DynamicMessage, tonic::Status>>(4);
            tokio::spawn(async move {
                loop {
                    match inbound.message().await {
                        Ok(Some(ping)) => {
                            let id = ping
                                .get_field_by_name("id")
                                .and_then(|v| v.as_str().map(str::to_owned))
                                .unwrap_or_default();
                            let mut pong = DynamicMessage::new(pong_desc.clone());
                            pong.set_field_by_name("id", Value::String(id.clone()));
                            pong.set_field_by_name("echoed", Value::String(format!("echo: {id}")));
                            if tx.send(Ok(pong)).await.is_err() {
                                return; // client went away (cancel)
                            }
                        }
                        Ok(None) => return, // half-close → dropping `tx` ends the response OK
                        Err(status) => {
                            let _ = tx.send(Err(status)).await;
                            return;
                        }
                    }
                }
            });
            let stream: PongStream = Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx));
            Ok(tonic::Response::new(stream))
        })
    }
}

/// Implements `Echo.Download`: streams one `Chunk { name, data }` per entry of
/// `download_chunks` (`name` = `download_name` on every chunk, omitted when empty), pausing
/// `stream_delay` before each, then ends OK. The Assemble fixture: the client reassembles
/// `data` across the rows.
#[derive(Clone)]
struct DownloadHandler {
    chunk_desc: prost_reflect::MessageDescriptor,
    config: Arc<Mutex<EchoConfig>>,
}

impl tower::Service<tonic::Request<prost_reflect::DynamicMessage>> for DownloadHandler {
    type Response = tonic::Response<PongStream>;
    type Error = tonic::Status;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(&mut self, _req: tonic::Request<prost_reflect::DynamicMessage>) -> Self::Future {
        use prost_reflect::{DynamicMessage, Value};

        let chunk_desc = self.chunk_desc.clone();
        let config = Arc::clone(&self.config);

        Box::pin(async move {
            let cfg = config.lock().await.clone();
            let (tx, rx) = tokio::sync::mpsc::channel::<Result<DynamicMessage, tonic::Status>>(4);
            tokio::spawn(async move {
                for data in cfg.download_chunks {
                    if let Some(d) = cfg.stream_delay {
                        tokio::time::sleep(d).await;
                    }
                    let mut chunk = DynamicMessage::new(chunk_desc.clone());
                    if !cfg.download_name.is_empty() {
                        chunk.set_field_by_name("name", Value::String(cfg.download_name.clone()));
                    }
                    chunk.set_field_by_name("data", Value::Bytes(bytes::Bytes::from(data)));
                    if tx.send(Ok(chunk)).await.is_err() {
                        return; // client went away (cancel)
                    }
                }
            });
            let stream: PongStream = Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx));
            Ok(tonic::Response::new(stream))
        })
    }
}

/// Implements the unary `Echo.Send` business logic.
/// `tower::Service<tonic::Request<DynamicMessage>>` auto-derives `tonic::server::UnaryService`.
#[derive(Clone)]
struct EchoHandler {
    pong_desc: prost_reflect::MessageDescriptor,
    config: Arc<Mutex<EchoConfig>>,
}

impl tower::Service<tonic::Request<prost_reflect::DynamicMessage>> for EchoHandler {
    type Response = tonic::Response<prost_reflect::DynamicMessage>;
    type Error = tonic::Status;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn call(
        &mut self,
        req: tonic::Request<prost_reflect::DynamicMessage>,
    ) -> Self::Future {
        use prost_reflect::{DynamicMessage, Value};

        let pong_desc = self.pong_desc.clone();
        let config = Arc::clone(&self.config);

        Box::pin(async move {
            let cfg = config.lock().await;

            let authorization = req
                .metadata()
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_string();
            let id = req
                .get_ref()
                .get_field_by_name("id")
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_default();
            cfg.seen_unary_requests.lock().unwrap().push((authorization.clone(), id));
            if cfg.required_unary_authorization
                .as_ref()
                .is_some_and(|expected| expected != &authorization)
            {
                return Err(tonic::Status::unauthenticated("expired token"));
            }

            // If configured to return a gRPC error status, do so.
            if let Some(code) = cfg.return_status {
                let code = tonic::Code::from(code);
                let mut status = tonic::Status::new(code, format!("injected error: {code:?}"));

                // Inject any configured trailing metadata (same as OK path).
                for (k, v) in &cfg.trailers {
                    if let (Ok(key), Ok(val)) = (
                        tonic::metadata::AsciiMetadataKey::from_bytes(k.to_lowercase().as_bytes()),
                        tonic::metadata::AsciiMetadataValue::try_from(v.as_str()),
                    ) {
                        status.metadata_mut().insert(key, val);
                    }
                }

                return Err(status);
            }

            // Extract `id` from the incoming Ping.
            let ping = req.into_inner();
            let id = ping
                .get_field_by_name("id")
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default();

            // Build Pong { id, echoed: "echo: {id}" }.
            let mut pong = DynamicMessage::new(pong_desc);
            pong.set_field_by_name("id", Value::String(id.clone()));
            pong.set_field_by_name("echoed", Value::String(format!("echo: {id}")));

            let mut response = tonic::Response::new(pong);

            // Inject any configured trailing metadata.
            for (k, v) in &cfg.trailers {
                if let (Ok(key), Ok(val)) = (
                    tonic::metadata::AsciiMetadataKey::from_bytes(k.to_lowercase().as_bytes()),
                    tonic::metadata::AsciiMetadataValue::try_from(v.as_str()),
                ) {
                    response.metadata_mut().insert(key, val);
                }
            }

            Ok(response)
        })
    }
}
