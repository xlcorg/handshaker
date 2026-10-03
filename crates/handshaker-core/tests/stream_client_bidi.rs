//! `Sender::open_stream` + `StreamCall::send_message` / `half_close` end to end against
//! the echo fixture's `ClientStream(stream Ping) → Pong { echoed: "count: N" }` and
//! `Bidi(stream Ping) → stream Pong` (real tonic on both sides): Open sends nothing,
//! messages go out before any headers exist, half-close brings the server's answer, the
//! phase-2 deadline counts from half-close only.

mod common;

use std::sync::Arc;
use std::time::Duration;

use handshaker_core::auth::{AuthCredentials, StaticTokenSource};
use handshaker_core::collections::ids::ItemId;
use handshaker_core::collections::SavedRequest;
use handshaker_core::env::Environment;
use handshaker_core::grpc::invoke::CallOptions;
use handshaker_core::grpc::transport::TonicTransport;
use handshaker_core::grpc::InMemoryContractCache;
use handshaker_core::send::Sender;
use handshaker_core::stream::{MethodKind, StreamEvent, StreamEvents};
use handshaker_core::vars::builtins::SystemBuiltins;
use handshaker_core::CoreError;
use uuid::Uuid;

fn request(addr: &str, method: &str) -> SavedRequest {
    SavedRequest {
        id: ItemId(Uuid::from_u128(1)),
        name: "r".into(),
        address_template: addr.into(),
        service: "test.Echo".into(),
        method: method.into(),
        body_template: r#"{"id":"{{who}}"}"#.into(),
        metadata: vec![],
        auth: handshaker_core::auth::SavedAuthConfig::None,
        tls_override: Some(false),
        last_used_at: None,
        use_count: 0,
    }
}

