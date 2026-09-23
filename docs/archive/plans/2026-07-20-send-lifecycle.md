# One Home for the Send Lifecycle — Implementation Plan

> **Status: 🎉 DONE (2026-07-20).** All 5 tasks implemented via subagent-driven
> execution, per-task + whole-branch reviews clean, full gate green, live-verified
> in `tauri:dev`, squashed and ff-merged to `main`. Bonus fix shipped alongside:
> vitest Storage shim (node ≥ 22 shadows jsdom `localStorage`). Follow-up
> candidate: move the two Send error strings into `src/lib/messages.ts`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `grpc_send` returns a Send report (outcome + auth/TLS actually used), and a new `useSend` hook owns the whole frontend Send lifecycle (patch → executed snapshot → usage bump), eliminating the stale `auth_effective` snapshot and the CallPanel+FocusView co-authoring.

**Architecture:** Core `resolve_request` stops dropping the picked auth config (`EffectiveRequest.picked_auth`, template form). The IPC layer wraps the invoke outcome in `SendReportIpc { outcome, auth_used, tls_used }`. The frontend `useSend` hook absorbs `stepPatchFromSendResult` / `shouldRecordExecuted` / `buildExecutedStep` as internals and commits history + bumps usage itself; `sendStep`/`cancelStep` stay as the IO adapter. Spec: `docs/superpowers/specs/2026-07-20-send-lifecycle-design.md`.

**Tech Stack:** Rust (tokio, specta/tauri-specta), React 18 + TypeScript, vitest + @testing-library/react.

## Global Constraints

- Execute in an isolated worktree branch `claude/send-lifecycle` off `main` (per CLAUDE.md). Fresh worktree: `pnpm install`, then build `dist/` before compiling `src-tauri`.
- Core stays specta-free and tonic-free outside `grpc/transport`.
- ADR-0001: resolved secrets never cross IPC. `auth_used` is the picked config in **template** form only.
- After any Rust command/DTO change regenerate bindings: `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet` (writes gitignored `src/ipc/bindings.ts`).
- The gate before merge = `pnpm lint` + `pnpm test` + `cargo test --workspace`.
- Commits: Conventional Commits with scope; **no `Co-Authored-By` trailers** (`.claude/rules/commit-messages.md`). Branch is squashed to one commit at merge (`.claude/rules/squashing-feature-branches.md`) — commit per task during work is fine.
- No new user-facing strings are introduced (nothing to add to `src/lib/messages.ts`).
- Every task must leave the tree green (`pnpm lint` + affected tests pass).

---

### Task 1: Core — `EffectiveRequest.picked_auth`

**Files:**
- Modify: `crates/handshaker-core/src/collections/mod.rs:92-103` (`EffectiveRequest`)
- Modify: `crates/handshaker-core/src/collections/resolve.rs:93-102` (return) and its `#[cfg(test)]` module (starts at line 134)

**Interfaces:**
- Consumes: existing `resolve_request(request, collection, active_env, tokens)`, `pick_auth_config` (auth/mod.rs:33).
- Produces: `EffectiveRequest.picked_auth: Option<SavedAuthConfig>` — the winning config in template form; later tasks read `eff.picked_auth` and `eff.target.tls`.

- [ ] **Step 1: Write the failing tests**

Append to the `#[cfg(test)]` module in `crates/handshaker-core/src/collections/resolve.rs`. Reuse the module's existing request/collection/env builders and token-source fake if equivalents already exist there (they cover the oauth resolve scenarios); otherwise add these self-contained helpers:

