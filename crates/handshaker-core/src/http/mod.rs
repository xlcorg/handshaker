//! Plain HTTP requests: the value types a template, a transport, and a history record
//! share. The spine that sends them is `Sender::send_http` (`crate::send`); this module
//! owns the pure rules (URL, body) and the network seam.

pub mod body;
pub mod request;
#[cfg(any(test, feature = "test-support"))]
pub mod testing;
pub mod transport;
pub mod url;

use serde::{Deserialize, Serialize};

use crate::collections::MetadataRow;

pub use request::OutboundHttpRequest;
pub use transport::{HttpTransport, ReqwestTransport};
pub use url::UrlProblem;

/// The method set the product offers. Closed on purpose: no free-text method.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

impl HttpMethod {
    pub(crate) fn as_reqwest(self) -> reqwest::Method {
        match self {
            HttpMethod::Get => reqwest::Method::GET,
            HttpMethod::Post => reqwest::Method::POST,
            HttpMethod::Put => reqwest::Method::PUT,
            HttpMethod::Patch => reqwest::Method::PATCH,
            HttpMethod::Delete => reqwest::Method::DELETE,
            HttpMethod::Head => reqwest::Method::HEAD,
            HttpMethod::Options => reqwest::Method::OPTIONS,
        }
    }
}

/// The authored body. The stored mode is exactly what is sent: switching modes keeps only
/// the active variant.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HttpBody {
    #[default]
    None,
    /// Sent byte-for-byte after resolve and built-ins. Not validated as JSON: the server
    /// is the judge.
    Json {
        text: String,
    },
    Text {
        text: String,
    },
    /// `application/x-www-form-urlencoded`.
    Form {
        fields: Vec<MetadataRow>,
    },
}

/// One response, as shown live and as recorded. `status >= 400` is still a value: only a
/// failure with no HTTP response becomes a `CoreError`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    /// Canonical reason phrase for `status`, empty when unknown.
    pub reason: String,
    /// Grouped by name in first-arrival order, duplicates kept (`set-cookie`). Non-UTF-8
    /// values are lossy-decoded.
    pub headers: Vec<HeaderRow>,
    pub body: ResponseBody,
    /// Body bytes read off the wire. For `TooLarge`, the count at which reading stopped.
    pub size_bytes: u64,
    /// From dispatch to the last body byte. Excludes resolve and token fetch.
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeaderRow {
    pub name: String,
    pub value: String,
}

/// What the body pane can show. Core classifies and pretty-prints once, so live and
/// recorded responses render identically.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResponseBody {
    /// No bytes (HEAD, 204, 304, or an empty 200).
    Empty,
    /// Valid JSON, re-indented by `body::reindent_json_lexemes`.
    Json { text: String },
    /// UTF-8 text that is not JSON.
    Text { text: String },
    /// Not UTF-8. Only the size is shown.
    Binary,
    /// Reading stopped at the call's `max_body_bytes`.
    TooLarge { limit_bytes: u64 },
    /// Kept live, dropped from the history record to fit the inline budget.
    Omitted,
}

#[derive(Debug, Clone, Copy)]
pub struct HttpCallOptions {
    /// `usize::MAX` = unlimited.
    pub max_body_bytes: usize,
}
