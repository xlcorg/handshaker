//! IPC DTOs for collections. All ids cross as strings (UUID). Conversions to core
//! are fallible (bad UUID → `InvalidTarget`); conversions from core are total.
//!
//! `ItemIpc` is a `#[serde(tag = "type")]` tagged union — the frontend (#3)
//! discriminates on `type` ("folder" | "request").

use std::collections::HashMap;

use handshaker_core::auth::{
    AuthByEnv, EnvVarAuthConfig, OAuth2ClientCredentialsConfig, SavedAuthConfig,
};
use handshaker_core::collections::ids::{CollectionId, ItemId};
use handshaker_core::collections::tree::ItemSnapshot;
use handshaker_core::collections::{Collection, Folder, Item, SavedRequest};
use handshaker_core::error::CoreError;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

// --- id parsing helpers -----------------------------------------------------

pub(crate) fn parse_collection_id(s: &str) -> Result<CollectionId, CoreError> {
    Uuid::parse_str(s)
        .map(CollectionId)
        .map_err(|e| CoreError::InvalidTarget(format!("bad collection id `{s}`: {e}")))
}

pub(crate) fn parse_item_id(s: &str) -> Result<ItemId, CoreError> {
    Uuid::parse_str(s)
        .map(ItemId)
        .map_err(|e| CoreError::InvalidTarget(format!("bad item id `{s}`: {e}")))
}

// --- auth DTOs --------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SavedAuthConfigIpc {
    None,
    EnvVar { env_var: String, header_name: String, prefix: String },
    Oauth2ClientCredentials {
        token_url: String,
        client_id: String,
        client_secret_env_var: String,
        scopes: Vec<String>,
    },
}

impl SavedAuthConfigIpc {
    pub fn from_core(c: SavedAuthConfig) -> Self {
        match c {
            SavedAuthConfig::None => Self::None,
            SavedAuthConfig::EnvVar(e) => Self::EnvVar {
                env_var: e.env_var,
                header_name: e.header_name,
                prefix: e.prefix,
            },
            SavedAuthConfig::OAuth2ClientCredentials(o) => Self::Oauth2ClientCredentials {
                token_url: o.token_url,
                client_id: o.client_id,
                client_secret_env_var: o.client_secret_env_var,
                scopes: o.scopes,
            },
        }
    }

    pub fn into_core(self) -> SavedAuthConfig {
        match self {
            Self::None => SavedAuthConfig::None,
            Self::EnvVar { env_var, header_name, prefix } => {
                SavedAuthConfig::EnvVar(EnvVarAuthConfig { env_var, header_name, prefix })
            }
            Self::Oauth2ClientCredentials { token_url, client_id, client_secret_env_var, scopes } => {
                SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
                    token_url,
                    client_id,
                    client_secret_env_var,
                    scopes,
                })
            }
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct AuthByEnvIpc {
    pub configs: HashMap<String, SavedAuthConfigIpc>,
}

impl AuthByEnvIpc {
    pub fn from_core(a: AuthByEnv) -> Self {
        Self {
            configs: a.configs.into_iter().map(|(k, v)| (k, SavedAuthConfigIpc::from_core(v))).collect(),
        }
    }

