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
pub mod descriptor;
pub mod invoke;
pub mod reflection;
pub mod transport;

pub use catalog::{build_catalog, MethodEntry, ServiceCatalog, ServiceEntry};
pub use connection::{GrpcConnection, GrpcTarget};
pub use contract::activate;
pub use descriptor::build_pool;
pub use invoke::UnaryOutcome;
pub use transport::{GrpcTransport, TonicChannel, TonicTransport};
