//! IPC-facing wrappers around `handshaker_core::grpc::ServiceCatalog`.
//!
//! Keeps handshaker-core OS-independent (no specta dep). Conversion is cheap
//! — Vec/String allocations, no I/O.

use handshaker_core::grpc::{MethodEntry, ServiceCatalog, ServiceEntry};
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ServiceCatalogIpc {
    pub services: Vec<ServiceEntryIpc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ServiceEntryIpc {
    pub full_name: String,
    pub methods: Vec<MethodEntryIpc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MethodEntryIpc {
    pub name: String,
    pub path: String,
    pub input_message: String,
    pub output_message: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
}

impl From<ServiceCatalog> for ServiceCatalogIpc {
    fn from(c: ServiceCatalog) -> Self {
        Self {
            services: c.services.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<ServiceEntry> for ServiceEntryIpc {
    fn from(s: ServiceEntry) -> Self {
        Self {
            full_name: s.full_name,
            methods: s.methods.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<MethodEntry> for MethodEntryIpc {
    fn from(m: MethodEntry) -> Self {
        Self {
            name: m.name,
            path: m.path,
            input_message: m.input_message,
            output_message: m.output_message,
            client_streaming: m.client_streaming,
            server_streaming: m.server_streaming,
        }
    }
}
