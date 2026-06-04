//! Disk-backed `ContractCache`: one `<dir>/<hex-key>.json` per cached contract, written
//! atomically (temp+rename) through an in-memory mirror. Survives restarts so reflection
//! is skipped across sessions (spec §10 / B7). The cache is **disposable**: persist/remove
//! failures are logged, not propagated (a miss just re-reflects), and a corrupt entry is
//! skipped on load rather than aborting boot.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{Duration, UNIX_EPOCH};

use prost_reflect::DescriptorPool;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::grpc::catalog::ServiceCatalog;
use crate::grpc::contract_cache::{CachedContract, ContractCache, ContractKey};
use crate::persist::{atomic_write_json, read_json, Envelope};

/// On-disk shape of one cached contract. `pool` is `DescriptorPool::encode_to_vec()`
/// (protobuf `FileDescriptorSet` bytes); `fetched_at` is epoch-ms.
#[derive(Serialize, Deserialize)]
struct PersistedContract {
    address: String,
    tls: bool,
    pool: Vec<u8>,
    catalog: ServiceCatalog,
    fetched_at: i64,
}

/// `<canonical-key>` hex-encoded (stable, reversible, filesystem-safe) + `.json`.
/// Canonical key = `"{tls}|{address}"`; hex avoids `:` / `/` in addresses.
fn key_filename(key: &ContractKey) -> String {
    let canonical = format!("{}|{}", key.tls, key.address);
    let mut name = canonical.bytes().fold(String::with_capacity(canonical.len() * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    });
    name.push_str(".json");
    name
}

pub struct FileContractCache {
    dir: PathBuf,
    inner: RwLock<HashMap<ContractKey, CachedContract>>,
}

impl FileContractCache {
    /// Load every `*.json` under `dir` (creating `dir` if absent). A file that fails to
    /// parse or whose pool fails to decode is **skipped** (logged), never fatal.
    pub fn load(dir: PathBuf) -> Result<Self, CoreError> {
        fs::create_dir_all(&dir)
            .map_err(|e| CoreError::Persistence(format!("create dir {}: {e}", dir.display())))?;
        let mut map = HashMap::new();
        for entry in fs::read_dir(&dir)
            .map_err(|e| CoreError::Persistence(format!("read dir {}: {e}", dir.display())))?
        {
            let entry = entry.map_err(|e| CoreError::Persistence(format!("dir entry: {e}")))?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue; // skip orphaned .tmp etc.
            }
            match Self::read_entry(&path) {
                Ok((key, contract)) => {
                    map.insert(key, contract);
                }
                Err(e) => {
                    eprintln!("contract cache: skipping {}: {e}", path.display());
                }
            }
        }
        Ok(Self { dir, inner: RwLock::new(map) })
    }

    fn read_entry(path: &Path) -> Result<(ContractKey, CachedContract), CoreError> {
        let p: PersistedContract = read_json(path)?;
        let pool = DescriptorPool::decode(p.pool.as_slice())
            .map_err(|e| CoreError::DescriptorBuild(format!("decode cached pool: {e}")))?;
        let key = ContractKey { address: p.address, tls: p.tls };
        let contract = CachedContract {
            pool,
            catalog: p.catalog,
            fetched_at: UNIX_EPOCH + Duration::from_millis(p.fetched_at.max(0) as u64),
        };
        Ok((key, contract))
    }

    fn file_path(&self, key: &ContractKey) -> PathBuf {
        self.dir.join(key_filename(key))
    }

    fn persist(&self, key: &ContractKey, contract: &CachedContract) -> Result<(), CoreError> {
        let fetched_at = contract
            .fetched_at
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let payload = PersistedContract {
            address: key.address.clone(),
            tls: key.tls,
            pool: contract.pool.encode_to_vec(),
            catalog: contract.catalog.clone(),
            fetched_at,
        };
        atomic_write_json(&self.file_path(key), &Envelope::new(payload))
    }
}

impl ContractCache for FileContractCache {
    fn get(&self, key: &ContractKey) -> Option<CachedContract> {
        self.inner.read().expect("contract cache poisoned").get(key).cloned()
    }

