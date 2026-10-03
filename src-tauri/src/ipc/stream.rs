//! IPC mirrors for **Stream calls** (ADR-0002): the method kind the UI chose, the
//! tagged-union event that flows on the per-call `tauri::ipc::Channel`, and the
//! **Send message** ack. Core stays specta-free — `specta::Type` derives only here.

use std::collections::HashMap;

use handshaker_core::stream::{AssembleResult, MethodKind, OutboundMessage, StreamEvent};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ipc::collection::SavedAuthConfigIpc;
use crate::ipc::invoke::StatusDetailIpc;
use crate::ipc::IpcError;

/// **Method kind** on the wire: `"unary" | "server" | "client" | "bidi"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MethodKindIpc {
    Unary,
    Server,
    Client,
    Bidi,
}

impl MethodKindIpc {
    pub fn into_core(self) -> MethodKind {
        match self {
            MethodKindIpc::Unary => MethodKind::Unary,
            MethodKindIpc::Server => MethodKind::Server,
            MethodKindIpc::Client => MethodKind::Client,
            MethodKindIpc::Bidi => MethodKind::Bidi,
        }
    }

    pub fn from_core(k: MethodKind) -> Self {
        match k {
            MethodKind::Unary => MethodKindIpc::Unary,
            MethodKind::Server => MethodKindIpc::Server,
            MethodKind::Client => MethodKindIpc::Client,
            MethodKind::Bidi => MethodKindIpc::Bidi,
        }
    }
}

/// One event of a stream call, discriminated by `"type"` like `IpcError`:
/// `Opened → Headers → Message* → End | Fault`. Cancel is not an event.
///
/// Numbers: `index` / `message_count` / `size_bytes` / `elapsed_ms` are `u32` (specta
/// forbids u64); `at_ms` (epoch ms) and `total_bytes` (multi-GB streams) are `f64`.
#[derive(Debug, Serialize, Type)]
#[serde(tag = "type")]
pub enum StreamEventIpc {
    Opened {
        kind: MethodKindIpc,
        /// The winning auth config in template form (`None` variant = unauthenticated).
        auth_used: SavedAuthConfigIpc,
        tls_used: bool,
        bytes_fields: Vec<String>,
    },
    Headers {
        metadata: HashMap<String, String>,
    },
    Message {
        index: u32,
        at_ms: f64,
        size_bytes: u32,
        preview: String,
        json: Option<String>,
    },
    End {
        status_code: i32,
        status_message: String,
        status_details: Vec<StatusDetailIpc>,
        trailing_metadata: HashMap<String, String>,
        elapsed_ms: u32,
        message_count: u32,
        total_bytes: f64,
    },
    Fault {
        error: IpcError,
    },
}

/// The `stream_send` ack — one **outbound message** row for the timeline: the same meta
/// as an inbound `Message` (`index` in the numbering shared with inbound rows, `at_ms`,
/// `size_bytes`, `preview`) plus the **resolved** pretty JSON that went on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct OutboundMessageIpc {
    pub index: u32,
    pub at_ms: f64,
    pub size_bytes: u32,
    pub preview: String,
    pub json: String,
}

impl OutboundMessageIpc {
    pub fn from_core(m: OutboundMessage) -> Self {
        Self {
            index: m.index,
            at_ms: m.at_ms as f64,
            size_bytes: cap_u32(m.size_bytes),
            preview: m.preview,
            json: m.json,
        }
    }
}

fn cap_u32(v: u64) -> u32 {
    v.min(u64::from(u32::MAX)) as u32
}

/// What `stream_assemble` wrote: the chosen `path`, `written` = inbound messages that
/// carried the field, `total` = all inbound messages, `size_bytes` as `f64` (a multi-GB
/// assembly overflows `u32`, and specta forbids `u64`).
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct AssembleResultIpc {
    pub path: String,
    pub written: u32,
    pub total: u32,
    pub size_bytes: f64,
}

impl AssembleResultIpc {
    pub fn from_core(r: AssembleResult, path: String) -> Self {
        Self { path, written: r.written, total: r.total, size_bytes: r.size_bytes as f64 }
    }
}

