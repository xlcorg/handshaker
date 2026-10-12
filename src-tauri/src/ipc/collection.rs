//! IPC DTOs for collections. All ids cross as strings (UUID). Conversions to core
//! are fallible (bad UUID → `InvalidTarget`); conversions from core are total.
//!
//! `ItemIpc` is a `#[serde(tag = "type")]` tagged union — the frontend (#3)
//! discriminates on `type` ("folder" | "request").

use indexmap::IndexMap;

use handshaker_core::auth::{
    EnvVarAuthConfig, OAuth2ClientCredentialsConfig, SavedAuthConfig,
};
use handshaker_core::collections::ids::{CollectionId, ItemId};
use handshaker_core::collections::tree::ItemSnapshot;
use handshaker_core::collections::{
    Collection, CollectionLink, Folder, GrpcTemplate, Item, MetadataRow, RequestTemplate,
    SavedRequest,
};
use handshaker_core::error::CoreError;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use crate::ipc::http::HttpTemplateIpc;

// --- default helpers for auth serde -----------------------------------------

fn default_auth_header_name() -> String {
    "authorization".to_string()
}
fn default_auth_prefix() -> String {
    "Bearer ".to_string()
}

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SavedAuthConfigIpc {
    None,
    EnvVar {
        env_var: String,
        header_name: String,
        prefix: String,
        #[serde(default)]
        environments: Vec<String>,
    },
    #[serde(rename = "oauth2_client_credentials")]
    Oauth2ClientCredentials {
        token_url: String,
        client_id: String,
        client_secret: String,
        scopes: Vec<String>,
        #[serde(default = "default_auth_header_name")]
        header_name: String,
        #[serde(default = "default_auth_prefix")]
        prefix: String,
        #[serde(default)]
        environments: Vec<String>,
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
                environments: e.environments,
            },
            SavedAuthConfig::OAuth2ClientCredentials(o) => Self::Oauth2ClientCredentials {
                token_url: o.token_url,
                client_id: o.client_id,
                client_secret: o.client_secret,
                scopes: o.scopes,
                header_name: o.header_name,
                prefix: o.prefix,
                environments: o.environments,
            },
        }
    }

    pub fn into_core(self) -> SavedAuthConfig {
        match self {
            Self::None => SavedAuthConfig::None,
            Self::EnvVar { env_var, header_name, prefix, environments } => {
                SavedAuthConfig::EnvVar(EnvVarAuthConfig { env_var, header_name, prefix, environments })
            }
            Self::Oauth2ClientCredentials {
                token_url, client_id, client_secret, scopes, header_name, prefix, environments,
            } => SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
                token_url,
                client_id,
                client_secret,
                scopes,
                header_name,
                prefix,
                environments,
            }),
        }
    }
}

// --- metadata DTOs ----------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MetadataRowIpc {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

impl MetadataRowIpc {
    pub fn from_core(r: MetadataRow) -> Self {
        Self { key: r.key, value: r.value, enabled: r.enabled }
    }
    pub fn into_core(self) -> MetadataRow {
        MetadataRow { key: self.key, value: self.value, enabled: self.enabled }
    }
}

// --- item DTOs --------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FolderIpc {
    pub id: String,
    pub name: String,
    pub items: Vec<ItemIpc>,
    pub expanded: bool,
}

/// A gRPC call as authored: the saved content, the Send and Open input, and the history
/// request.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GrpcTemplateIpc {
    pub address_template: String,
    /// `None` inherits the collection's `default_tls`, resolved in core at Send time.
    pub tls_override: Option<bool>,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: Vec<MetadataRowIpc>,
    pub auth: SavedAuthConfigIpc,
}

impl GrpcTemplateIpc {
    pub fn from_core(g: GrpcTemplate) -> Self {
        Self {
            address_template: g.address_template,
            tls_override: g.tls_override,
            service: g.service,
            method: g.method,
            body_template: g.body_template,
            metadata: g.metadata.into_iter().map(MetadataRowIpc::from_core).collect(),
            auth: SavedAuthConfigIpc::from_core(g.auth),
        }
    }

    pub fn into_core(self) -> GrpcTemplate {
        GrpcTemplate {
            address_template: self.address_template,
            tls_override: self.tls_override,
            service: self.service,
            method: self.method,
            body_template: self.body_template,
            metadata: self.metadata.into_iter().map(MetadataRowIpc::into_core).collect(),
            auth: self.auth.into_core(),
        }
    }
}

/// Over IPC the tag is always present, so no compat repr is needed here.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "protocol", rename_all = "lowercase")]
pub enum RequestTemplateIpc {
    Grpc(GrpcTemplateIpc),
    Http(HttpTemplateIpc),
}

