//! handshaker-core — OS-independent core.
//!
//! Modules grow plan-by-plan: error (plan 1), grpc/* (plans 2-3), env+resolver (plan 4),
//! auth (plan 5), collections (plan 6).

pub mod env;
pub mod error;
pub mod grpc;
pub mod vars;

pub use error::CoreError;
pub use grpc::GrpcTarget;
pub use grpc::UnaryOutcome;
pub use grpc::{build_request_skeleton, invoke_unary};