impl StreamEventIpc {
    pub fn from_core(ev: StreamEvent) -> Self {
        match ev {
            StreamEvent::Opened { kind, auth_used, tls_used, bytes_fields } => {
                StreamEventIpc::Opened {
                    kind: MethodKindIpc::from_core(kind),
                    auth_used: SavedAuthConfigIpc::from_core(
                        auth_used.unwrap_or(handshaker_core::auth::SavedAuthConfig::None),
                    ),
                    tls_used,
                    bytes_fields,
                }
            }
            StreamEvent::Headers { metadata } => StreamEventIpc::Headers { metadata },
            StreamEvent::Message { index, at_ms, size_bytes, preview, json } => {
                StreamEventIpc::Message {
                    index,
                    at_ms: at_ms as f64,
                    size_bytes: cap_u32(size_bytes),
                    preview,
                    json,
                }
            }
            StreamEvent::End {
                status_code,
                status_message,
                status_details,
                trailing_metadata,
                elapsed_ms,
                message_count,
                total_bytes,
            } => StreamEventIpc::End {
                status_code,
                status_message,
                status_details: status_details.into_iter().map(Into::into).collect(),
                trailing_metadata,
                elapsed_ms: cap_u32(elapsed_ms),
                message_count,
                total_bytes: total_bytes as f64,
            },
            StreamEvent::Fault { error } => StreamEventIpc::Fault { error: error.into() },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn method_kind_serializes_snake_case_and_round_trips() {
        for (k, s) in [
            (MethodKindIpc::Unary, "\"unary\""),
            (MethodKindIpc::Server, "\"server\""),
            (MethodKindIpc::Client, "\"client\""),
            (MethodKindIpc::Bidi, "\"bidi\""),
        ] {
            assert_eq!(serde_json::to_string(&k).unwrap(), s);
            let back: MethodKindIpc = serde_json::from_str(s).unwrap();
            assert_eq!(back, k);
            assert_eq!(MethodKindIpc::from_core(k.into_core()), k);
        }
    }

    #[test]
    fn opened_maps_no_auth_to_the_none_variant_and_tags_by_type() {
        let ev = StreamEventIpc::from_core(StreamEvent::Opened {
            kind: MethodKind::Server,
            auth_used: None,
            tls_used: true,
            bytes_fields: vec![],
        });
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains(r#""type":"Opened""#), "{json}");
        assert!(json.contains(r#""kind":"server""#), "{json}");
        assert!(json.contains(r#""tls_used":true"#), "{json}");
        match ev {
            StreamEventIpc::Opened { auth_used, .. } => assert_eq!(auth_used, SavedAuthConfigIpc::None),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn message_and_end_carry_wide_numbers_as_f64() {
        let msg = StreamEventIpc::from_core(StreamEvent::Message {
            index: 1,
            at_ms: 1_700_000_000_123,
            size_bytes: 5,
            preview: "{}".into(),
            json: None,
        });
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""at_ms":1700000000123"#), "{json}");
        assert!(json.contains(r#""json":null"#), "{json}");

        let end = StreamEventIpc::from_core(StreamEvent::End {
            status_code: 0,
            status_message: "OK".into(),
            status_details: vec![],
            trailing_metadata: HashMap::new(),
            elapsed_ms: 12,
            message_count: 3,
            total_bytes: 5_000_000_000,
        });
        let json = serde_json::to_string(&end).unwrap();
        assert!(json.contains(r#""type":"End""#), "{json}");
        assert!(json.contains(r#""total_bytes":5000000000"#), "{json}");
    }

    #[test]
    fn outbound_message_ack_mirrors_the_message_meta_plus_resolved_json() {
        let ack = OutboundMessageIpc::from_core(OutboundMessage {
            index: 3,
            at_ms: 1_700_000_000_123,
            size_bytes: 9,
            preview: r#"{"id":"a"}"#.into(),
            json: "{\n  \"id\": \"a\"\n}".into(),
        });
        let json = serde_json::to_string(&ack).unwrap();
        assert!(json.contains(r#""index":3"#), "{json}");
        assert!(json.contains(r#""at_ms":1700000000123"#), "{json}");
        assert!(json.contains(r#""size_bytes":9"#), "{json}");
        assert!(json.contains(r#""preview":"{\"id\":\"a\"}""#), "{json}");
        assert!(json.contains(r#""json":"{\n  \"id\": \"a\"\n}""#), "{json}");
    }

    #[test]
    fn assemble_result_carries_the_path_counts_and_a_wide_size() {
        let r = AssembleResultIpc::from_core(
            AssembleResult { written: 3, total: 4, size_bytes: 5_000_000_000 },
            "C:\\out\\file.bin".into(),
        );
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains(r#""path":"C:\\out\\file.bin""#), "{json}");
        assert!(json.contains(r#""written":3"#) && json.contains(r#""total":4"#), "{json}");
        assert!(json.contains(r#""size_bytes":5000000000"#), "{json}");
    }

    #[test]
    fn fault_wraps_the_mapped_ipc_error() {
        let ev = StreamEventIpc::from_core(StreamEvent::Fault {
            error: handshaker_core::CoreError::DeadlineExceeded { timeout_ms: 30_000 },
        });
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains(r#""type":"Fault""#), "{json}");
        assert!(json.contains(r#""error":{"type":"DeadlineExceeded","timeout_ms":30000}"#), "{json}");
    }
}
