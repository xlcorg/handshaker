use std::sync::Arc;

use crate::collections::{resolve_probe_target, Collection};
use crate::env::Environment;
use crate::error::CoreError;
use crate::grpc::catalog::ServiceCatalog;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::contract::load_contract;
use crate::grpc::contract_cache::{CachedContract, ContractCache, ContractKey};
use crate::grpc::invoke::{
    build_message_schema_from_pools, build_request_skeleton_from_pools, MessageSchema, MessageSide,
};
use crate::grpc::transport::GrpcTransport;

pub struct ContractProbe {
    pub address_template: String,
    pub tls_override: Option<bool>,
}

/// One contract read. The probe target is resolved once. `refresh` drops the
/// cached contract before the load so a miss reflects again.
#[derive(Debug, Clone)]
pub struct ContractQuery {
    pub service: String,
    pub method: String,
    pub refresh: bool,
}

/// Catalog plus the focused method's input schema, output schema, and request
/// skeleton. The method pieces are absent when no method is named or the
/// method is not in the catalog.
#[derive(Debug, Clone)]
pub struct MethodBundle {
    pub catalog: ServiceCatalog,
    pub input_schema: Option<MessageSchema>,
    pub output_schema: Option<MessageSchema>,
    pub skeleton: Option<String>,
}

#[derive(Debug)]
pub struct ContractAnswer {
    pub bundle: MethodBundle,
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
        if query.refresh {
            self.cache.invalidate(&key);
        }
        let (cached, reflected) =
            load_contract(&target, self.transport.as_ref(), self.cache.as_ref()).await?;
        let bundle = bundle_for(&cached, &query.service, &query.method);
        Ok(ContractAnswer {
            bundle,
            reflected,
            target,
        })
    }
}

fn bundle_for(cached: &CachedContract, service: &str, method: &str) -> MethodBundle {
    let service = service.trim();
    let method = method.trim();
    if service.is_empty() || method.is_empty() {
        return MethodBundle {
            catalog: cached.catalog.clone(),
            input_schema: None,
            output_schema: None,
            skeleton: None,
        };
    }
    MethodBundle {
        catalog: cached.catalog.clone(),
        input_schema: build_message_schema_from_pools(
            &cached.pools,
            service,
            method,
            MessageSide::Input,
        )
        .ok(),
        output_schema: build_message_schema_from_pools(
            &cached.pools,
            service,
            method,
            MessageSide::Output,
        )
        .ok(),
        skeleton: build_request_skeleton_from_pools(&cached.pools, service, method).ok(),
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

    fn query(service: &str, method: &str) -> ContractQuery {
        ContractQuery {
            service: service.into(),
            method: method.into(),
            refresh: false,
        }
    }

    fn seed(cache: &InMemoryContractCache) {
        cache.put(
            ContractKey {
                address: "127.0.0.1:1".into(),
                tls: false,
            },
            fixture_cached_contract(),
        );
    }

    #[tokio::test]
    async fn catalog_hit_opens_no_channel() {
        let transport = Arc::new(FakeTransport::default());
        let cache = Arc::new(InMemoryContractCache::new());
        seed(&cache);
        let answer = reader(transport.clone(), cache)
            .read(
                &probe("127.0.0.1:1", Some(false)),
                None,
                None,
                query("test.Echo", "Send"),
            )
            .await
            .expect("cached bundle");
        assert!(answer
            .bundle
            .catalog
            .services
            .iter()
            .any(|s| s.full_name == "test.Echo"));
        let input = answer.bundle.input_schema.expect("input schema");
        assert_eq!(input.root, "test.Ping");
        let output = answer.bundle.output_schema.expect("output schema");
        assert_eq!(output.root, "test.Pong");
        let skeleton = answer.bundle.skeleton.expect("skeleton");
        assert!(skeleton.contains("\"id\""), "{skeleton}");
        assert!(!answer.reflected);
        assert_eq!(transport.channel_calls.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn missing_method_returns_catalog_without_opening_a_channel() {
        let transport = Arc::new(FakeTransport::default());
        let cache = Arc::new(InMemoryContractCache::new());
        seed(&cache);
        let answer = reader(transport.clone(), cache)
            .read(
                &probe("127.0.0.1:1", Some(false)),
                None,
                None,
                query("test.Echo", "Missing"),
            )
            .await
            .expect("catalog still returns");
        assert!(answer
            .bundle
            .catalog
            .services
            .iter()
            .any(|s| s.full_name == "test.Echo"));
        assert!(answer.bundle.input_schema.is_none());
        assert!(answer.bundle.output_schema.is_none());
        assert!(answer.bundle.skeleton.is_none());
        assert_eq!(transport.channel_calls.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn blank_method_omits_schemas_and_skeleton() {
        let transport = Arc::new(FakeTransport::default());
        let cache = Arc::new(InMemoryContractCache::new());
        seed(&cache);
        let answer = reader(transport.clone(), cache)
            .read(
                &probe("127.0.0.1:1", Some(false)),
                None,
                None,
                query("", ""),
            )
            .await
            .expect("catalog");
        assert!(answer.bundle.input_schema.is_none());
        assert!(answer.bundle.output_schema.is_none());
        assert!(answer.bundle.skeleton.is_none());
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
                query("", ""),
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
