mod common;

use handshaker_core::grpc::contract::activate;
use handshaker_core::grpc::connection::GrpcTarget;
use handshaker_core::grpc::invoke::build_request_skeleton;
use handshaker_core::grpc::transport::TonicTransport;
use serde_json::Value;
use std::sync::Arc;

#[tokio::test]
async fn skeleton_for_echo_with_deps() {
    let (addr, _stop) = common::spawn_reflection_server_v1_with_deps().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let conn = activate(target, transport).await.expect("activate");

    let json_str =
        build_request_skeleton(&conn, "test.EchoWithDeps", "Send").expect("skeleton");
    let v: Value = serde_json::from_str(&json_str).expect("valid JSON");
    // PingX { h: Header { trace_id }, id }
    assert_eq!(v["id"], serde_json::json!(""));
    assert!(v["h"].is_object(), "h must be nested Header object");
    assert_eq!(v["h"]["traceId"], serde_json::json!(""));
}

#[tokio::test]
async fn skeleton_returns_method_not_found() {
    let (addr, _stop) = common::spawn_reflection_server_v1().await;
    let target = GrpcTarget::new(addr.to_string(), false, false).unwrap();
    let transport: Arc<dyn handshaker_core::grpc::transport::GrpcTransport> =
        Arc::new(TonicTransport::new());
    let conn = activate(target, transport).await.expect("activate");

    let err = build_request_skeleton(&conn, "test.Echo", "Nope").unwrap_err();
    assert!(matches!(
        err,
        handshaker_core::error::CoreError::MethodNotFound { .. }
    ));
}
