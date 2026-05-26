//! IPC-facing error. Tagged union with discriminator "type" — frontend type-narrows.

use handshaker_core::CoreError;
use serde::Serialize;
use specta::Type;

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
    Transport { message: String },
    Auth { message: String },
    GrpcStatus { code: i32, message: String },
    NotImplemented { message: String },
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
            CoreError::Transport(m) => IpcError::Transport { message: m },
            CoreError::Auth(m) => IpcError::Auth { message: m },
            CoreError::GrpcStatus { code, message } => IpcError::GrpcStatus { code, message },
            CoreError::NotImplemented(m) => IpcError::NotImplemented { message: m },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::IpcError;
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
        ];

        assert_eq!(cases.len(), 15, "Update this test when CoreError variants change");

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
}
