//! Single error type for handshaker-core. Every public API returns `Result<_, CoreError>`.

use thiserror::Error;

use crate::stream::MethodKind;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid target: {0}")]
    InvalidTarget(String),
    #[error("not connected")]
    NotConnected,
    #[error("reflection disabled on server: {hint}")]
    ReflectionDisabled { hint: String },
    #[error("reflection error: {0}")]
    Reflection(String),
    #[error("descriptor build failed: {0}")]
    DescriptorBuild(String),
    #[error("service not found: {service}")]
    ServiceNotFound { service: String },
    #[error("method not found: {service}/{method}")]
    MethodNotFound { service: String, method: String },
    #[error("encode request failed: {0}")]
    EncodeRequest(String),
    #[error("decode response failed: {0}")]
    DecodeResponse(String),
    #[error("unresolved variable: {name}")]
    UnresolvedVariable { name: String },
    #[error("variable cycle: chain {chain:?}")]
    VariableCycle { chain: Vec<String> },
    /// Resolve pipeline gathered every unresolved `{{var}}` at once (deduped, encounter
    /// order) plus a cycle chain if one was detected. Unlike `UnresolvedVariable`, this
    /// is the whole diagnosis, not the first failure.
    #[error("resolve failed: unresolved {unresolved:?}, cycle {cycle:?}")]
    ResolveFailed { unresolved: Vec<String>, cycle: Option<Vec<String>> },
    #[error("transport error: {0}")]
    Transport(String),
    #[error("auth error: {0}")]
    Auth(String),
    #[error("gRPC status {code}: {message}")]
    GrpcStatus { code: i32, message: String },
    /// A core-owned phase timer of a stream call expired (Open → connected, or
    /// half-close → stream start). Unary deadlines are the calling layer's race, so
    /// they never produce this variant.
    #[error("deadline exceeded after {timeout_ms} ms")]
    DeadlineExceeded { timeout_ms: u64 },
    /// A Stream store lookup missed: no call under `request_id`, or the call has no
    /// inbound message with that 1-based `index` (released, never received, or a
    /// stale id).
    #[error("stream {request_id}: no message #{index}")]
    StreamMessageNotFound { request_id: String, index: u32 },
    /// A **Send message** / **Half-close** found no open outbound side under
    /// `request_id`: the call is unknown (not yet `Opened`, or released), already
    /// half-closed, ended, or cancelled. Never a silent drop.
    #[error("stream {request_id}: outbound side is closed")]
    StreamClosed { request_id: String },
    /// A Stream store operation (Save messages, Assemble) found no call under
    /// `request_id` — never `Opened`, or already released.
    #[error("stream {request_id}: no such call")]
    StreamNotFound { request_id: String },
    /// **Assemble** was asked for a `field_path` that is not a candidate of the call's
    /// response type (not a non-repeated `bytes` field reachable through single message
    /// fields) — a stale menu or a contract that changed since Open.
    #[error("stream {request_id}: no bytes field `{field_path}` in the response type")]
    StreamFieldNotFound { request_id: String, field_path: String },
    /// The **kind gate**: the call path does not match the method's **Method kind** in the
    /// loaded contract, refused before anything reaches the wire. `expected` is the kind
    /// the caller's path implied (the unary spine → `Unary`; `open_stream` → the kind the
    /// UI chose), `actual` is the descriptor's kind — the path a re-route must take.
    /// `expected == actual == Unary` arises only from `open_stream(Unary)`: the stream
    /// path has no unary shape, so even an agreeing unary kind is refused there.
    #[error("method kind mismatch: {service}/{method} is {actual}, called as {expected}")]
    MethodKindMismatch {
        service: String,
        method: String,
        expected: MethodKind,
        actual: MethodKind,
    },
    #[error("not implemented (MVP): {0}")]
    NotImplemented(String),
    #[error("persistence error: {0}")]
    Persistence(String),
}

#[cfg(test)]
mod tests {
    use super::CoreError;

    #[test]
    fn invalid_target_renders_with_payload() {
        let e = CoreError::InvalidTarget("api.prod:bad".into());
        assert_eq!(e.to_string(), "invalid target: api.prod:bad");
    }

    #[test]
    fn reflection_disabled_uses_named_field() {
        let e = CoreError::ReflectionDisabled {
            hint: "enable reflection on server".into(),
        };
        assert_eq!(
            e.to_string(),
            "reflection disabled on server: enable reflection on server"
        );
    }

    #[test]
    fn variable_cycle_renders_chain() {
        let e = CoreError::VariableCycle {
            chain: vec!["a".into(), "b".into(), "a".into()],
        };
        assert_eq!(e.to_string(), r#"variable cycle: chain ["a", "b", "a"]"#);
    }

    #[test]
    fn grpc_status_renders_code_and_message() {
        let e = CoreError::GrpcStatus {
            code: 16,
            message: "UNAUTHENTICATED".into(),
        };
        assert_eq!(e.to_string(), "gRPC status 16: UNAUTHENTICATED");
    }
}
