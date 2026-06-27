# gRPC Error Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface gRPC servers' structured error details (`grpc-status-details-bin` / `google.rpc` richer error model) in the response view, and replace the fragile regex-on-message client/transport-error classification with a structured one driven from the Rust core.

**Architecture:** Two independent tracks meeting at the response layer. **① Server-error details:** decode the `tonic::Status` details via `tonic-types` in core → new `status_details` field on `UnaryOutcome`/`InvokeOutcomeIpc` → typed per-type render in a new `StatusDetails.tsx` inside `ErrorView`. **② Client/transport error:** `cancel`/`timeout` become dedicated `IpcError` variants and connect failures carry a `kind` classified in Rust; the frontend narrows on the structured error (no regex).

**Tech Stack:** Rust (`handshaker-core`, `src-tauri`), `tonic 0.14` + new `tonic-types 0.14`, `prost`, `tauri-specta` bindings; React 18 + TypeScript + Vitest.

---

## Spec

`docs/superpowers/specs/2026-06-26-grpc-error-handling-design.md` (committed `dc6e4b6`).

## Prerequisites (read once before Task 1)

- This is a worktree. If `dist/` is missing or `node_modules` is stale, run `pnpm install` then `pnpm build` once — `src-tauri` (and thus the `export-bindings` binary) won't compile without `dist/` because `generate_context!` needs it. See `CLAUDE.md` → Build / test.
- Run all Rust commands from the repo root.
- Bindings regen command (used in Tasks 3 and 7):
  `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
- `src/ipc/bindings.ts` is **git-tracked** — commit its regenerated diff alongside the IPC change.

## Verified facts (tonic-types 0.14.2 — already confirmed against tagged source)

- Extraction (client side): `tonic_types::StatusExt::get_error_details_vec(&self) -> Vec<ErrorDetail>`.
- Construction (server side, for tests): `tonic::Status::with_error_details_vec(code: Code, message: impl Into<String>, details: impl IntoIterator<Item = ErrorDetail>) -> Status` (a `StatusExt` associated fn).
- `ErrorDetail` enum variants (each tuple-wraps the struct): `ErrorInfo`, `BadRequest`, `RetryInfo`, `QuotaFailure`, `PreconditionFailure`, `DebugInfo`, `RequestInfo`, `ResourceInfo`, `Help`, `LocalizedMessage`.
- Struct fields:
  - `ErrorInfo { reason: String, domain: String, metadata: HashMap<String,String> }` — `ErrorInfo::new(reason: impl Into<String>, domain: impl Into<String>, metadata: impl Into<HashMap<String,String>>)`.
  - `BadRequest { field_violations: Vec<FieldViolation> }`; `FieldViolation { field, description, reason, localized_message }` — `BadRequest::with_violation(field: impl Into<String>, description: impl Into<String>)`.
  - `RetryInfo { retry_delay: Option<std::time::Duration> }` — `RetryInfo::new(Option<std::time::Duration>)`.
  - `QuotaFailure { violations: Vec<QuotaViolation> }`; `QuotaViolation { subject, description, .. }`.
  - `PreconditionFailure { violations: Vec<PreconditionViolation> }`; `PreconditionViolation { r#type, subject, description }`.
  - `DebugInfo { stack_entries: Vec<String>, detail: String }`.
  - `RequestInfo { request_id: String, serving_data: String }`.
  - `ResourceInfo { resource_type, resource_name, owner, description }`.
  - `Help { links: Vec<HelpLink> }`; `HelpLink { description, url }`.
  - `LocalizedMessage { locale: String, message: String }`.

---

# TRACK ① — Structured server-error details

## Task 1: core — `StatusDetail` DTO + `extract_status_details`

**Files:**
- Modify: `Cargo.toml` (workspace deps) + `crates/handshaker-core/Cargo.toml`
- Create: `crates/handshaker-core/src/grpc/invoke/status_details.rs`
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs` (add `mod status_details;` + re-export)
- Modify: `crates/handshaker-core/src/grpc/mod.rs` (surface the new names at `grpc::`)

- [ ] **Step 1: Add the `tonic-types` dependency**

In `Cargo.toml` (workspace `[workspace.dependencies]`, next to the other tonic crates around lines 26-28) add:

```toml
tonic-types = "0.14"
```

In `crates/handshaker-core/Cargo.toml` (next to `tonic.workspace = true`, ~line 23) add:

```toml
tonic-types.workspace = true
```

- [ ] **Step 2: Write the failing test (create the module with tests first)**

Create `crates/handshaker-core/src/grpc/invoke/status_details.rs`:

```rust
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
        .map(map_detail)
        .collect()
}