impl RequestTemplateIpc {
    pub fn from_core(t: RequestTemplate) -> Self {
        match t {
            RequestTemplate::Grpc(g) => Self::Grpc(GrpcTemplateIpc::from_core(g)),
            RequestTemplate::Http(h) => Self::Http(HttpTemplateIpc::from_core(h)),
        }
    }

    pub fn into_core(self) -> RequestTemplate {
        match self {
            Self::Grpc(g) => RequestTemplate::Grpc(g.into_core()),
            Self::Http(h) => RequestTemplate::Http(h.into_core()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SavedRequestIpc {
    pub id: String,
    pub name: String,
    pub last_used_at: Option<f64>,
    pub use_count: u32,
    /// Nested, not flattened: tsc then flags every frontend read of a protocol field
    /// that skipped the narrowing.
    pub template: RequestTemplateIpc,
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
                expanded: f.expanded,
            }),
            Item::Request(r) => Self::Request(SavedRequestIpc {
                id: r.id.0.to_string(),
                name: r.name,
                last_used_at: r.last_used_at,
                use_count: r.use_count,
                template: RequestTemplateIpc::from_core(r.template),
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
                    expanded: f.expanded,
                }))
            }
            Self::Request(r) => Ok(Item::Request(SavedRequest {
                id: parse_item_id(&r.id)?,
                name: r.name,
                last_used_at: r.last_used_at,
                use_count: r.use_count,
                template: r.template.into_core(),
            })),
        }
    }
}

// --- collection link DTOs ---------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CollectionLinkIpc {
    pub name: String,
    /// `{{var}}` template — crosses the seam unresolved.
    pub url: String,
}

impl CollectionLinkIpc {
    pub fn from_core(l: CollectionLink) -> Self {
        Self { name: l.name, url: l.url }
    }
    pub fn into_core(self) -> CollectionLink {
        CollectionLink { name: self.name, url: self.url }
    }
}

// --- collection DTOs --------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionIpc {
    pub id: String,
    pub name: String,
    pub items: Vec<ItemIpc>,
    pub variables: IndexMap<String, String>,
    pub auth: SavedAuthConfigIpc,
    pub default_tls: bool,
    pub skip_tls_verify: bool,
    pub pinned: bool,
    pub description: Option<String>,
    pub created_at: f64,
    pub expanded: bool,
    /// Collection links in creation order; empty for pre-feature stores.
    #[serde(default)]
    pub links: Vec<CollectionLinkIpc>,
}

impl CollectionIpc {
    pub fn from_core(c: Collection) -> Self {
        Self {
            id: c.id.0.to_string(),
            name: c.name,
            items: c.items.into_iter().map(ItemIpc::from_core).collect(),
            variables: c.variables,
            auth: SavedAuthConfigIpc::from_core(c.auth),
            default_tls: c.default_tls,
            skip_tls_verify: c.skip_tls_verify,
            pinned: c.pinned,
            description: c.description,
            created_at: c.created_at,
            expanded: c.expanded,
            links: c.links.into_iter().map(CollectionLinkIpc::from_core).collect(),
        }
    }

