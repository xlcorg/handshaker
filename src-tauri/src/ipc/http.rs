//! Plain HTTP DTOs.

use handshaker_core::collections::HttpTemplate;
use handshaker_core::http::{
    HeaderRow, HttpBody, HttpMethod, HttpResponse, ResponseBody, UrlProblem,
};
use handshaker_core::send::HttpSendReport;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ipc::collection::{MetadataRowIpc, SavedAuthConfigIpc};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethodIpc {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

impl HttpMethodIpc {
    pub fn from_core(m: HttpMethod) -> Self {
        match m {
            HttpMethod::Get => HttpMethodIpc::Get,
            HttpMethod::Post => HttpMethodIpc::Post,
            HttpMethod::Put => HttpMethodIpc::Put,
            HttpMethod::Patch => HttpMethodIpc::Patch,
            HttpMethod::Delete => HttpMethodIpc::Delete,
            HttpMethod::Head => HttpMethodIpc::Head,
            HttpMethod::Options => HttpMethodIpc::Options,
        }
    }

    pub fn into_core(self) -> HttpMethod {
        match self {
            HttpMethodIpc::Get => HttpMethod::Get,
            HttpMethodIpc::Post => HttpMethod::Post,
            HttpMethodIpc::Put => HttpMethod::Put,
            HttpMethodIpc::Patch => HttpMethod::Patch,
            HttpMethodIpc::Delete => HttpMethod::Delete,
            HttpMethodIpc::Head => HttpMethod::Head,
            HttpMethodIpc::Options => HttpMethod::Options,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HttpBodyIpc {
    None,
    Json { text: String },
    Text { text: String },
    Form { fields: Vec<MetadataRowIpc> },
}

impl HttpBodyIpc {
    pub fn from_core(b: HttpBody) -> Self {
        match b {
            HttpBody::None => HttpBodyIpc::None,
            HttpBody::Json { text } => HttpBodyIpc::Json { text },
            HttpBody::Text { text } => HttpBodyIpc::Text { text },
            HttpBody::Form { fields } => HttpBodyIpc::Form {
                fields: fields.into_iter().map(MetadataRowIpc::from_core).collect(),
            },
        }
    }

    pub fn into_core(self) -> HttpBody {
        match self {
            HttpBodyIpc::None => HttpBody::None,
            HttpBodyIpc::Json { text } => HttpBody::Json { text },
            HttpBodyIpc::Text { text } => HttpBody::Text { text },
            HttpBodyIpc::Form { fields } => HttpBody::Form {
                fields: fields.into_iter().map(MetadataRowIpc::into_core).collect(),
            },
        }
    }
}

/// The HTTP request as authored: `{{var}}` intact, disabled and keyless rows included.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct HttpTemplateIpc {
    pub method: HttpMethodIpc,
    pub url_template: String,
    pub query: Vec<MetadataRowIpc>,
    pub headers: Vec<MetadataRowIpc>,
    pub body: HttpBodyIpc,
    pub auth: SavedAuthConfigIpc,
}

impl HttpTemplateIpc {
    pub fn from_core(t: HttpTemplate) -> Self {
        Self {
            method: HttpMethodIpc::from_core(t.method),
            url_template: t.url_template,
            query: t.query.into_iter().map(MetadataRowIpc::from_core).collect(),
            headers: t
                .headers
                .into_iter()
                .map(MetadataRowIpc::from_core)
                .collect(),
            body: HttpBodyIpc::from_core(t.body),
            auth: SavedAuthConfigIpc::from_core(t.auth),
        }
    }

    pub fn into_core(self) -> HttpTemplate {
        HttpTemplate {
            method: self.method.into_core(),
            url_template: self.url_template,
            query: self
                .query
                .into_iter()
                .map(MetadataRowIpc::into_core)
                .collect(),
            headers: self
                .headers
                .into_iter()
                .map(MetadataRowIpc::into_core)
                .collect(),
            body: self.body.into_core(),
            auth: self.auth.into_core(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HeaderRowIpc {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResponseBodyIpc {
    Empty,
    Json { text: String },
    Text { text: String },
    Binary,
    TooLarge { limit_bytes: u32 },
    Omitted,
}

impl ResponseBodyIpc {
    pub fn from_core(b: ResponseBody) -> Self {
        match b {
            ResponseBody::Empty => ResponseBodyIpc::Empty,
            ResponseBody::Json { text } => ResponseBodyIpc::Json { text },
            ResponseBody::Text { text } => ResponseBodyIpc::Text { text },
            ResponseBody::Binary => ResponseBodyIpc::Binary,
            ResponseBody::TooLarge { limit_bytes } => ResponseBodyIpc::TooLarge {
                limit_bytes: saturate_u32(limit_bytes),
            },
            ResponseBody::Omitted => ResponseBodyIpc::Omitted,
        }
    }

    pub fn into_core(self) -> ResponseBody {
        match self {
            ResponseBodyIpc::Empty => ResponseBody::Empty,
            ResponseBodyIpc::Json { text } => ResponseBody::Json { text },
            ResponseBodyIpc::Text { text } => ResponseBody::Text { text },
            ResponseBodyIpc::Binary => ResponseBody::Binary,
            ResponseBodyIpc::TooLarge { limit_bytes } => ResponseBody::TooLarge {
                limit_bytes: u64::from(limit_bytes),
            },
            ResponseBodyIpc::Omitted => ResponseBody::Omitted,
        }
    }
}

/// Sizes and times saturate at `u32::MAX`: specta forbids u64 at the IPC boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HttpResponseIpc {
    pub status: u16,
    pub reason: String,
    pub headers: Vec<HeaderRowIpc>,
    pub body: ResponseBodyIpc,
    pub size_bytes: u32,
    pub elapsed_ms: u32,
}

impl HttpResponseIpc {
    pub fn from_core(r: HttpResponse) -> Self {
        Self {
            status: r.status,
            reason: r.reason,
            headers: r
                .headers
                .into_iter()
                .map(|HeaderRow { name, value }| HeaderRowIpc { name, value })
                .collect(),
            body: ResponseBodyIpc::from_core(r.body),
            size_bytes: saturate_u32(r.size_bytes),
            elapsed_ms: saturate_u32(r.elapsed_ms),
        }
    }

    pub fn into_core(self) -> HttpResponse {
        HttpResponse {
            status: self.status,
            reason: self.reason,
            headers: self
                .headers
                .into_iter()
                .map(|HeaderRowIpc { name, value }| HeaderRow { name, value })
                .collect(),
            body: self.body.into_core(),
            size_bytes: u64::from(self.size_bytes),
            elapsed_ms: u64::from(self.elapsed_ms),
        }
    }
}

/// `auth_used` is the picked config in template form, `{ kind: "none" }` when
/// unauthenticated, as in `SendReportIpc`.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct HttpSendReportIpc {
    pub response: HttpResponseIpc,
    pub auth_used: SavedAuthConfigIpc,
}

impl HttpSendReportIpc {
    pub fn from_core(r: HttpSendReport) -> Self {
        let picked = r
            .auth_used
            .unwrap_or(handshaker_core::auth::SavedAuthConfig::None);
        Self {
            response: HttpResponseIpc::from_core(r.response),
            auth_used: SavedAuthConfigIpc::from_core(picked),
        }
    }
}

fn saturate_u32(v: u64) -> u32 {
    v.min(u64::from(u32::MAX)) as u32
}

/// Why a resolved URL cannot be sent. Never carries the URL: it can hold secrets.
#[derive(Debug, Clone, Serialize, Type, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UrlProblemIpc {
    MissingScheme,
    UnsupportedScheme { scheme: String },
    Malformed { reason: String },
}

impl UrlProblemIpc {
    pub fn from_core(p: UrlProblem) -> Self {
        match p {
            UrlProblem::MissingScheme => UrlProblemIpc::MissingScheme,
            UrlProblem::UnsupportedScheme { scheme } => UrlProblemIpc::UnsupportedScheme { scheme },
            UrlProblem::Malformed { reason } => UrlProblemIpc::Malformed { reason },
        }
    }
}