fn map_detail(d: ErrorDetail) -> StatusDetail {
    match d {
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
    }
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
```

In `crates/handshaker-core/src/grpc/invoke/mod.rs`, register the module next to the other `mod`/`pub mod` lines (~lines 13-16):

```rust
mod status_details;
pub use status_details::{
    extract_status_details, FieldViolation, HelpLink, PreconditionViolation, QuotaViolation,
    StatusDetail,
};
```

Then in `crates/handshaker-core/src/grpc/mod.rs`, extend the existing `pub use invoke::{...}` block (lines 25-29) so the new names are reachable as `handshaker_core::grpc::StatusDetail` etc. (the path the IPC layer and its tests import). Add to that brace list:

```rust
pub use invoke::{
    build_message_schema_from_pool, build_request_skeleton, build_request_skeleton_from_pool,
    extract_status_details, invoke_unary, EnumNode, EnumValueNode, FieldNode, FieldValueKind,
    FieldViolation, HelpLink, MessageNode, MessageSchema, MessageSide, PreconditionViolation,
    QuotaViolation, StatusDetail, UnaryOutcome,
};
```

- [ ] **Step 3: Run the test to verify it fails (compile error / undefined)**

Run: `cargo test -p handshaker-core status_details`
Expected: FAIL — first a compile error until `tonic-types` resolves, then the two tests compile and pass once the code above is in place. If `match d` reports "non-exhaustive" (a future `#[non_exhaustive]` `ErrorDetail`), add a trailing arm `_ => return` by switching `.map(map_detail)` to `.filter_map(map_detail_opt)` returning `Option`; otherwise leave as-is.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p handshaker-core status_details`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock crates/handshaker-core/Cargo.toml crates/handshaker-core/src/grpc/invoke/status_details.rs crates/handshaker-core/src/grpc/invoke/mod.rs crates/handshaker-core/src/grpc/mod.rs
git commit -m "feat(grpc): decode google.rpc status details via tonic-types"
```

---

## Task 2: core — add `status_details` to `UnaryOutcome` and wire the transport

**Files:**
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs` (struct `UnaryOutcome`, ~lines 30-37; test fixture ~line 309)
- Modify: `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` (both branches, ~lines 76-91)

- [ ] **Step 1: Add the field to `UnaryOutcome`**

In `crates/handshaker-core/src/grpc/invoke/mod.rs`, add the field to the struct (after `trailing_metadata`):

```rust
#[derive(Debug, Clone)]
pub struct UnaryOutcome {
    pub status_code: i32,
    pub status_message: String,
    pub response_json: Option<String>,
    pub trailing_metadata: HashMap<String, String>,
    /// Decoded google.rpc structured error details (empty on success / when none).
    pub status_details: Vec<StatusDetail>,
    pub elapsed_ms: u64,
}
```

- [ ] **Step 2: Wire the transport (both branches)**

In `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`, add `use crate::grpc::invoke::extract_status_details;` near the other `use` lines, then:

Success branch (~line 76) — add `status_details: Vec::new(),`:

```rust
Ok(UnaryOutcome {
    status_code: 0,
    status_message: "OK".into(),
    response_json: Some(json),
    trailing_metadata: trailing,
    status_details: Vec::new(),
    elapsed_ms,
})
```

Error branch (~line 84) — decode from the status:

```rust
Err(status) => Ok(UnaryOutcome {
    status_code: status.code() as i32,
    status_message: format!("{}: {}", status.code(), status.message()),
    response_json: None,
    trailing_metadata: metadata_to_map(status.metadata()),
    status_details: extract_status_details(&status),
    elapsed_ms,
}),
```

- [ ] **Step 3: Fix the unit-test fixture and add a pass-through assertion**

In `crates/handshaker-core/src/grpc/invoke/mod.rs`, the `happy_path_passes_path_and_metadata_to_transport` test builds a literal `UnaryOutcome` (~line 309). Add the field to the literal and assert it survives:

```rust
let canned = UnaryOutcome {
    status_code: 0,
    status_message: "OK".into(),
    response_json: Some(r#"{"id":"echo"}"#.into()),
    trailing_metadata: HashMap::new(),
    status_details: Vec::new(),
    elapsed_ms: 42,
};
```

After the existing assertions in that test, add:

```rust
assert!(outcome.status_details.is_empty());
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p handshaker-core`
Expected: PASS (compile clean — every `UnaryOutcome` construction site now has the field; no other literal exists besides these two and `tonic_impl`).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/invoke/mod.rs crates/handshaker-core/src/grpc/transport/tonic_impl.rs
git commit -m "feat(grpc): carry status_details on UnaryOutcome from the transport"
```

---

## Task 3: IPC — `StatusDetailIpc` mirror + `From` + `InvokeOutcomeIpc.status_details` + bindings

**Files:**
- Modify: `src-tauri/src/ipc/invoke.rs`

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/ipc/invoke.rs` a `tests` module (or extend an existing one):

```rust
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p handshaker --lib ipc::invoke`
Expected: FAIL — `StatusDetailIpc` undefined, `InvokeOutcomeIpc` has no `status_details`.

- [ ] **Step 3: Implement the IPC mirror + From + field**

In `src-tauri/src/ipc/invoke.rs`, add the mirror types and conversions. Add the new field to `InvokeOutcomeIpc` (after `trailing_metadata`) and extend its `From`:

```rust
use handshaker_core::grpc::{
    HelpLink as CoreHelpLink, PreconditionViolation as CorePreconditionViolation,
    QuotaViolation as CoreQuotaViolation, StatusDetail, FieldViolation as CoreFieldViolation,
};

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
        metadata: std::collections::HashMap<String, String>,
    },
    BadRequest { violations: Vec<FieldViolationIpc> },
    RetryInfo { retry_delay_ms: Option<u32> },
    QuotaFailure { violations: Vec<QuotaViolationIpc> },
    PreconditionFailure { violations: Vec<PreconditionViolationIpc> },
    DebugInfo { stack_entries: Vec<String>, detail: String },
    RequestInfo { request_id: String, serving_data: String },
    ResourceInfo {
        resource_type: String,
        resource_name: String,
        owner: String,
        description: String,
    },
    Help { links: Vec<HelpLinkIpc> },
    LocalizedMessage { locale: String, message: String },
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
```

Add the field to `InvokeOutcomeIpc` (after `trailing_metadata`):

```rust
pub status_details: Vec<StatusDetailIpc>,
```

And in its `From<UnaryOutcome>` (after `trailing_metadata: o.trailing_metadata,`):

```rust
status_details: o.status_details.into_iter().map(Into::into).collect(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p handshaker --lib ipc::invoke`
Expected: PASS (3 tests).

- [ ] **Step 5: Regenerate bindings**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
Expected: `src/ipc/bindings.ts` now contains `StatusDetailIpc`, `FieldViolationIpc`, etc., and `InvokeOutcomeIpc` gains `status_details: StatusDetailIpc[]`.

- [ ] **Step 6: Run the full Rust gate + commit**

Run: `cargo test --workspace`
Expected: PASS.

```bash
git add src-tauri/src/ipc/invoke.rs src/ipc/bindings.ts
git commit -m "feat(ipc): expose status_details on InvokeOutcomeIpc"
```

---

## Task 4: frontend — `StatusDetails.tsx` typed renderer

**Files:**
- Create: `src/features/response/StatusDetails.tsx`
- Create: `src/features/response/StatusDetails.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/response/StatusDetails.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusDetails } from "./StatusDetails";
import type { StatusDetailIpc } from "@/ipc/bindings";

describe("StatusDetails", () => {
  it("renders ErrorInfo reason, domain and metadata", () => {
    const details: StatusDetailIpc[] = [
      { type: "ErrorInfo", reason: "STOCKOUT", domain: "shop.example", metadata: { sku: "X1" } },
    ];
    render(<StatusDetails details={details} />);
    expect(screen.getByText("STOCKOUT")).toBeInTheDocument();
    expect(screen.getByText("shop.example")).toBeInTheDocument();
    expect(screen.getByText("sku")).toBeInTheDocument();
    expect(screen.getByText("X1")).toBeInTheDocument();
  });

  it("renders BadRequest field violations", () => {
    const details: StatusDetailIpc[] = [
      { type: "BadRequest", violations: [{ field: "qty", description: "must be > 0" }] },
    ];
    render(<StatusDetails details={details} />);
    expect(screen.getByText("qty")).toBeInTheDocument();
    expect(screen.getByText("must be > 0")).toBeInTheDocument();
  });

  it("renders RetryInfo suggested delay", () => {
    const details: StatusDetailIpc[] = [{ type: "RetryInfo", retry_delay_ms: 2000 }];
    render(<StatusDetails details={details} />);
    expect(screen.getByText(/retry/i)).toBeInTheDocument();
    expect(screen.getByText(/2(\.0)?\s*s/i)).toBeInTheDocument();
  });

  it("renders Help links", () => {
    const details: StatusDetailIpc[] = [
      { type: "Help", links: [{ description: "Docs", url: "https://example.com/help" }] },
    ];
    render(<StatusDetails details={details} />);
    expect(screen.getByText("Docs")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/response/StatusDetails.test.tsx`
Expected: FAIL — `StatusDetails` not defined.

- [ ] **Step 3: Implement the component**

Create `src/features/response/StatusDetails.tsx`:

```tsx
import type { StatusDetailIpc } from "@/ipc/bindings";

/** Human label per detail type, shown as the card header. */
const TITLE: Record<StatusDetailIpc["type"], string> = {
  ErrorInfo: "Error info",
  BadRequest: "Bad request",
  RetryInfo: "Retry info",
  QuotaFailure: "Quota failure",
  PreconditionFailure: "Precondition failure",
  DebugInfo: "Debug info",
  RequestInfo: "Request info",
  ResourceInfo: "Resource info",
  Help: "Help",
  LocalizedMessage: "Localized message",
};

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="min-w-[7rem] flex-none font-medium text-foreground/60">{k}</span>
      <span className="break-all font-mono text-foreground/85">{v}</span>
    </div>
  );
}

function Body({ d }: { d: StatusDetailIpc }) {
  switch (d.type) {
    case "ErrorInfo":
      return (
        <div className="space-y-1">
          <Row k="reason" v={d.reason} />
          <Row k="domain" v={d.domain} />
          {Object.entries(d.metadata).map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </div>
      );
    case "BadRequest":
      return (
        <div className="space-y-1.5">
          {d.violations.map((v, i) => (
            <div key={i}>
              <p className="font-mono text-xs text-foreground/85">{v.field}</p>
              <p className="text-xs text-muted-foreground">{v.description}</p>
            </div>
          ))}
        </div>
      );
    case "RetryInfo":
      return (
        <p className="text-xs text-muted-foreground">
          Retryable
          {d.retry_delay_ms != null ? ` — suggested delay ${(d.retry_delay_ms / 1000).toFixed(1)}s` : ""}
        </p>
      );
    case "QuotaFailure":
      return (
        <div className="space-y-1.5">
          {d.violations.map((v, i) => (
            <div key={i}>
              <p className="font-mono text-xs text-foreground/85">{v.subject}</p>
              <p className="text-xs text-muted-foreground">{v.description}</p>
            </div>
          ))}
        </div>
      );
    case "PreconditionFailure":
      return (
        <div className="space-y-1.5">
          {d.violations.map((v, i) => (
            <div key={i}>
              <p className="font-mono text-xs text-foreground/85">
                {v.kind} · {v.subject}
              </p>
              <p className="text-xs text-muted-foreground">{v.description}</p>
            </div>
          ))}
        </div>
      );
    case "DebugInfo":
      return (
        <div className="space-y-1">
          {d.detail ? <Row k="detail" v={d.detail} /> : null}
          {d.stack_entries.map((s, i) => (
            <p key={i} className="break-all font-mono text-[11px] text-muted-foreground">
              {s}
            </p>
          ))}
        </div>
      );
    case "RequestInfo":
      return (
        <div className="space-y-1">
          <Row k="request id" v={d.request_id} />
          {d.serving_data ? <Row k="serving data" v={d.serving_data} /> : null}
        </div>
      );
    case "ResourceInfo":
      return (
        <div className="space-y-1">
          <Row k="type" v={d.resource_type} />
          <Row k="name" v={d.resource_name} />
          {d.owner ? <Row k="owner" v={d.owner} /> : null}
          {d.description ? <Row k="description" v={d.description} /> : null}
        </div>
      );
    case "Help":
      return (
        <ul className="space-y-1">
          {d.links.map((l, i) => (
            <li key={i} className="text-xs">
              <span className="text-foreground/85">{l.description}</span>{" "}
              <span className="break-all font-mono text-muted-foreground">{l.url}</span>
            </li>
          ))}
        </ul>
      );
    case "LocalizedMessage":
      return (
        <p className="text-xs text-foreground/85">
          <span className="mr-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            {d.locale}
          </span>
          {d.message}
        </p>
      );
  }
}

/** Typed render of the google.rpc structured error details attached to a non-OK status. */
export function StatusDetails({ details }: { details: StatusDetailIpc[] }) {
  return (
    <div className="space-y-2">
      {details.map((d, i) => (
        <div key={i} className="rounded-md border border-border bg-card/40 p-2.5">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {TITLE[d.type]}
          </p>
          <Body d={d} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/features/response/StatusDetails.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/response/StatusDetails.tsx src/features/response/StatusDetails.test.tsx
git commit -m "feat(response): typed renderer for google.rpc status details"
```

---

## Task 5: frontend — wire `StatusDetails` into `ErrorView`

**Files:**
- Modify: `src/features/response/ErrorView.tsx`
- Modify: `src/lib/messages.ts`
- Modify: `src/features/response/ErrorView.test.tsx`

- [ ] **Step 1: Update the failing test**

Rewrite `src/features/response/ErrorView.test.tsx` — the fixture helper must include the new field, and the old "details unavailable" assertion is replaced:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorView } from "./ErrorView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const outcome = (over: Partial<InvokeOutcomeIpc> = {}): InvokeOutcomeIpc => ({
  status_code: 5,
  status_message: "NOT_FOUND: user does not exist",
  response_json: null,
  trailing_metadata: {},
  status_details: [],
  elapsed_ms: 12,
  ...over,
});

