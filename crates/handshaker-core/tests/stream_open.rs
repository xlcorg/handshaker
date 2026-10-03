//! `Sender::open_stream` end to end against the echo fixture's `ServerStream` (real
//! tonic on both sides): N rows then an OK end, a scripted non-OK end mid-stream, and
//! cancel via the handle mid-stream (rows kept, nothing more emitted).

mod common;

use std::sync::Arc;
use std::time::Duration;

use handshaker_core::auth::{AuthCredentials, StaticTokenSource};
use handshaker_core::collections::ids::ItemId;
use handshaker_core::collections::SavedRequest;
use handshaker_core::grpc::invoke::CallOptions;
use handshaker_core::grpc::transport::TonicTransport;
use handshaker_core::grpc::InMemoryContractCache;
use handshaker_core::send::Sender;
use handshaker_core::stream::{MethodKind, StreamEvent, StreamEvents};
use handshaker_core::vars::builtins::SystemBuiltins;
use uuid::Uuid;

fn request(addr: &str) -> SavedRequest {
    SavedRequest {
        id: ItemId(Uuid::from_u128(1)),
        name: "r".into(),
        address_template: addr.into(),
        service: "test.Echo".into(),
        method: "ServerStream".into(),
        body_template: r#"{"id":"hi"}"#.into(),
        metadata: vec![],
        auth: handshaker_core::auth::SavedAuthConfig::None,
        tls_override: Some(false),
        last_used_at: None,
        use_count: 0,
    }
}

fn sender() -> Sender {
    Sender::new(
        Arc::new(TonicTransport::new()),
        Arc::new(StaticTokenSource {
            header: AuthCredentials { header_name: "authorization".into(), header_value: "x".into() },
        }),
        Arc::new(InMemoryContractCache::new()),
        Arc::new(SystemBuiltins),
    )
}

fn collector() -> (StreamEvents, tokio::sync::mpsc::UnboundedReceiver<StreamEvent>) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let events: StreamEvents = Arc::new(move |ev| {
        let _ = tx.send(ev);
    });
    (events, rx)
}

async fn next(rx: &mut tokio::sync::mpsc::UnboundedReceiver<StreamEvent>) -> StreamEvent {
    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("event within 5s")
        .expect("sink alive")
}

fn opts() -> CallOptions {
    CallOptions { max_message_bytes: usize::MAX, phase_timeout: Some(Duration::from_secs(5)) }
}

#[tokio::test]
async fn server_stream_delivers_n_rows_then_ok_end_with_totals() {
    let (addr, _stop) =
        common::spawn_echo_server(common::EchoConfig { stream_count: 3, ..Default::default() })
            .await;
    let (events, mut rx) = collector();

    let call = sender()
        .open_stream(&request(&addr.to_string()), None, None, MethodKind::Server, opts(), events)
        .await
        .expect("open");

    assert!(matches!(next(&mut rx).await, StreamEvent::Opened { kind: MethodKind::Server, .. }));
    assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
    let mut total = 0u64;
    for i in 1..=3u32 {
        match next(&mut rx).await {
            StreamEvent::Message { index, size_bytes, preview, json, .. } => {
                assert_eq!(index, i);
                total += size_bytes;
                assert!(preview.contains(&format!("echo: hi #{i}")), "{preview}");
                assert!(json.is_some());
            }
            other => panic!("expected Message #{i}, got {other:?}"),
        }
    }
    match next(&mut rx).await {
        StreamEvent::End { status_code, message_count, total_bytes, .. } => {
            assert_eq!(status_code, 0);
            assert_eq!(message_count, 3);
            assert_eq!(total_bytes, total);
        }
        other => panic!("expected End, got {other:?}"),
    }
    assert_eq!(call.message_count(), 3, "store keeps every raw row");
}

