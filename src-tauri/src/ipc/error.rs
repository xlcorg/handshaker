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