describe("ErrorView", () => {
  it("renders the status code name and the message prominently", () => {
    render(<ErrorView outcome={outcome()} />);
    expect(screen.getByText("NOT_FOUND")).toBeInTheDocument();
    expect(screen.getByText(/user does not exist/)).toBeInTheDocument();
  });

  it("renders structured details when present", () => {
    render(
      <ErrorView
        outcome={outcome({
          status_details: [{ type: "ErrorInfo", reason: "STOCKOUT", domain: "shop", metadata: {} }],
        })}
      />,
    );
    expect(screen.getByText("STOCKOUT")).toBeInTheDocument();
  });

  it("shows a 'no structured details' note when there are none", () => {
    render(<ErrorView outcome={outcome()} />);
    expect(screen.getByText(/no structured details/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/response/ErrorView.test.tsx`
Expected: FAIL — `StATUSDetails` not wired; "no structured details" text absent.

- [ ] **Step 3: Replace the messages copy**

In `src/lib/messages.ts`, replace the `response.error` block (~lines 67-74) with:

```ts
  response: {
    error: {
      noDetails: "No structured details (google.rpc) were attached to this error.",
    },
  },
```

- [ ] **Step 4: Wire the component into `ErrorView`**

In `src/features/response/ErrorView.tsx`, add `import { StatusDetails } from "./StatusDetails";`, and replace the entire `details` block (currently the `<div>` with `messages.response.error.detailsUnavailablePre/Post`, ~lines 37-44) with:

```tsx
        <div>
          <p className="mb-1 font-medium text-foreground/70">details</p>
          {outcome.status_details.length > 0 ? (
            <StatusDetails details={outcome.status_details} />
          ) : (
            <p className="leading-relaxed text-muted-foreground">{messages.response.error.noDetails}</p>
          )}
        </div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/features/response/ErrorView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Type-check + commit**

Run: `pnpm lint`
Expected: PASS (tsc clean).

```bash
git add src/features/response/ErrorView.tsx src/lib/messages.ts src/features/response/ErrorView.test.tsx
git commit -m "feat(response): show structured google.rpc details in ErrorView"
```

🧹 **/clear-checkpoint — Track ① complete (server-error details land end-to-end). Start Track ② fresh.**

---

# TRACK ② — Structured client/transport error (regex-free)

## Task 6: core — `ConnectKind` + `classify_connect_error`

**Files:**
- Create: `crates/handshaker-core/src/grpc/error_class.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs` (register module + re-export)

- [ ] **Step 1: Write the failing test**

Create `crates/handshaker-core/src/grpc/error_class.rs`:

```rust
//! Classify a transport/connect error MESSAGE into a coarse kind, so the UI can pick a
//! face/hint without re-parsing strings. This is the single source of truth (was a
//! fragile frontend regex). The `Other` kind covers anything we don't specifically map.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectKind {
    Refused,
    Tls,
    Dns,
    Other,
}

/// Map a raw connect/transport error string (from tonic / the OS) to a `ConnectKind`.
/// Order matters: more specific patterns first.
pub fn classify_connect_error(message: &str) -> ConnectKind {
    let m = message.to_lowercase();
    if m.contains("connection refused") || m.contains("econnrefused") || m.contains("refused") {
        ConnectKind::Refused
    } else if m.contains("certificate")
        || m.contains("tls")
        || m.contains("ssl")
        || m.contains("handshake")
    {
        ConnectKind::Tls
    } else if m.contains("dns")
        || m.contains("name resolution")
        || m.contains("failed to lookup")
        || m.contains("no such host")
    {
        ConnectKind::Dns
    } else {
        ConnectKind::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_real_world_strings() {
        assert_eq!(classify_connect_error("connection refused"), ConnectKind::Refused);
        assert_eq!(
            classify_connect_error("tcp connect error: Connection refused (os error 10061)"),
            ConnectKind::Refused
        );
        assert_eq!(classify_connect_error("the certificate is not trusted"), ConnectKind::Tls);
        assert_eq!(classify_connect_error("TLS handshake failed"), ConnectKind::Tls);
        assert_eq!(classify_connect_error("dns error: failed to lookup address"), ConnectKind::Dns);
        assert_eq!(classify_connect_error("no such host"), ConnectKind::Dns);
        assert_eq!(classify_connect_error("something weird"), ConnectKind::Other);
    }
}
```

In `crates/handshaker-core/src/grpc/mod.rs`, register and re-export (next to the other modules):

```rust
mod error_class;
pub use error_class::{classify_connect_error, ConnectKind};
```

(Confirm the `pub use` is reachable as `handshaker_core::grpc::ConnectKind`; mirror however the existing `grpc` re-exports are exposed — e.g. `crates/handshaker-core/src/lib.rs` may re-export `grpc`.)

- [ ] **Step 2: Run the test to verify it fails, then passes**

Run: `cargo test -p handshaker-core error_class`
Expected: FAIL first (undefined) → after the code is in place, PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add crates/handshaker-core/src/grpc/error_class.rs crates/handshaker-core/src/grpc/mod.rs
git commit -m "feat(grpc): classify connect errors into ConnectKind in core"
```

---

## Task 7: IPC — structured `IpcError` (Transport.kind + Cancelled + DeadlineExceeded) + bindings

**Files:**
- Modify: `src-tauri/src/ipc/error.rs`
- Modify: `src-tauri/src/commands/grpc.rs` (`race_cancel_timeout` + its tests)

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/ipc/error.rs` `tests` module, add:

```rust
#[test]
fn transport_from_core_carries_connect_kind() {
    let e: IpcError = handshaker_core::CoreError::Transport(
        "connect `http://x`: tcp connect error: Connection refused".into(),
    )
    .into();
    match e {
        IpcError::Transport { kind, .. } => assert_eq!(kind, TransportKindIpc::Refused),
        other => panic!("got {other:?}"),
    }
}

#[test]
fn cancelled_and_deadline_serialize_with_type_tag() {
    assert!(serde_json::to_string(&IpcError::Cancelled)
        .unwrap()
        .contains(r#""type":"Cancelled""#));
    let j = serde_json::to_string(&IpcError::DeadlineExceeded { timeout_ms: 30000 }).unwrap();
    assert!(j.contains(r#""type":"DeadlineExceeded""#) && j.contains(r#""timeout_ms":30000"#), "{j}");
}
```

In `src-tauri/src/commands/grpc.rs` tests, change the timeout assertion (`race_times_out_when_work_exceeds_budget`, ~line 311):

```rust
        match race_cancel_timeout(&m, "id2".to_string(), 50, work).await {
            Err(IpcError::DeadlineExceeded { timeout_ms }) => assert_eq!(timeout_ms, 50),
            other => panic!("expected DeadlineExceeded, got {other:?}"),
        }
```

And the two cancel assertions (`duplicate_id_cleanup...` ~line 372, `race_cancels_when_notified...` ~line 402):

```rust
        match b {
            Err(IpcError::Cancelled) => {}
            other => panic!("expected B cancelled, got {other:?}"),
        }
```

```rust
        match raced {
            Err(IpcError::Cancelled) => {}
            other => panic!("expected cancelled, got {other:?}"),
        }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p handshaker --lib ipc::error` and `cargo test -p handshaker --lib commands::grpc`
Expected: FAIL — `TransportKindIpc` / `Cancelled` / `DeadlineExceeded` undefined; old `Transport { message }` match arms no longer hold.

- [ ] **Step 3: Implement the IpcError changes**

In `src-tauri/src/ipc/error.rs`, add the kind enum, change the `Transport` variant, add two variants, and update `From`:

```rust
use handshaker_core::grpc::ConnectKind;
use handshaker_core::CoreError;
use serde::Serialize;
use specta::Type;

#[derive(Debug, Serialize, Type, PartialEq)]
pub enum TransportKindIpc {
    Refused,
    Tls,
    Dns,
    Other,
}

impl From<ConnectKind> for TransportKindIpc {
    fn from(k: ConnectKind) -> Self {
        match k {
            ConnectKind::Refused => TransportKindIpc::Refused,
            ConnectKind::Tls => TransportKindIpc::Tls,
            ConnectKind::Dns => TransportKindIpc::Dns,
            ConnectKind::Other => TransportKindIpc::Other,
        }
    }
}
```

In the `IpcError` enum, replace `Transport { message: String }` with the kinded variant and add the two synthesized variants:

```rust
    Transport { kind: TransportKindIpc, message: String },
    Cancelled,
    DeadlineExceeded { timeout_ms: u32 },
    Auth { message: String },
```

In `From<CoreError>`, change the `Transport` arm to classify:

```rust
            CoreError::Transport(m) => IpcError::Transport {
                kind: handshaker_core::grpc::classify_connect_error(&m).into(),
                message: m,
            },
```

(`Cancelled` / `DeadlineExceeded` have no `CoreError` source — they're synthesized in `race_cancel_timeout`, so the exhaustive `from_core_error_exhaustive` test and its `cases.len() == 16` assertion stay unchanged.)

- [ ] **Step 4: Implement the race_cancel_timeout change**

In `src-tauri/src/commands/grpc.rs`, delete `CANCELLED_MSG` and `timed_out_msg` (~lines 159-164) and change the `select!` arms (~lines 205-209):

```rust
    tokio::select! {
        biased;
        _ = notify.notified() => Err(IpcError::Cancelled),
        r = tokio::time::timeout(Duration::from_millis(timeout_ms as u64), work) => match r {
            Ok(inner) => inner,
            Err(_) => Err(IpcError::DeadlineExceeded { timeout_ms }),
        },
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p handshaker --lib`
Expected: PASS. (If any other site matched `IpcError::Transport { message }` positionally, the compiler flags it — update to `{ kind, message }` or the new variant.)

- [ ] **Step 6: Regenerate bindings + full Rust gate + commit**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
Then: `cargo test --workspace`
Expected: PASS; `src/ipc/bindings.ts` `IpcError` now has `{ type: "Transport"; kind: TransportKindIpc; message: string }`, `{ type: "Cancelled" }`, `{ type: "DeadlineExceeded"; timeout_ms: number }`, plus `export type TransportKindIpc = "Refused" | "Tls" | "Dns" | "Other"`.

```bash
git add src-tauri/src/ipc/error.rs src-tauri/src/commands/grpc.rs src/ipc/bindings.ts
git commit -m "feat(ipc): structured Transport.kind + Cancelled + DeadlineExceeded errors"
```

---

## Task 8: frontend — `netDiagnostics` structured rewrite (delete regex)

**Files:**
- Modify: `src/features/workflow/netDiagnostics.ts`
- Modify: `src/features/workflow/netDiagnostics.test.ts`

- [ ] **Step 1: Rewrite the test**

Replace `src/features/workflow/netDiagnostics.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { faultFromUnknown, isCancelError, faultHint } from "./netDiagnostics";

describe("faultFromUnknown", () => {
  it("maps a structured Transport error to its kind", () => {
    expect(faultFromUnknown({ type: "Transport", kind: "Refused", message: "refused" })).toEqual({
      kind: "refused",
      message: "refused",
    });
    expect(faultFromUnknown({ type: "Transport", kind: "Tls", message: "bad cert" }).kind).toBe("tls");
    expect(faultFromUnknown({ type: "Transport", kind: "Dns", message: "no host" }).kind).toBe("dns");
    expect(faultFromUnknown({ type: "Transport", kind: "Other", message: "weird" }).kind).toBe("other");
  });

  it("maps DeadlineExceeded to a timeout fault with the timeout in the message", () => {
    const f = faultFromUnknown({ type: "DeadlineExceeded", timeout_ms: 30000 });
    expect(f.kind).toBe("timeout");
    expect(f.message).toMatch(/30000/);
  });

  it("maps EncodeRequest / DecodeResponse / Auth", () => {
    expect(faultFromUnknown({ type: "EncodeRequest", message: "bad json" }).kind).toBe("encode");
    expect(faultFromUnknown({ type: "DecodeResponse", message: "bad proto" }).kind).toBe("decode");
    expect(faultFromUnknown({ type: "Auth", message: "no creds" }).kind).toBe("auth");
  });

  it("falls back to 'other' for unknown throwables", () => {
    expect(faultFromUnknown(new Error("boom"))).toEqual({ kind: "other", message: "boom" });
    expect(faultFromUnknown("plain string").kind).toBe("other");
  });
});

describe("isCancelError", () => {
  it("is true only for the structured Cancelled error", () => {
    expect(isCancelError({ type: "Cancelled" })).toBe(true);
    expect(isCancelError({ type: "Transport", kind: "Other", message: "x" })).toBe(false);
    expect(isCancelError("request cancelled")).toBe(false);
  });
});

describe("faultHint", () => {
  it("returns a non-empty hint for known kinds and empty for other", () => {
    expect(faultHint("refused")).toMatch(/listening|server is running/i);
    expect(faultHint("other")).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/workflow/netDiagnostics.test.ts`
Expected: FAIL — new exports undefined.

- [ ] **Step 3: Rewrite `netDiagnostics.ts`**

Replace the entire contents of `src/features/workflow/netDiagnostics.ts` with:

```ts
import type { IpcError } from "@/ipc/bindings";

/** Display face selector for a client-side (non-gRPC-status) failure. */
export type FaultKind =
  | "refused"
  | "tls"
  | "dns"
  | "timeout"
  | "cancelled"
  | "encode"
  | "decode"
  | "auth"
  | "other";

export interface ClientFault {
  kind: FaultKind;
  /** Raw, human-readable message for the footer. */
  message: string;
}

const HINT: Record<FaultKind, string> = {
  refused:
    "Nothing is listening at that address/port. Check the host, port, and that the server is running.",
  tls: "TLS negotiation failed. Verify the scheme, the server certificate, or disable verification for self-signed certs.",
  dns: "The hostname could not be resolved. Check the address for typos or your network/DNS.",
  timeout:
    "The server did not respond before the request deadline. Raise it in Settings → Network or check the server.",
  cancelled: "Request was cancelled.",
  encode: "The request body could not be encoded for this method. Check the JSON against the contract.",
  decode:
    "The server's response could not be decoded — the method's contract may be stale. Refresh reflection.",
  auth: "Authentication could not be prepared. Check the auth configuration and its variables.",
  other: "",
};

/** Actionable hint for a fault kind (empty string ⇒ no hint shown). */
export function faultHint(kind: FaultKind): string {
  return HINT[kind];
}

function isObj(e: unknown): e is Record<string, unknown> {
  return typeof e === "object" && e !== null;
}

/** True only for the backend's structured cancel error — the safe cancel discriminator. */
export function isCancelError(e: unknown): boolean {
  return isObj(e) && e.type === "Cancelled";
}

function transportKindToFault(kind: string): FaultKind {
  switch (kind) {
    case "Refused":
      return "refused";
    case "Tls":
      return "tls";
    case "Dns":
      return "dns";
    default:
      return "other";
  }
}

function ipcErrorMessage(e: IpcError): string {
  if ("message" in e && typeof e.message === "string") return e.message;
  if ("hint" in e && typeof e.hint === "string") return e.hint;
  if ("name" in e && typeof e.name === "string") return `Unresolved variable: ${e.name}`;
  return e.type;
}

function faultFromIpcError(e: IpcError): ClientFault {
  switch (e.type) {
    case "Transport":
      return { kind: transportKindToFault(e.kind), message: e.message };
    case "DeadlineExceeded":
      return { kind: "timeout", message: `Request timed out after ${e.timeout_ms}ms` };
    case "Cancelled":
      return { kind: "cancelled", message: "Request cancelled" };
    case "EncodeRequest":
      return { kind: "encode", message: e.message };
    case "DecodeResponse":
      return { kind: "decode", message: e.message };
    case "Auth":
      return { kind: "auth", message: e.message };
    default:
      return { kind: "other", message: ipcErrorMessage(e) };
  }
}

/** Map a thrown IPC error (or any throwable) to a display fault — no regex on messages. */
export function faultFromUnknown(e: unknown): ClientFault {
  if (isObj(e) && typeof e.type === "string") return faultFromIpcError(e as IpcError);
  return { kind: "other", message: e instanceof Error ? e.message : String(e) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/features/workflow/netDiagnostics.test.ts`
Expected: PASS. (`tsc` will still be red until Tasks 9–10 update the consumers — that's expected and fixed there.)

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/netDiagnostics.ts src/features/workflow/netDiagnostics.test.ts
git commit -m "refactor(netdiag): structured ClientFault from IpcError, drop regex"
```

---

## Task 9: frontend — `ClientErrorView` consumes a structured fault

**Files:**
- Modify: `src/features/response/ClientErrorView.tsx`
- Modify: `src/features/response/ClientErrorView.test.tsx`

- [ ] **Step 1: Rewrite the test**

Replace `src/features/response/ClientErrorView.test.tsx` with:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientErrorView } from "./ClientErrorView";

describe("ClientErrorView", () => {
  it("shows the raw message", () => {
    render(<ClientErrorView fault={{ kind: "other", message: "transport error xyz" }} />);
    expect(screen.getByText(/transport error xyz/i)).toBeInTheDocument();
  });

  it("renders a diagnostic hint for a recognised kind", () => {
    render(<ClientErrorView fault={{ kind: "refused", message: "connection refused" }} />);
    expect(screen.getByTestId("diag-hint")).toBeInTheDocument();
    expect(screen.getByText(/listening|server is running/i)).toBeInTheDocument();
  });

  it("shows no hint for the 'other' kind", () => {
    render(<ClientErrorView fault={{ kind: "other", message: "Unresolved variables: {{host}}" }} />);
    expect(screen.queryByTestId("diag-hint")).not.toBeInTheDocument();
  });

  it("shows an auth face for auth faults", () => {
    render(<ClientErrorView fault={{ kind: "auth", message: "no creds" }} />);
    expect(screen.getByText(/authentication/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/response/ClientErrorView.test.tsx`
Expected: FAIL — component still takes `message`, has no `auth` face.

- [ ] **Step 3: Rewrite `ClientErrorView.tsx`**

Replace `src/features/response/ClientErrorView.tsx` with:

```tsx
import {
  AlertCircle,
  Ban,
  FileWarning,
  Globe,
  KeyRound,
  ServerCrash,
  ShieldAlert,
  TimerOff,
  type LucideIcon,
} from "lucide-react";
import { faultHint, type ClientFault, type FaultKind } from "@/features/workflow/netDiagnostics";

/** Per-kind face: a title + illustration icon. */
const FACE: Record<FaultKind, { title: string; Icon: LucideIcon }> = {
  refused: { title: "Service unavailable", Icon: ServerCrash },
  tls: { title: "TLS handshake failed", Icon: ShieldAlert },
  dns: { title: "Host not found", Icon: Globe },
  timeout: { title: "Request timed out", Icon: TimerOff },
  cancelled: { title: "Request cancelled", Icon: Ban },
  encode: { title: "Request couldn't be encoded", Icon: FileWarning },
  decode: { title: "Response couldn't be decoded", Icon: FileWarning },
  auth: { title: "Authentication failed", Icon: KeyRound },
  other: { title: "Request failed", Icon: AlertCircle },
};

/**
 * Body-filling, Postman-style face for client/transport failures (no gRPC outcome): an
 * illustration + a friendly title and explanation, with the raw error pinned below.
 * The kind is decided in the backend (`IpcError`) — no string parsing here.
 */
export function ClientErrorView({ fault }: { fault: ClientFault }) {
  const { title, Icon } = FACE[fault.kind];
  const hint = faultHint(fault.kind);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto scroll-thin p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="text-sm font-medium text-foreground/85">{title}</div>
      {hint ? (
        <p data-testid="diag-hint" className="max-w-[400px] text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : (
        <p className="max-w-[400px] text-xs leading-relaxed text-muted-foreground">
          The request could not be completed. Check the address, port and TLS setting, then try again.
        </p>
      )}
      <div className="w-full max-w-[460px] rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-left">
        <p className="text-[10px] font-medium uppercase tracking-wide text-destructive/80">Error</p>
        <p className="mt-0.5 break-all font-mono text-xs leading-relaxed text-destructive">{fault.message}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/features/response/ClientErrorView.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/response/ClientErrorView.tsx src/features/response/ClientErrorView.test.tsx
git commit -m "feat(response): ClientErrorView renders a structured ClientFault"
```

---

## Task 10: frontend — thread the structured fault through the send path

**Files:**
- Modify: `src/features/workflow/model.ts` (Step.error type)
- Modify: `src/features/workflow/actions.ts` (`SendResult`, `sendStep`, `stepPatchFromSendResult`)
- Modify: `src/features/workflow/CallPanel.tsx` (auth-error patch)
- Modify: `src/features/response/ResponsePanel.tsx` (`error` prop type + ClientErrorView call)
- Modify: `src/features/workflow/useDraftReflection.ts` (cancel gate)
- Modify tests: `src/features/workflow/actions.test.ts`, `src/features/workflow/stepView.test.ts`, `src/features/workflow/reducers.test.ts`, `src/features/workflow/useDraftReflection.test.ts`

- [ ] **Step 1: Update `SendResult` + `sendStep` + `stepPatchFromSendResult`**

In `src/features/workflow/actions.ts`:

Change the import on line 8 from `isCancelSentinel` to the new helpers:

```ts
import { faultFromUnknown, isCancelError, type ClientFault } from "./netDiagnostics";
```

Change `SendResult` (line 161-165) — the error variant now carries a structured fault:

```ts
export type SendResult =
  | { kind: "ok"; outcome: InvokeOutcomeIpc }
  | { kind: "error"; fault: ClientFault }
  | { kind: "unresolved"; unresolved: string[]; cycle: string[] | null }
  | { kind: "cancelled" };
```

Change the `sendStep` catch (lines 307-311):

```ts
  } catch (e) {
    if (isCancelError(e)) return { kind: "cancelled" }; // structured discriminator
    return { kind: "error", fault: faultFromUnknown(e) };
  }
```

Change `stepPatchFromSendResult` (lines 324-341) — `Step.error` becomes a `ClientFault | null`:

```ts
export function stepPatchFromSendResult(res: SendResult): Partial<Step> {
  if (res.kind === "ok") {
    return { status: res.outcome.status_code === 0 ? "ok" : "error", outcome: res.outcome, error: null };
  }
  if (res.kind === "unresolved") {
    const message = res.cycle
      ? `Variable cycle: ${res.cycle.join(" → ")}`
      : `Unresolved variables: ${res.unresolved.map((v) => `{{${v}}}`).join(", ")}`;
    return { status: "error", outcome: null, error: { kind: "other", message } };
  }
  if (res.kind === "cancelled") {
    return { status: "draft", outcome: null, error: null };
  }
  return { status: "error", outcome: null, error: res.fault };
}
```

(`errorToMessage` stays — it's still used by `resolveAuthHeader`'s catch. Leave it.)

- [ ] **Step 2: Update `Step.error` type**

In `src/features/workflow/model.ts`, change line 27 and add the import:

```ts
import type { ClientFault } from "./netDiagnostics";
// ...
  error: ClientFault | null; // client-side (non-gRPC) failure, structured for the face
```

- [ ] **Step 3: Update `CallPanel` auth-error patch + `ResponsePanel`**

In `src/features/workflow/CallPanel.tsx`, the auth-error patch (~line 88) becomes:

```ts
    if (auth.kind === "error") {
      onPatch({ status: "error", outcome: null, error: { kind: "auth", message: auth.message }, requestId: null });
      return;
    }
```

In `src/features/response/ResponsePanel.tsx`, change the `error` prop type (line 24-25) and the `ClientErrorView` call (line 123):

```ts
  /** Client/transport fault (no gRPC outcome), shown in the Body tab. */
  error?: import("@/features/workflow/netDiagnostics").ClientFault | null;
```

```tsx
      {isError && !outcome && error && tab === "body" && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ClientErrorView fault={error} />
        </div>
      )}
```

(Prefer a top-of-file `import type { ClientFault } from "@/features/workflow/netDiagnostics";` and use `ClientFault | null` rather than the inline `import(...)` type — match the file's existing import style.)

- [ ] **Step 4: Update `useDraftReflection` cancel gate**

In `src/features/workflow/useDraftReflection.ts`, change the import (line 7) to `import { isCancelError } from "./netDiagnostics";`, and the cancel gate (~line 75) to operate on the raw caught error `e` instead of the flattened message:

```ts
        // A user cancel is quiet: keep the existing catalog, show no error banner.
        if (!isCancelError(e)) {
          setCatalog(null);
          setError(message);
        }
```

(Keep `const message = reflectErr(e);` above for the display string.)

- [ ] **Step 5: Update the affected tests**

`src/features/workflow/actions.test.ts`:
- Line ~98: `mockRejectedValue({ type: "Transport", kind: "Refused", message: "connection refused" })`; the assertion on that send result becomes `{ kind: "error", fault: { kind: "refused", message: "connection refused" } }`.
- Line ~228: `expect(p.error).toEqual({ kind: "other", message: "Unresolved variables: {{host}}, {{id}}" })`.
- Line ~232: `expect(p.error).toEqual({ kind: "other", message: "Variable cycle: a → b → a" })`.
- Line ~235: `expect(stepPatchFromSendResult({ kind: "error", fault: { kind: "other", message: "boom" } })).toEqual({ status: "error", outcome: null, error: { kind: "other", message: "boom" } })`.
- Line ~315: `expect(shouldRecordExecuted({ kind: "error", fault: { kind: "other", message: "refused" } })).toBe(false)`.
- Line ~357 (cancel): `mockRejectedValue({ type: "Cancelled" })`; the result asserts `{ kind: "cancelled" }`.

`src/features/workflow/stepView.test.ts`:
- Line ~64: `const step = { ...newStep(base), status: "error" as const, error: { kind: "other", message: "refused" } };`

`src/features/workflow/reducers.test.ts`:
- Line ~40: `updateStep(wf, "nope", { error: { kind: "other", message: "x" } })` (the id is absent, so `.error` still asserts `toBeNull()`).

`src/features/workflow/useDraftReflection.test.ts`:
- Line ~115 (cancel case): `mockRejectedValue({ type: "Cancelled" })` (was `{ message: "request cancelled" }`); the assertion `result.current.error` stays `toBeNull()`.

- [ ] **Step 6: Run the full frontend suite + type-check**

Run: `pnpm test` then `pnpm lint`
Expected: PASS — vitest green, tsc clean. If tsc flags any other `Step.error` string usage, convert it to a `ClientFault` (`{ kind: "other", message }`) or `null`.

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/model.ts src/features/workflow/actions.ts src/features/workflow/CallPanel.tsx src/features/response/ResponsePanel.tsx src/features/workflow/useDraftReflection.ts src/features/workflow/actions.test.ts src/features/workflow/stepView.test.ts src/features/workflow/reducers.test.ts src/features/workflow/useDraftReflection.test.ts
git commit -m "feat(workflow): thread structured ClientFault through the send path"
```

🧹 **/clear-checkpoint — Track ② complete (regex-free structured client errors).**

---

## Task 11: Final verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full Rust gate**

Run: `cargo test --workspace`
Expected: PASS (0 failed). Note the core + src-tauri counts.

- [ ] **Step 2: Bindings no-drift check**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
Then: `git status --porcelain src/ipc/bindings.ts`
Expected: empty output (no drift — bindings already committed in Tasks 3 & 7).

- [ ] **Step 3: Frontend gate**

Run: `pnpm test` then `pnpm lint` then `pnpm build`
Expected: vitest all green; tsc clean; `vite build` succeeds.

- [ ] **Step 4: Manual WebView2 pass (record outcome, do not block the merge gate on tooling that can't drive WebView2)**

Verify by hand in `pnpm tauri:dev`:
- A method that returns a non-OK status **with** google.rpc details (e.g. a server using `BadRequest`/`ErrorInfo`) → ErrorView shows the typed detail cards.
- A method that returns a non-OK status **without** details → "No structured details" note.
- Point at a dead port → `ClientErrorView` shows the "Service unavailable" face (refused) with hint.
- Wrong TLS scheme → "TLS handshake failed" face.
- Cancel an in-flight call → returns to draft quietly (no error banner).
- A request that exceeds the deadline → "Request timed out" face showing the timeout.

- [ ] **Step 5: Hand off for review**

Use `superpowers:requesting-code-review` for a branch review, then `superpowers:finishing-a-development-branch` to merge ff into `main` and archive the plan+spec (per `CLAUDE.md` → "Архивирование завершённых планов и спеков").

---

## Out of scope (YAGNI / follow-ups — do NOT implement here)

- ③ `status_message` double-encodes the code (`"{code}: {message}"` + the badge already shows the code).
- ④ Headers tab (initial metadata separate from trailers).
- ⑤ Retry button / auto-retry from `RetryInfo` (details are **shown** as data; no action wired).
- ⑥ Copy-error (full structured error to clipboard).
- Decoding custom (non-standard `google.rpc`) `Any` details.

## Self-review notes (done before handoff)

- **Spec coverage:** ① decode→outcome→IPC→render = Tasks 1-5; ② core classify + IpcError variants + frontend structured consumption = Tasks 6-10. Out-of-scope list mirrors the spec.
- **Type consistency:** core `StatusDetail`/`ConnectKind` → IPC `StatusDetailIpc`/`TransportKindIpc` → bindings → frontend `StatusDetailIpc`/`ClientFault`. `Step.error: ClientFault | null` consistently produced by `stepPatchFromSendResult` and the `CallPanel` auth path, consumed by `ResponsePanel`→`ClientErrorView`.
- **No placeholders:** every code/test block is concrete; the only contingencies are explicit (non-exhaustive `ErrorDetail` match arm; any extra positional `IpcError::Transport` match site the compiler surfaces).