```rust
use crate::auth::{AuthCredentials, OAuth2ClientCredentialsConfig, SavedAuthConfig, TokenSource};
use crate::collections::ids::{CollectionId, ItemId};
use crate::collections::{Collection, SavedRequest};
use crate::env::Environment;
use crate::error::CoreError;
use indexmap::IndexMap;
use uuid::Uuid;

struct FakeTokens;
#[async_trait::async_trait]
impl TokenSource for FakeTokens {
    async fn header_for(
        &self,
        _cfg: &OAuth2ClientCredentialsConfig,
    ) -> Result<AuthCredentials, CoreError> {
        Ok(AuthCredentials { header_name: "authorization".into(), header_value: "Bearer t".into() })
    }
    fn invalidate(&self, _cfg: &OAuth2ClientCredentialsConfig) {}
}

fn req_with_auth(auth: SavedAuthConfig) -> SavedRequest {
    SavedRequest {
        id: ItemId(Uuid::from_u128(1)),
        name: "r".into(),
        address_template: "h:50051".into(),
        service: "pkg.Svc".into(),
        method: "Do".into(),
        body_template: "{}".into(),
        metadata: vec![],
        auth,
        tls_override: None,
        last_used_at: None,
        use_count: 0,
    }
}

fn oauth_template() -> SavedAuthConfig {
    SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
        token_url: "https://idp/token".into(),
        client_id: "cid".into(),
        client_secret: "{{sec}}".into(), // template — must survive into picked_auth unresolved
        scopes: vec![],
        header_name: "authorization".into(),
        prefix: "Bearer ".into(),
        environments: vec![],
    })
}

fn env_with_sec() -> Environment {
    let mut variables = IndexMap::new();
    variables.insert("sec".to_string(), "s3cr3t".to_string());
    Environment { name: "dev".into(), variables, color: None }
}

fn coll_with_auth(auth: SavedAuthConfig) -> Collection {
    Collection {
        id: CollectionId(Uuid::from_u128(9)),
        name: "C".into(),
        items: vec![],
        variables: IndexMap::new(),
        auth,
        default_tls: false,
        skip_tls_verify: false,
        pinned: false,
        description: None,
        created_at: 0.0,
        expanded: false,
    }
}
```

The four tests:

```rust
#[tokio::test]
async fn picked_auth_is_request_config_in_template_form() {
    let req = req_with_auth(oauth_template());
    let env = env_with_sec();
    let eff = resolve_request(&req, None, Some(&env), &FakeTokens).await.unwrap();
    // Template form: client_secret stays "{{sec}}", never the resolved value.
    assert_eq!(eff.picked_auth, Some(oauth_template()));
}

#[tokio::test]
async fn picked_auth_falls_back_to_collection_config() {
    let req = req_with_auth(SavedAuthConfig::None);
    let coll = coll_with_auth(oauth_template());
    let env = env_with_sec();
    let eff = resolve_request(&req, Some(&coll), Some(&env), &FakeTokens).await.unwrap();
    assert_eq!(eff.picked_auth, Some(oauth_template()));
}

#[tokio::test]
async fn picked_auth_none_when_env_gate_skips_all_configs() {
    let mut auth = oauth_template();
    if let SavedAuthConfig::OAuth2ClientCredentials(c) = &mut auth {
        c.environments = vec!["prod".into()];
    }
    let req = req_with_auth(auth);
    let env = Environment { name: "dev".into(), variables: IndexMap::new(), color: None };
    let eff = resolve_request(&req, None, Some(&env), &FakeTokens).await.unwrap();
    assert_eq!(eff.picked_auth, None);
    assert!(eff.auth.is_none());
}

#[tokio::test]
async fn picked_auth_none_when_unauthenticated() {
    let req = req_with_auth(SavedAuthConfig::None);
    let eff = resolve_request(&req, None, None, &FakeTokens).await.unwrap();
    assert_eq!(eff.picked_auth, None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p handshaker-core picked_auth`
Expected: compile error — `EffectiveRequest` has no field `picked_auth`.

- [ ] **Step 3: Implement**

In `crates/handshaker-core/src/collections/mod.rs`, add the field to `EffectiveRequest` (after `invalidate_oauth`):

```rust
    /// The auth config that won the pick, in **template** form (as stored in the
    /// collection/request) — `None` = unauthenticated. This is what the Send report
    /// carries back to the UI; resolved secrets stay out of it by construction.
    pub picked_auth: Option<SavedAuthConfig>,
```

