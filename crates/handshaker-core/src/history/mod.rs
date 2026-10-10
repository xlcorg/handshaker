//! **Call history**: the persisted, capped log of finished Focus calls.
//!
//! One immutable [`CallRecord`] per wire attempt, keyed by that attempt's request id. The
//! frontend builds it at the call's terminal transition, because the frontend owns the
//! call's live view (the message timeline, the frozen elapsed time, the authored request
//! with disabled metadata rows). Core persists it through [`file_store::FileHistoryStore`],
//! which alone enforces order, the cap and the size bound. Core never builds a record and
//! never interprets the request.
//!
//! Distinct from the workflow's executed steps, which live in frontend memory for List and
//! Ledger.

pub mod file_store;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::SavedAuthConfig;
use crate::collections::{CollectionId, ItemId, MetadataRow};

pub use file_store::{FileHistoryStore, HistoryPage};

/// Records kept on disk: the newest by `started_at_ms`.
pub const HISTORY_CAP: usize = 200;
/// Message rows kept per stream record (the newest); older rows count in `omitted_messages`.
pub const MAX_MESSAGE_ROWS: usize = 200;
/// UTF-8 bytes of inline response JSON one record may keep (unary body or stream messages).
pub const INLINE_JSON_BUDGET: usize = 256 * 1024;
/// Serialized size of one record file. A record still over it after trimming is refused.
pub const MAX_RECORD_BYTES: usize = 512 * 1024;

/// Identity of one wire attempt: the request id the frontend sent it under (unary
/// `requestId`, stream id). A UUID v7, so it also breaks `started_at_ms` ties by time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CallId(pub Uuid);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CallRecord {
    pub id: CallId,
    /// Epoch ms when the attempt began (unary Send start, stream Open start).
    pub started_at_ms: f64,
    /// The saved request the draft was bound to at call start. `None` is an unbound draft.
    pub origin: Option<CallOrigin>,
    pub request: CallRequest,
    pub elapsed_ms: u64,
    pub outcome: CallOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallOrigin {
    pub collection_id: CollectionId,
    pub request_id: ItemId,
}

/// Exactly what loads back into the draft, as authored: `{{var}}` unresolved, TLS
/// tri-state, disabled metadata rows kept, and the request's own auth (not the pick).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallRequest {
    pub address_template: String,
    pub tls_override: Option<bool>,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: Vec<MetadataRow>,
    pub auth: SavedAuthConfig,
}

/// How the attempt ended, by shape. Each variant carries only what that shape can have:
/// a unary call has no headers field because the transport does not split them out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CallOutcome {
    /// A unary call that got a gRPC status, 0 or not.
    Unary {
        status: CallStatus,
        response: RecordedBody,
    },
    /// A unary client or transport fault with no status.
    UnaryFault { fault: CallFault },
    /// A stream call that reached Open and then ended, faulted, or was cancelled.
    Stream {
        kind: StreamKind,
        /// `None` means the server sent no headers before the end.
        headers: Option<BTreeMap<String, String>>,
        /// Oldest first. These are the call's newest rows; see `omitted_messages`.
        messages: Vec<RecordedMessage>,
        /// Rows dropped from the front to fit the record budget.
        omitted_messages: u32,
        end: StreamTermination,
    },
    /// A stream call that failed before Open (connect, auth, encode).
    StreamRefused { kind: StreamKind, fault: CallFault },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallStatus {
    pub code: i32,
    pub message: String,
    pub trailers: BTreeMap<String, String>,
}

