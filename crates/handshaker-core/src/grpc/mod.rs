//! gRPC subsystem: target, transport, reflection, descriptors, catalog, connection orchestration.
//!
//! Tonic concrete types are confined to `transport::tonic_impl` and `reflection` (Plan #2-3).
//! `TonicChannel` (a `tonic::transport::Channel` type alias) is the only tonic surface exposed
//! at the `grpc::` level today; Plan #3 introduces a higher-level call abstraction that should
//! eventually subsume it. The rest of the core talks `prost_reflect::DescriptorPool` and the
//! data types defined here.

pub mod catalog;
pub mod connection;
pub mod contract;
pub mod contract_cache;
pub mod descriptor;
pub mod error_class;
pub mod file_contract_cache;
pub mod invoke;
pub mod reflection;
#[cfg(test)]
pub mod testing;
pub mod transport;

pub use catalog::{build_catalog, MethodEntry, ServiceCatalog, ServiceEntry};
pub use connection::{GrpcConnection, GrpcTarget};
pub use contract::activate;
pub use contract_cache::{CachedContract, ContractCache, ContractKey, InMemoryContractCache};
pub use error_class::{classify_connect_error, ConnectKind};
pub use file_contract_cache::FileContractCache;
pub use descriptor::build_pool;
pub use invoke::{
    build_message_schema_from_pool, build_request_skeleton, build_request_skeleton_from_pool,
    extract_status_details, invoke_unary, CallOptions, EnumNode, EnumValueNode, FieldNode,
    FieldValueKind, FieldViolation, HelpLink, MessageNode, MessageSchema, MessageSide,
    PreconditionViolation, QuotaViolation, StatusDetail, UnaryOutcome,
};
pub use transport::{GrpcTransport, TonicChannel, TonicTransport};
