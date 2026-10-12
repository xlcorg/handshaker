//! **Request template**: what a request *is*, by protocol. A template is authored content:
//! `{{var}}` intact, disabled rows kept, the request's own auth (never the pick). The same
//! value is what a saved request holds and what Send takes.

use serde::{Deserialize, Serialize};

use crate::auth::SavedAuthConfig;
use crate::http::{HttpBody, HttpMethod};

use super::MetadataRow;

/// Each variant carries exactly what its Send needs. The protocol is fixed at creation:
/// nothing converts one variant into the other.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "protocol", rename_all = "lowercase", try_from = "TemplateWire")]
pub enum RequestTemplate {
    Grpc(GrpcTemplate),
    Http(HttpTemplate),
}

impl RequestTemplate {
    /// The request-level auth config, whatever the protocol (the auth pick is protocol-neutral).
    pub fn auth(&self) -> &SavedAuthConfig {
        match self {
            RequestTemplate::Grpc(g) => &g.auth,
            RequestTemplate::Http(h) => &h.auth,
        }
    }

    pub fn set_auth(&mut self, auth: SavedAuthConfig) {
        match self {
            RequestTemplate::Grpc(g) => g.auth = auth,
            RequestTemplate::Http(h) => h.auth = auth,
        }
    }
}

/// A gRPC call template.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GrpcTemplate {
    /// `host:port` template; becomes a `GrpcTarget` after resolve.
    pub address_template: String,
    /// TLS tri-state: `None` inherits the collection's `default_tls` at Send time.
    pub tls_override: Option<bool>,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: Vec<MetadataRow>,
    pub auth: SavedAuthConfig,
}

/// A plain HTTP request template. No TLS field: the URL scheme is the single truth.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpTemplate {
    pub method: HttpMethod,
    /// Absolute `http(s)://` URL template. It may already contain a `?query`; `query` rows
    /// are appended after it.
    pub url_template: String,
    /// Order kept, duplicates allowed. Key and value are both templates.
    pub query: Vec<MetadataRow>,
    /// Literal names, templated values. A user `Content-Type` overrides the body's implied
    /// one. The materialized auth header replaces a user row of the same name.
    pub headers: Vec<MetadataRow>,
    pub body: HttpBody,
    pub auth: SavedAuthConfig,
}

/// The on-disk read form. serde has no default for a missing internal tag, so this repr is
/// the single home of the compat rule: `protocol` absent ⇒ gRPC. Every collection file and
/// history record written before the tag existed loads through the default. An unknown
/// protocol is a parse error, so a file from a newer build is quarantined, not half-read.
#[derive(Deserialize)]
struct TemplateWire {
    #[serde(default)]
    protocol: Protocol,
    #[serde(flatten)]
    fields: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Protocol {
    #[default]
    Grpc,
    Http,
}

impl TryFrom<TemplateWire> for RequestTemplate {
    type Error = serde_json::Error;

    fn try_from(wire: TemplateWire) -> Result<Self, Self::Error> {
        let fields = serde_json::Value::Object(wire.fields);
        match wire.protocol {
            Protocol::Grpc => serde_json::from_value(fields).map(RequestTemplate::Grpc),
            Protocol::Http => serde_json::from_value(fields).map(RequestTemplate::Http),
        }
    }
}
