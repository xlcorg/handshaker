pub mod file_store;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::collections::{CollectionId, GrpcTemplate, HttpTemplate, ItemId, RequestTemplate};
use crate::http::{HttpMethod, HttpResponse};

pub use file_store::{FileHistoryStore, HistoryPage};

/// Records kept on disk: the newest by `started_at_ms`.
pub const HISTORY_CAP: usize = 200;
/// Message rows kept per stream record (the newest); older rows count in `omitted_messages`.
pub const MAX_MESSAGE_ROWS: usize = 200;
/// UTF-8 bytes of inline response JSON one record may keep (unary body or stream messages).
pub const INLINE_JSON_BUDGET: usize = 256 * 1024;
/// Serialized size of one record file. A record still over it after trimming is refused.
pub const MAX_RECORD_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CallId(pub Uuid);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "CallRecordIn", into = "CallRecordOut")]
pub struct CallRecord {
    pub id: CallId,
    /// Epoch ms when the attempt began (unary Send start, stream Open start).
    pub started_at_ms: f64,
    /// The saved request the draft was bound to at call start. `None` is an unbound draft.
    pub origin: Option<CallOrigin>,
    pub elapsed_ms: u64,
    pub call: RecordedCall,
}

/// The request, exactly as it loads back into the draft, paired with an outcome of the
/// same protocol.
#[derive(Debug, Clone, PartialEq)]
pub enum RecordedCall {
    Grpc { request: GrpcTemplate, outcome: CallOutcome },
    Http { request: HttpTemplate, outcome: HttpOutcome },
}

/// The v1 record layout is kept on disk: `request` and `outcome` sit at the top level.
/// The request's `protocol` (absent means gRPC, via `RequestTemplate`) decides how
/// `outcome` parses, so every existing record file loads unchanged.
#[derive(Deserialize)]
struct CallRecordIn {
    id: CallId,
    started_at_ms: f64,
    origin: Option<CallOrigin>,
    request: RequestTemplate,
    elapsed_ms: u64,
    outcome: serde_json::Value,
}

#[derive(Serialize)]
struct CallRecordOut {
    id: CallId,
    started_at_ms: f64,
    origin: Option<CallOrigin>,
    request: RequestTemplate,
    elapsed_ms: u64,
    outcome: OutcomeOut,
}

#[derive(Serialize)]
#[serde(untagged)]
enum OutcomeOut {
    Grpc(CallOutcome),
    Http(HttpOutcome),
}

impl TryFrom<CallRecordIn> for CallRecord {
    type Error = serde_json::Error;

    fn try_from(w: CallRecordIn) -> Result<Self, Self::Error> {
        let call = match w.request {
            RequestTemplate::Grpc(request) => RecordedCall::Grpc {
                request,
                outcome: serde_json::from_value(w.outcome)?,
            },
            RequestTemplate::Http(request) => RecordedCall::Http {
                request,
                outcome: serde_json::from_value(w.outcome)?,
            },
        };
        Ok(CallRecord {
            id: w.id,
            started_at_ms: w.started_at_ms,
            origin: w.origin,
            elapsed_ms: w.elapsed_ms,
            call,
        })
    }
}

