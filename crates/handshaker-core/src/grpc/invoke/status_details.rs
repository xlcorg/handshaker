//! Decode a `tonic::Status`'s `grpc-status-details-bin` payload (google.rpc richer
//! error model) into a serde-free, UI-friendly DTO. The wire decode is done by
//! `tonic-types`; this module maps its typed structs onto our own shapes so the IPC
//! layer (specta) and the frontend never depend on `tonic-types` directly.

use std::collections::BTreeMap;
use tonic_types::{ErrorDetail, StatusExt};

#[derive(Debug, Clone, PartialEq)]
pub struct FieldViolation {
    pub field: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuotaViolation {
    pub subject: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreconditionViolation {
    pub kind: String,
    pub subject: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HelpLink {
    pub description: String,
    pub url: String,
}

/// One decoded `google.rpc` standard error-detail message. Only the fields a debugging
/// UI needs are kept (the crate carries a few extras we deliberately drop).
#[derive(Debug, Clone, PartialEq)]
pub enum StatusDetail {
    ErrorInfo {
        reason: String,
        domain: String,
        metadata: BTreeMap<String, String>,
    },
    BadRequest {
        violations: Vec<FieldViolation>,
    },
    RetryInfo {
        retry_delay_ms: Option<u64>,
    },
    QuotaFailure {
        violations: Vec<QuotaViolation>,
    },
    PreconditionFailure {
        violations: Vec<PreconditionViolation>,
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
        links: Vec<HelpLink>,
    },
    LocalizedMessage {
        locale: String,
        message: String,
    },
}

/// Extract every standard `google.rpc` detail from a non-OK `tonic::Status`. Returns an
/// empty Vec when the status carries no `grpc-status-details-bin` trailer. Non-standard
/// (custom) `Any` details are not decoded (rare; would require google.rpc descriptors).
pub fn extract_status_details(status: &tonic::Status) -> Vec<StatusDetail> {
    status
        .get_error_details_vec()
        .into_iter()
        .filter_map(map_detail_opt)
        .collect()
}

// `ErrorDetail` is `#[non_exhaustive]`, so the match needs a catch-all. Returning `None`
// for any future/unknown variant lets us decode the 10 standard google.rpc messages and
// silently skip anything tonic-types adds later.
fn map_detail_opt(d: ErrorDetail) -> Option<StatusDetail> {
    let mapped = match d {
        ErrorDetail::ErrorInfo(i) => StatusDetail::ErrorInfo {
            reason: i.reason,
            domain: i.domain,
            metadata: i.metadata.into_iter().collect(),
        },
        ErrorDetail::BadRequest(b) => StatusDetail::BadRequest {
            violations: b
                .field_violations
                .into_iter()
                .map(|v| FieldViolation { field: v.field, description: v.description })
                .collect(),
        },
        ErrorDetail::RetryInfo(r) => StatusDetail::RetryInfo {
            retry_delay_ms: r.retry_delay.map(|d| d.as_millis() as u64),
        },
        ErrorDetail::QuotaFailure(q) => StatusDetail::QuotaFailure {
            violations: q
                .violations
                .into_iter()
                .map(|v| QuotaViolation { subject: v.subject, description: v.description })
                .collect(),
        },
        ErrorDetail::PreconditionFailure(p) => StatusDetail::PreconditionFailure {
            violations: p
                .violations
                .into_iter()
                .map(|v| PreconditionViolation {
                    kind: v.r#type,
                    subject: v.subject,
                    description: v.description,
                })
                .collect(),
        },
        ErrorDetail::DebugInfo(d) => StatusDetail::DebugInfo {
            stack_entries: d.stack_entries,
            detail: d.detail,
        },
        ErrorDetail::RequestInfo(r) => StatusDetail::RequestInfo {
            request_id: r.request_id,
            serving_data: r.serving_data,
        },
        ErrorDetail::ResourceInfo(r) => StatusDetail::ResourceInfo {
            resource_type: r.resource_type,
            resource_name: r.resource_name,
            owner: r.owner,
            description: r.description,
        },
        ErrorDetail::Help(h) => StatusDetail::Help {
            links: h
                .links
                .into_iter()
                .map(|l| HelpLink { description: l.description, url: l.url })
                .collect(),
        },
        ErrorDetail::LocalizedMessage(m) => StatusDetail::LocalizedMessage {
            locale: m.locale,
            message: m.message,
        },
        _ => return None,
    };
    Some(mapped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::time::Duration;
    use tonic_types::{BadRequest, ErrorInfo, RetryInfo};

    #[test]
    fn extracts_error_info_bad_request_and_retry_info() {
        let status = tonic::Status::with_error_details_vec(
            tonic::Code::FailedPrecondition,
            "nope",
            vec![
                ErrorDetail::ErrorInfo(ErrorInfo::new(
                    "STOCKOUT",
                    "shop.example",
                    HashMap::from([("sku".to_string(), "X1".to_string())]),
                )),
                ErrorDetail::BadRequest(BadRequest::with_violation("qty", "must be > 0")),
                ErrorDetail::RetryInfo(RetryInfo::new(Some(Duration::from_secs(2)))),
            ],
        );

        let details = extract_status_details(&status);
        assert_eq!(details.len(), 3);
        assert_eq!(
            details[0],
            StatusDetail::ErrorInfo {
                reason: "STOCKOUT".into(),
                domain: "shop.example".into(),
                metadata: BTreeMap::from([("sku".to_string(), "X1".to_string())]),
            }
        );
        assert!(matches!(
            &details[1],
            StatusDetail::BadRequest { violations } if violations[0].field == "qty"
        ));
        assert_eq!(details[2], StatusDetail::RetryInfo { retry_delay_ms: Some(2000) });
    }

    #[test]
    fn status_without_details_extracts_empty() {
        let status = tonic::Status::new(tonic::Code::NotFound, "missing");
        assert!(extract_status_details(&status).is_empty());
    }
}