fn env(who: &str) -> Environment {
    let mut variables = indexmap::IndexMap::new();
    variables.insert("who".to_string(), who.to_string());
    Environment { name: "dev".into(), variables, color: None }
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

fn opts(phase_timeout: Duration) -> CallOptions {
    CallOptions { max_message_bytes: usize::MAX, phase_timeout: Some(phase_timeout) }
}

#[tokio::test]
async fn client_stream_three_sends_then_half_close_yields_count_3_and_ok_end() {
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig::default()).await;
    let (events, mut rx) = collector();
    let request = request(&addr.to_string(), "ClientStream");
    let env = env("hi");

    let call = sender()
        .open_stream(&request, None, Some(&env), MethodKind::Client, opts(Duration::from_secs(5)), events)
        .await
        .expect("open");
    assert!(matches!(next(&mut rx).await, StreamEvent::Opened { kind: MethodKind::Client, .. }));

    // Three Send messages, acked before the server has said anything at all.
    for i in 1..=3u32 {
        let ack = call.send_message(&request.body_template, None, Some(&env)).await.expect("send");
        assert_eq!(ack.index, i);
        assert_eq!(ack.preview, r#"{"id":"hi"}"#);
        assert!(ack.json.contains(r#""id": "hi""#), "{}", ack.json);
    }
    assert!(rx.try_recv().is_err(), "a client-streaming server answers only after half-close");

    call.half_close().expect("half-close");
    assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
    match next(&mut rx).await {
        StreamEvent::Message { index, preview, .. } => {
            assert_eq!(index, 4, "the one reply follows the three → rows");
            assert!(preview.contains("count: 3"), "{preview}");
        }
        other => panic!("expected Message #4, got {other:?}"),
    }
    match next(&mut rx).await {
        StreamEvent::End { status_code, message_count, .. } => {
            assert_eq!(status_code, 0);
            assert_eq!(message_count, 1);
        }
        other => panic!("expected End, got {other:?}"),
    }
    assert_eq!(call.message_count(), 4);
    let sent = call.message_json(2).expect("decode").expect("→ row 2 kept");
    assert!(sent.contains(r#""id": "hi""#), "{sent}");
}

#[tokio::test]
async fn bidi_echoes_each_message_with_headers_before_half_close_and_ends_ok() {
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig::default()).await;
    let (events, mut rx) = collector();
    let request = request(&addr.to_string(), "Bidi");
    let mut env = env("a");

    // A short phase timeout: headers arrive before half-close, so it never fires.
    let call = sender()
        .open_stream(&request, None, Some(&env), MethodKind::Bidi, opts(Duration::from_millis(200)), events)
        .await
        .expect("open");
    assert!(matches!(next(&mut rx).await, StreamEvent::Opened { kind: MethodKind::Bidi, .. }));

    let ack = call.send_message(&request.body_template, None, Some(&env)).await.expect("send a");
    assert_eq!(ack.index, 1);
    // The bidi server answers with headers right away and echoes.
    assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
    match next(&mut rx).await {
        StreamEvent::Message { index, preview, .. } => {
            assert_eq!(index, 2);
            assert!(preview.contains("echo: a"), "{preview}");
        }
        other => panic!("expected echo #2, got {other:?}"),
    }

    // Idle well past the phase timeout: an open stream has no deadline.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(rx.try_recv().is_err(), "no Fault while open");

    env.variables.insert("who".into(), "b".into());
    let ack = call.send_message(&request.body_template, None, Some(&env)).await.expect("send b");
    assert_eq!(ack.index, 3);
    assert_eq!(ack.preview, r#"{"id":"b"}"#, "resolved with the env of this moment");
    match next(&mut rx).await {
        StreamEvent::Message { index, preview, .. } => {
            assert_eq!(index, 4);
            assert!(preview.contains("echo: b"), "{preview}");
        }
        other => panic!("expected echo #4, got {other:?}"),
    }

    call.half_close().expect("half-close");
    match next(&mut rx).await {
        StreamEvent::End { status_code, message_count, .. } => {
            assert_eq!(status_code, 0);
            assert_eq!(message_count, 2);
        }
        other => panic!("expected End, got {other:?}"),
    }

    // The outbound side is gone: never a silent drop.
    let err = call.send_message(&request.body_template, None, Some(&env)).await.unwrap_err();
    assert!(matches!(err, CoreError::StreamClosed { .. }), "{err:?}");
}

#[tokio::test]
async fn half_close_with_zero_messages_gets_count_0() {
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig::default()).await;
    let (events, mut rx) = collector();
    let request = request(&addr.to_string(), "ClientStream");
    let env = env("x");

    let call = sender()
        .open_stream(&request, None, Some(&env), MethodKind::Client, opts(Duration::from_secs(5)), events)
        .await
        .expect("open");
    assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));
    call.half_close().expect("half-close with nothing sent");

    assert!(matches!(next(&mut rx).await, StreamEvent::Headers { .. }));
    match next(&mut rx).await {
        StreamEvent::Message { index: 1, preview, .. } => assert!(preview.contains("count: 0"), "{preview}"),
        other => panic!("expected the reply as #1, got {other:?}"),
    }
    assert!(matches!(next(&mut rx).await, StreamEvent::End { status_code: 0, .. }));
}

/// Phase 2 against a server that never answers: no deadline runs while the outbound side
/// is open; once half-closed, the timer fires and the call faults after `Opened`.
#[tokio::test]
async fn phase2_deadline_fires_only_after_half_close_against_a_silent_server() {
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig {
        client_stream_hang: true,
        ..Default::default()
    })
    .await;
    let (events, mut rx) = collector();
    let request = request(&addr.to_string(), "ClientStream");
    let env = env("x");

    let call = sender()
        .open_stream(&request, None, Some(&env), MethodKind::Client, opts(Duration::from_millis(100)), events)
        .await
        .expect("open");
    assert!(matches!(next(&mut rx).await, StreamEvent::Opened { .. }));

    // Open, idle three times the deadline, still sendable.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(rx.try_recv().is_err(), "no deadline between Open and Half-close");
    call.send_message(&request.body_template, None, Some(&env)).await.expect("still open");

    call.half_close().expect("half-close");
    match next(&mut rx).await {
        StreamEvent::Fault { error } => {
            assert!(matches!(error, CoreError::DeadlineExceeded { timeout_ms: 100 }), "{error:?}");
        }
        other => panic!("expected Fault(DeadlineExceeded), got {other:?}"),
    }
    tokio::time::timeout(Duration::from_secs(2), async {
        while !call.is_finished() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the call ends on the fault");
    assert_eq!(call.message_count(), 1, "the sent row stays in the store");
}