(`SavedAuthConfig` is already in scope in this file via the `auth` field.)

In `crates/handshaker-core/src/collections/resolve.rs`, `picked` is moved by the materialize `match` at line 82 — clone it first and put the clone in the result:

```rust
    // --- 4. Auth materialize (nearest active config already picked above) ---
    let picked_auth = picked.clone();
    let (auth, invalidate_oauth) = match picked {
        // ... unchanged ...
    };

    Ok(EffectiveRequest {
        target,
        service: request.service.clone(),
        method: request.method.clone(),
        body_json,
        metadata,
        auth,
        invalidate_oauth,
        picked_auth,
    })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p handshaker-core` (the whole crate — other resolve tests must stay green)
Expected: PASS, including the 4 new `picked_auth_*` tests.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/collections/mod.rs crates/handshaker-core/src/collections/resolve.rs
git commit -m "feat(core): EffectiveRequest carries picked_auth (template form)"
```

---

### Task 2: IPC — `SendReportIpc` from `grpc_send`, wire through to `SendResult`

**Files:**
- Modify: `src-tauri/src/ipc/invoke.rs` (add `SendReportIpc` after `InvokeOutcomeIpc`, ~line 208)
- Modify: `src-tauri/src/ipc/mod.rs` (re-export `SendReportIpc` next to `SendCtxIpc`/`SendDraftIpc`)
- Modify: `src-tauri/src/commands/grpc.rs:263-347` (`grpc_send_impl` + `grpc_send` return type)
- Modify: `src-tauri/CONTEXT.md` (Language: **Send report**)
- Regenerate: `src/ipc/bindings.ts`
- Modify: `src/ipc/client.ts:99-108` (`grpcSend` return type)
- Modify: `src/features/workflow/actions.ts` (`SendResult.ok` carries `report`; `sendStep`; `stepPatchFromSendResult` reads `res.report.outcome`)
- Test: `src-tauri/src/ipc/invoke.rs` (`#[cfg(test)]`), `src/features/workflow/actions.test.ts`, `src/features/workflow/CallPanel.editable.test.tsx` (fixture sync)

**Interfaces:**
- Consumes: `EffectiveRequest.picked_auth` (Task 1), `SavedAuthConfigIpc::from_core` (ipc/collection.rs:72), `InvokeOutcomeIpc`.
- Produces: `SendReportIpc { outcome: InvokeOutcomeIpc, auth_used: SavedAuthConfigIpc, tls_used: bool }` with `SendReportIpc::from_parts(outcome, picked_auth: Option<SavedAuthConfig>, tls_used: bool)`; TS `SendResult` ok-variant = `{ kind: "ok"; report: SendReportIpc }`. Task 3 consumes both.

- [ ] **Step 1: Write the failing Rust test**

In `src-tauri/src/ipc/invoke.rs` `#[cfg(test)]` module, add:

```rust
use crate::ipc::collection::SavedAuthConfigIpc;
use handshaker_core::auth::{OAuth2ClientCredentialsConfig, SavedAuthConfig};
use std::collections::HashMap;

fn outcome_fixture() -> InvokeOutcomeIpc {
    InvokeOutcomeIpc {
        status_code: 0,
        status_message: String::new(),
        response_json: Some("{}".into()),
        trailing_metadata: HashMap::new(),
        status_details: vec![],
        elapsed_ms: 5,
    }
}

#[test]
fn send_report_none_pick_maps_to_auth_none() {
    let report = SendReportIpc::from_parts(outcome_fixture(), None, false);
    assert_eq!(report.auth_used, SavedAuthConfigIpc::None);
    assert!(!report.tls_used);
}

#[test]
fn send_report_keeps_picked_config_in_template_form() {
    let picked = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
        token_url: "https://idp/token".into(),
        client_id: "cid".into(),
        client_secret: "{{sec}}".into(),
        scopes: vec![],
        header_name: "authorization".into(),
        prefix: "Bearer ".into(),
        environments: vec![],
    });
    let report = SendReportIpc::from_parts(outcome_fixture(), Some(picked), true);
    match report.auth_used {
        SavedAuthConfigIpc::Oauth2ClientCredentials { client_secret, .. } => {
            assert_eq!(client_secret, "{{sec}}"); // template survived, secret did not resolve
        }
        other => panic!("got {other:?}"),
    }
    assert!(report.tls_used);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p handshaker send_report`
