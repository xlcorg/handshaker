//! Single error type for handshaker-core. Every public API returns `Result<_, CoreError>`.

use thiserror::Error;

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
