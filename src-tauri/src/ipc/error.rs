//! IPC-facing error. Tagged union with discriminator "type" — frontend type-narrows.

use handshaker_core::grpc::ConnectKind;
use handshaker_core::CoreError;
use serde::Serialize;
use specta::Type;

use crate::ipc::MethodKindIpc;

/// Structured classification of a transport-connect failure. Lets the frontend
/// narrow on a kind instead of regex-parsing the message string.
#[derive(Debug, Serialize, Type, PartialEq)]
pub enum TransportKindIpc {
    Refused,
    Tls,
    Dns,
    Other,
}

impl From<ConnectKind> for TransportKindIpc {
    fn from(k: ConnectKind) -> Self {
        match k {
            ConnectKind::Refused => TransportKindIpc::Refused,
            ConnectKind::Tls => TransportKindIpc::Tls,
            ConnectKind::Dns => TransportKindIpc::Dns,
            ConnectKind::Other => TransportKindIpc::Other,
        }
    }
}

#[derive(Debug, Serialize, Type)]
#[serde(tag = "type")]
pub enum IpcError {
    InvalidTarget { message: String },
    NotConnected,
    ReflectionDisabled { hint: String },
    Reflection { message: String },
    DescriptorBuild { message: String },
    ServiceNotFound { service: String },
    MethodNotFound { service: String, method: String },
    EncodeRequest { message: String },
    DecodeResponse { message: String },
    UnresolvedVariable { name: String },
    VariableCycle { chain: Vec<String> },
    UnresolvedVars { unresolved: Vec<String>, cycle: Option<Vec<String>> },
    Transport { kind: TransportKindIpc, message: String },
    Cancelled,
    DeadlineExceeded { timeout_ms: u32 },
    /// `stream_message` (and later store reads) for an unknown call id or row index.
    StreamMessageNotFound { request_id: String, index: u32 },
    /// `stream_send` / `stream_half_close` found no open outbound side under the id: the
    /// call is not `Opened` yet (or released), already half-closed, ended or cancelled.
    StreamClosed { request_id: String },
    /// `stream_save_messages` / `stream_assemble` for an id with no Stream store (never
    /// `Opened`, or already released).
    StreamNotFound { request_id: String },
    /// `stream_assemble` for a `field_path` that is not a `bytes` candidate of the call's
    /// response type (stale menu / changed contract).
    StreamFieldNotFound { request_id: String, field_path: String },
    /// The **kind gate**: the call path did not match the method's kind in the loaded
    /// contract — nothing reached the wire. `expected` = the kind the path implied
    /// (`grpc_send` → `unary`, `stream_open` → the kind the UI passed); `actual` = the
    /// descriptor's kind, i.e. the path the one-shot re-route takes.
    MethodKindMismatch {
        service: String,
        method: String,
        expected: MethodKindIpc,
        actual: MethodKindIpc,
    },
    Auth { message: String },
    GrpcStatus { code: i32, message: String },
    NotImplemented { message: String },
    Persistence { message: String },
}

