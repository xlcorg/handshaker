//! Disk-backed `CollectionStore`: one `<dir>/<uuid>.json` per collection, written
//! atomically (temp+rename). Reads serve from an in-memory mirror; the mirror is
//! updated only after a successful write (clone-then-commit, design §R7).

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use crate::error::CoreError;
use crate::persist::{atomic_write_json, read_json, Envelope};

use super::ids::CollectionId;
use super::store::CollectionStore;
use super::Collection;

#[derive(Debug)]
pub struct FileCollectionStore {
    dir: PathBuf,
    inner: RwLock<HashMap<CollectionId, Collection>>,
}

impl FileCollectionStore {
    /// Load every `*.json` under `dir` (creating `dir` if absent).
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
            let c: Collection = read_json(&path)?;
            map.insert(c.id, c);
        }
        Ok(Self { dir, inner: RwLock::new(map) })
    }

    fn file_path(&self, id: CollectionId) -> PathBuf {
        self.dir.join(format!("{}.json", id.0))
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
    use uuid::Uuid;

    fn coll(id: u128, name: &str) -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(id)),
            name: name.into(),
            items: vec![],
            variables: HashMap::new(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0,
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
    fn corrupt_file_is_persistence_error_not_panic() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join(format!("{}.json", Uuid::from_u128(3)));
        std::fs::write(&bad, b"{ not valid json").unwrap();
        let err = FileCollectionStore::load(dir.path().to_path_buf()).unwrap_err();
        assert!(matches!(err, CoreError::Persistence(_)));
    }
}