Expected: compile error — `SendReportIpc` not found.

- [ ] **Step 3: Implement the DTO + command change**

In `src-tauri/src/ipc/invoke.rs`, after the `From<UnaryOutcome> for InvokeOutcomeIpc` impl:

```rust
/// Send report: the invoke outcome plus the facts the resolve pipeline actually
/// used — so the UI's executed-history snapshot records fact instead of asking
/// `auth_effective` a second (possibly stale) time. `auth_used` is the picked
/// config in template form; resolved secrets never cross IPC (ADR-0001).
#[derive(Debug, Serialize, Type)]
pub struct SendReportIpc {
    pub outcome: InvokeOutcomeIpc,
    pub auth_used: crate::ipc::collection::SavedAuthConfigIpc,
    pub tls_used: bool,
}

impl SendReportIpc {
    pub fn from_parts(
        outcome: InvokeOutcomeIpc,
        picked_auth: Option<handshaker_core::auth::SavedAuthConfig>,
        tls_used: bool,
    ) -> Self {
        let picked = picked_auth.unwrap_or(handshaker_core::auth::SavedAuthConfig::None);
        let auth_used = crate::ipc::collection::SavedAuthConfigIpc::from_core(picked);
        Self { outcome, auth_used, tls_used }
    }
}
```

In `src-tauri/src/ipc/mod.rs`, extend the existing re-export list that contains `SendCtxIpc`/`SendDraftIpc` with `SendReportIpc`.

In `src-tauri/src/commands/grpc.rs`:
- `grpc_send_impl` return type → `Result<SendReportIpc, IpcError>`; `grpc_send` likewise (add `SendReportIpc` to the `crate::ipc::invoke` imports).
- After the resolve call (line 294), capture the facts **before** anything moves:

```rust
    let eff = resolve_request(&saved, collection.as_ref(), active_env.as_ref(), tokens).await?;

    // Send-report facts, captured before `eff` fields move into the work closure.
    let picked_auth = eff.picked_auth.clone();
    let tls_used = eff.target.tls;
```

- The final lines become:

```rust
    invalidate_on_unauthenticated(&state.oauth2_provider, outcome.status_code, invalidate.as_ref());
    Ok(SendReportIpc::from_parts(outcome, picked_auth, tls_used))
```

(The `work` closure still produces `InvokeOutcomeIpc` — leave its `Ok::<InvokeOutcomeIpc, IpcError>(outcome.into())` unchanged.)

- [ ] **Step 4: Run Rust tests**

Run: `cargo test --workspace`
Expected: PASS (including the existing `grpc_send_unresolved_var_returns_unresolved_vars_error` — the error path is unchanged).

- [ ] **Step 5: Regenerate bindings**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
Expected: `src/ipc/bindings.ts` now exports `SendReportIpc`, and `commands.grpcSend` returns it.

- [ ] **Step 6: Update the TS facade + `SendResult`**

`src/ipc/client.ts` — add `SendReportIpc` to the type imports from `./bindings`, drop `InvokeOutcomeIpc` from `grpcSend`'s signature:

```ts
export async function grpcSend(
  draft: SendDraftIpc,
  ctx: SendCtxIpc,
  requestId: string,
  opts: CallOptionsIpc,
): Promise<SendReportIpc> {
  const r = await commands.grpcSend(draft, ctx, requestId, opts);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

`src/features/workflow/actions.ts` — add `SendReportIpc` to the type imports from `@/ipc/bindings`, then:

```ts
export type SendResult =
  | { kind: "ok"; report: SendReportIpc }
  | { kind: "error"; fault: ClientFault }
  | { kind: "unresolved"; unresolved: string[]; cycle: string[] | null }
  | { kind: "cancelled" };
