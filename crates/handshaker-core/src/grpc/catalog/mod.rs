//! Service catalog: stable, UI-friendly snapshot of services → methods → message schemas
//! derived from a `DescriptorPool`. **Read-only**. The pool stays the source of truth;
//! catalog is a projection optimised for rendering.

pub mod build;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceCatalog {
    pub services: Vec<ServiceEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceEntry {
    /// Fully-qualified, e.g. `test.Echo`.
    pub full_name: String,
    pub methods: Vec<MethodEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MethodEntry {
    /// Short name, e.g. `Send`.
    pub name: String,
    /// gRPC path used at invoke time, e.g. `/test.Echo/Send`.
    pub path: String,
    /// Fully-qualified input message name, e.g. `test.Ping`.
    pub input_message: String,
    /// Fully-qualified output message name, e.g. `test.Pong`.
    pub output_message: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
}

pub use build::build_catalog;