    pub fn into_core(self) -> Result<Collection, CoreError> {
        let items = self.items.into_iter().map(ItemIpc::into_core).collect::<Result<Vec<_>, _>>()?;
        Ok(Collection {
            id: parse_collection_id(&self.id)?,
            name: self.name,
            items,
            variables: self.variables,
            auth: self.auth.into_core(),
            default_tls: self.default_tls,
            skip_tls_verify: self.skip_tls_verify,
            pinned: self.pinned,
            description: self.description,
            created_at: self.created_at,
            expanded: self.expanded,
            links: self.links.into_iter().map(CollectionLinkIpc::into_core).collect(),
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
    use handshaker_core::auth::SavedAuthConfig;
    use handshaker_core::collections::{Collection, Folder, Item, MetadataRow, SavedRequest};

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
                    last_used_at: Some(123.0),
                    use_count: 4,
                    template: RequestTemplate::Grpc(GrpcTemplate {
                        address_template: "{{host}}".into(),
                        service: "svc".into(),
                        method: "M".into(),
                        body_template: "{}".into(),
                        metadata: vec![
                            MetadataRow { key: "a".into(), value: "1".into(), enabled: true },
                            MetadataRow { key: "a".into(), value: "2".into(), enabled: false },
                        ],
                        auth: SavedAuthConfig::None,
                        tls_override: Some(true),
                    }),
                })],
                expanded: true,
            })],
            variables: IndexMap::new(),
            auth: SavedAuthConfig::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: true,
            description: Some("d".into()),
            created_at: 1_700_000_000_000.0,
            expanded: true,
            links: vec![
                CollectionLink { name: "Grafana".into(), url: "https://{{host}}/d/abc".into() },
                CollectionLink { name: "Logs".into(), url: "https://logs.example".into() },
            ],
        }
    }

    #[test]
    fn collection_round_trips_through_ipc() {
        let original = sample_collection();
        let ipc = CollectionIpc::from_core(original.clone());
        let back = ipc.into_core().unwrap();
        assert_eq!(original, back);

        // metadata order (incl. duplicate keys + enabled flags) preserved through round-trip
        let Item::Folder(folder) = &back.items[0] else { panic!("expected folder") };
        let Item::Request(SavedRequest { template: RequestTemplate::Grpc(req), .. }) = &folder.items[0]
        else {
            panic!("expected request")
        };
        assert_eq!(req.metadata[0].key, "a");
        assert!(req.metadata[0].enabled);
        assert!(!req.metadata[1].enabled);

        // links survive the round-trip in creation order, URL template unresolved
        assert_eq!(back.links.len(), 2);
        assert_eq!(back.links[0].name, "Grafana");
        assert_eq!(back.links[0].url, "https://{{host}}/d/abc");
        assert_eq!(back.links[1].name, "Logs");
    }

    #[test]
    fn http_request_item_from_the_frontend_reaches_core_and_comes_back_unchanged() {
        let wire = serde_json::json!({
            "type": "request",
            "id": "00000000-0000-0000-0000-000000000005",
            "name": "List users",
            "last_used_at": null,
            "use_count": 2,
            "template": {
                "protocol": "http",
                "method": "GET",
                "url_template": "{{base}}/users",
                "query": [{ "key": "page", "value": "{{page}}", "enabled": true }],
                "headers": [{ "key": "", "value": "x", "enabled": true }],
                "body": { "kind": "text", "text": "hi" },
                "auth": { "kind": "none" },
            },
        });

        let core = serde_json::from_value::<ItemIpc>(wire.clone()).unwrap().into_core().unwrap();

        let Item::Request(SavedRequest { template: RequestTemplate::Http(t), use_count: 2, .. }) = &core
        else {
            panic!("expected an HTTP request, got {core:?}")
        };
        assert_eq!(t.url_template, "{{base}}/users");
        assert_eq!(t.headers, vec![MetadataRow { key: "".into(), value: "x".into(), enabled: true }]);
        assert_eq!(serde_json::to_value(ItemIpc::from_core(core)).unwrap(), wire);
    }

    /// A payload sent by a frontend that predates links (or a stored DTO without the
    /// field) must deserialize with an empty list, not fail.
    #[test]
    fn collection_ipc_without_links_deserializes_to_empty() {
        let json = r#"{
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "c",
            "items": [],
            "variables": {},
            "auth": { "kind": "none" },
            "default_tls": false,
            "skip_tls_verify": false,
            "pinned": false,
            "description": null,
            "created_at": 0.0,
            "expanded": false
        }"#;
        let ipc: CollectionIpc = serde_json::from_str(json).unwrap();
        assert!(ipc.links.is_empty());
        assert!(ipc.into_core().unwrap().links.is_empty());
    }

    #[test]
    fn oauth2_ipc_round_trips_through_core_with_new_fields() {
        let ipc = SavedAuthConfigIpc::Oauth2ClientCredentials {
            token_url: "u".into(),
            client_id: "c".into(),
            client_secret: "s".into(),
            scopes: vec!["a".into()],
            header_name: "x-auth".into(),
            prefix: "Token ".into(),
            environments: vec!["prod".into()],
        };
        let core = ipc.clone().into_core();
        let back = SavedAuthConfigIpc::from_core(core);
        assert_eq!(back, ipc);
    }

    #[test]
    fn oauth2_ipc_tag_is_pinned() {
        let ipc = SavedAuthConfigIpc::Oauth2ClientCredentials {
            token_url: "u".into(), client_id: "c".into(), client_secret: "s".into(),
            scopes: vec![], header_name: "authorization".into(), prefix: "Bearer ".into(),
            environments: vec![],
        };
        let json = serde_json::to_string(&ipc).unwrap();
        assert!(json.contains(r#""kind":"oauth2_client_credentials""#), "got {json}");
    }

    #[test]
    fn env_var_ipc_round_trips_environments() {
        let ipc = SavedAuthConfigIpc::EnvVar {
            env_var: "V".into(), header_name: "authorization".into(), prefix: "Bearer ".into(),
            environments: vec!["prod".into()],
        };
        let back = SavedAuthConfigIpc::from_core(ipc.clone().into_core());
        assert_eq!(back, ipc);
    }

    #[test]
    fn bad_uuid_is_invalid_target() {
        let ipc = CollectionIpc {
            id: "not-a-uuid".into(),
            name: "c".into(),
            items: vec![],
            variables: IndexMap::new(),
            auth: SavedAuthConfigIpc::None,
            default_tls: false,
            skip_tls_verify: false,
            pinned: false,
            description: None,
            created_at: 0.0,
            expanded: false,
            links: vec![],
        };
        assert!(matches!(ipc.into_core().unwrap_err(), CoreError::InvalidTarget(_)));
    }
}
