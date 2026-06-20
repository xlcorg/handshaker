//! In-memory `CollectionStore` (tests + `AppState::default()`).

use std::collections::HashMap;
use std::sync::RwLock;

use crate::error::CoreError;

use super::ids::CollectionId;
use super::store::CollectionStore;
use super::Collection;

pub struct InMemoryCollectionStore {
    inner: RwLock<HashMap<CollectionId, Collection>>,
}

impl InMemoryCollectionStore {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }
}

impl Default for InMemoryCollectionStore {
    fn default() -> Self {
        Self::new()
    }
}

impl CollectionStore for InMemoryCollectionStore {
    fn list(&self) -> Vec<Collection> {
        self.inner.read().expect("collection store poisoned").values().cloned().collect()
    }

    fn get(&self, id: CollectionId) -> Option<Collection> {
        self.inner.read().expect("collection store poisoned").get(&id).cloned()
    }

    fn upsert(&self, collection: Collection) -> Result<(), CoreError> {
        self.inner.write().expect("collection store poisoned").insert(collection.id, collection);
        Ok(())
    }

    fn delete(&self, id: CollectionId) -> Result<(), CoreError> {
        self.inner.write().expect("collection store poisoned").remove(&id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::SavedAuthConfig;
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
        }
    }

    #[test]
    fn upsert_get_round_trip() {
        let s = InMemoryCollectionStore::new();
        s.upsert(coll(1, "a")).unwrap();
        assert_eq!(s.get(CollectionId(Uuid::from_u128(1))).unwrap().name, "a");
    }

    #[test]
    fn delete_is_idempotent() {
        let s = InMemoryCollectionStore::new();
        s.delete(CollectionId(Uuid::from_u128(7))).unwrap(); // missing → Ok
    }

}
