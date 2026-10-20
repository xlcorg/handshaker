use handshaker_core::grpc::{ContractQuery, MethodBundle};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ipc::catalog::ServiceCatalogIpc;
use crate::ipc::schema::MessageSchemaIpc;

/// One contract-read query. The probe target is resolved once per call.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct ContractQueryIpc {
    pub service: String,
    pub method: String,
    pub refresh: bool,
}

impl ContractQueryIpc {
    pub fn into_core(self) -> ContractQuery {
        ContractQuery {
            service: self.service,
            method: self.method,
            refresh: self.refresh,
        }
    }
}

/// Catalog, both schemas, and the request skeleton for the named method.
#[derive(Debug, Clone, Serialize, Type)]
pub struct MethodBundleIpc {
    pub catalog: ServiceCatalogIpc,
    pub input_schema: Option<MessageSchemaIpc>,
    pub output_schema: Option<MessageSchemaIpc>,
    pub skeleton: Option<String>,
}

impl From<MethodBundle> for MethodBundleIpc {
    fn from(bundle: MethodBundle) -> Self {
        Self {
            catalog: ServiceCatalogIpc::from(bundle.catalog),
            input_schema: bundle.input_schema.map(MessageSchemaIpc::from),
            output_schema: bundle.output_schema.map(MessageSchemaIpc::from),
            skeleton: bundle.skeleton,
        }
    }
}
