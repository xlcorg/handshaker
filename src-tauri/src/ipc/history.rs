use std::collections::BTreeMap;

use handshaker_core::error::CoreError;
use handshaker_core::history::{
    CallEnding, CallFault, CallId, CallKind, CallOrigin, CallOutcome, CallRecord, CallRequest,
    CallStatus, CallSummary, HistoryPage, MessageDirection, RecordedBody, RecordedMessage,
    StreamKind, StreamTermination,
};
use handshaker_core::stream::MethodKind;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use crate::ipc::collection::{
    parse_collection_id, parse_item_id, MetadataRowIpc, SavedAuthConfigIpc,
};
use crate::ipc::stream::MethodKindIpc;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CallRecordIpc {
    pub id: String,
    pub started_at_ms: f64,
    pub origin: Option<CallOriginIpc>,
    pub request: CallRequestIpc,
    pub elapsed_ms: u32,
    pub outcome: CallOutcomeIpc,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CallOriginIpc {
    pub collection_id: String,
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CallRequestIpc {
    pub address_template: String,
    pub tls_override: Option<bool>,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: Vec<MetadataRowIpc>,
    pub auth: SavedAuthConfigIpc,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CallOutcomeIpc {
    Unary {
        status: CallStatusIpc,
        response: RecordedBodyIpc,
    },
    UnaryFault {
        fault: CallFaultIpc,
    },
    Stream {
        kind: StreamKindIpc,
        headers: Option<BTreeMap<String, String>>,
        messages: Vec<RecordedMessageIpc>,
        omitted_messages: u32,
        end: StreamTerminationIpc,
    },
    StreamRefused {
        kind: StreamKindIpc,
        fault: CallFaultIpc,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CallStatusIpc {
    pub code: i32,
    pub message: String,
    pub trailers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CallFaultIpc {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamTerminationIpc {
    Status { status: CallStatusIpc },
    Fault { fault: CallFaultIpc },
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RecordedBodyIpc {
    Absent,
    Inline { json: String },
    Omitted { size_bytes: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RecordedMessageIpc {
    pub direction: MessageDirectionIpc,
    pub index: u32,
    pub at_ms: f64,
    pub size_bytes: u32,
    pub preview: String,
    pub json: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MessageDirectionIpc {
    In,
    Out,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StreamKindIpc {
    Server,
    Client,
    Bidi,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CallSummaryIpc {
    pub id: String,
    pub started_at_ms: f64,
    pub kind: MethodKindIpc,
    pub service: String,
    pub method: String,
    pub address_template: String,
    pub elapsed_ms: u32,
    pub ending: CallEndingIpc,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CallEndingIpc {
    Status { code: i32 },
    Fault { kind: String },
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct HistoryPageIpc {
    pub revision: u32,
    pub rows: Vec<CallSummaryIpc>,
}

fn saturate(n: u64) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

fn finite(ms: f64, what: &str) -> Result<f64, CoreError> {
    if ms.is_finite() {
        Ok(ms)
    } else {
        Err(CoreError::InvalidTarget(format!(
            "{what} must be a finite epoch ms, got {ms}"
        )))
    }
}

pub(crate) fn parse_call_id(s: &str) -> Result<CallId, CoreError> {
    Uuid::parse_str(s)
        .map(CallId)
        .map_err(|e| CoreError::InvalidTarget(format!("bad call id `{s}`: {e}")))
}

impl CallRecordIpc {
    pub fn from_core(r: CallRecord) -> Self {
        Self {
            id: r.id.0.to_string(),
            started_at_ms: r.started_at_ms,
            origin: r.origin.map(|o| CallOriginIpc {
                collection_id: o.collection_id.0.to_string(),
                request_id: o.request_id.0.to_string(),
            }),
            request: CallRequestIpc::from_core(r.request),
            elapsed_ms: saturate(r.elapsed_ms),
            outcome: CallOutcomeIpc::from_core(r.outcome),
        }
    }

    pub fn into_core(self) -> Result<CallRecord, CoreError> {
        Ok(CallRecord {
            id: parse_call_id(&self.id)?,
            started_at_ms: finite(self.started_at_ms, "started_at_ms")?,
            origin: self
                .origin
                .map(|o| {
                    Ok::<_, CoreError>(CallOrigin {
                        collection_id: parse_collection_id(&o.collection_id)?,
                        request_id: parse_item_id(&o.request_id)?,
                    })
                })
                .transpose()?,
            request: self.request.into_core(),
            elapsed_ms: u64::from(self.elapsed_ms),
            outcome: self.outcome.into_core()?,
        })
    }
}

impl CallRequestIpc {
    fn from_core(r: CallRequest) -> Self {
        Self {
            address_template: r.address_template,
            tls_override: r.tls_override,
            service: r.service,
            method: r.method,
            body_template: r.body_template,
            metadata: r
                .metadata
                .into_iter()
                .map(MetadataRowIpc::from_core)
                .collect(),
            auth: SavedAuthConfigIpc::from_core(r.auth),
        }
    }

    fn into_core(self) -> CallRequest {
        CallRequest {
            address_template: self.address_template,
            tls_override: self.tls_override,
            service: self.service,
            method: self.method,
            body_template: self.body_template,
            metadata: self
                .metadata
                .into_iter()
                .map(MetadataRowIpc::into_core)
                .collect(),
            auth: self.auth.into_core(),
        }
    }
}

impl CallOutcomeIpc {
    fn from_core(o: CallOutcome) -> Self {
        match o {
            CallOutcome::Unary { status, response } => Self::Unary {
                status: CallStatusIpc::from_core(status),
                response: RecordedBodyIpc::from_core(response),
            },
            CallOutcome::UnaryFault { fault } => Self::UnaryFault {
                fault: CallFaultIpc::from_core(fault),
            },
            CallOutcome::Stream {
                kind,
                headers,
                messages,
                omitted_messages,
                end,
            } => Self::Stream {
                kind: StreamKindIpc::from_core(kind),
                headers,
                messages: messages
                    .into_iter()
                    .map(RecordedMessageIpc::from_core)
                    .collect(),
                omitted_messages,
                end: StreamTerminationIpc::from_core(end),
            },
            CallOutcome::StreamRefused { kind, fault } => Self::StreamRefused {
                kind: StreamKindIpc::from_core(kind),
                fault: CallFaultIpc::from_core(fault),
            },
        }
    }

    fn into_core(self) -> Result<CallOutcome, CoreError> {
        Ok(match self {
            Self::Unary { status, response } => CallOutcome::Unary {
                status: status.into_core(),
                response: response.into_core(),
            },
            Self::UnaryFault { fault } => CallOutcome::UnaryFault {
                fault: fault.into_core(),
            },
            Self::Stream {
                kind,
                headers,
                messages,
                omitted_messages,
                end,
            } => CallOutcome::Stream {
                kind: kind.into_core(),
                headers,
                messages: messages
                    .into_iter()
                    .map(RecordedMessageIpc::into_core)
                    .collect::<Result<_, _>>()?,
                omitted_messages,
                end: end.into_core(),
            },
            Self::StreamRefused { kind, fault } => CallOutcome::StreamRefused {
                kind: kind.into_core(),
                fault: fault.into_core(),
            },
        })
    }
}

impl CallStatusIpc {
    fn from_core(s: CallStatus) -> Self {
        Self {
            code: s.code,
            message: s.message,
            trailers: s.trailers,
        }
    }

    fn into_core(self) -> CallStatus {
        CallStatus {
            code: self.code,
            message: self.message,
            trailers: self.trailers,
        }
    }
}

impl CallFaultIpc {
    fn from_core(f: CallFault) -> Self {
        Self {
            kind: f.kind,
            message: f.message,
        }
    }

    fn into_core(self) -> CallFault {
        CallFault {
            kind: self.kind,
            message: self.message,
        }
    }
}

impl StreamTerminationIpc {
    fn from_core(t: StreamTermination) -> Self {
        match t {
            StreamTermination::Status { status } => Self::Status {
                status: CallStatusIpc::from_core(status),
            },
            StreamTermination::Fault { fault } => Self::Fault {
                fault: CallFaultIpc::from_core(fault),
            },
            StreamTermination::Cancelled => Self::Cancelled,
        }
    }

    fn into_core(self) -> StreamTermination {
        match self {
            Self::Status { status } => StreamTermination::Status {
                status: status.into_core(),
            },
            Self::Fault { fault } => StreamTermination::Fault {
                fault: fault.into_core(),
            },
            Self::Cancelled => StreamTermination::Cancelled,
        }
    }
}

impl RecordedBodyIpc {
    fn from_core(b: RecordedBody) -> Self {
        match b {
            RecordedBody::Absent => Self::Absent,
            RecordedBody::Inline { json } => Self::Inline { json },
            RecordedBody::Omitted { size_bytes } => Self::Omitted {
                size_bytes: saturate(size_bytes),
            },
        }
    }

    fn into_core(self) -> RecordedBody {
        match self {
            Self::Absent => RecordedBody::Absent,
            Self::Inline { json } => RecordedBody::Inline { json },
            Self::Omitted { size_bytes } => RecordedBody::Omitted {
                size_bytes: u64::from(size_bytes),
            },
        }
    }
}

impl RecordedMessageIpc {
    fn from_core(m: RecordedMessage) -> Self {
        Self {
            direction: MessageDirectionIpc::from_core(m.direction),
            index: m.index,
            at_ms: m.at_ms,
            size_bytes: saturate(m.size_bytes),
            preview: m.preview,
            json: m.json,
        }
    }

    fn into_core(self) -> Result<RecordedMessage, CoreError> {
        Ok(RecordedMessage {
            direction: self.direction.into_core(),
            index: self.index,
            at_ms: finite(self.at_ms, "message at_ms")?,
            size_bytes: u64::from(self.size_bytes),
            preview: self.preview,
            json: self.json,
        })
    }
}

impl MessageDirectionIpc {
    fn from_core(d: MessageDirection) -> Self {
        match d {
            MessageDirection::In => Self::In,
            MessageDirection::Out => Self::Out,
        }
    }

    fn into_core(self) -> MessageDirection {
        match self {
            Self::In => MessageDirection::In,
            Self::Out => MessageDirection::Out,
        }
    }
}

impl StreamKindIpc {
    fn from_core(k: StreamKind) -> Self {
        match k {
            StreamKind::Server => Self::Server,
            StreamKind::Client => Self::Client,
            StreamKind::Bidi => Self::Bidi,
        }
    }

    fn into_core(self) -> StreamKind {
        match self {
            Self::Server => StreamKind::Server,
            Self::Client => StreamKind::Client,
            Self::Bidi => StreamKind::Bidi,
        }
    }
}

impl CallSummaryIpc {
    pub fn from_core(s: CallSummary) -> Self {
        let kind = match s.kind {
            CallKind::Unary => MethodKind::Unary,
            CallKind::Server => MethodKind::Server,
            CallKind::Client => MethodKind::Client,
            CallKind::Bidi => MethodKind::Bidi,
        };
        Self {
            id: s.id.0.to_string(),
            started_at_ms: s.started_at_ms,
            kind: MethodKindIpc::from_core(kind),
            service: s.service,
            method: s.method,
            address_template: s.address_template,
            elapsed_ms: saturate(s.elapsed_ms),
            ending: match s.ending {
                CallEnding::Status { code } => CallEndingIpc::Status { code },
                CallEnding::Fault { kind } => CallEndingIpc::Fault { kind },
                CallEnding::Cancelled => CallEndingIpc::Cancelled,
            },
        }
    }
}

impl HistoryPageIpc {
    pub fn from_core(p: HistoryPage) -> Self {
        Self {
            revision: p.revision,
            rows: p.rows.into_iter().map(CallSummaryIpc::from_core).collect(),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use handshaker_core::auth::SavedAuthConfig;
    use handshaker_core::collections::ids::{CollectionId, ItemId};
    use handshaker_core::collections::MetadataRow;

    pub(crate) fn record() -> CallRecord {
        CallRecord {
            id: CallId(Uuid::from_u128(1)),
            started_at_ms: 1_791_640_800_123.0,
            origin: Some(CallOrigin {
                collection_id: CollectionId(Uuid::from_u128(2)),
                request_id: ItemId(Uuid::from_u128(3)),
            }),
            request: CallRequest {
                address_template: "{{host}}:50051".into(),
                tls_override: Some(false),
                service: "echo.v1.Echo".into(),
                method: "Watch".into(),
                body_template: "{}".into(),
                metadata: vec![MetadataRow {
                    key: "x-debug".into(),
                    value: "1".into(),
                    enabled: false,
                }],
                auth: SavedAuthConfig::None,
            },
            elapsed_ms: 40,
            outcome: CallOutcome::Stream {
                kind: StreamKind::Server,
                headers: Some(BTreeMap::from([(
                    "content-type".into(),
                    "application/grpc".into(),
                )])),
                messages: vec![RecordedMessage {
                    direction: MessageDirection::In,
                    index: 1,
                    at_ms: 1_791_640_800_140.0,
                    size_bytes: 18,
                    preview: "{\"tick\":0}".into(),
                    json: Some("{\n  \"tick\": 0\n}".into()),
                }],
                omitted_messages: 3,
                end: StreamTermination::Fault {
                    fault: CallFault {
                        kind: "timeout".into(),
                        message: "late".into(),
                    },
                },
            },
        }
    }

    #[test]
    fn record_round_trips_core_ipc_core() {
        let original = record();
        assert_eq!(
            CallRecordIpc::from_core(original.clone())
                .into_core()
                .unwrap(),
            original
        );
    }

    #[test]
    fn record_ipc_json_has_the_tagged_shape_the_frontend_reads() {
        let json = serde_json::to_value(CallRecordIpc::from_core(record())).unwrap();
        assert_eq!(json["id"], "00000000-0000-0000-0000-000000000001");
        assert_eq!(
            json["origin"]["request_id"],
            "00000000-0000-0000-0000-000000000003"
        );
        assert_eq!(json["outcome"]["type"], "stream");
        assert_eq!(json["outcome"]["kind"], "server");
        assert_eq!(json["outcome"]["messages"][0]["direction"], "in");
        assert_eq!(
            json["outcome"]["end"],
            serde_json::json!({ "type": "fault", "fault": { "kind": "timeout", "message": "late" } })
        );
    }

    #[test]
    fn bad_call_id_is_invalid_target() {
        let ipc = CallRecordIpc {
            id: "nope".into(),
            ..CallRecordIpc::from_core(record())
        };
        assert!(
            matches!(ipc.into_core(), Err(CoreError::InvalidTarget(m)) if m.contains("call id"))
        );
    }

    #[test]
    fn bad_origin_id_is_invalid_target() {
        let mut ipc = CallRecordIpc::from_core(record());
        ipc.origin = Some(CallOriginIpc {
            collection_id: "c".into(),
            request_id: Uuid::from_u128(3).to_string(),
        });
        assert!(
            matches!(ipc.into_core(), Err(CoreError::InvalidTarget(m)) if m.contains("collection id"))
        );
    }

    #[test]
    fn non_finite_started_at_is_rejected() {
        let ipc = CallRecordIpc {
            started_at_ms: f64::NAN,
            ..CallRecordIpc::from_core(record())
        };
        assert!(
            matches!(ipc.into_core(), Err(CoreError::InvalidTarget(m)) if m.contains("started_at_ms"))
        );
    }

    #[test]
    fn non_finite_message_time_is_rejected() {
        let mut ipc = CallRecordIpc::from_core(record());
        if let CallOutcomeIpc::Stream { messages, .. } = &mut ipc.outcome {
            messages[0].at_ms = f64::INFINITY;
        }
        assert!(matches!(ipc.into_core(), Err(CoreError::InvalidTarget(m)) if m.contains("at_ms")));
    }

    #[test]
    fn elapsed_saturates_to_u32() {
        let ipc = CallRecordIpc::from_core(CallRecord {
            elapsed_ms: u64::MAX,
            ..record()
        });
        assert_eq!(ipc.elapsed_ms, u32::MAX);
    }

    #[test]
    fn summary_projects_kind_and_ending() {
        let summary = CallSummaryIpc::from_core(record().summary());
        assert!(matches!(summary.kind, MethodKindIpc::Server));
        assert!(matches!(summary.ending, CallEndingIpc::Fault { ref kind } if kind == "timeout"));
        assert_eq!(summary.elapsed_ms, 40);
    }
}