#[tokio::test]
async fn non_ok_end_mid_stream_arrives_as_end_with_that_code_and_rows_stay() {
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig {
        stream_count: 10,
        fail_after: Some((2, 13)), // INTERNAL after two rows
        trailers: std::collections::HashMap::from([("x-reason".to_string(), "quota".to_string())]),
        ..Default::default()
    })
    .await;
    let (events, mut rx) = collector();

    let call = sender()
        .open_stream(&request(&addr.to_string()), None, None, MethodKind::Server, opts(), events)
        .await
        .expect("open");

    let mut messages = 0;
    loop {
        match next(&mut rx).await {
            StreamEvent::Message { .. } => messages += 1,
            StreamEvent::End { status_code, status_message, trailing_metadata, message_count, .. } => {
                assert_eq!(status_code, 13);
                // `<code> <NAME> · message` on the red strip reads this text.
                assert_eq!(status_message, "injected stream error: Internal");
                // The server's error details ride the trailers ("See trailers").
                assert_eq!(trailing_metadata.get("x-reason").map(String::as_str), Some("quota"));
                assert_eq!(message_count, 2);
                break;
            }
            StreamEvent::Fault { error } => panic!("unexpected fault: {error:?}"),
            _ => {}
        }
    }
    assert_eq!(messages, 2);
    assert_eq!(call.message_count(), 2);
    // Rows received before the failure stay decodable on demand.
    let row2 = call.message_json(2).expect("decode").expect("row 2 kept");
    assert!(row2.contains(r#""echoed": "echo: hi #2""#), "{row2}");
    assert!(call.message_json(3).unwrap().is_none(), "nothing past the failure");
}

/// The deadline pref is core's phase timer, never a `grpc-timeout` header — that header
/// would make the server cancel an open stream on its own.
#[tokio::test]
async fn stream_call_sends_no_grpc_timeout_header_even_with_a_phase_timeout() {
    let config = common::EchoConfig { stream_count: 1, ..Default::default() };
    let seen = config.seen_metadata.clone();
    let (addr, _stop) = common::spawn_echo_server(config).await;
    let (events, mut rx) = collector();

    // `opts()` carries a 5 s phase timeout — the only deadline a stream call has.
    let _call = sender()
        .open_stream(&request(&addr.to_string()), None, None, MethodKind::Server, opts(), events)
        .await
        .expect("open");
    while !matches!(next(&mut rx).await, StreamEvent::End { .. }) {}

    let md = seen.lock().unwrap().clone().expect("server saw the request");
    assert!(md.get("content-type").is_some(), "request metadata captured: {md:?}");
    assert!(md.get("grpc-timeout").is_none(), "no grpc-timeout on a stream call: {md:?}");
}

#[tokio::test]
async fn cancel_mid_stream_keeps_received_rows_and_emits_nothing_more() {
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig {
        stream_count: 1000,
        stream_delay: Some(Duration::from_millis(5)),
        ..Default::default()
    })
    .await;
    let (events, mut rx) = collector();

    let call = sender()
        .open_stream(&request(&addr.to_string()), None, None, MethodKind::Server, opts(), events)
        .await
        .expect("open");

    // Let a few rows through, then cancel.
    let mut seen = 0;
    while seen < 3 {
        if let StreamEvent::Message { .. } = next(&mut rx).await {
            seen += 1;
        }
    }
    call.cancel();
    // The task drops the inbound stream (RST on the wire) and goes quiet.
    tokio::time::timeout(Duration::from_secs(5), async {
        while !call.is_finished() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("task ends after cancel");
    tokio::time::sleep(Duration::from_millis(50)).await;

    let kept = call.message_count();
    assert!(kept >= 3, "rows received before cancel stay: {kept}");
    // Anything still in the channel was emitted before cancel took effect; no End/Fault.
    while let Ok(ev) = rx.try_recv() {
        assert!(matches!(ev, StreamEvent::Message { .. }), "no terminal event after cancel: {ev:?}");
    }
    assert!(call.is_cancelled());
}
