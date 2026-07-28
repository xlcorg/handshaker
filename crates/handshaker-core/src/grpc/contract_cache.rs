//! Descriptor (contract) cache keyed by `(address, tls)` (master spec §5.8). Lets
//! `activate()` skip reflection when the contract for an endpoint is already known.
//! `skip_verify` is deliberately NOT part of the key (it does not change the
//! contract). The `InMemoryContractCache` below is session-only; see `file_contract_cache`
//! for the disk-backed implementation.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use prost_types::FileDescriptorProto;

use crate::grpc::catalog::ServiceCatalog;
use crate::grpc::connection::GrpcTarget;
use crate::grpc::descriptor::PoolSet;

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

/// A cached contract: the raw descriptor corpus as fetched, the pools assembled from it,
/// and the projected catalog. The corpus is kept because it — not the assembled pools —
/// is what gets persisted: a disk-backed reload rebuilds the pool set from it, so a
/// contract that needed isolation survives a restart with all of its pools.
///
/// `Clone` has to stay cheap: `ContractCache::get` hands out a clone, and `Sender::send`
/// calls `activate()` — hence `get` — on **every** request, using only `pools` (itself
/// `Arc`-backed) and the small `catalog`. Hence the `Arc` around the corpus: a bare `Vec`
/// would deep-clone thousands of prost allocations per send, worst on exactly the bloated
/// code-first corpora this cache exists for.
#[derive(Clone)]
pub struct CachedContract {
    pub files: Arc<Vec<FileDescriptorProto>>,
    pub pools: PoolSet,
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
            files: Arc::new(vec![]),
            pools: PoolSet::from_pool(prost_reflect::DescriptorPool::new()),
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
