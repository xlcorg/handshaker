//! `GrpcTransport::stream_dynamic` against the echo fixture's `ServerStream(Ping) → stream
//! Pong`: raw bytes both ways, `await` resolves at stream start (headers), the inbound
//! stream ends with exactly one `StreamEnd` (OK or non-OK), trailers-only non-OK yields
//! zero messages.

mod common;

use bytes::Bytes;
use futures_util::StreamExt as _;
use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::invoke::CallOptions;
use handshaker_core::grpc::transport::{GrpcTransport, StreamEnd, TonicTransport};
use prost::Message as _;
use prost_reflect::{DynamicMessage, Value};
use std::collections::HashMap;
use std::sync::Arc;

fn opts() -> CallOptions {
    CallOptions { max_message_bytes: usize::MAX, phase_timeout: None }
}

async fn open(
    config: common::EchoConfig,
) -> (Arc<dyn GrpcTransport>, handshaker_core::grpc::GrpcConnection, tokio::sync::oneshot::Sender<()>)
{
    let (addr, stop) = common::spawn_echo_server(config).await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn GrpcTransport> = Arc::new(TonicTransport::new());
    let cache = handshaker_core::grpc::InMemoryContractCache::new();
    let conn = activate(target, transport.clone(), &cache).await.expect("activate");
    (transport, conn, stop)
}

fn ping_bytes(conn: &handshaker_core::grpc::GrpcConnection, id: &str) -> Bytes {
    let desc = conn
        .pools
        .for_service("test.Echo")
        .and_then(|p| p.get_message_by_name("test.Ping"))
        .expect("test.Ping");
    let mut msg = DynamicMessage::new(desc);
    msg.set_field_by_name("id", Value::String(id.into()));
    Bytes::from(msg.encode_to_vec())
}

fn decode_pong(conn: &handshaker_core::grpc::GrpcConnection, b: &Bytes) -> (String, String) {
    let desc = conn
        .pools
        .for_service("test.Echo")
        .and_then(|p| p.get_message_by_name("test.Pong"))
        .expect("test.Pong");
    let msg = DynamicMessage::decode(desc, b.clone()).expect("decode Pong");
    let f = |n: &str| msg.get_field_by_name(n).unwrap().as_str().unwrap().to_string();
    (f("id"), f("echoed"))
}

/// Drain the inbound stream into (messages, terminal end).
async fn drain(
    mut inbound: handshaker_core::grpc::transport::InboundStream,
) -> (Vec<Bytes>, Option<StreamEnd>) {
    let mut msgs = Vec::new();
    let mut end = None;
    while let Some(item) = inbound.next().await {
        match item {
            Ok(b) => msgs.push(b),
            Err(e) => {
                assert!(end.is_none(), "StreamEnd must be yielded exactly once");
                end = Some(e);
            }
        }
    }
    (msgs, end)
}

#[tokio::test]
async fn server_stream_yields_n_raw_messages_then_ok_end() {
    let (transport, conn, _stop) =
        open(common::EchoConfig { stream_count: 3, ..Default::default() }).await;

    let outbound = Box::pin(tokio_stream::once(ping_bytes(&conn, "hello")));
    let start = transport
        .stream_dynamic(
            conn.channel.clone(),
            "/test.Echo/ServerStream".into(),
            outbound,
            HashMap::new(),
            opts(),
        )
        .await
        .expect("stream start");

    // Stream start = response HEADERS; tonic servers always send content-type.
    assert!(start.headers.contains_key("content-type"), "headers: {:?}", start.headers);

    let (msgs, end) = drain(start.inbound).await;
    assert_eq!(msgs.len(), 3);
    for (i, b) in msgs.iter().enumerate() {
        let (id, echoed) = decode_pong(&conn, b);
        assert_eq!(id, "hello");
        assert_eq!(echoed, format!("echo: hello #{}", i + 1));
    }
    let end = end.expect("terminal StreamEnd");
    assert_eq!(end.status_code, 0);
}

#[tokio::test]
async fn non_ok_end_mid_stream_keeps_earlier_messages() {
    let (transport, conn, _stop) = open(common::EchoConfig {
        stream_count: 5,
        fail_after: Some((2, 7)), // PERMISSION_DENIED after two rows
        ..Default::default()
    })
    .await;

    let start = transport
        .stream_dynamic(
            conn.channel.clone(),
            "/test.Echo/ServerStream".into(),
            Box::pin(tokio_stream::once(ping_bytes(&conn, "x"))),
            HashMap::new(),
            opts(),
        )
        .await
        .expect("stream start");

    let (msgs, end) = drain(start.inbound).await;
    assert_eq!(msgs.len(), 2);
    let end = end.expect("terminal StreamEnd");
    assert_eq!(end.status_code, 7);
    assert!(end.status_message.contains("injected"), "{}", end.status_message);
}

#[tokio::test]
async fn trailers_only_non_ok_is_a_stream_start_with_zero_messages_and_no_headers() {
    let mut trailers = HashMap::new();
    trailers.insert("x-reason".to_string(), "expired".to_string());
    let (transport, conn, _stop) = open(common::EchoConfig {
        fail_after: Some((0, 16)), // UNAUTHENTICATED before any row
        trailers,
        ..Default::default()
    })
    .await;

    let start = transport
        .stream_dynamic(
            conn.channel.clone(),
            "/test.Echo/ServerStream".into(),
            Box::pin(tokio_stream::once(ping_bytes(&conn, "x"))),
            HashMap::new(),
            opts(),
        )
        .await
        .expect("trailers-only is Ok(StreamStart), not Err");

    // Trailers-only = one HEADERS block that IS the trailers: it belongs to the End, so
    // the stream start carries no headers (the same keys must not show twice).
    assert!(start.headers.is_empty(), "headers: {:?}", start.headers);
    let (msgs, end) = drain(start.inbound).await;
    assert!(msgs.is_empty());
    let end = end.expect("terminal StreamEnd");
    assert_eq!(end.status_code, 16);
    assert_eq!(end.trailing_metadata.get("x-reason").map(String::as_str), Some("expired"));
}

#[tokio::test]
async fn ok_end_carries_server_trailers() {
    let mut trailers = HashMap::new();
    trailers.insert("x-server-hostname".to_string(), "echo-1".to_string());
    let (transport, conn, _stop) =
        open(common::EchoConfig { stream_count: 1, trailers, ..Default::default() }).await;

    let start = transport
        .stream_dynamic(
            conn.channel.clone(),
            "/test.Echo/ServerStream".into(),
            Box::pin(tokio_stream::once(ping_bytes(&conn, "x"))),
            HashMap::new(),
            opts(),
        )
        .await
        .expect("stream start");

    // The fixture puts its extra metadata on the response headers for streams —
    // it must show up at stream start, not be merged into the end.
    assert_eq!(start.headers.get("x-server-hostname").map(String::as_str), Some("echo-1"));
    let (msgs, end) = drain(start.inbound).await;
    assert_eq!(msgs.len(), 1);
    assert_eq!(end.expect("end").status_code, 0);
}