    /// Write-through: persist (best-effort) then update the mirror. A persist failure is
    /// logged but the in-memory entry still lands, so the session benefits regardless.
    fn put(&self, key: ContractKey, contract: CachedContract) {
        if let Err(e) = self.persist(&key, &contract) {
            eprintln!("contract cache: failed to persist {}: {e}", key.address);
        }
        self.inner.write().expect("contract cache poisoned").insert(key, contract);
    }

    fn invalidate(&self, key: &ContractKey) {
        let path = self.file_path(key);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => eprintln!("contract cache: failed to remove {}: {e}", path.display()),
        }
        self.inner.write().expect("contract cache poisoned").remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grpc::catalog::build_catalog;
    use crate::grpc::contract_cache::ContractKey;
    use crate::grpc::descriptor::build_pool;
    use prost_types::{
        DescriptorProto, FieldDescriptorProto, FileDescriptorProto, MethodDescriptorProto,
        ServiceDescriptorProto, field_descriptor_proto::Type as FieldType,
    };
    use std::time::{Duration, UNIX_EPOCH};

    const FETCHED_MS: u64 = 1_700_000_000_000;

    fn sample_pool() -> prost_reflect::DescriptorPool {
        let file = FileDescriptorProto {
            name: Some("test/echo.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![
                DescriptorProto {
                    name: Some("Ping".into()),
                    field: vec![FieldDescriptorProto {
                        name: Some("id".into()),
                        number: Some(1),
                        r#type: Some(FieldType::String as i32),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                DescriptorProto { name: Some("Pong".into()), ..Default::default() },
            ],
            service: vec![ServiceDescriptorProto {
                name: Some("Echo".into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Send".into()),
                    input_type: Some(".test.Ping".into()),
                    output_type: Some(".test.Pong".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        build_pool(vec![file]).expect("build sample pool")
    }

    fn sample_contract() -> CachedContract {
        let pool = sample_pool();
        let catalog = build_catalog(&pool);
        CachedContract {
            pool,
            catalog,
            fetched_at: UNIX_EPOCH + Duration::from_millis(FETCHED_MS),
        }
    }

    fn key(addr: &str, tls: bool) -> ContractKey {
        ContractKey { address: addr.into(), tls }
    }

    #[test]
    fn put_then_reload_round_trips_pool_catalog_and_timestamp() {
        let dir = tempfile::tempdir().unwrap();
        let k = key("api.example:443", true);
        let original = sample_contract();

        let cache = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        cache.put(k.clone(), original.clone());

        drop(cache);
        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        let got = reloaded.get(&k).expect("entry survives reload");

        assert!(got.pool.get_service_by_name("test.Echo").is_some());
        assert_eq!(got.catalog, original.catalog);
        assert_eq!(
            got.fetched_at.duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
            FETCHED_MS
        );
    }

    #[test]
    fn invalidate_removes_file_and_entry() {
        let dir = tempfile::tempdir().unwrap();
        let k = key("h:1", false);
        let cache = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        cache.put(k.clone(), sample_contract());

        let json_count = || std::fs::read_dir(dir.path()).unwrap()
            .filter(|e| e.as_ref().unwrap().path().extension().and_then(|s| s.to_str()) == Some("json"))
            .count();
        assert_eq!(json_count(), 1);

        cache.invalidate(&k);
        assert!(cache.get(&k).is_none());
        assert_eq!(json_count(), 0);
        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        assert!(reloaded.get(&k).is_none());
    }

    #[test]
    fn corrupt_entry_is_skipped_on_load_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let cache = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        cache.put(key("good:1", false), sample_contract());
        std::fs::write(dir.path().join("deadbeef.json"), b"{ not valid").unwrap();
        drop(cache);

        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        assert!(reloaded.get(&key("good:1", false)).is_some());
        assert!(reloaded.get(&key("good:1", false)).unwrap().pool.get_service_by_name("test.Echo").is_some());
    }

    #[test]
    fn key_filename_is_stable_and_distinguishes_tls_and_address() {
        let a = key_filename(&key("h:1", false));
        assert_eq!(a, key_filename(&key("h:1", false)));
        assert_ne!(a, key_filename(&key("h:1", true)));
        assert_ne!(a, key_filename(&key("h:2", false)));
        assert!(a.ends_with(".json"));
    }
}
