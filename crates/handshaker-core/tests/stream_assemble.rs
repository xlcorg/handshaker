//! **Assemble** end to end against the echo fixture's `Download(Ping) → stream Chunk {
//! name, data }` (real tonic on both sides): the candidate list rides `Opened`, the
//! chunks reassemble byte for byte through a sink, the first message names the file, and
//! a cancelled download assembles whatever arrived.

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
use handshaker_core::stream::{AssembleResult, MethodKind, StreamEvent, StreamEvents};
use handshaker_core::vars::builtins::SystemBuiltins;
use uuid::Uuid;

fn request(addr: &str) -> SavedRequest {
    SavedRequest {
        id: ItemId(Uuid::from_u128(1)),
        name: "r".into(),
        address_template: addr.into(),
        service: "test.Echo".into(),
        method: "Download".into(),
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

/// `n` chunks of distinct length and fill; the first one starts with `0xff` (not UTF-8),
/// so a sniffed default name lands on `.bin`.
fn chunks(n: usize) -> Vec<Vec<u8>> {
    (0..n).map(|i| vec![0xff - i as u8; 1000 + i]).collect()
}

#[tokio::test]
async fn download_assembles_every_chunk_under_the_name_the_first_message_carries() {
    let payload = chunks(5);
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig {
        download_name: "archive.tar".into(),
        download_chunks: payload.clone(),
        ..Default::default()
    })
    .await;
    let (events, mut rx) = collector();

    let call = sender()
        .open_stream(&request(&addr.to_string()), None, None, MethodKind::Server, opts(), events)
        .await
        .expect("open");

    match next(&mut rx).await {
        StreamEvent::Opened { kind, bytes_fields, .. } => {
            assert_eq!(kind, MethodKind::Server);
            assert_eq!(bytes_fields, vec!["data"], "the one bytes field of Chunk");
        }
        other => panic!("expected Opened, got {other:?}"),
    }
    loop {
        match next(&mut rx).await {
            StreamEvent::End { status_code, message_count, .. } => {
                assert_eq!(status_code, 0);
                assert_eq!(message_count, 5);
                break;
            }
            StreamEvent::Fault { error } => panic!("unexpected fault: {error:?}"),
            _ => {}
        }
    }

    let mut sink = Vec::new();
    let r = call.assemble("data", &mut sink).expect("assemble");
    assert_eq!(sink, payload.concat(), "concatenated byte for byte, in order");
    assert_eq!(r, AssembleResult { written: 5, total: 5, size_bytes: payload.concat().len() as u64 });
    assert_eq!(call.default_name("data", "S").unwrap(), "archive.tar", "every chunk carries the name");

    // Save messages sees the same five rows as one array.
    let arr: Vec<serde_json::Value> = serde_json::from_str(&call.save_messages().unwrap()).unwrap();
    assert_eq!(arr.len(), 5);
    assert_eq!(arr[0]["name"], "archive.tar");
}

#[tokio::test]
async fn cancelled_download_assembles_the_chunks_received_so_far() {
    let payload = chunks(200);
    let (addr, _stop) = common::spawn_echo_server(common::EchoConfig {
        download_chunks: payload.clone(),
        stream_delay: Some(Duration::from_millis(5)),
        ..Default::default()
    })
    .await;
    let (events, mut rx) = collector();

    let call = sender()
        .open_stream(&request(&addr.to_string()), None, None, MethodKind::Server, opts(), events)
        .await
        .expect("open");

    let mut seen = 0;
    while seen < 3 {
        if let StreamEvent::Message { .. } = next(&mut rx).await {
            seen += 1;
        }
    }
    call.cancel();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !call.is_finished() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("task ends after cancel");

    let kept = call.message_count();
    assert!((3..200).contains(&kept), "some but not all chunks arrived: {kept}");
    let mut sink = Vec::new();
    let r = call.assemble("data", &mut sink).expect("assemble after cancel");
    assert_eq!(sink, payload[..kept].concat(), "exactly the received prefix");
    assert_eq!(r.written, kept as u32);
    assert_eq!(r.total, kept as u32);
    // No name field on these chunks → stamp + sniffed extension (raw bytes = `bin`).
    assert_eq!(call.default_name("data", "S").unwrap(), "stream-S.bin");
}