    pub fn into_core(self) -> AuthByEnv {
        AuthByEnv {
            configs: self.configs.into_iter().map(|(k, v)| (k, v.into_core())).collect(),
        }
    }
}

// --- item DTOs --------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FolderIpc {
    pub id: String,
    pub name: String,
    pub items: Vec<ItemIpc>,
    pub auth_by_env: AuthByEnvIpc,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SavedRequestIpc {
    pub id: String,
    pub name: String,
    pub address_template: String,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: HashMap<String, String>,
    pub auth_by_env: AuthByEnvIpc,
    pub tls_override: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ItemIpc {
    Folder(FolderIpc),
    Request(SavedRequestIpc),
}

impl ItemIpc {
    pub fn from_core(item: Item) -> Self {
        match item {
            Item::Folder(f) => Self::Folder(FolderIpc {
                id: f.id.0.to_string(),
                name: f.name,
                items: f.items.into_iter().map(ItemIpc::from_core).collect(),
                auth_by_env: AuthByEnvIpc::from_core(f.auth_by_env),
            }),
            Item::Request(r) => Self::Request(SavedRequestIpc {
                id: r.id.0.to_string(),
                name: r.name,
                address_template: r.address_template,
                service: r.service,
                method: r.method,
                body_template: r.body_template,
                metadata: r.metadata,
                auth_by_env: AuthByEnvIpc::from_core(r.auth_by_env),
                tls_override: r.tls_override,
            }),
        }
    }

    pub fn into_core(self) -> Result<Item, CoreError> {
        match self {
            Self::Folder(f) => {
                let items = f.items.into_iter().map(ItemIpc::into_core).collect::<Result<Vec<_>, _>>()?;
                Ok(Item::Folder(Folder {
                    id: parse_item_id(&f.id)?,
                    name: f.name,
                    items,
                    auth_by_env: f.auth_by_env.into_core(),
                }))
            }
            Self::Request(r) => Ok(Item::Request(SavedRequest {
                id: parse_item_id(&r.id)?,
                name: r.name,
                address_template: r.address_template,
                service: r.service,
                method: r.method,
                body_template: r.body_template,
                metadata: r.metadata,
                auth_by_env: r.auth_by_env.into_core(),
                tls_override: r.tls_override,
            })),
        }
    }
}

// --- collection DTOs --------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionIpc {
    pub id: String,
    pub name: String,
    pub items: Vec<ItemIpc>,
    pub variables: HashMap<String, String>,
    pub auth_by_env: AuthByEnvIpc,
    pub default_tls: bool,
    pub skip_tls_verify: bool,
}

impl CollectionIpc {
    pub fn from_core(c: Collection) -> Self {
        Self {
            id: c.id.0.to_string(),
            name: c.name,
            items: c.items.into_iter().map(ItemIpc::from_core).collect(),
            variables: c.variables,
            auth_by_env: AuthByEnvIpc::from_core(c.auth_by_env),
            default_tls: c.default_tls,
            skip_tls_verify: c.skip_tls_verify,
        }
    }

    pub fn into_core(self) -> Result<Collection, CoreError> {
        let items = self.items.into_iter().map(ItemIpc::into_core).collect::<Result<Vec<_>, _>>()?;
        Ok(Collection {
            id: parse_collection_id(&self.id)?,
            name: self.name,
            items,
            variables: self.variables,
            auth_by_env: self.auth_by_env.into_core(),
            default_tls: self.default_tls,
            skip_tls_verify: self.skip_tls_verify,
        })
    }
}

/// Lightweight list entry (id + name only) for `collection_list`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionMetaIpc {
    pub id: String,
    pub name: String,
}

/// Undo payload returned by `collection_delete_item`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ItemSnapshotIpc {
    pub item: ItemIpc,
    pub parent_id: Option<String>,
    pub position: u32,
}

impl ItemSnapshotIpc {
    pub fn from_core(s: ItemSnapshot) -> Self {
        Self {
            item: ItemIpc::from_core(s.item),
            parent_id: s.parent.map(|p| p.0.to_string()),
            position: s.position as u32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use handshaker_core::auth::AuthByEnv as CoreAuthByEnv;

    fn sample_collection() -> Collection {
        Collection {
            id: CollectionId(Uuid::from_u128(42)),
            name: "c".into(),
            items: vec![Item::Folder(Folder {
                id: ItemId(Uuid::from_u128(1)),
                name: "f".into(),
                items: vec![Item::Request(SavedRequest {
                    id: ItemId(Uuid::from_u128(2)),
                    name: "r".into(),
                    address_template: "{{host}}".into(),
                    service: "svc".into(),
                    method: "M".into(),
                    body_template: "{}".into(),
                    metadata: HashMap::new(),
                    auth_by_env: CoreAuthByEnv::default(),
                    tls_override: Some(true),
                })],
                auth_by_env: CoreAuthByEnv::default(),
            })],
            variables: HashMap::new(),
            auth_by_env: CoreAuthByEnv::default(),
            default_tls: false,
            skip_tls_verify: false,
        }
    }

    #[test]
    fn collection_round_trips_through_ipc() {
        let original = sample_collection();
        let ipc = CollectionIpc::from_core(original.clone());
        let back = ipc.into_core().unwrap();
        assert_eq!(original, back);
    }

    #[test]
    fn bad_uuid_is_invalid_target() {
        let ipc = CollectionIpc {
            id: "not-a-uuid".into(),
            name: "c".into(),
            items: vec![],
            variables: HashMap::new(),
            auth_by_env: AuthByEnvIpc::default(),
            default_tls: false,
            skip_tls_verify: false,
        };
        assert!(matches!(ipc.into_core().unwrap_err(), CoreError::InvalidTarget(_)));
    }
}