/// A client-side fault. `kind` is the frontend's classification, stored as text: the
/// fault-kind list lives in one place, the frontend, which parses it back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallFault {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamTermination {
    Status {
        status: CallStatus,
    },
    Fault {
        fault: CallFault,
    },
    /// A user Cancel after Open, or a live stream freed because its draft was replaced.
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RecordedBody {
    /// No body was returned (a non-OK status).
    Absent,
    Inline {
        json: String,
    },
    /// The body was over the inline budget, so only its size is kept.
    Omitted {
        size_bytes: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordedMessage {
    pub direction: MessageDirection,
    pub index: u32,
    /// Epoch ms, from the channel event (inbound) or the send ack (outbound).
    pub at_ms: f64,
    pub size_bytes: u64,
    pub preview: String,
    /// Inline pretty JSON. `None` when the message was too large on the wire or over the
    /// record budget. The preview always survives.
    pub json: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageDirection {
    In,
    Out,
}

/// A streaming kind. It cannot be unary by construction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamKind {
    Server,
    Client,
    Bidi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallKind {
    Unary,
    Server,
    Client,
    Bidi,
}

impl From<StreamKind> for CallKind {
    fn from(kind: StreamKind) -> Self {
        match kind {
            StreamKind::Server => CallKind::Server,
            StreamKind::Client => CallKind::Client,
            StreamKind::Bidi => CallKind::Bidi,
        }
    }
}

/// One dock row: the only projection of a record. What the table, the filter and the
/// chips need, and nothing else.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CallSummary {
    pub id: CallId,
    pub started_at_ms: f64,
    pub kind: CallKind,
    pub service: String,
    pub method: String,
    pub address_template: String,
    pub elapsed_ms: u64,
    pub ending: CallEnding,
}

/// The status column and chip input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CallEnding {
    Status { code: i32 },
    Fault { kind: String },
    Cancelled,
}

impl CallRecord {
    pub fn kind(&self) -> CallKind {
        match &self.outcome {
            CallOutcome::Unary { .. } | CallOutcome::UnaryFault { .. } => CallKind::Unary,
            CallOutcome::Stream { kind, .. } | CallOutcome::StreamRefused { kind, .. } => {
                (*kind).into()
            }
        }
    }

    pub fn summary(&self) -> CallSummary {
        CallSummary {
            id: self.id,
            started_at_ms: self.started_at_ms,
            kind: self.kind(),
            service: self.request.service.clone(),
            method: self.request.method.clone(),
            address_template: self.request.address_template.clone(),
            elapsed_ms: self.elapsed_ms,
            ending: self.outcome.ending(),
        }
    }
}

impl CallOutcome {
    fn ending(&self) -> CallEnding {
        let fault = |f: &CallFault| CallEnding::Fault {
            kind: f.kind.clone(),
        };
        match self {
            CallOutcome::Unary { status, .. } => CallEnding::Status { code: status.code },
            CallOutcome::UnaryFault { fault: f } | CallOutcome::StreamRefused { fault: f, .. } => {
                fault(f)
            }
            CallOutcome::Stream { end, .. } => match end {
                StreamTermination::Status { status } => CallEnding::Status { code: status.code },
                StreamTermination::Fault { fault: f } => fault(f),
                StreamTermination::Cancelled => CallEnding::Cancelled,
            },
        }
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;

    pub fn request(body: &str) -> CallRequest {
        CallRequest {
            address_template: "{{host}}:50051".into(),
            tls_override: None,
            service: "echo.v1.Echo".into(),
            method: "Say".into(),
            body_template: body.into(),
            metadata: vec![
                MetadataRow {
                    key: "x-trace".into(),
                    value: "{{$uuid}}".into(),
                    enabled: true,
                },
                MetadataRow {
                    key: "x-debug".into(),
                    value: "1".into(),
                    enabled: false,
                },
            ],
            auth: SavedAuthConfig::None,
        }
    }

    pub fn status(code: i32) -> CallStatus {
        CallStatus {
            code,
            message: String::new(),
            trailers: BTreeMap::new(),
        }
    }

    pub fn unary(n: u128, started_at_ms: f64, response: RecordedBody) -> CallRecord {
        CallRecord {
            id: CallId(Uuid::from_u128(n)),
            started_at_ms,
            origin: None,
            request: request("{\"text\":\"hi\"}"),
            elapsed_ms: 12,
            outcome: CallOutcome::Unary {
                status: status(0),
                response,
            },
        }
    }

    pub fn message(index: u32, json: Option<String>) -> RecordedMessage {
        RecordedMessage {
            direction: MessageDirection::In,
            index,
            at_ms: 1_000.0 + f64::from(index),
            size_bytes: 8,
            preview: format!("{{\"tick\":{index}}}"),
            json,
        }
    }

    pub fn stream(n: u128, started_at_ms: f64, messages: Vec<RecordedMessage>) -> CallRecord {
        CallRecord {
            outcome: CallOutcome::Stream {
                kind: StreamKind::Server,
                headers: None,
                messages,
                omitted_messages: 0,
                end: StreamTermination::Status { status: status(0) },
            },
            ..unary(n, started_at_ms, RecordedBody::Absent)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    fn fault(kind: &str) -> CallFault {
        CallFault {
            kind: kind.into(),
            message: "boom".into(),
        }
    }

    fn ending_of(outcome: CallOutcome) -> (CallKind, CallEnding) {
        let record = CallRecord {
            outcome,
            ..unary(1, 1.0, RecordedBody::Absent)
        };
        let summary = record.summary();
        (summary.kind, summary.ending)
    }

    #[test]
    fn summary_maps_every_outcome_to_its_ending() {
        let stream_end = |end| CallOutcome::Stream {
            kind: StreamKind::Bidi,
            headers: None,
            messages: vec![],
            omitted_messages: 0,
            end,
        };
        assert_eq!(
            ending_of(CallOutcome::Unary {
                status: status(5),
                response: RecordedBody::Absent
            }),
            (CallKind::Unary, CallEnding::Status { code: 5 }),
        );
        assert_eq!(
            ending_of(CallOutcome::UnaryFault {
                fault: fault("refused")
            }),
            (
                CallKind::Unary,
                CallEnding::Fault {
                    kind: "refused".into()
                }
            ),
        );
        assert_eq!(
            ending_of(stream_end(StreamTermination::Status { status: status(0) })),
            (CallKind::Bidi, CallEnding::Status { code: 0 }),
        );
        assert_eq!(
            ending_of(stream_end(StreamTermination::Fault {
                fault: fault("timeout")
            })),
            (
                CallKind::Bidi,
                CallEnding::Fault {
                    kind: "timeout".into()
                }
            ),
        );
        assert_eq!(
            ending_of(stream_end(StreamTermination::Cancelled)),
            (CallKind::Bidi, CallEnding::Cancelled)
        );
    }

    #[test]
    fn kind_of_refused_stream_is_its_stream_kind() {
        assert_eq!(
            ending_of(CallOutcome::StreamRefused {
                kind: StreamKind::Client,
                fault: fault("tls")
            }),
            (CallKind::Client, CallEnding::Fault { kind: "tls".into() }),
        );
    }

    #[test]
    fn summary_copies_the_row_fields() {
        let record = unary(
            7,
            1_791_640_800_123.0,
            RecordedBody::Inline { json: "{}".into() },
        );
        let summary = record.summary();
        assert_eq!(summary.id, CallId(Uuid::from_u128(7)));
        assert_eq!(summary.started_at_ms, 1_791_640_800_123.0);
        assert_eq!(summary.service, "echo.v1.Echo");
        assert_eq!(summary.method, "Say");
        assert_eq!(summary.address_template, "{{host}}:50051");
        assert_eq!(summary.elapsed_ms, 12);
    }

    #[test]
    fn record_serializes_with_tagged_outcomes() {
        let json =
            serde_json::to_value(unary(1, 2.0, RecordedBody::Omitted { size_bytes: 9 })).unwrap();
        assert_eq!(json["id"], "00000000-0000-0000-0000-000000000001");
        assert_eq!(json["outcome"]["type"], "unary");
        assert_eq!(
            json["outcome"]["response"],
            serde_json::json!({ "type": "omitted", "size_bytes": 9 })
        );
        assert_eq!(
            json["request"]["auth"],
            serde_json::json!({ "kind": "none" })
        );
    }
}
