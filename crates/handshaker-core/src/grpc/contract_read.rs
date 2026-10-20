use std::sync::Arc;

use crate::collections::{resolve_probe_target, Collection};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::catalog::ServiceCatalog;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::contract::load_contract;
use crate::grpc::contract_cache::{ContractCache, ContractKey};
use crate::grpc::invoke::{
    build_message_schema_from_pools, build_request_skeleton_from_pools, MessageSchema, MessageSide,
};
use crate::grpc::transport::GrpcTransport;

pub struct ContractProbe {
    pub address_template: String,
    pub tls_override: Option<bool>,
}

#[derive(Debug)]
pub enum ContractQuery {
    Catalog,
    Refresh,
    Skeleton {
        service: String,
        method: String,
    },
    Schema {
        service: String,
        method: String,
        side: MessageSide,
    },
}

#[derive(Debug)]
pub enum ContractArtifact {
    Catalog(ServiceCatalog),
    Skeleton(String),
    Schema(MessageSchema),
}

#[derive(Debug)]
pub struct ContractAnswer {
    pub artifact: ContractArtifact,
    pub reflected: bool,
    pub target: GrpcTarget,
}

pub struct ContractRead {
    transport: Arc<dyn GrpcTransport>,
    cache: Arc<dyn ContractCache>,
}

impl ContractRead {
    pub fn new(transport: Arc<dyn GrpcTransport>, cache: Arc<dyn ContractCache>) -> Self {
        Self { transport, cache }
    }

    pub async fn read(
        &self,
        probe: &ContractProbe,
        collection: Option<&Collection>,
        active_env: Option<&Environment>,
        query: ContractQuery,
    ) -> Result<ContractAnswer, CoreError> {
        let target = resolve_probe_target(
            &probe.address_template,
            probe.tls_override,
            collection,
            active_env,
        )?;
        let key = ContractKey::from_target(&target);
        if matches!(query, ContractQuery::Refresh) {
            self.cache.invalidate(&key);
        }
        let (cached, reflected) =
            load_contract(&target, self.transport.as_ref(), self.cache.as_ref()).await?;
        let artifact = match query {
            ContractQuery::Catalog | ContractQuery::Refresh => {
                ContractArtifact::Catalog(cached.catalog)
            }
            ContractQuery::Skeleton { service, method } => ContractArtifact::Skeleton(
                build_request_skeleton_from_pools(&cached.pools, &service, &method)?,
            ),
            ContractQuery::Schema {
                service,
                method,
                side,
            } => ContractArtifact::Schema(build_message_schema_from_pools(
                &cached.pools,
                &service,
                &method,
                side,
            )?),
        };
        Ok(ContractAnswer {
            artifact,
            reflected,
            target,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    use super::*;
    use crate::error::CoreError;
    use crate::grpc::contract_cache::InMemoryContractCache;
    use crate::grpc::testing::{fixture_cached_contract, FakeTransport};
    use crate::grpc::ContractKey;

    fn reader(transport: Arc<FakeTransport>, cache: Arc<InMemoryContractCache>) -> ContractRead {
        ContractRead::new(transport, cache)
    }

    fn probe(address: &str, tls: Option<bool>) -> ContractProbe {
        ContractProbe {
            address_template: address.into(),
            tls_override: tls,
        }
    }

    #[tokio::test]
    async fn catalog_hit_opens_no_channel() {
        let transport = Arc::new(FakeTransport::default());
        let cache = Arc::new(InMemoryContractCache::new());
        cache.put(
            ContractKey {
                address: "127.0.0.1:1".into(),
                tls: false,
            },
            fixture_cached_contract(),
        );
        let answer = reader(transport.clone(), cache)
            .read(
                &probe("127.0.0.1:1", Some(false)),
                None,
                None,
                ContractQuery::Catalog,
            )
            .await
            .expect("cached catalog");
        match answer.artifact {
            ContractArtifact::Catalog(catalog) => {
                assert!(catalog.services.iter().any(|s| s.full_name == "test.Echo"));
            }
            other => panic!("expected catalog, got {other:?}"),
        }
        assert!(!answer.reflected);
        assert_eq!(transport.channel_calls.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn unresolved_probe_address_opens_no_channel() {
        let transport = Arc::new(FakeTransport::default());
        let cache = Arc::new(InMemoryContractCache::new());
        let err = reader(transport.clone(), cache)
            .read(
                &probe("{{missing}}", Some(false)),
                None,
                None,
                ContractQuery::Catalog,
            )
            .await
            .expect_err("unresolved address");
        assert!(
            matches!(err, CoreError::ResolveFailed { ref unresolved, cycle: None } if unresolved == &["missing".to_string()]),
            "{err:?}"
        );
        assert_eq!(transport.channel_calls.load(Ordering::Relaxed), 0);
    }
}
