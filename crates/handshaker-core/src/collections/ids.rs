//! Opaque UUID-v7 identifiers for collections and items. v7 is time-ordered, so
//! ids sort by creation; tests must NOT assert specific values (design §R8) —
//! construct `ItemId(Uuid::from_u128(n))` when a fixed id is needed.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CollectionId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ItemId(pub Uuid);

#[allow(clippy::new_without_default)]
impl CollectionId {
    /// Fresh time-ordered id.
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

#[allow(clippy::new_without_default)]
impl ItemId {
    /// Fresh time-ordered id.
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique() {
        assert_ne!(ItemId::new(), ItemId::new());
        assert_ne!(CollectionId::new(), CollectionId::new());
    }

    #[test]
    fn id_serializes_as_string() {
        let id = ItemId(Uuid::from_u128(1));
        let json = serde_json::to_string(&id).unwrap();
        assert!(json.starts_with('"') && json.ends_with('"'), "got {json}");
        let back: ItemId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, back);
    }
}
