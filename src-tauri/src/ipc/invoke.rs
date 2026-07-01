//! IPC wrapper types for unary invoke. handshaker-core stays specta-free —
//! `specta::Type` derive only here.

use handshaker_core::grpc::{
    FieldViolation as CoreFieldViolation, HelpLink as CoreHelpLink,
    PreconditionViolation as CorePreconditionViolation, QuotaViolation as CoreQuotaViolation,
    StatusDetail, UnaryOutcome,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Type)]
pub struct InvokeRequest {
    pub service: String,
    pub method: String,
    pub request_json: String,
    pub metadata: HashMap<String, String>,
}

/// Per-call invoke options, as they cross the wire. `request_id` is NOT here — it's a
/// separate `grpc_invoke_oneshot` param (cancel key, distinct lifecycle from call options).
#[derive(Debug, Deserialize, Type)]
pub struct CallOptionsIpc {
    pub timeout_ms: u32,
    pub max_message_bytes: u32,
}

#[derive(Debug, Serialize, Type)]
pub struct FieldViolationIpc {
    pub field: String,
    pub description: String,
}

#[derive(Debug, Serialize, Type)]
pub struct QuotaViolationIpc {
    pub subject: String,
    pub description: String,
}

#[derive(Debug, Serialize, Type)]
pub struct PreconditionViolationIpc {
    pub kind: String,
    pub subject: String,
    pub description: String,
}

#[derive(Debug, Serialize, Type)]
pub struct HelpLinkIpc {
    pub description: String,
    pub url: String,
}

/// Tagged-union mirror of `StatusDetail` (discriminator "type"), as the frontend narrows.
#[derive(Debug, Serialize, Type)]
#[serde(tag = "type")]
pub enum StatusDetailIpc {
    ErrorInfo {
        reason: String,
        domain: String,
        metadata: std::collections::BTreeMap<String, String>,
    },
    BadRequest {
        violations: Vec<FieldViolationIpc>,
    },
    RetryInfo {
        retry_delay_ms: Option<u32>,
    },
    QuotaFailure {
        violations: Vec<QuotaViolationIpc>,
    },
    PreconditionFailure {
        violations: Vec<PreconditionViolationIpc>,
    },
    DebugInfo {
        stack_entries: Vec<String>,
        detail: String,
    },
    RequestInfo {
        request_id: String,
        serving_data: String,
    },
    ResourceInfo {
        resource_type: String,
        resource_name: String,
        owner: String,
        description: String,
    },
    Help {
        links: Vec<HelpLinkIpc>,
    },
    LocalizedMessage {
        locale: String,
        message: String,
    },
}

impl From<CoreFieldViolation> for FieldViolationIpc {
    fn from(v: CoreFieldViolation) -> Self {
        Self { field: v.field, description: v.description }
    }
}
impl From<CoreQuotaViolation> for QuotaViolationIpc {
    fn from(v: CoreQuotaViolation) -> Self {
        Self { subject: v.subject, description: v.description }
    }
}
impl From<CorePreconditionViolation> for PreconditionViolationIpc {
    fn from(v: CorePreconditionViolation) -> Self {
        Self { kind: v.kind, subject: v.subject, description: v.description }
    }
}
impl From<CoreHelpLink> for HelpLinkIpc {
    fn from(l: CoreHelpLink) -> Self {
        Self { description: l.description, url: l.url }
    }
}

impl From<StatusDetail> for StatusDetailIpc {
    fn from(d: StatusDetail) -> Self {
        match d {
            StatusDetail::ErrorInfo { reason, domain, metadata } => StatusDetailIpc::ErrorInfo {
                reason,
                domain,
                metadata: metadata.into_iter().collect(),
            },
            StatusDetail::BadRequest { violations } => StatusDetailIpc::BadRequest {
                violations: violations.into_iter().map(Into::into).collect(),
            },
            StatusDetail::RetryInfo { retry_delay_ms } => StatusDetailIpc::RetryInfo {
                retry_delay_ms: retry_delay_ms.map(|ms| ms.min(u64::from(u32::MAX)) as u32),
            },
            StatusDetail::QuotaFailure { violations } => StatusDetailIpc::QuotaFailure {
                violations: violations.into_iter().map(Into::into).collect(),
            },
            StatusDetail::PreconditionFailure { violations } => {
                StatusDetailIpc::PreconditionFailure {
                    violations: violations.into_iter().map(Into::into).collect(),
                }
            }
            StatusDetail::DebugInfo { stack_entries, detail } => {
                StatusDetailIpc::DebugInfo { stack_entries, detail }
            }
            StatusDetail::RequestInfo { request_id, serving_data } => {
                StatusDetailIpc::RequestInfo { request_id, serving_data }
            }
            StatusDetail::ResourceInfo { resource_type, resource_name, owner, description } => {
                StatusDetailIpc::ResourceInfo { resource_type, resource_name, owner, description }
            }
            StatusDetail::Help { links } => StatusDetailIpc::Help {
                links: links.into_iter().map(Into::into).collect(),
            },
            StatusDetail::LocalizedMessage { locale, message } => {
                StatusDetailIpc::LocalizedMessage { locale, message }
            }
        }
    }
}

#[derive(Debug, Serialize, Type)]
pub struct InvokeOutcomeIpc {
    pub status_code: i32,
    pub status_message: String,
    pub response_json: Option<String>,
    pub trailing_metadata: HashMap<String, String>,
    pub status_details: Vec<StatusDetailIpc>,
    /// Elapsed time in milliseconds. Capped at u32::MAX (~49 days) for
    /// TypeScript compatibility (specta forbids u64 / BigInt at the IPC boundary).
    pub elapsed_ms: u32,
}

impl From<UnaryOutcome> for InvokeOutcomeIpc {
    fn from(o: UnaryOutcome) -> Self {
        Self {
            status_code: o.status_code,
            status_message: o.status_message,
            response_json: o.response_json,
            trailing_metadata: o.trailing_metadata,
            status_details: o.status_details.into_iter().map(Into::into).collect(),
            elapsed_ms: o.elapsed_ms.min(u64::from(u32::MAX)) as u32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use handshaker_core::grpc::{FieldViolation, StatusDetail};

    #[test]
    fn maps_error_info_detail_to_tagged_ipc() {
        let d = StatusDetail::ErrorInfo {
            reason: "STOCKOUT".into(),
            domain: "shop".into(),
            metadata: std::collections::BTreeMap::from([("sku".into(), "X1".into())]),
        };
        let ipc: StatusDetailIpc = d.into();
        let json = serde_json::to_string(&ipc).unwrap();
        assert!(json.contains(r#""type":"ErrorInfo""#), "{json}");
        assert!(json.contains(r#""reason":"STOCKOUT""#), "{json}");
    }

    #[test]
    fn maps_bad_request_violations() {
        let d = StatusDetail::BadRequest {
            violations: vec![FieldViolation { field: "qty".into(), description: "> 0".into() }],
        };
        let ipc: StatusDetailIpc = d.into();
        match ipc {
            StatusDetailIpc::BadRequest { violations } => {
                assert_eq!(violations[0].field, "qty");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn outcome_carries_status_details() {
        let outcome = handshaker_core::grpc::UnaryOutcome {
            status_code: 9,
            status_message: "FAILED_PRECONDITION: x".into(),
            response_json: None,
            trailing_metadata: std::collections::HashMap::new(),
            status_details: vec![StatusDetail::RetryInfo { retry_delay_ms: Some(2000) }],
            elapsed_ms: 1,
        };
        let ipc: InvokeOutcomeIpc = outcome.into();
        assert_eq!(ipc.status_details.len(), 1);
    }
}
