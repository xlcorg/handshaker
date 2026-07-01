//! Postman-style recursive collections (master spec §5.5).
//!
//! A `Collection` owns a tree of `Item`s (`Folder` | `SavedRequest`). Folders
//! are pure organization (no auth, no variables — master §5.2). Each node that
//! can carry auth (Collection, SavedRequest) holds a single `SavedAuthConfig`
//! (not a per-env map). Variables exist only at env + collection scope.
//! Endpoints are `{{var}}` templates resolved to a `GrpcTarget` at send time.

use std::collections::HashMap;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::auth::{AuthCredentials, SavedAuthConfig};
use crate::grpc::GrpcTarget;

pub mod file_store;
pub mod ids;
pub mod in_memory;
pub mod resolve;
pub mod store;
pub mod tree;

pub use file_store::FileCollectionStore;
pub use ids::{CollectionId, ItemId};
pub use in_memory::InMemoryCollectionStore;
pub use resolve::resolve_request;
pub use store::CollectionStore;

/// An ordered metadata header row (templated value, literal key).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MetadataRow {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

/// Root entity. Carries collection-scope variables, root auth, and TLS defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Collection {
    pub id: CollectionId,
    pub name: String,
    pub items: Vec<Item>,
    pub variables: IndexMap<String, String>,
    pub auth: SavedAuthConfig,
    pub default_tls: bool,
    pub skip_tls_verify: bool,
    pub pinned: bool,
    pub description: Option<String>,
    pub created_at: f64, // epoch ms, set by frontend
    #[serde(default)]
    pub expanded: bool,
}

/// A node in the tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Item {
    Folder(Folder),
    Request(SavedRequest),
}

/// User grouping. Pure organization — no auth, no variables (master §5.2, spec §7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Folder {
    pub id: ItemId,
    pub name: String,
    pub items: Vec<Item>,
    #[serde(default)]
    pub expanded: bool,
    // no auth: folders are pure organization (spec §7)
}

/// A saved request: address template + service/method + body/metadata templates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedRequest {
    pub id: ItemId,
    pub name: String,
    pub address_template: String,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: Vec<MetadataRow>,
    pub auth: SavedAuthConfig,
    pub tls_override: Option<bool>,
    pub last_used_at: Option<f64>, // epoch ms
    pub use_count: u32,
}

/// Fully-resolved request, ready to invoke. Output of `resolve::resolve_request`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveRequest {
    pub target: GrpcTarget,
    pub service: String,
    pub method: String,
    pub body_json: String,
    pub metadata: HashMap<String, String>,
    pub auth: Option<AuthCredentials>,
    /// The resolved OAuth2 config whose token materialized `auth`, if any. The Send
    /// command uses it to invalidate the token cache on a 16 UNAUTHENTICATED. `None`
    /// for None/EnvVar auth.
    pub invalidate_oauth: Option<crate::auth::OAuth2ClientCredentialsConfig>,
}

impl Item {
    pub fn id(&self) -> ItemId {
        match self {
            Item::Folder(f) => f.id,
            Item::Request(r) => r.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Item::Folder(f) => &f.name,
            Item::Request(r) => &r.name,
        }
    }

    pub fn set_name(&mut self, name: String) {
        match self {
            Item::Folder(f) => f.name = name,
            Item::Request(r) => r.name = name,
        }
    }
}

#[cfg(test)]
mod model_tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn saved_request_holds_ordered_metadata_and_single_auth() {
        let r = SavedRequest {
            id: ItemId(Uuid::from_u128(1)),
            name: "r".into(),
            address_template: "{{host}}".into(),
            service: "svc".into(),
            method: "M".into(),
            body_template: "{}".into(),
            metadata: vec![
                MetadataRow { key: "a".into(), value: "1".into(), enabled: true },
                MetadataRow { key: "a".into(), value: "2".into(), enabled: false },
            ],
            auth: SavedAuthConfig::None,
            tls_override: None,
            last_used_at: None,
            use_count: 0,
        };
        // duplicate keys preserved in order
        assert_eq!(r.metadata.len(), 2);
        assert!(!r.metadata[1].enabled);
    }

    /// Legacy persisted JSON, written before `expanded` existed, must still
    /// deserialize: both `Collection.expanded` and `Folder.expanded` carry
    /// `#[serde(default)]`, so an omitted key resolves to `false`. This is the
    /// load-bearing backward-compat guarantee for on-disk collections (plan-01).
    #[test]
    fn legacy_json_without_expanded_deserializes_to_false() {
        // No `expanded` key on the collection OR on the nested folder — exactly
        // what an older build would have persisted.
        let legacy = r#"{
            "id": "00000000-0000-0000-0000-000000000002",
            "name": "c",
            "items": [
                {
                    "type": "folder",
                    "id": "00000000-0000-0000-0000-000000000003",
                    "name": "f",
                    "items": []
                }
            ],
            "variables": {},
            "auth": { "kind": "none" },
            "default_tls": false,
            "skip_tls_verify": false,
            "pinned": false,
            "description": null,
            "created_at": 1700000000000.0
        }"#;

        let collection: Collection = serde_json::from_str(legacy).unwrap();
        assert!(!collection.expanded, "omitted Collection.expanded must default to false");

        // The nested folder also omitted `expanded`.
        let Item::Folder(folder) = &collection.items[0] else {
            panic!("expected a folder item");
        };
        assert!(!folder.expanded, "omitted Folder.expanded must default to false");

        // And a standalone Folder with no `expanded` key deserializes too.
        let legacy_folder = r#"{
            "id": "00000000-0000-0000-0000-000000000004",
            "name": "g",
            "items": []
        }"#;
        let folder: Folder = serde_json::from_str(legacy_folder).unwrap();
        assert!(!folder.expanded, "omitted standalone Folder.expanded must default to false");
    }

    #[test]
    fn collection_has_pinned_description_created_at_and_single_auth() {
        let c = Collection {
            id: CollectionId(Uuid::from_u128(2)),
            name: "c".into(),
            items: vec![],
            variables: IndexMap::new(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: true,
            description: Some("d".into()),
            created_at: 1_700_000_000_000.0,
            expanded: false,
        };
        assert!(c.pinned);
        assert_eq!(c.description.as_deref(), Some("d"));
    }
}
