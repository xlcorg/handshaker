//! Disk-backed `ContractCache`: one `<dir>/<hex-key>.json` per cached contract, written
//! atomically (temp+rename) through an in-memory mirror. Survives restarts so reflection
//! is skipped across sessions (spec §10 / B7). The cache is **disposable**: persist/remove
//! failures are logged, not propagated (a miss just re-reflects), and a corrupt entry is
//! skipped on load rather than aborting boot.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{Duration, UNIX_EPOCH};

use prost::Message as _;
use prost_types::FileDescriptorSet;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::grpc::catalog::ServiceCatalog;
use crate::grpc::contract_cache::{CachedContract, ContractCache, ContractKey};
use crate::grpc::descriptor::build_pool_set;
use crate::persist::{atomic_write_json, read_json, Envelope};

/// On-disk shape of one cached contract. `files` is the **raw** descriptor corpus as the
/// server sent it, encoded as a protobuf `FileDescriptorSet`; the pools are rebuilt from
/// it on load. Storing raw rather than post-assembly keeps restoration deterministic —
/// after pruning, one file name can have different contents in different pools.
/// `fetched_at` is epoch-ms.
///
/// The field rename `pool` → `files` is deliberately breaking: an entry written before it
/// fails to deserialize and is skipped on load (a miss just re-reflects), and the next
/// `put` for that endpoint overwrites the file.
#[derive(Serialize, Deserialize)]
struct PersistedContract {
    address: String,
    tls: bool,
    files: Vec<u8>,
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
    /// parse, or whose corpus fails to decode or reassemble, is **skipped** (logged), never
    /// fatal.
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
        // Reassemble exactly as `activate()` does, from the same raw corpus: a contract that
        // needed isolation gets its several pools back instead of being dropped.
        let set = FileDescriptorSet::decode(p.files.as_slice())
            .map_err(|e| CoreError::DescriptorBuild(format!("decode cached descriptors: {e}")))?;
        let pools = build_pool_set(&set.file)?;
        let key = ContractKey { address: p.address, tls: p.tls };
        let contract = CachedContract {
            files: Arc::new(set.file),
            pools,
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
            // Cold path — one clone per cache miss, dwarfed by the reflection round trip it
            // follows. The `Arc` on `CachedContract::files` is for `get`, which is per-send.
            files: FileDescriptorSet { file: contract.files.as_ref().clone() }.encode_to_vec(),
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
    use crate::grpc::descriptor::{build_pool, PoolSet};
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
        let files: Vec<prost_types::FileDescriptorProto> =
            sample_pool().file_descriptor_protos().cloned().collect();
        let pools = PoolSet::from_pool(sample_pool());
        let catalog = build_catalog(&pools);
        CachedContract {
            files: Arc::new(files),
            pools,
            catalog,
            fetched_at: UNIX_EPOCH + Duration::from_millis(FETCHED_MS),
        }
    }

    fn key(addr: &str, tls: bool) -> ContractKey {
        ContractKey { address: addr.into(), tls }
    }

    fn json_count(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .filter(|e| {
                e.as_ref().unwrap().path().extension().and_then(|s| s.to_str()) == Some("json")
            })
            .count()
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

        assert!(got.pools.for_service("test.Echo").is_some());
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

        assert_eq!(json_count(dir.path()), 1);

        cache.invalidate(&k);
        assert!(cache.get(&k).is_none());
        assert_eq!(json_count(dir.path()), 0);
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
        assert!(reloaded
            .get(&key("good:1", false))
            .unwrap()
            .pools
            .for_service("test.Echo")
            .is_some());
    }

    #[test]
    fn conflicting_corpus_round_trips_as_multiple_pools() {
        // Two files, same message name, one service each — the isolation case.
        let mk = |file: &str, svc: &str| FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some("Shared".into()),
                ..Default::default()
            }],
            service: vec![ServiceDescriptorProto {
                name: Some(svc.into()),
                method: vec![MethodDescriptorProto {
                    name: Some("Call".into()),
                    input_type: Some(".test.Shared".into()),
                    output_type: Some(".test.Shared".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let files = vec![mk("a.proto", "SvcA"), mk("b.proto", "SvcB")];
        let pools = crate::grpc::descriptor::build_pool_set(&files).unwrap();
        let catalog = build_catalog(&pools);

        let dir = tempfile::tempdir().unwrap();
        let k = key("dupes:443", true);
        let cache = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        cache.put(
            k.clone(),
            CachedContract {
                files: Arc::new(files.clone()),
                pools,
                catalog: catalog.clone(),
                fetched_at: UNIX_EPOCH + Duration::from_millis(FETCHED_MS),
            },
        );
        drop(cache);

        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        let got = reloaded.get(&k).expect("entry survives reload");
        assert_eq!(*got.files, files, "the raw corpus survives the round trip unchanged");
        assert_eq!(got.pools.pool_count(), 2);
        assert!(got.pools.for_service("test.SvcA").is_some());
        assert!(got.pools.for_service("test.SvcB").is_some());

        // The catalog comes off disk while the pools are rebuilt from the corpus, so the two
        // could drift. They must not: every service the stored catalog offers has to resolve
        // through the rebuilt pools, and the rebuild must project that same catalog back.
        assert_eq!(got.catalog, catalog);
        for svc in &got.catalog.services {
            assert!(
                got.pools.for_service(&svc.full_name).is_some(),
                "catalog offers {} but no rebuilt pool resolves it",
                svc.full_name
            );
        }
        assert_eq!(build_catalog(&got.pools), got.catalog);
    }

    /// An entry written before the field rename: `pool`, not `files`. Its bytes are already a
    /// `FileDescriptorSet` (that part landed earlier), so the *only* thing wrong with this
    /// fixture is the field name — which is exactly what has to reject it.
    ///
    /// Takes the `ContractKey` rather than a loose address so the JSON body cannot drift
    /// from the file name the entry is written under: were they to disagree, the
    /// "must be skipped" assertion would pass for the wrong reason (loaded under a
    /// different key instead of rejected).
    fn old_format_entry_json(key: &ContractKey) -> String {
        let files: Vec<FileDescriptorProto> =
            sample_pool().file_descriptor_protos().cloned().collect();
        serde_json::json!({
            "schema_version": 1,
            "data": {
                "address": key.address,
                "tls": key.tls,
                "pool": FileDescriptorSet { file: files }.encode_to_vec(),
                "catalog": build_catalog(&PoolSet::from_pool(sample_pool())),
                "fetched_at": FETCHED_MS as i64,
            }
        })
        .to_string()
    }

    #[test]
    fn old_format_entry_is_skipped_on_load_then_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let k = key("h:1", false);
        let stale = dir.path().join(key_filename(&k));
        std::fs::write(&stale, old_format_entry_json(&k)).unwrap();

        let cache = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        assert!(cache.get(&k).is_none(), "a pre-rename entry must be skipped, not loaded");

        // Skipped, not accumulated: the file name is derived from the key, so the next put
        // for that endpoint replaces the stale file rather than adding a second one.
        cache.put(k.clone(), sample_contract());
        assert_eq!(json_count(dir.path()), 1);
        drop(cache);

        let reloaded = FileContractCache::load(dir.path().to_path_buf()).unwrap();
        assert!(reloaded.get(&k).is_some(), "the rewritten entry loads");
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