impl From<CoreError> for IpcError {
    fn from(e: CoreError) -> Self {
        match e {
            CoreError::InvalidTarget(m) => IpcError::InvalidTarget { message: m },
            CoreError::NotConnected => IpcError::NotConnected,
            CoreError::ReflectionDisabled { hint } => IpcError::ReflectionDisabled { hint },
            CoreError::Reflection(m) => IpcError::Reflection { message: m },
            CoreError::DescriptorBuild(m) => IpcError::DescriptorBuild { message: m },
            CoreError::ServiceNotFound { service } => IpcError::ServiceNotFound { service },
            CoreError::MethodNotFound { service, method } => {
                IpcError::MethodNotFound { service, method }
            }
            CoreError::EncodeRequest(m) => IpcError::EncodeRequest { message: m },
            CoreError::DecodeResponse(m) => IpcError::DecodeResponse { message: m },
            CoreError::UnresolvedVariable { name } => IpcError::UnresolvedVariable { name },
            CoreError::VariableCycle { chain } => IpcError::VariableCycle { chain },
            CoreError::Transport(m) => IpcError::Transport {
                kind: handshaker_core::grpc::classify_connect_error(&m).into(),
                message: m,
            },
            CoreError::Auth(m) => IpcError::Auth { message: m },
            CoreError::GrpcStatus { code, message } => IpcError::GrpcStatus { code, message },
            // Core phase timers of a stream call → the same face as the unary race.
            CoreError::DeadlineExceeded { timeout_ms } => IpcError::DeadlineExceeded {
                timeout_ms: timeout_ms.min(u64::from(u32::MAX)) as u32,
            },
            CoreError::StreamMessageNotFound { request_id, index } => {
                IpcError::StreamMessageNotFound { request_id, index }
            }
            CoreError::StreamClosed { request_id } => IpcError::StreamClosed { request_id },
            CoreError::StreamNotFound { request_id } => IpcError::StreamNotFound { request_id },
            CoreError::StreamFieldNotFound { request_id, field_path } => {
                IpcError::StreamFieldNotFound { request_id, field_path }
            }
            CoreError::MethodKindMismatch { service, method, expected, actual } => {
                IpcError::MethodKindMismatch {
                    service,
                    method,
                    expected: MethodKindIpc::from_core(expected),
                    actual: MethodKindIpc::from_core(actual),
                }
            }
            CoreError::NotImplemented(m) => IpcError::NotImplemented { message: m },
            CoreError::Persistence(m) => IpcError::Persistence { message: m },
            CoreError::ResolveFailed { unresolved, cycle } => {
                IpcError::UnresolvedVars { unresolved, cycle }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{IpcError, TransportKindIpc};
    use crate::ipc::MethodKindIpc;
    use handshaker_core::stream::MethodKind;
    use handshaker_core::CoreError;

    /// One-shot exhaustiveness check: every CoreError variant maps to the expected IpcError shape.
    /// If a new CoreError variant is added without updating the From impl above, this test fails to
    /// compile (because the match below is exhaustive over CoreError).
    #[test]
    fn from_core_error_exhaustive() {
        let cases: Vec<CoreError> = vec![
            CoreError::InvalidTarget("t".into()),
            CoreError::NotConnected,
            CoreError::ReflectionDisabled { hint: "h".into() },
            CoreError::Reflection("r".into()),
            CoreError::DescriptorBuild("d".into()),
            CoreError::ServiceNotFound { service: "s".into() },
            CoreError::MethodNotFound { service: "s".into(), method: "m".into() },
            CoreError::EncodeRequest("e".into()),
            CoreError::DecodeResponse("d".into()),
            CoreError::UnresolvedVariable { name: "v".into() },
            CoreError::VariableCycle { chain: vec!["a".into()] },
            CoreError::Transport("t".into()),
            CoreError::Auth("a".into()),
            CoreError::GrpcStatus { code: 1, message: "m".into() },
            CoreError::NotImplemented("n".into()),
            CoreError::Persistence("p".into()),
            CoreError::ResolveFailed { unresolved: vec!["v".into()], cycle: None },
            CoreError::DeadlineExceeded { timeout_ms: 5 },
            CoreError::StreamMessageNotFound { request_id: "r".into(), index: 1 },
            CoreError::StreamClosed { request_id: "r".into() },
            CoreError::MethodKindMismatch {
                service: "s".into(),
                method: "m".into(),
                expected: MethodKind::Unary,
                actual: MethodKind::Server,
            },
            CoreError::StreamNotFound { request_id: "r".into() },
            CoreError::StreamFieldNotFound { request_id: "r".into(), field_path: "data".into() },
        ];

        assert_eq!(cases.len(), 23, "Update this test when CoreError variants change");

        for c in cases {
            // Smoke test: From impl must succeed for every variant. If a future CoreError variant
            // is added but the From impl above forgets it, this won't compile.
            let _: IpcError = c.into();
        }
    }

    /// Sanity-check the JSON discriminator works as the frontend expects.
    #[test]
    fn serializes_with_type_tag() {
        let e: IpcError = CoreError::ServiceNotFound { service: "foo.Bar".into() }.into();
        let json = serde_json::to_string(&e).unwrap();
        // Tagged union with discriminator "type"
        assert!(json.contains(r#""type":"ServiceNotFound""#));
        assert!(json.contains(r#""service":"foo.Bar""#));
    }

    #[test]
    fn transport_from_core_carries_connect_kind() {
        let e: IpcError = handshaker_core::CoreError::Transport(
            "connect `http://x`: tcp connect error: Connection refused".into(),
        )
        .into();
        match e {
            IpcError::Transport { kind, .. } => assert_eq!(kind, TransportKindIpc::Refused),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn resolve_failed_maps_to_unresolved_vars() {
        let e: IpcError = CoreError::ResolveFailed {
            unresolved: vec!["a".into(), "b".into()], cycle: None }.into();
        match e {
            IpcError::UnresolvedVars { unresolved, cycle } => {
                assert_eq!(unresolved, vec!["a", "b"]);
                assert!(cycle.is_none());
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn core_deadline_maps_to_ipc_deadline_with_timeout() {
        let e: IpcError = CoreError::DeadlineExceeded { timeout_ms: 30_000 }.into();
        match e {
            IpcError::DeadlineExceeded { timeout_ms } => assert_eq!(timeout_ms, 30_000),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn stream_closed_maps_with_the_request_id_and_tags_by_type() {
        let e: IpcError = CoreError::StreamClosed { request_id: "rid".into() }.into();
        match &e {
            IpcError::StreamClosed { request_id } => assert_eq!(request_id, "rid"),
            other => panic!("got {other:?}"),
        }
        let j = serde_json::to_string(&e).unwrap();
        assert!(j.contains(r#""type":"StreamClosed""#) && j.contains(r#""request_id":"rid""#), "{j}");
    }

    /// The kind gate's error crosses IPC 1:1 with both kinds in the frontend's snake_case
    /// spelling — `actual` is what the one-shot re-route routes by.
    #[test]
    fn method_kind_mismatch_maps_both_kinds_and_serializes_them_snake_case() {
        let e: IpcError = CoreError::MethodKindMismatch {
            service: "pkg.Svc".into(),
            method: "Watch".into(),
            expected: MethodKind::Unary,
            actual: MethodKind::Server,
        }
        .into();
        match &e {
            IpcError::MethodKindMismatch { service, method, expected, actual } => {
                assert_eq!((service.as_str(), method.as_str()), ("pkg.Svc", "Watch"));
                assert_eq!((*expected, *actual), (MethodKindIpc::Unary, MethodKindIpc::Server));
            }
            other => panic!("got {other:?}"),
        }
        let j = serde_json::to_string(&e).unwrap();
        assert!(j.contains(r#""type":"MethodKindMismatch""#), "{j}");
        assert!(j.contains(r#""expected":"unary""#) && j.contains(r#""actual":"server""#), "{j}");
        let bidi: IpcError = CoreError::MethodKindMismatch {
            service: "s".into(), method: "m".into(), expected: MethodKind::Client, actual: MethodKind::Bidi,
        }
        .into();
        let j = serde_json::to_string(&bidi).unwrap();
        assert!(j.contains(r#""expected":"client""#) && j.contains(r#""actual":"bidi""#), "{j}");
    }

    /// The Stream store export errors cross 1:1 with the call id (and the path) so the
    /// frontend can name them without regexing the message.
    #[test]
    fn stream_export_errors_map_with_their_ids_and_tag_by_type() {
        let e: IpcError = CoreError::StreamNotFound { request_id: "rid".into() }.into();
        let j = serde_json::to_string(&e).unwrap();
        assert!(j.contains(r#""type":"StreamNotFound""#) && j.contains(r#""request_id":"rid""#), "{j}");
        let e: IpcError =
            CoreError::StreamFieldNotFound { request_id: "rid".into(), field_path: "chunk.data".into() }.into();
        match &e {
            IpcError::StreamFieldNotFound { request_id, field_path } => {
                assert_eq!((request_id.as_str(), field_path.as_str()), ("rid", "chunk.data"));
            }
            other => panic!("got {other:?}"),
        }
        let j = serde_json::to_string(&e).unwrap();
        assert!(j.contains(r#""type":"StreamFieldNotFound""#) && j.contains(r#""field_path":"chunk.data""#), "{j}");
    }

    #[test]
    fn cancelled_and_deadline_serialize_with_type_tag() {
        assert!(serde_json::to_string(&IpcError::Cancelled)
            .unwrap()
            .contains(r#""type":"Cancelled""#));
        let j = serde_json::to_string(&IpcError::DeadlineExceeded { timeout_ms: 30000 }).unwrap();
        assert!(j.contains(r#""type":"DeadlineExceeded""#) && j.contains(r#""timeout_ms":30000"#), "{j}");
    }
}
