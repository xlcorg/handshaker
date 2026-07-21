//! Disk-backed `CollectionStore`: one `<dir>/<uuid>.json` per collection, written
//! atomically (temp+rename). Reads serve from an in-memory mirror; the mirror is
//! updated only after a successful write (clone-then-commit, design §R7).

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use crate::error::CoreError;
use crate::persist::{atomic_write_json, quarantine_corrupt, read_json, Envelope};

use super::ids::CollectionId;
use super::store::CollectionStore;
use super::Collection;

#[derive(Debug)]
pub struct FileCollectionStore {
    dir: PathBuf,
    inner: RwLock<HashMap<CollectionId, Collection>>,
    /// Files quarantined as corrupt during `load` (each moved to `<name>.corrupt`).
    recovered: Vec<PathBuf>,
}

impl FileCollectionStore {
    /// Load every `*.json` under `dir` (creating `dir` if absent).
    pub fn load(dir: PathBuf) -> Result<Self, CoreError> {
        fs::create_dir_all(&dir)
            .map_err(|e| CoreError::Persistence(format!("create dir {}: {e}", dir.display())))?;
        let mut map = HashMap::new();
        let mut recovered = Vec::new();
        for entry in fs::read_dir(&dir)
            .map_err(|e| CoreError::Persistence(format!("read dir {}: {e}", dir.display())))?
        {
            let entry = entry.map_err(|e| CoreError::Persistence(format!("dir entry: {e}")))?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue; // skip orphaned .tmp etc.
            }
            match read_json::<Collection>(&path) {
                Ok(c) => {
                    map.insert(c.id, c);
                }
                // A corrupt collection file is quarantined and skipped, so one bad file
                // neither bricks startup nor drops its sibling collections.
                Err(_) => {
                    if let Some(q) = quarantine_corrupt(&path) {
                        recovered.push(q);
                    }
                }
            }
        }
        Ok(Self { dir, inner: RwLock::new(map), recovered })
    }

    fn file_path(&self, id: CollectionId) -> PathBuf {
        self.dir.join(format!("{}.json", id.0))
    }

    /// Files quarantined as corrupt during `load`, so the caller can surface a
    /// "recovered from a corrupt file" notice. Empty on a clean load.
    pub fn recovered_files(&self) -> &[PathBuf] {
        &self.recovered
    }
}

impl CollectionStore for FileCollectionStore {
    fn list(&self) -> Vec<Collection> {
        self.inner.read().expect("collection store poisoned").values().cloned().collect()
    }

    fn get(&self, id: CollectionId) -> Option<Collection> {
        self.inner.read().expect("collection store poisoned").get(&id).cloned()
    }

    fn upsert(&self, collection: Collection) -> Result<(), CoreError> {
        let path = self.file_path(collection.id);
        let mut guard = self.inner.write().expect("collection store poisoned");
        atomic_write_json(&path, &Envelope::new(collection.clone()))?;
        guard.insert(collection.id, collection);
        Ok(())
    }

    fn delete(&self, id: CollectionId) -> Result<(), CoreError> {
        let path = self.file_path(id);
        let mut guard = self.inner.write().expect("collection store poisoned");
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| CoreError::Persistence(format!("remove {}: {e}", path.display())))?;
        }
        guard.remove(&id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::SavedAuthConfig;
    use crate::collections::CollectionLink;
    use indexmap::IndexMap;
    use uuid::Uuid;

    fn coll(id: u128, name: &str) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(id)),
            name: name.into(),
            items: vec![],
            variables: IndexMap::new(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
            links: vec![],
        }
    }

    #[test]
    fn upsert_creates_file_and_reload_sees_it() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        store.upsert(coll(1, "a")).unwrap();
        store.upsert(coll(2, "b")).unwrap();

        // Two files on disk.
        let json_count = std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|e| e.as_ref().unwrap().path().extension().and_then(|s| s.to_str()) == Some("json"))
            .count();
        assert_eq!(json_count, 2);

        // Reload sees both.
        drop(store);
        let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        assert_eq!(store2.list().len(), 2);
    }

    #[test]
    fn delete_removes_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        store.upsert(coll(1, "a")).unwrap();
        store.delete(CollectionId(Uuid::from_u128(1))).unwrap();
        assert!(store.get(CollectionId(Uuid::from_u128(1))).is_none());
        let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        assert!(store2.list().is_empty());
    }

    #[test]
    fn var_order_survives_reload() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        let ordered = [
            ("zeta", "1"), ("alpha", "2"), ("mu", "3"), ("beta", "4"),
            ("kappa", "5"), ("delta", "6"), ("iota", "7"), ("nu", "8"),
        ];
        let mut c = coll(1, "c");
        for (k, v) in ordered {
            c.variables.insert(k.to_string(), v.to_string());
        }
        store.upsert(c).unwrap();
        drop(store);
        let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        let keys: Vec<String> = store2
            .get(CollectionId(Uuid::from_u128(1)))
            .unwrap()
            .variables
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, ordered.iter().map(|(k, _)| k.to_string()).collect::<Vec<_>>());
    }

    /// Links are part of the persisted collection: a store reload (the app-restart
    /// path) must return them, in creation order.
    #[test]
    fn links_survive_reload_in_creation_order() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        let mut c = coll(1, "c");
        c.links = vec![
            CollectionLink { name: "Grafana".into(), url: "https://{{host}}/d/abc".into() },
            CollectionLink { name: "Logs".into(), url: "https://logs.example".into() },
        ];
        store.upsert(c.clone()).unwrap();
        drop(store);

        let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        let back = store2.get(CollectionId(Uuid::from_u128(1))).unwrap();
        assert_eq!(back.links, c.links);
    }

    /// A collection file written before links existed loads with an empty list.
    #[test]
    fn store_file_without_links_loads_with_empty_list() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        store.upsert(coll(1, "a")).unwrap();
        drop(store);

        // Strip the field from the persisted file, mimicking a pre-feature write.
        let path = dir.path().join(format!("{}.json", Uuid::from_u128(1)));
        let raw = std::fs::read_to_string(&path).unwrap();
        let mut doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let payload = doc.get_mut("data").expect("envelope data");
        assert!(payload.get("links").is_some(), "links must be persisted in the first place");
        payload.as_object_mut().unwrap().remove("links");
        std::fs::write(&path, serde_json::to_string(&doc).unwrap()).unwrap();

        let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        let back = store2.get(CollectionId(Uuid::from_u128(1))).unwrap();
        assert!(back.links.is_empty());
    }

    #[test]
    fn corrupt_file_is_quarantined_and_siblings_still_load() {
        let dir = tempfile::tempdir().unwrap();
        // One good collection on disk…
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        store.upsert(coll(1, "good")).unwrap();
        drop(store);
        // …plus a corrupt sibling file.
        let bad = dir.path().join(format!("{}.json", Uuid::from_u128(3)));
        std::fs::write(&bad, b"{ not valid json").unwrap();

        // Load must NOT brick: the good collection loads, the corrupt file is moved aside.
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        assert_eq!(store.list().len(), 1, "the good collection still loads");
        assert!(!bad.exists(), "the corrupt file was moved aside");
        assert_eq!(store.recovered_files().len(), 1, "the corrupt file was recorded");
    }
}
