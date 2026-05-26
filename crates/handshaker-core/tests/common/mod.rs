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

/// Pick a free TCP port by binding to 127.0.0.1:0 and reading back the assigned port.
async fn pick_addr() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    addr
}

/// Spawn a tonic server exposing reflection over the v1 protocol.
/// Returns `(address, shutdown_sender)`. Drop the sender to stop the server.
pub async fn spawn_reflection_server_v1() -> (SocketAddr, oneshot::Sender<()>) {
    let addr = pick_addr().await;
    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_descriptor_set_bytes())
        .build_v1()
        .expect("build v1 reflection service");

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .serve_with_shutdown(addr, async {
                rx.await.ok();
            })
            .await;
    });
    // tiny pause to let the listener bind
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    (addr, tx)
}

/// Spawn a tonic server exposing reflection ONLY over the v1alpha protocol.
pub async fn spawn_reflection_server_v1alpha() -> (SocketAddr, oneshot::Sender<()>) {
    let addr = pick_addr().await;
    let reflection = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fixture_descriptor_set_bytes())
        .build_v1alpha()
        .expect("build v1alpha reflection service");

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = tonic::transport::Server::builder()
            .add_service(reflection)
            .serve_with_shutdown(addr, async {
                rx.await.ok();
            })
            .await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    (addr, tx)
}

/// Spawn a tonic server with NO reflection service registered.
/// Useful to exercise the `ReflectionDisabled` path.
///
/// Uses a raw TCP listener that accepts and immediately drops connections so that
/// any gRPC caller gets a connection-refused or stream-reset, which maps to the
/// `ReflectionDisabled` error path.  We don't add any tonic service because
/// `Server::builder()` without `add_service` has no `serve_with_shutdown(addr,
/// signal)` overload in tonic 0.14 — only the `Router` returned by `add_service`
/// has that 2-argument form.
pub async fn spawn_bare_server() -> (SocketAddr, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        tokio::select! {
            _ = rx => {}
            // accept and immediately drop every connection
            _ = async {
                loop {
                    let _ = listener.accept().await;
                }
            } => {}
        }
    });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    (addr, tx)
}
