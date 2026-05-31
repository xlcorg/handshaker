//! Descriptor (contract) cache keyed by `(address, tls)` (master spec §5.8). Lets
//! `activate()` skip reflection when the contract for an endpoint is already known.
//! `skip_verify` is deliberately NOT part of the key (it does not change the
//! contract). Session-only — not persisted.

use std::collections::HashMap;
use std::sync::RwLock;

use prost_reflect::DescriptorPool;

use crate::grpc::catalog::ServiceCatalog;
use crate::grpc::connection::GrpcTarget;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ContractKey {
    pub address: String,
    pub tls: bool,
}

impl ContractKey {
    pub fn from_target(t: &GrpcTarget) -> Self {
        Self { address: t.address.clone(), tls: t.tls }
    }
}

/// A cached contract: the assembled descriptor pool + projected catalog.
#[derive(Clone)]
pub struct CachedContract {
    pub pool: DescriptorPool,
    pub catalog: ServiceCatalog,
    pub fetched_at: std::time::SystemTime,
}

pub trait ContractCache: Send + Sync {
    fn get(&self, key: &ContractKey) -> Option<CachedContract>;
    fn put(&self, key: ContractKey, contract: CachedContract);
    fn invalidate(&self, key: &ContractKey);
}

pub struct InMemoryContractCache {
    inner: RwLock<HashMap<ContractKey, CachedContract>>,
}

impl InMemoryContractCache {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }
}

impl Default for InMemoryContractCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ContractCache for InMemoryContractCache {
    fn get(&self, key: &ContractKey) -> Option<CachedContract> {
        self.inner.read().expect("contract cache poisoned").get(key).cloned()
    }

    fn put(&self, key: ContractKey, contract: CachedContract) {
        self.inner.write().expect("contract cache poisoned").insert(key, contract);
    }

    fn invalidate(&self, key: &ContractKey) {
        self.inner.write().expect("contract cache poisoned").remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(addr: &str, tls: bool) -> ContractKey {
        ContractKey { address: addr.into(), tls }
    }

    fn sample_contract() -> CachedContract {
        CachedContract {
            pool: DescriptorPool::new(),
            catalog: ServiceCatalog { services: vec![] },
            fetched_at: std::time::SystemTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn key_ignores_skip_verify_but_distinguishes_tls() {
        let t1 = GrpcTarget::new("h:1", true, false).unwrap();
        let t2 = GrpcTarget::new("h:1", true, true).unwrap();
        let t3 = GrpcTarget::new("h:1", false, false).unwrap();
        assert_eq!(ContractKey::from_target(&t1), ContractKey::from_target(&t2));
        assert_ne!(ContractKey::from_target(&t1), ContractKey::from_target(&t3));
    }

    #[test]
    fn put_get_invalidate() {
        let cache = InMemoryContractCache::new();
        let k = key("h:1", false);
        assert!(cache.get(&k).is_none());
        cache.put(k.clone(), sample_contract());
        assert!(cache.get(&k).is_some());
        cache.invalidate(&k);
        assert!(cache.get(&k).is_none());
    }
}