```

In `sendStep` (line 252-254):

```ts
  try {
    const report = await ipc.grpcSend(draft, sendCtx, requestId, callOpts);
    return { kind: "ok", report };
```

In `stepPatchFromSendResult` (line 279-281) — temporary adaptation, this function moves into `useSend` in Task 3:

```ts
  if (res.kind === "ok") {
    const outcome = res.report.outcome;
    return { status: outcome.status_code === 0 ? "ok" : "error", outcome, error: null };
  }
```

In `CallPanel.tsx` line 124, the snapshot still reads `effectiveAuth`/`effTls` — leave untouched in this task (rewired in Task 4).

- [ ] **Step 7: Sync TS tests/fixtures**

- `src/features/workflow/actions.test.ts`: every `SendResult` ok-fixture changes from `{ kind: "ok", outcome: <o> }` to `{ kind: "ok", report: { outcome: <o>, auth_used: { kind: "none" }, tls_used: false } }` (keep each test's `<o>` as is). Tests calling `sendStep` with a mocked `ipc.grpcSend` change the mock's resolved value the same way.
- `src/features/workflow/CallPanel.editable.test.tsx`: its `grpcSend` mock resolves the same wrapped shape:

```ts
{ outcome: { status_code: 0, status_message: "", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 1 }, auth_used: { kind: "none" }, tls_used: false }
```

- [ ] **Step 8: Run the frontend gate**

Run: `pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 9: Add the CONTEXT.md term**

Append to `src-tauri/CONTEXT.md` (Language section), matching the file's existing Russian format:

```markdown
**Send report**:
Ответ команды Send: invoke-outcome плюс факты, которые пайплайн реально
использовал — `auth_used` (выигравший конфиг в шаблонной форме) и `tls_used`.
Снапшот истории записывает эти факты, а не спрашивает `auth_effective` второй раз.
_Avoid_: возврат материализованного заголовка (секреты не гуляют через IPC)
```

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/ipc/invoke.rs src-tauri/src/ipc/mod.rs src-tauri/src/commands/grpc.rs src-tauri/CONTEXT.md src/ipc/client.ts src/features/workflow/actions.ts src/features/workflow/actions.test.ts src/features/workflow/CallPanel.editable.test.tsx
git commit -m "feat(ipc): grpc_send returns SendReportIpc (auth/TLS actually used)"
```

---

### Task 3: Frontend — the `useSend` module

**Files:**
- Create: `src/features/workflow/useSend.ts`
- Test: `src/features/workflow/useSend.test.ts`

**Interfaces:**
- Consumes: `sendStep(step, {envName}, {requestId})` / `cancelStep(requestId)` and `type SendResult` from `./actions` (Task 2 shapes); `workflowStore.commitExecutedStep(step)` (store.ts:95); `useCatalog().bumpUsage(collectionId, itemId, usedAt)` (CatalogProvider); `type DraftOrigin` (store.ts:6).
- Produces: `useSend({ step, envName, onPatch, record?, origin? }): { send: () => Promise<void>, cancel: () => void }`. Task 4 wires CallPanel to it.

- [ ] **Step 1: Write the failing tests**

`src/features/workflow/useSend.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSend } from "./useSend";
import { workflowStore } from "./store";
import { newStep } from "./model";
import type { SendResult } from "./actions";
import type { SendReportIpc } from "@/ipc/bindings";

const mocks = vi.hoisted(() => ({
  sendStep: vi.fn<(...args: unknown[]) => Promise<SendResult>>(),
  cancelStep: vi.fn(() => Promise.resolve()),
  bumpUsage: vi.fn(() => Promise.resolve()),
}));

