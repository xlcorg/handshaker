//! Storage abstraction for collections. CRUD by whole `Collection`; tree edits
//! happen in the command layer (get → mutate via `tree` → upsert), keeping
//! per-collection writes atomic. Implementations: [`super::InMemoryCollectionStore`],
//! [`super::FileCollectionStore`].

use crate::error::CoreError;

use super::ids::CollectionId;
use super::Collection;

pub trait CollectionStore: Send + Sync {
    fn list(&self) -> Vec<Collection>;
    fn get(&self, id: CollectionId) -> Option<Collection>;
    fn upsert(&self, collection: Collection) -> Result<(), CoreError>;
    /// Idempotent: deleting a missing id returns `Ok`.
    fn delete(&self, id: CollectionId) -> Result<(), CoreError>;
}
