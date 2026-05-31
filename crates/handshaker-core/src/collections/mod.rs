//! Postman-style recursive collections (master spec §5.5).
//!
//! A `Collection` owns a tree of `Item`s (`Folder` | `SavedRequest`). Folders
//! group items and carry auth-by-env; variables exist only at env + collection
//! scope (master §5.2 — no per-folder variables). Endpoints are `{{var}}`
//! templates resolved to a `GrpcTarget` at send time.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::auth::{AuthByEnv, AuthCredentials};
use crate::grpc::GrpcTarget;

pub mod ids;
pub mod resolve;
pub mod tree;

pub use ids::{CollectionId, ItemId};
pub use resolve::resolve_request;

/// Root entity. Carries collection-scope variables, root auth, and TLS defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Collection {
    pub id: CollectionId,
    pub name: String,
    pub items: Vec<Item>,
    pub variables: HashMap<String, String>,
    pub auth_by_env: AuthByEnv,
    pub default_tls: bool,
    pub skip_tls_verify: bool,
}

/// A node in the tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Item {
    Folder(Folder),
    Request(SavedRequest),
}

/// User grouping. Carries auth-by-env only (no variables — master §5.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Folder {
    pub id: ItemId,
    pub name: String,
    pub items: Vec<Item>,
    pub auth_by_env: AuthByEnv,
}

/// A saved request: address template + service/method + body/metadata templates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedRequest {
    pub id: ItemId,
    pub name: String,
    pub address_template: String,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: HashMap<String, String>,
    pub auth_by_env: AuthByEnv,
    pub tls_override: Option<bool>,
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
