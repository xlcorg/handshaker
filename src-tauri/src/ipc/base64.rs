//! IPC DTO for the base64 decoder. See
//! docs/superpowers/specs/2026-06-15-base64-value-decoder-design.md.

use handshaker_core::base64::Classified;
use serde::Serialize;
use specta::Type;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Base64KindIpc {
    Json,
    Text,
    Binary,
}

#[derive(Debug, Serialize, Type)]
pub struct Base64InspectIpc {
    pub kind: Base64KindIpc,
    /// Decoded byte length. specta rejects u64 in DTOs → u32 (responses ≪ 4 GB; saturating).
    pub size_bytes: u32,
    /// Decoded UTF-8 text for Json/Text; None for Binary.
    pub text: Option<String>,
    /// MIME for Binary (magic bytes); None otherwise.
    pub mime: Option<String>,
    /// Suggested extension for Binary; None otherwise.
    pub extension: Option<String>,
}

impl Base64InspectIpc {
    pub fn from_classified(size_bytes: u32, c: Classified) -> Self {
        match c {
            Classified::Json(s) => Self {
                kind: Base64KindIpc::Json,
                size_bytes,
                text: Some(s),
                mime: None,
                extension: None,
            },
            Classified::Text(s) => Self {
                kind: Base64KindIpc::Text,
                size_bytes,
                text: Some(s),
                mime: None,
                extension: None,
            },
            Classified::Binary { mime, extension } => Self {
                kind: Base64KindIpc::Binary,
                size_bytes,
                text: None,
                mime,
                extension,
            },
        }
    }
}
