//! Live-server smoke test. Run explicitly via `cargo test --test invoke_live -- --ignored`.
//! Doesn't block CI — `#[ignore]` skips by default.
//!
//! Default target: `127.0.0.1:5002`. Override via
//! `HANDSHAKER_LIVE_TARGET=host:port cargo test --test invoke_live -- --ignored --nocapture`.

mod common;

use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::invoke::{build_request_skeleton, invoke_unary, CallOptions};
use handshaker_core::grpc::transport::TonicTransport;
use std::collections::HashMap;
use std::sync::Arc;

const DEFAULT_TARGET: &str = "127.0.0.1:5002";

fn live_target() -> String {
    std::env::var("HANDSHAKER_LIVE_TARGET").unwrap_or_else(|_| DEFAULT_TARGET.to_string())
}

#[tokio::test]
#[ignore = "requires a real gRPC server with reflection at HANDSHAKER_LIVE_TARGET"]
async fn live_target_reflects_and_invokes_first_unary_method() {
    let address = live_target();
    println!("[invoke_live] target = {address}");

    let target = GrpcTarget::new(address.clone(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let cache = handshaker_core::grpc::InMemoryContractCache::new();
    let conn = activate(target, transport, &cache).await.expect("activate live");

    // Find the first non-reflection unary method.
    let mut chosen: Option<(String, String)> = None;
    for svc in &conn.catalog.services {
        if svc.full_name.starts_with("grpc.reflection.") {
            continue;
        }
        for m in &svc.methods {
            if m.client_streaming || m.server_streaming {
                continue;
            }
            chosen = Some((svc.full_name.clone(), m.name.clone()));
            break;
        }
        if chosen.is_some() {
            break;
        }
    }
    let (svc_name, method_name) =
        chosen.expect("live server must expose at least one non-reflection unary method");
    println!("[invoke_live] picked method = {svc_name}/{method_name}");

    let skeleton = build_request_skeleton(&conn, &svc_name, &method_name).expect("skeleton");
    println!("[invoke_live] skeleton = {skeleton}");

    match invoke_unary(
        &conn,
        &svc_name,
        &method_name,
        &skeleton,
        HashMap::new(),
        CallOptions { max_message_bytes: usize::MAX },
    )
    .await
    {
        Ok(outcome) => {
            println!(
                "[invoke_live] outcome: status={} ({}), ms={}",
                outcome.status_code, outcome.status_message, outcome.elapsed_ms,
            );
            // No strong assertion on status_code — server may legitimately return
            // INVALID_ARGUMENT for an all-defaults skeleton. What matters: no panic,
            // outcome correctly populated.
            if outcome.status_code == 0 {
                assert!(outcome.response_json.is_some());
            } else {
                assert!(!outcome.status_message.is_empty());
            }
        }
        Err(handshaker_core::error::CoreError::NotImplemented(msg)) => {
            // Streaming method accidentally picked — that's OK, skip.
            println!("[invoke_live] picked method was streaming; skipping ({msg})");
        }
        Err(e) => panic!("invoke_live unexpected client-side error: {e:?}"),
    }
}
