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
/// service Echo {
///   rpc Send (Ping) returns (Pong);
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
    let service = ServiceDescriptorProto {
        name: Some("Echo".to_string()),
        method: vec![MethodDescriptorProto {
            name: Some("Send".to_string()),
            input_type: Some(".test.Ping".to_string()),
            output_type: Some(".test.Pong".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    };
    let file = FileDescriptorProto {
        name: Some("test/echo.proto".to_string()),
        package: Some("test".to_string()),
        syntax: Some("proto3".to_string()),
        message_type: vec![ping, pong],
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