vi.mock("./actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actions")>()),
  sendStep: mocks.sendStep,
  cancelStep: mocks.cancelStep,
}));

vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({ bumpUsage: mocks.bumpUsage }),
}));

const report: SendReportIpc = {
  outcome: {
    status_code: 0,
    status_message: "",
    response_json: "{}",
    trailing_metadata: {},
    status_details: [],
    elapsed_ms: 5,
  },
  auth_used: {
    kind: "env_var",
    env_var: "TOK",
    header_name: "authorization",
    prefix: "Bearer ",
    environments: [],
  },
  tls_used: true,
};

function draft() {
  return newStep({ address: "h:50051", service: "pkg.Svc", method: "Do" });
}

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("useSend", () => {
  it("ok + record: patches, commits an executed snapshot with the report's auth/tls, bumps usage", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "ok", report });
    const step = draft();
    const patches: object[] = [];
    const origin = { collectionId: "c1", requestId: "r1" };
    const { result } = renderHook(() =>
      useSend({ step, envName: "dev", onPatch: (p) => patches.push(p), record: true, origin }),
    );

    await act(() => result.current.send());

    expect(patches[0]).toMatchObject({ status: "sending", error: null });
    expect(patches[1]).toMatchObject({ status: "ok", outcome: report.outcome, requestId: null });

    const executed = workflowStore.activeWorkflow().steps;
    expect(executed).toHaveLength(1);
    // The snapshot records fact from the Send report — not a second auth_effective fetch.
    expect(executed[0].auth).toEqual(report.auth_used);
    expect(executed[0].tls).toBe(true);
    expect(executed[0].id).not.toBe(step.id);
    expect(executed[0].requestId).toBeNull();
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
  });

  it("ok without record: patches but commits nothing and bumps nothing", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "ok", report });
    const { result } = renderHook(() =>
      useSend({ step: draft(), envName: null, onPatch: () => {} }),
    );
    await act(() => result.current.send());
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("record without origin: commits the snapshot but does not bump usage", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "ok", report });
    const { result } = renderHook(() =>
      useSend({ step: draft(), envName: null, onPatch: () => {}, record: true }),
    );
    await act(() => result.current.send());
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("unresolved: error patch listing the vars, no snapshot", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "unresolved", unresolved: ["host"], cycle: null });
    const patches: object[] = [];
    const { result } = renderHook(() =>
      useSend({ step: draft(), envName: null, onPatch: (p) => patches.push(p), record: true }),
    );
    await act(() => result.current.send());
    expect(patches[1]).toMatchObject({
      status: "error",
      outcome: null,
      error: { kind: "other", message: "Unresolved variables: {{host}}" },
    });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("cancelled: returns the step to draft", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "cancelled" });
    const patches: object[] = [];
    const { result } = renderHook(() =>
      useSend({ step: draft(), envName: null, onPatch: (p) => patches.push(p) }),
    );
    await act(() => result.current.send());
    expect(patches[1]).toMatchObject({ status: "draft", outcome: null, error: null });
  });

  it("gate: a step already sending does not send again", async () => {
    const step = { ...draft(), status: "sending" as const };
    const { result } = renderHook(() =>
      useSend({ step, envName: null, onPatch: () => {} }),
    );
    await act(() => result.current.send());
    expect(mocks.sendStep).not.toHaveBeenCalled();
  });

  it("cancel: forwards the in-flight requestId to cancelStep", () => {
    const step = { ...draft(), requestId: "rid-1" };
    const { result } = renderHook(() =>
      useSend({ step, envName: null, onPatch: () => {} }),
    );
    act(() => result.current.cancel());
    expect(mocks.cancelStep).toHaveBeenCalledWith("rid-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/workflow/useSend.test.ts`
Expected: FAIL — `./useSend` does not exist.

- [ ] **Step 3: Implement `useSend.ts`**

```ts
import { useCallback } from "react";
import { cancelStep, sendStep, type SendResult } from "./actions";
import { workflowStore, type DraftOrigin } from "./store";
import { useCatalog } from "@/features/catalog/CatalogProvider";
import { newId } from "@/lib/ids";
import type { Step } from "./model";

interface UseSendArgs {
  step: Step;
  envName: string | null;
  /** Apply a patch to the edited step (history step in place, or the global draft). */
  onPatch: (patch: Partial<Step>) => void;
  /** Focus(draft) only: record a completed call as an executed history snapshot. */
  record?: boolean;
  /** Origin-bound draft only: credit the saved request with one execution. */
  origin?: DraftOrigin | null;
}

/** Step patch for a Send result. Internal — the lifecycle's single home is this hook. */
function stepPatch(res: SendResult): Partial<Step> {
  if (res.kind === "ok") {
    const outcome = res.report.outcome;
    return { status: outcome.status_code === 0 ? "ok" : "error", outcome, error: null };
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

/** The single home of the Send lifecycle: gate → send → patch → executed snapshot →
 *  usage bump. The snapshot freezes the auth/TLS the core pipeline *actually used*
 *  (from the Send report) so re-sending the history step works standalone — no
 *  second `auth_effective` fetch that could go stale. */
export function useSend({ step, envName, onPatch, record = false, origin = null }: UseSendArgs) {
  const { bumpUsage } = useCatalog();

  const send = useCallback(async () => {
    if (step.status === "sending") return; // idempotent: Send stays inert while in flight
    const requestId = newId();
    onPatch({ status: "sending", error: null, requestId });
    const res = await sendStep(step, { envName }, { requestId });
    const patch = { ...stepPatch(res), requestId: null };
    onPatch(patch);
    if (record && res.kind === "ok") {
      const executed: Step = {
        ...step,
        auth: res.report.auth_used,
        tls: res.report.tls_used,
        ...patch,
        id: newId(),
        requestId: null,
      };
      workflowStore.commitExecutedStep(executed);
      if (origin) {
        void bumpUsage(origin.collectionId, origin.requestId, Date.now()).catch(() => {});
      }
    }
  }, [step, envName, onPatch, record, origin, bumpUsage]);

  const cancel = useCallback(() => {
    if (step.requestId) void cancelStep(step.requestId);
  }, [step.requestId]);

  return { send, cancel };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/workflow/useSend.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/useSend.ts src/features/workflow/useSend.test.ts
git commit -m "feat(workflow): useSend hook — single home of the Send lifecycle"
```

---

### Task 4: Wire CallPanel/FocusView, delete the shallow exports, run the gate

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx` (props 33-63, body 107-130, header wiring 210-218)
- Modify: `src/features/workflow/FocusView.tsx` (drop onExecuted/originAuth, pass `origin`)
- Modify: `src/features/workflow/actions.ts` (delete `stepPatchFromSendResult`, `shouldRecordExecuted`, `buildExecutedStep`)
- Modify: `src/features/workflow/actions.test.ts` (delete the deleted-exports' tests)
- Modify: `src/features/workflow/CallPanel.editable.test.tsx`, `src/features/workflow/CallPanel.layout.test.tsx` (drop `onExecuted`/`originAuth` usage; executed-history assertions move to `workflowStore`)
- Unchanged: `LedgerView.tsx`, `ListView.tsx` (they pass neither `record` nor `origin` — no history, same as today), `useEffectiveAuth.ts` (survives for the Auth tab only)

**Interfaces:**
- Consumes: `useSend` (Task 3), `DraftOrigin` (store.ts:6).
- Produces: `CallPanelProps` without `onExecuted`/`originAuth`, with `origin?: DraftOrigin | null`.

- [ ] **Step 1: Rewire CallPanel**

In `src/features/workflow/CallPanel.tsx`:

Imports — drop `stepPatchFromSendResult, shouldRecordExecuted, buildExecutedStep, cancelStep, sendStep` from the `./actions` import (keep `applyMethodSelection, resetBodyToTemplate, varsResolverFor`); add:

```ts
import { useSend } from "./useSend";
import type { DraftOrigin } from "./store";
```

(`newId` stays — check remaining uses; if only `onSend` used it, drop that import too.)

Props — delete `onExecuted` and `originAuth` (and the `_originAuth` destructure), add:

```ts
  /** Focus(draft) only: origin of the bound draft — lets useSend credit the saved
   *  request with one execution. Absent/null for unbound drafts and history panels. */
  origin?: DraftOrigin | null;
```

Body — replace the whole `onSend`/`onCancel` block (lines 107-130) with:

```ts
  // The Send lifecycle lives in useSend: gate → send → patch → executed snapshot
  // (auth/TLS from the Send report — fact, not a second fetch) → usage bump.
  const { send, cancel } = useSend({
    step,
    envName: activeWf.envName,
    onPatch,
    record: !!editable,
    origin,
  });
```

Then substitute uses: `sendShortcutRef.current` calls `void send()`; `<DraftAddressBar ... onSend={send} onCancel={cancel}` and `<AddressBar step={step} onSend={send} onCancel={cancel} />`. The `effectiveAuth` hook call stays (it feeds `RequestTabs serviceAuth` — Auth tab display only); `effTls` stays (probes/reflection/schema display).

- [ ] **Step 2: Rewire FocusView**

In `src/features/workflow/FocusView.tsx`:
- Destructure without `bumpUsage`: `const { tree, duplicateItem, renameItem } = useCatalog();`
- Delete the `originAuth` computation (line 57).
- In the `<CallPanel>` call: delete the whole `onExecuted={...}` block and `originAuth={originAuth}`; add `origin={origin}`.

- [ ] **Step 3: Delete the absorbed exports**

In `src/features/workflow/actions.ts` delete `stepPatchFromSendResult`, `shouldRecordExecuted`, `buildExecutedStep` (lines 278-303; keep `cancelStep`). In `src/features/workflow/actions.test.ts` delete their test cases. Run `pnpm lint` — the compiler confirms no other consumer remains (expected: none).

- [ ] **Step 4: Sync CallPanel tests**

In `CallPanel.editable.test.tsx` / `CallPanel.layout.test.tsx`: remove `onExecuted`/`originAuth` props from renders. Where a test asserted the `onExecuted` callback, assert the store instead: `workflowStore.reset()` in setup, render with `editable` and `origin`, then `expect(workflowStore.activeWorkflow().steps).toHaveLength(1)` after a successful send (the mocked `grpcSend` fixture from Task 2 provides the report). If a test file renders `CallPanel` inside a catalog-free tree, wrap with the existing catalog test provider or mock `@/features/catalog/CatalogProvider`'s `useCatalog` as in `useSend.test.ts`.

- [ ] **Step 5: Run the full gate**

Run: `pnpm lint && pnpm test && cargo test --workspace`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/CallPanel.tsx src/features/workflow/FocusView.tsx src/features/workflow/actions.ts src/features/workflow/actions.test.ts src/features/workflow/CallPanel.editable.test.tsx src/features/workflow/CallPanel.layout.test.tsx
git commit -m "feat(workflow): CallPanel/FocusView ride useSend; drop absorbed exports"
```

---

### Task 5: Live verification + finish

- [ ] **Step 1: Verify in the real app**

Run: `pnpm tauri:dev` (never a bare vite/browser — `getCurrentWindow` crashes outside Tauri). Manually: open a saved request with collection-level auth, Send, open the executed history row — its Auth must show the collection config (the fact from the Send report); cancel an in-flight send still returns the step to draft.

- [ ] **Step 2: Mark done + hand off to merge flow**

Update the spec status banner (`docs/superpowers/specs/2026-07-20-send-lifecycle-design.md`) to `🎉 DONE`; then follow `superpowers:finishing-a-development-branch` — squash to **one** feature commit (`.claude/rules/squashing-feature-branches.md`), ff-merge to `main`, archive plan+spec per `.claude/rules/archiving-completed-work.md`.
