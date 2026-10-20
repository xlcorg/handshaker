use handshaker_core::grpc::{ContractArtifact, ContractQuery, MessageSide};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ipc::catalog::ServiceCatalogIpc;
use crate::ipc::schema::{MessageSchemaIpc, MessageSideIpc};

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum ContractQueryIpc {
    Catalog,
    Refresh,
    Skeleton {
        service: String,
        method: String,
    },
    Schema {
        service: String,
        method: String,
        side: MessageSideIpc,
    },
}

impl ContractQueryIpc {
    pub fn into_core(self) -> ContractQuery {
        match self {
            Self::Catalog => ContractQuery::Catalog,
            Self::Refresh => ContractQuery::Refresh,
            Self::Skeleton { service, method } => ContractQuery::Skeleton { service, method },
            Self::Schema {
                service,
                method,
                side,
            } => ContractQuery::Schema {
                service,
                method,
                side: MessageSide::from(side),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContractArtifactIpc {
    Catalog { catalog: ServiceCatalogIpc },
    Skeleton { json: String },
    Schema { schema: MessageSchemaIpc },
}

impl From<ContractArtifact> for ContractArtifactIpc {
    fn from(artifact: ContractArtifact) -> Self {
        match artifact {
            ContractArtifact::Catalog(catalog) => Self::Catalog {
                catalog: ServiceCatalogIpc::from(catalog),
            },
            ContractArtifact::Skeleton(json) => Self::Skeleton { json },
            ContractArtifact::Schema(schema) => Self::Schema {
                schema: MessageSchemaIpc::from(schema),
            },
        }
    }
}