impl From<CallRecord> for CallRecordOut {
    fn from(r: CallRecord) -> Self {
        let (request, outcome) = match r.call {
            RecordedCall::Grpc { request, outcome } => {
                (RequestTemplate::Grpc(request), OutcomeOut::Grpc(outcome))
            }
            RecordedCall::Http { request, outcome } => {
                (RequestTemplate::Http(request), OutcomeOut::Http(outcome))
            }
        };
        CallRecordOut {
            id: r.id,
            started_at_ms: r.started_at_ms,
            origin: r.origin,
            request,
            elapsed_ms: r.elapsed_ms,
            outcome,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallOrigin {
    pub collection_id: CollectionId,
    pub request_id: ItemId,
}

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

/// The HTTP counterpart of `CallOutcome`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HttpOutcome {
    /// Any status, 4xx and 5xx included. `fit_budget` may turn the body into `Omitted`.
    Response { response: HttpResponse },
    /// No response: refused, DNS, TLS, timeout, URL problem, unresolved vars.
    Fault { fault: CallFault },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallStatus {
    pub code: i32,
    pub message: String,
    pub trailers: BTreeMap<String, String>,
}

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

/// The dock row. An index written before `protocol` existed fails to parse, and
/// `FileHistoryStore::load` rebuilds it from the record bodies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CallSummary {
    pub id: CallId,
    pub started_at_ms: f64,
    pub elapsed_ms: u64,
    #[serde(flatten)]
    pub line: SummaryLine,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "protocol", rename_all = "lowercase")]
pub enum SummaryLine {
    Grpc {
        kind: CallKind,
        service: String,
        method: String,
        address_template: String,
        ending: CallEnding,
    },
    Http {
        method: HttpMethod,
        url_template: String,
        ending: HttpEnding,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CallEnding {
    Status { code: i32 },
    Fault { kind: String },
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HttpEnding {
    Status { code: u16 },
    Fault { kind: String },
}

impl CallRecord {
    pub fn summary(&self) -> CallSummary {
        let line = match &self.call {
            RecordedCall::Grpc { request, outcome } => SummaryLine::Grpc {
                kind: outcome.kind(),
                service: request.service.clone(),
                method: request.method.clone(),
                address_template: request.address_template.clone(),
                ending: outcome.ending(),
            },
            RecordedCall::Http { request, outcome } => SummaryLine::Http {
                method: request.method,
                url_template: request.url_template.clone(),
                ending: outcome.ending(),
            },
        };
        CallSummary {
            id: self.id,
            started_at_ms: self.started_at_ms,
            elapsed_ms: self.elapsed_ms,
            line,
        }
    }
}

impl CallOutcome {
    fn kind(&self) -> CallKind {
        match self {
            CallOutcome::Unary { .. } | CallOutcome::UnaryFault { .. } => CallKind::Unary,
            CallOutcome::Stream { kind, .. } | CallOutcome::StreamRefused { kind, .. } => {
                (*kind).into()
            }
        }
    }

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

impl HttpOutcome {
    fn ending(&self) -> HttpEnding {
        match self {
            HttpOutcome::Response { response } => HttpEnding::Status {
                code: response.status,
            },
            HttpOutcome::Fault { fault } => HttpEnding::Fault {
                kind: fault.kind.clone(),
            },
        }
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;
    use crate::auth::SavedAuthConfig;
    use crate::collections::MetadataRow;
    use crate::http::{HttpBody, ResponseBody};

    pub fn request(body: &str) -> GrpcTemplate {
        GrpcTemplate {
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

    pub fn grpc(n: u128, started_at_ms: f64, outcome: CallOutcome) -> CallRecord {
        CallRecord {
            id: CallId(Uuid::from_u128(n)),
            started_at_ms,
            origin: None,
            elapsed_ms: 12,
            call: RecordedCall::Grpc {
                request: request("{\"text\":\"hi\"}"),
                outcome,
            },
        }
    }

    pub fn unary(n: u128, started_at_ms: f64, response: RecordedBody) -> CallRecord {
        grpc(
            n,
            started_at_ms,
            CallOutcome::Unary {
                status: status(0),
                response,
            },
        )
    }

    pub fn http_request() -> HttpTemplate {
        HttpTemplate {
            method: HttpMethod::Get,
            url_template: "{{base}}/users".into(),
            query: vec![MetadataRow {
                key: "page".into(),
                value: "2".into(),
                enabled: true,
            }],
            headers: vec![],
            body: HttpBody::None,
            auth: SavedAuthConfig::None,
        }
    }

    pub fn http_response(status: u16, reason: &str, body: ResponseBody) -> HttpResponse {
        HttpResponse {
            status,
            reason: reason.into(),
            headers: vec![],
            body,
            size_bytes: 2,
            elapsed_ms: 9,
        }
    }

    pub fn http(n: u128, started_at_ms: f64, outcome: HttpOutcome) -> CallRecord {
        CallRecord {
            id: CallId(Uuid::from_u128(n)),
            started_at_ms,
            origin: None,
            elapsed_ms: 12,
            call: RecordedCall::Http {
                request: http_request(),
                outcome,
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
        grpc(
            n,
            started_at_ms,
            CallOutcome::Stream {
                kind: StreamKind::Server,
                headers: None,
                messages,
                omitted_messages: 0,
                end: StreamTermination::Status { status: status(0) },
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;
    use crate::http::ResponseBody;

    fn fault(kind: &str) -> CallFault {
        CallFault {
            kind: kind.into(),
            message: "boom".into(),
        }
    }

    fn ending_of(outcome: CallOutcome) -> (CallKind, CallEnding) {
        match grpc(1, 1.0, outcome).summary().line {
            SummaryLine::Grpc { kind, ending, .. } => (kind, ending),
            other => panic!("expected a gRPC line, got {other:?}"),
        }
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
        assert_eq!(
            record.summary(),
            CallSummary {
                id: CallId(Uuid::from_u128(7)),
                started_at_ms: 1_791_640_800_123.0,
                elapsed_ms: 12,
                line: SummaryLine::Grpc {
                    kind: CallKind::Unary,
                    service: "echo.v1.Echo".into(),
                    method: "Say".into(),
                    address_template: "{{host}}:50051".into(),
                    ending: CallEnding::Status { code: 0 },
                },
            }
        );
    }

    #[test]
    fn summary_index_row_carries_the_protocol_beside_the_shared_columns() {
        let json = serde_json::to_value(unary(7, 3.0, RecordedBody::Absent).summary()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "id": "00000000-0000-0000-0000-000000000007",
                "started_at_ms": 3.0,
                "elapsed_ms": 12,
                "protocol": "grpc",
                "kind": "unary",
                "service": "echo.v1.Echo",
                "method": "Say",
                "address_template": "{{host}}:50051",
                "ending": { "type": "status", "code": 0 },
            })
        );
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
        assert_eq!(json["request"]["protocol"], "grpc");
    }

    #[test]
    fn http_record_keeps_the_v1_layout_and_reads_back() {
        let record = http(
            3,
            4.0,
            HttpOutcome::Response {
                response: http_response(404, "Not Found", ResponseBody::Text { text: "no".into() }),
            },
        );

        let json = serde_json::to_value(&record).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "id": "00000000-0000-0000-0000-000000000003",
                "started_at_ms": 4.0,
                "origin": null,
                "request": {
                    "protocol": "http",
                    "method": "GET",
                    "url_template": "{{base}}/users",
                    "query": [{ "key": "page", "value": "2", "enabled": true }],
                    "headers": [],
                    "body": { "kind": "none" },
                    "auth": { "kind": "none" },
                },
                "elapsed_ms": 12,
                "outcome": {
                    "type": "response",
                    "response": {
                        "status": 404, "reason": "Not Found", "headers": [],
                        "body": { "type": "text", "text": "no" },
                        "size_bytes": 2, "elapsed_ms": 9,
                    },
                },
            })
        );
        assert_eq!(serde_json::from_value::<CallRecord>(json).unwrap(), record);
    }

    #[test]
    fn http_summary_line_carries_method_url_and_ending() {
        let response = http(
            3,
            4.0,
            HttpOutcome::Response {
                response: http_response(503, "Service Unavailable", ResponseBody::Empty),
            },
        );
        let fault = http(
            4,
            5.0,
            HttpOutcome::Fault {
                fault: fault("dns"),
            },
        );

        assert_eq!(
            response.summary(),
            CallSummary {
                id: CallId(Uuid::from_u128(3)),
                started_at_ms: 4.0,
                elapsed_ms: 12,
                line: SummaryLine::Http {
                    method: HttpMethod::Get,
                    url_template: "{{base}}/users".into(),
                    ending: HttpEnding::Status { code: 503 },
                },
            }
        );
        assert_eq!(
            serde_json::to_value(fault.summary()).unwrap(),
            serde_json::json!({
                "id": "00000000-0000-0000-0000-000000000004",
                "started_at_ms": 5.0,
                "elapsed_ms": 12,
                "protocol": "http",
                "method": "GET",
                "url_template": "{{base}}/users",
                "ending": { "type": "fault", "kind": "dns" },
            })
        );
    }

    #[test]
    fn v1_record_body_loads_unchanged() {
        let legacy = r#"{
            "id": "00000000-0000-0000-0000-000000000001", "started_at_ms": 2.0, "origin": null,
            "request": {
                "address_template": "{{host}}:50051", "tls_override": null,
                "service": "echo.v1.Echo", "method": "Say", "body_template": "{\"text\":\"hi\"}",
                "metadata": [
                    { "key": "x-trace", "value": "{{$uuid}}", "enabled": true },
                    { "key": "x-debug", "value": "1", "enabled": false }
                ],
                "auth": { "kind": "none" }
            },
            "elapsed_ms": 12,
            "outcome": { "type": "unary", "status": { "code": 0, "message": "", "trailers": {} },
                         "response": { "type": "omitted", "size_bytes": 9 } }
        }"#;

        let record: CallRecord = serde_json::from_str(legacy).unwrap();

        assert_eq!(record, unary(1, 2.0, RecordedBody::Omitted { size_bytes: 9 }));
    }
}
