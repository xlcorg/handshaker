//! gRPC subsystem: target, transport, reflection, descriptors, catalog, connection orchestration.
//!
//! Tonic types are confined to `transport::tonic_impl` and `reflection`. The rest of the core
//! talks `prost_reflect::DescriptorPool` and the data types defined here.

pub mod connection;

pub use connection::GrpcTarget;
