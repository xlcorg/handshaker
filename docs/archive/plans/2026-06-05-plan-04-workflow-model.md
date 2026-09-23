# Plan 04 — Workflow model: global pending-draft, inline `Step.auth`, Send→executed step

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** ✅ **done** (`0381a9d..7d767d4`). 274/274 front-end tests green; `workflow/**`
and `catalog/{actions,mapping}` are type-clean. `pnpm lint` (`tsc -b`) still reports the
**15 pre-existing** legacy errors in dead code (`src/features/collections/**` ×14,
`src/ipc/client.ts` ×1) — unchanged from the plan-03 baseline, removed in plan-09; **zero**
new errors and none under `features/workflow`/`features/catalog`. `pnpm build` is `tsc`-gated
and remains blocked by those legacy errors (as in plan-03), so the gate was `pnpm test` +
targeted typecheck. NB: the Tasks 4–6 pass also caught and fixed a real defect introduced by
Task 3 — `createWorkflow` rebuilt state without `...state`, dropping the global `draft`
(`dd6001f`).
**Branch:** `redesign/workflow-ui-spec-plans`
**Phase:** 3 of spec §16 (`docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`).
**Predecessors:** plan-01 (`cadaccd..625241b`), plan-02 (`41d29bf..0a33cae`),
plan-03 (`7b1b885..2903c8a`) — all ✅ done. This plan **closes the plan-03 auth seam**
(Task 8) once `Step` gains inline `auth`.

**Goal:** Split the workflow model into a single global **pending-draft** (the Focus
editor) and the per-workflow **executed-step history**: `Send` runs the draft and appends
a frozen executed snapshot to the active workflow while the draft remains in Focus. In the
same pass, move auth onto the `Step` itself (`auth: SavedAuthConfigIpc` inline) and delete
`Step.serviceId` together with the `catalogStore`-based auth lookup in `CallPanel`/`actions`.

**Architecture:** The store gains a store-level `draft: Step | null` slot beside the
workflows. `CallPanel` becomes update-strategy-agnostic — it edits whatever `Step` it is
given through an injected `onPatch`, and optionally reports a completed call through
`onExecuted`. Focus wires the draft (`updateDraft` + `commitExecutedStep`); List/Ledger keep
editing their history step in place (no `onExecuted`, so re-send stays in place — unchanged
behavior). Auth resolution reads the step's own `auth` field; `catalogStore`/`serviceId`
disappear from the workflow feature.

**Tech Stack:** TypeScript, React 18, Vitest + Testing Library, `@/` path alias (= `src/`).

## Build / test commands (repo root, PowerShell)

- Single test file: `pnpm test src/features/workflow/<file>.test.ts`
- All front-end tests: `pnpm test`
- Typecheck: `pnpm lint` (`tsc -b`) · Prod build: `pnpm build`

## Design notes (decisions locked from spec §3, §7, §16, §15-table)

1. **One global pending-draft** (spec L60, table "Pending-draft | один глобальный"):
   stored as `WorkflowState.draft: Step | null`, **not** per-workflow, **not** inside
   `wf.steps`. `null` ⇒ Focus shows an empty state.
2. **Send semantics** (spec L55-57, L295-296, table "Send → шаг", "Draft после Send"):
   the draft is sent **in place** (its own `status`/`outcome` update, so the response stays
   visible in Focus), **and** a frozen executed snapshot (`{...draft, ...patch, id: newId(),
   requestId: null}`) is appended to the active workflow's history. The draft itself is never
   added to `wf.steps`. "Pending-draft в историю не попадает, пока не выполнен" ⇒ a snapshot
   is recorded **only when the call reached the server** (`SendResult.kind === "ok"`, i.e. a
   gRPC response — success *or* non-zero status). Client-side outcomes (`unresolved`,
   transport `error`, `cancelled`) update the draft only; nothing is appended.
3. **Auth is inline on the step** (spec §7 L184-186, table "Step.auth"): `Step.auth:
   SavedAuthConfigIpc`. `serviceId` and the `catalogStore`-driven `resolveStepAuthHeader`
   branch are removed. The folder→collection inheritance / env-resolve described in §7 is
   wired later (plan-05/06 sidebar+save); here the draft simply carries whatever `auth` it
   was created with (`none` by default).
4. **History views unchanged** (spec L62-64, table "История-вьюхи | как есть"):
   `StepRail`/`StepRow`/`StepList`/`ListView`/`LedgerView` keep rendering `wf.steps`. Their
   only change is the new `onPatch` prop threaded into `CallPanel` (in-place edit, identical
   to today's `updateStep`). No visual/behavioral change.

## File structure (boundaries)

- `src/features/workflow/model.ts` — `Step.auth: SavedAuthConfigIpc`, drop `Step.serviceId`;
  `newStep` gains `auth?`, drops `serviceId`.
- `src/features/workflow/actions.ts` — replace `resolveStepAuthHeader(serviceId, getService,
  authResolve)` with `resolveAuthHeader(auth, authResolve)`; `createStepFromMethod` opts
  `serviceId` → `auth`; add pure `shouldRecordExecuted` + `buildExecutedStep` helpers.
- `src/features/workflow/store.ts` — `WorkflowState.draft`; `setDraft`/`updateDraft`/
  `clearDraft`/`commitExecutedStep`; `useDraft` hook.
- `src/features/workflow/CallPanel.tsx` — inject `onPatch` (required) + `onExecuted`
  (optional); auth from `step.auth`; drop `catalogStore`.
- `src/features/workflow/FocusView.tsx` — render the **draft** through `CallPanel` with
  draft wiring; empty state when no draft.
- `src/features/workflow/ListView.tsx` + `LedgerView.tsx` — pass in-place `onPatch` to
  `CallPanel`.
- `src/features/catalog/actions.ts` — `openCallFromMethod` sets the **draft** (not a history
  step) and passes the service's `auth` inline.
- `src/features/catalog/mapping.ts` — close the plan-03 seam: `stepToSavedRequest` copies
  `step.auth`; `savedRequestToDraft` restores `auth` onto the draft.

---

### Task 1: `model.ts` — inline `Step.auth`, drop `serviceId`

**Files:**
- Modify: `src/features/workflow/model.ts`
- Test: `src/features/workflow/model.test.ts`

`SavedAuthConfigIpc` is the generated union in `src/ipc/bindings.ts` (kinds include
`"none"`, `"env_var"`, `"oauth_2_client_credentials"`, …). The default auth is
`{ kind: "none" }`.

- [ ] **Step 1: Rewrite the `serviceId` test block as an `auth` block**

In `src/features/workflow/model.test.ts`, replace the entire
`describe("newStep — serviceId and metadata", …)` block (lines ~19-32) with:

```ts
describe("newStep — auth and metadata", () => {
  it("newStep defaults auth to { kind: 'none' } and metadata to []", () => {
    const s = newStep({ address: "h", tls: false, service: "S", method: "M" });
    expect(s.auth).toEqual({ kind: "none" });
    expect(s.metadata).toEqual([]);
  });

  it("newStep carries provided auth and metadata", () => {
    const rows = [{ key: "x", value: "1", enabled: true }];
    const auth = { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
    const s = newStep({ address: "h", tls: false, service: "S", method: "M", auth, metadata: rows });
    expect(s.auth).toEqual(auth);
    expect(s.metadata).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/model.test.ts`
Expected: FAIL — `newStep` does not accept/return `auth` (and `s.auth` is `undefined`).

- [ ] **Step 3: Implement the model change**

In `src/features/workflow/model.ts`:

1. Add the import:

```ts
import type { InvokeOutcomeIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
```

2. In `interface Step`, **remove** the `serviceId` line and **add** `auth`:

```ts
export interface Step {
  id: string;
  address: string; // resolved or {{var}} template
  tls: boolean;
  service: string; // proto service full name, e.g. "payments.v1.PaymentService"
  method: string; // method name, e.g. "GetPayment"
  auth: SavedAuthConfigIpc; // inline auth for this call (resolved at Send)
  requestJson: string; // editable request body (skeleton-prefilled)
  metadata: MetadataRow[];
  status: StepStatus;
  outcome: InvokeOutcomeIpc | null;
  error: string | null; // client-side (non-gRPC) error message
  requestId: string | null; // transient: in-flight invoke id while status === "sending"
}
```

3. Update `newStep`'s init type and body — drop `serviceId`, add `auth`:

```ts
export function newStep(init: {
  address: string;
  tls: boolean;
  service: string;
  method: string;
  requestJson?: string;
  metadata?: MetadataRow[];
  auth?: SavedAuthConfigIpc;
}): Step {
  return {
    id: newId(),
    address: init.address,
    tls: init.tls,
    service: init.service,
    method: init.method,
    auth: init.auth ?? { kind: "none" },
    requestJson: init.requestJson ?? "{}",
    metadata: init.metadata ?? [],
    status: "draft",
    outcome: null,
    error: null,
    requestId: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/model.test.ts`
Expected: PASS. (`pnpm lint` will still fail repo-wide — `actions.ts`/`CallPanel.tsx`/
`mapping.ts`/`catalog/actions.ts` still reference `serviceId`; fixed in Tasks 2,4,7,8.)

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/model.ts src/features/workflow/model.test.ts
git commit -m "feat(workflow): inline Step.auth, drop serviceId (plan-04)"
```

---

### Task 2: `actions.ts` — inline auth resolve + executed-snapshot helpers

**Files:**
- Modify: `src/features/workflow/actions.ts`
- Test: `src/features/workflow/actions.test.ts`

Replaces the `serviceId`/`catalogStore` lookup with resolution from the step's own `auth`,
makes `createStepFromMethod` seed `auth` instead of `serviceId`, and adds two pure helpers
the draft Send path needs.

- [ ] **Step 1: Write the failing tests**

In `src/features/workflow/actions.test.ts`:

1. Update the import line (Task 2 renames the export):

```ts
import { createStepFromMethod, sendStep, stepPatchFromSendResult, resolveAuthHeader, shouldRecordExecuted, buildExecutedStep, cancelStep } from "./actions";
```

2. Add `newStep` to the test imports (used by the new helper tests):

```ts
import { newStep } from "./model";
```

3. Replace the `createStepFromMethod` "seeds metadata … records serviceId" test
(lines ~53-64) with:

```ts
  it("seeds metadata (deep copy) from service defaultMetadata and records inline auth", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue("{}");
    const defaults = [{ key: "x-tenant", value: "{{tenant}}", enabled: true }];
    const auth = { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
    const step = await createStepFromMethod(
      { address: "h:443", tls: true }, "S", "M",
      { auth, defaultMetadata: defaults },
    );
    expect(step.auth).toEqual(auth);
    expect(step.metadata).toEqual(defaults);
    expect(step.metadata).not.toBe(defaults);       // deep copy: array identity differs
    expect(step.metadata[0]).not.toBe(defaults[0]); // and row identity differs
  });
```

4. Replace the whole `describe("resolveStepAuthHeader", …)` block (lines ~251-286) with:

```ts
describe("resolveAuthHeader", () => {
  it("returns kind 'none' when auth.kind is none (no resolve call)", async () => {
    const r = await resolveAuthHeader({ kind: "none" }, ipc.authResolve);
    expect(r.kind).toBe("none");
    expect(ipc.authResolve).not.toHaveBeenCalled();
  });

  it("returns a header when EnvVar auth resolves", async () => {
    vi.mocked(ipc.authResolve).mockResolvedValue({ header_name: "authorization", header_value: "Bearer t" });
    const auth = { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
    const r = await resolveAuthHeader(auth, ipc.authResolve);
    expect(r).toEqual({ kind: "header", header: { key: "authorization", value: "Bearer t" } });
  });

  it("returns kind 'none' when authResolve yields null credentials", async () => {
    vi.mocked(ipc.authResolve).mockResolvedValue(null);
    const auth = { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
    const r = await resolveAuthHeader(auth, ipc.authResolve);
    expect(r.kind).toBe("none");
  });

  it("returns kind 'error' when authResolve throws (OAuth2 NotImplemented)", async () => {
    vi.mocked(ipc.authResolve).mockRejectedValue({ type: "NotImplemented", message: "oauth2 token fetch" });
    const auth = { kind: "oauth_2_client_credentials" as const, token_url: "u", client_id: "c", client_secret_env_var: "S", scopes: [] };
    const r = await resolveAuthHeader(auth, ipc.authResolve);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("oauth2");
  });
});

describe("shouldRecordExecuted", () => {
  it("records only calls that reached the server (kind 'ok')", () => {
    const outcome = { status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, elapsed_ms: 1 };
    expect(shouldRecordExecuted({ kind: "ok", outcome })).toBe(true);
    // non-zero gRPC status still reached the server → recorded
    const errOutcome = { status_code: 5, status_message: "NOT_FOUND", response_json: null, trailing_metadata: {}, elapsed_ms: 1 };
    expect(shouldRecordExecuted({ kind: "ok", outcome: errOutcome })).toBe(true);
    expect(shouldRecordExecuted({ kind: "error", message: "refused" })).toBe(false);
    expect(shouldRecordExecuted({ kind: "unresolved", unresolved: ["x"], cycle: null })).toBe(false);
    expect(shouldRecordExecuted({ kind: "cancelled" })).toBe(false);
  });
});

describe("buildExecutedStep", () => {
  it("freezes a fresh-id snapshot of the draft with the send patch applied", () => {
    const draft = newStep({ address: "h:443", tls: true, service: "S", method: "M" });
    const outcome = { status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, elapsed_ms: 7 };
    const snap = buildExecutedStep(draft, { status: "ok", outcome, error: null, requestId: null });
    expect(snap.id).not.toBe(draft.id);     // distinct history entry
    expect(snap.requestId).toBeNull();
    expect(snap.status).toBe("ok");
    expect(snap.outcome).toEqual(outcome);
    expect(snap.service).toBe("S");
    expect(snap.method).toBe("M");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/workflow/actions.test.ts`
Expected: FAIL — `resolveAuthHeader`/`shouldRecordExecuted`/`buildExecutedStep` are not
exported; `createStepFromMethod` does not accept an `auth` opt.

- [ ] **Step 3: Implement the changes in `actions.ts`**

1. Add `newId`/`newStep` are already imported; ensure `import { newStep, type MetadataRow,
   type Step } from "./model";` (it already imports `newStep`, `MetadataRow`, `Step`).

2. Change `createStepFromMethod`'s `opts` and body (drop `serviceId`, add `auth`):

```ts
export async function createStepFromMethod(
  target: CallTargetInit,
  service: string,
  method: string,
  opts: { auth?: SavedAuthConfigIpc; defaultMetadata?: MetadataRow[] } = {},
): Promise<Step> {
  let requestJson = "{}";
  try {
    requestJson = await ipc.grpcBuildRequestSkeleton(
      { address: target.address, tls: target.tls, skip_verify: false },
      service,
      method,
    );
  } catch {
    requestJson = "{}";
  }
  return newStep({
    address: target.address,
    tls: target.tls,
    service,
    method,
    requestJson,
    auth: opts.auth ?? { kind: "none" },
    metadata: (opts.defaultMetadata ?? []).map((r) => ({ ...r })), // deep copy → editable
  });
}
```

3. **Replace** `resolveStepAuthHeader` (the whole function, lines ~54-69) with
   `resolveAuthHeader` (resolves from inline auth, `AuthCredentialsIpc` is already imported):

```ts
export async function resolveAuthHeader(
  auth: SavedAuthConfigIpc,
  authResolve: (c: SavedAuthConfigIpc) => Promise<AuthCredentialsIpc | null>,
): Promise<AuthHeaderResult> {
  if (auth.kind === "none") return { kind: "none" };
  try {
    const creds = await authResolve(auth);
    if (!creds) return { kind: "none" };
    return { kind: "header", header: { key: creds.header_name, value: creds.header_value } };
  } catch (e) {
    return { kind: "error", message: errorToMessage(e) };
  }
}
```

4. Add the two pure helpers (place after `stepPatchFromSendResult`):

```ts
/** Whether a Send result represents a call that reached the server and should be
 *  recorded as an executed history step (gRPC responded — success or non-zero status). */
export function shouldRecordExecuted(res: SendResult): boolean {
  return res.kind === "ok";
}

/** A frozen executed-history snapshot of `draft` with the Send patch applied and a fresh id. */
export function buildExecutedStep(draft: Step, patch: Partial<Step>): Step {
  return { ...draft, ...patch, id: newId(), requestId: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/workflow/actions.test.ts`
Expected: PASS — all existing `sendStep`/`stepPatchFromSendResult`/`cancelStep` tests plus
the new `resolveAuthHeader`/`shouldRecordExecuted`/`buildExecutedStep` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/actions.ts src/features/workflow/actions.test.ts
git commit -m "feat(workflow): resolveAuthHeader from inline auth + executed-snapshot helpers (plan-04)"
```

---

### Task 3: `store.ts` — global pending-draft slot

**Files:**
- Modify: `src/features/workflow/store.ts`
- Test: `src/features/workflow/store.test.ts`

Adds a store-level `draft: Step | null` with mutators and a `commitExecutedStep` that appends
a snapshot to the active workflow's history.

- [ ] **Step 1: Write the failing tests** (append to `store.test.ts`)

```ts
import { workflowStore, useDraft } from "./store"; // useDraft is new; extend the existing import

describe("global pending-draft", () => {
  beforeEach(() => workflowStore.reset());

  it("starts with no draft", () => {
    expect(workflowStore.getState().draft).toBeNull();
  });

  it("setDraft stores a draft and notifies; clearDraft removes it", () => {
    let calls = 0;
    const unsub = workflowStore.subscribe(() => calls++);
    const d = newStep({ address: "h", tls: false, service: "S", method: "M" });
    workflowStore.setDraft(d);
    expect(workflowStore.getState().draft).toBe(d);
    workflowStore.clearDraft();
    expect(workflowStore.getState().draft).toBeNull();
    expect(calls).toBe(2);
    unsub();
  });

  it("updateDraft merges a patch onto the current draft", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    workflowStore.updateDraft({ status: "sending", requestId: "req-1" });
    expect(workflowStore.getState().draft?.status).toBe("sending");
    expect(workflowStore.getState().draft?.requestId).toBe("req-1");
  });

  it("updateDraft is a no-op when there is no draft", () => {
    workflowStore.updateDraft({ status: "ok" });
    expect(workflowStore.getState().draft).toBeNull();
  });

  it("commitExecutedStep appends a snapshot to the active workflow and activates it; draft untouched", () => {
    const draft = newStep({ address: "h", tls: false, service: "S", method: "M" });
    workflowStore.setDraft(draft);
    const snap = newStep({ address: "h", tls: false, service: "S", method: "M" });
    workflowStore.commitExecutedStep(snap);
    const wf = workflowStore.activeWorkflow();
    expect(wf.steps.map((s) => s.id)).toEqual([snap.id]);
    expect(wf.activeStepId).toBe(snap.id);
    expect(workflowStore.getState().draft).toBe(draft); // draft remains in Focus
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/workflow/store.test.ts`
Expected: FAIL — `useDraft`/`setDraft`/`updateDraft`/`clearDraft`/`commitExecutedStep` do
not exist and `state.draft` is `undefined`.

- [ ] **Step 3: Implement the draft slot in `store.ts`**

1. Extend imports to bring in `Step` and the `addStep` reducer:

```ts
import { newWorkflow, type Step, type Workflow } from "./model";
import { addStep, setWorkflowEnv as setWorkflowEnvReducer } from "./reducers";
```

2. Add `draft` to the state shape and initial state:

```ts
export interface WorkflowState {
  workflows: Workflow[];
  activeWorkflowId: string;
  draft: Step | null;
}

function initialState(): WorkflowState {
  const wf = newWorkflow("workflow-1");
  return { workflows: [wf], activeWorkflowId: wf.id, draft: null };
}
```

3. Add the draft methods to the `workflowStore` object (e.g. after `update`):

```ts
  setDraft(step: Step | null) {
    state = { ...state, draft: step };
    emit();
  },
  updateDraft(patch: Partial<Step>) {
    if (!state.draft) return;
    state = { ...state, draft: { ...state.draft, ...patch } };
    emit();
  },
  clearDraft() {
    state = { ...state, draft: null };
    emit();
  },
  /** Append a frozen executed snapshot to the active workflow's history. */
  commitExecutedStep(step: Step) {
    workflowStore.update((w) => addStep(w, step));
  },
```

4. Add the hook at the bottom:

```ts
export function useDraft(): Step | null {
  useWorkflowState(); // subscribe
  return workflowStore.getState().draft;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/workflow/store.test.ts`
Expected: PASS — existing store tests plus the new `global pending-draft` block green.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/store.ts src/features/workflow/store.test.ts
git commit -m "feat(workflow): global pending-draft slot + commitExecutedStep (plan-04)"
```

---

### Task 4: `CallPanel.tsx` — inject update strategy, auth from `step.auth`

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx`

`CallPanel` no longer hardcodes `workflowStore.update(updateStep(...))` or reads
`catalogStore`. It edits its `step` through `onPatch` and, when given `onExecuted`, reports a
completed call. **Why no unit test here:** `CallPanel` mounts the Monaco-backed `BodyEditor`,
which the suite deliberately leaves untested under jsdom (see archived plan-03/05). It is
covered by the `ListView`/`LedgerView` view tests (which mock `./CallPanel`) plus `pnpm lint`;
the send/record logic itself is unit-tested in Task 2.

- [ ] **Step 1: Replace the file contents**

Replace `src/features/workflow/CallPanel.tsx` with:

```tsx
import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { authResolve } from "@/ipc/client";
import { ClientErrorBanner } from "./ClientErrorBanner";
import { AddressBar } from "./AddressBar";
import { RequestTabs } from "./RequestTabs";
import {
  resolveAuthHeader,
  sendStep,
  stepPatchFromSendResult,
  shouldRecordExecuted,
  buildExecutedStep,
  cancelStep,
} from "./actions";
import { newId } from "@/lib/ids";
import type { MetadataRow, Step } from "./model";

interface CallPanelProps {
  step: Step;
  /** Apply a patch to the edited step (history step in place, or the global draft). */
  onPatch: (patch: Partial<Step>) => void;
  /** Draft only: record a completed call as an executed history snapshot. */
  onExecuted?: (executed: Step) => void;
}

/** The editable, sendable surface for one step — reused by Focus(draft)/List/Ledger. */
export function CallPanel({ step, onPatch, onExecuted }: CallPanelProps) {
  const onBody = (value: string) => onPatch({ requestJson: value });
  const onMetadata = (rows: MetadataRow[]) => onPatch({ metadata: rows });

  const onSend = async () => {
    const requestId = newId();
    onPatch({ status: "sending", error: null, requestId });
    const auth = await resolveAuthHeader(step.auth, authResolve);
    if (auth.kind === "error") {
      onPatch({ status: "error", outcome: null, error: auth.message, requestId: null });
      return;
    }
    const res = await sendStep(step, auth.kind === "header" ? auth.header : null, { requestId });
    const patch = { ...stepPatchFromSendResult(res), requestId: null };
    onPatch(patch);
    if (onExecuted && shouldRecordExecuted(res)) onExecuted(buildExecutedStep(step, patch));
  };

  const onCancel = () => {
    if (step.requestId) void cancelStep(step.requestId);
  };

  return (
    <div className="flex h-full flex-col">
      <AddressBar step={step} onSend={onSend} onCancel={onCancel} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-border">
          <RequestTabs step={step} serviceAuth={step.auth} onBody={onBody} onMetadata={onMetadata} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <ResponseSlot step={step} />
        </div>
      </div>
    </div>
  );
}

function ResponseSlot({ step }: { step: Step }) {
  const respState: RespState =
    step.status === "sending"
      ? "sending"
      : step.error
        ? "error"
        : step.outcome
          ? step.outcome.status_code === 0
            ? "success"
            : "error"
          : "idle";

  return (
    <>
      {step.error && !step.outcome ? <ClientErrorBanner message={step.error} /> : null}
      <ResponsePanel state={respState} outcome={step.outcome} />
    </>
  );
}
```

Notes: `AddressBar` is a **read-only** header (it displays `step.method`/`step.address`/
`step.service` + status and exposes only `onSend`/`onCancel`). It does **not** edit
address/tls, so it needs no `onPatch` — confirmed in `src/features/workflow/AddressBar.tsx`.
The only editable surfaces routed through `onPatch` are the body and metadata (via
`RequestTabs`). Address/TLS editing of the draft is reflection-driven and lands in plan-06.

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: `CallPanel.tsx` is type-clean. Repo-wide `tsc -b` still fails because
`FocusView`/`ListView`/`LedgerView` don't yet pass `onPatch` (fixed in Tasks 5-6) — those are
the only new errors expected here, plus the pre-existing 15 legacy errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/workflow/CallPanel.tsx
git commit -m "refactor(workflow): CallPanel edits via injected onPatch/onExecuted; auth from step.auth (plan-04)"
```

---

### Task 5: `FocusView.tsx` — render the global draft

**Files:**
- Modify: `src/features/workflow/FocusView.tsx`

Focus now edits the **draft**, not a history step. Empty state when there is no draft.

- [ ] **Step 1: Replace the file contents**

Replace `src/features/workflow/FocusView.tsx` with:

```tsx
import { CallPanel } from "./CallPanel";
import { useDraft, workflowStore } from "./store";
import type { Step } from "./model";

export function FocusView() {
  const draft = useDraft();

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">
        {draft ? (
          <CallPanel
            step={draft}
            onPatch={(patch: Partial<Step>) => workflowStore.updateDraft(patch)}
            onExecuted={(executed: Step) => workflowStore.commitExecutedStep(executed)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Нет активного реквеста — выбери метод в сайдбаре или нажми ⌘K.
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: the `StepRail` (history glance) is intentionally dropped from Focus — Focus is the draft
editor; executed history lives in List/Ledger (spec §3, "History-вьюхи как есть"). `StepRail`
remains an independent component with its own passing test; it is re-homed/removed in a later
phase. This keeps Focus's responsibility single.

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: `FocusView.tsx` type-clean (remaining repo errors: `ListView`/`LedgerView` onPatch,
fixed next; pre-existing 15 legacy).

- [ ] **Step 3: Commit**

```bash
git add src/features/workflow/FocusView.tsx
git commit -m "feat(workflow): FocusView renders the global pending-draft (plan-04)"
```

---

### Task 6: `ListView.tsx` + `LedgerView.tsx` — in-place `onPatch`

**Files:**
- Modify: `src/features/workflow/ListView.tsx`
- Modify: `src/features/workflow/LedgerView.tsx`

History views keep editing their step in place (today's behavior) — now expressed through the
injected `onPatch`. No `onExecuted` ⇒ re-send updates in place, no snapshot appended.

- [ ] **Step 1: Wire `ListView`**

In `src/features/workflow/ListView.tsx`, add the imports for the reducer/store and replace
the `<CallPanel step={active} />` usage:

```tsx
import { CallPanel } from "./CallPanel";
import { StepList } from "./StepList";
import { useActiveWorkflow, workflowStore } from "./store";
import { updateStep } from "./reducers";
import type { Step } from "./model";
```

```tsx
        {active ? (
          <CallPanel
            step={active}
            onPatch={(patch: Partial<Step>) =>
              workflowStore.update((w) => updateStep(w, active.id, patch))
            }
          />
        ) : (
```

- [ ] **Step 2: Wire `LedgerView`**

Read `src/features/workflow/LedgerView.tsx` (around line 50) and apply the identical pattern:
add `workflowStore`/`updateStep`/`Step` imports and pass
`onPatch={(patch) => workflowStore.update((w) => updateStep(w, step.id, patch))}` to the
`<CallPanel step={step} … />` there (use that view's loop variable name — `step`).

- [ ] **Step 3: Run the view tests + typecheck**

Run: `pnpm test src/features/workflow/ListView.test.tsx src/features/workflow/LedgerView.test.tsx`
Expected: PASS (the tests mock `./CallPanel` and only read `step.method`; the new prop is
ignored by the mock).

Run: `pnpm lint`
Expected: the workflow feature is now type-clean; only the **15 pre-existing** legacy errors
(`src/features/collections/**`, `src/ipc/client.ts`) remain — **unless** `catalog/actions.ts`
or `catalog/mapping.ts` still reference the removed `serviceId` (fixed in Tasks 7-8). Expect
those two files to surface errors until then.

- [ ] **Step 4: Commit**

```bash
git add src/features/workflow/ListView.tsx src/features/workflow/LedgerView.tsx
git commit -m "refactor(workflow): List/Ledger pass in-place onPatch to CallPanel (plan-04)"
```

---

### Task 7: `catalog/actions.ts` — open methods as the draft, pass inline auth

**Files:**
- Modify: `src/features/catalog/actions.ts`
- Test: `src/features/catalog/actions.test.ts`

`openCallFromMethod` currently `addStep`s an unexecuted step into history and passes
`serviceId`. In the new model an opened method becomes the **pending-draft** (request-first),
carrying the service's `auth` inline. (The derived `CatalogService` sidebar is replaced in
plan-05 and deleted in plan-09; this keeps the live app coherent through the transition.)

- [ ] **Step 1: Inspect the current test expectations**

Read `src/features/catalog/actions.test.ts` to see how `openCallFromMethod` is asserted
(it currently checks `addStep`/`setView` and `serviceId` threading). Note the exact mock
setup (it mocks `@/features/workflow/store`, `@/features/workflow/reducers`,
`@/features/workflow/actions`, and `./store`).

- [ ] **Step 2: Update the test to expect a draft + inline auth**

Adjust `src/features/catalog/actions.test.ts` so that:
- the `@/features/workflow/store` mock exposes `setDraft` and `update` (drop reliance on
  `addStep` for the open path if the test asserted it);
- `createStepFromMethod` is asserted to be called with `{ auth: svc.auth, defaultMetadata:
  svc.defaultMetadata }` (no `serviceId`);
- `openCallFromMethod` is asserted to call `workflowStore.setDraft(step)` and set the view to
  `focus`.

Concretely, replace the `openCallFromMethod` assertions with (adapt to the file's existing
mock style — keep the same `vi.mock` factories, add `setDraft: vi.fn()` to the store mock):

```ts
  it("opens the method as the global draft, carrying the service auth inline", async () => {
    vi.mocked(createStepFromMethod).mockResolvedValue(
      newStep({ address: "h:443", tls: true, service: "pkg.v1.Svc", method: "GetX" }),
    );
    const svc = makeService({ /* existing helper; ensure it has `auth` + `defaultMetadata` */ });
    await openCallFromMethod(svc, "pkg.v1.Svc", "GetX");
    expect(createStepFromMethod).toHaveBeenCalledWith(
      { address: svc.address, tls: svc.tls },
      "pkg.v1.Svc",
      "GetX",
      { auth: svc.auth, defaultMetadata: svc.defaultMetadata },
    );
    expect(workflowStore.setDraft).toHaveBeenCalledWith(expect.objectContaining({ method: "GetX" }));
  });
```

(Reuse the file's existing service-factory/helpers and mock handles; the snippet shows the
intended shape, not new infrastructure. If the existing test asserted `addStep`, remove that
expectation.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: FAIL — `openCallFromMethod` still passes `serviceId`/`addStep`.

- [ ] **Step 4: Implement `openCallFromMethod`**

In `src/features/catalog/actions.ts`, replace the `openCallFromMethod` body. Drop the
`addStep` import if it becomes unused; keep `setView`:

```ts
import { setView } from "@/features/workflow/reducers";
```

```ts
export async function openCallFromMethod(
  svc: CatalogService,
  service: string,
  method: string,
  opts: { newWorkflow?: boolean } = {},
): Promise<void> {
  if (opts.newWorkflow) workflowStore.createWorkflow(method);
  const step = await createStepFromMethod(
    { address: svc.address, tls: svc.tls },
    service,
    method,
    { auth: svc.auth, defaultMetadata: svc.defaultMetadata },
  );
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(step);
}
```

(`CatalogService` already carries `auth: SavedAuthConfigIpc` — confirm via
`src/features/catalog/model.ts`. If its auth field has a different name, use that name.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/actions.ts src/features/catalog/actions.test.ts
git commit -m "feat(catalog): open method as global draft with inline auth (plan-04)"
```

---

### Task 8: `mapping.ts` — close the plan-03 auth seam (round-trip auth)

**Files:**
- Modify: `src/features/catalog/mapping.ts`
- Test: `src/features/catalog/mapping.test.ts`

Now that `Step` carries inline `auth`, `stepToSavedRequest` must copy it and
`savedRequestToDraft` must restore it (plan-03 deferred this).

- [ ] **Step 1: Update/add the failing tests**

In `src/features/catalog/mapping.test.ts`:

1. In the first `stepToSavedRequest` test ("maps step fields …"), the `step()` helper builds
   a `Step` whose `auth` defaults to `{ kind: "none" }`; add an explicit auth and assert it
   is copied. Change that test to set `auth` on the step and expect it on the saved request:

```ts
    const s = step({
      address: "{{host}}:443",
      tls: true,
      service: "pkg.v1.Svc",
      method: "GetX",
      requestJson: '{"id":"1"}',
      metadata: [{ key: "x-tenant", value: "acme", enabled: true }],
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
    });
    const saved = stepToSavedRequest(s, { id: "req-1", name: "GetX" });
    expect(saved).toEqual({
      id: "req-1",
      name: "GetX",
      address_template: "{{host}}:443",
      service: "pkg.v1.Svc",
      method: "GetX",
      body_template: '{"id":"1"}',
      metadata: [{ key: "x-tenant", value: "acme", enabled: true }],
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
      tls_override: true,
      last_used_at: null,
      use_count: 0,
    });
```

2. In `savedRequestToDraft` "produces a draft-status Step …": remove the obsolete
   `expect(draft.serviceId).toBeNull();` line (the field no longer exists) and add an auth
   assertion. Give the `saved(...)` an explicit auth and assert the draft carries it:

```ts
    const draft = savedRequestToDraft(
      saved({
        address_template: "{{host}}:443",
        tls_override: true,
        body_template: '{"id":"1"}',
        metadata: [{ key: "x", value: "y", enabled: true }],
        auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
      }),
    );
    expect(draft.status).toBe("draft");
    expect(draft.auth).toEqual({ kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " });
    expect(draft.address).toBe("{{host}}:443");
    // …unchanged assertions for tls/service/method/requestJson/metadata…
```

3. Add a dedicated auth round-trip test (append inside `describe("savedRequestToDraft", …)`):

```ts
  it("round-trips inline auth step -> saved -> draft", () => {
    const auth = { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
    const original = step({ service: "pkg.v1.Svc", method: "Ping", auth });
    const draft = savedRequestToDraft(stepToSavedRequest(original, { id: "x", name: "Ping" }));
    expect(draft.auth).toEqual(auth);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/features/catalog/mapping.test.ts`
Expected: FAIL — `stepToSavedRequest` still emits `auth: { kind: "none" }`;
`savedRequestToDraft` drops auth (and the `serviceId` assertion no longer compiles).

- [ ] **Step 3: Implement the auth pass-through in `mapping.ts`**

```ts
export function stepToSavedRequest(step: Step, opts: { id: string; name: string }): SavedRequestIpc {
  return {
    id: opts.id,
    name: opts.name,
    address_template: step.address,
    service: step.service,
    method: step.method,
    body_template: step.requestJson,
    metadata: step.metadata.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled })),
    auth: step.auth,
    tls_override: step.tls,
    last_used_at: null,
    use_count: 0,
  };
}

export function savedRequestToDraft(saved: SavedRequestIpc): Step {
  return newStep({
    address: saved.address_template,
    tls: saved.tls_override ?? false,
    service: saved.service,
    method: saved.method,
    requestJson: saved.body_template,
    metadata: saved.metadata.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled })),
    auth: saved.auth,
  });
}
```

Also update the doc-comments to drop the "auth emitted as none / dropped until a later plan"
wording (the seam is now closed).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/features/catalog/mapping.test.ts`
Expected: PASS (the existing round-trip test plus the new auth round-trip).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/mapping.ts src/features/catalog/mapping.test.ts
git commit -m "feat(catalog): close plan-03 auth seam — round-trip Step.auth (plan-04)"
```

---

### Task 9: Whole-suite + typecheck gate; update index

**Files:**
- Modify: `docs/superpowers/plans/2026-06-05-plan-00-index.md`
- Modify: `docs/superpowers/plans/2026-06-05-plan-04-workflow-model.md` (this file's banner)

- [ ] **Step 1: Run the full front-end test suite**

Run: `pnpm test`
Expected: PASS — all suites green, including the updated
`workflow/{model,actions,store}.test.ts`, `workflow/{ListView,LedgerView}.test.tsx`, and
`catalog/{actions,mapping}.test.ts`.

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: the `workflow/` and `catalog/{actions,mapping}` files contribute **zero** errors.
`tsc -b` still surfaces the **15 pre-existing** errors in dead legacy code
(`src/features/collections/**`, `src/ipc/client.ts`) — unchanged by this plan, removed in
plan-09. Confirm the count is still 15 and none are under `features/workflow` or the touched
`features/catalog` files. If any **new** error appears (e.g. a lingering `serviceId`
reference, `resolveStepAuthHeader` import, or a `CatalogService` without an `auth` field),
fix it before proceeding and note it in the banner.

- [ ] **Step 3: Production build smoke (optional but recommended)**

Run: `pnpm build`
Expected: builds (Vite tree-shakes; the legacy `tsc` errors are in files the bundler does not
fail on). If `pnpm build` runs `tsc` and fails on the 15 legacy errors, skip this step and
rely on `pnpm test` + targeted `pnpm lint` — note which gate was used.

- [ ] **Step 4: Update the plan-00 index status row**

In `docs/superpowers/plans/2026-06-05-plan-00-index.md`, change the `plan-04` row Status from
`outline` to `✅ done (<firstSha>..<lastSha>)`, and flip this file's banner **Status** to
`✅ done` with the same SHA range and the final test count.

- [ ] **Step 5: Commit the status update**

```bash
git add docs/superpowers/plans/2026-06-05-plan-00-index.md docs/superpowers/plans/2026-06-05-plan-04-workflow-model.md
git commit -m "docs(plan-04): mark complete; update index row"
```

---

## Follow-ups (later plans, do NOT do here)

- **plan-05 (sidebar):** the new `CollectionTree`/`RequestRow` open a saved request by
  calling `savedRequestToDraft` → `workflowStore.setDraft`; `New request` (`+`) sets an empty
  draft. The derived-catalog `Sidebar`/`ServicePanel`/`openCallFromMethod` are replaced.
- **plan-06 (create/save):** draft `dirty`/origin-binding/autosave, reflection-driven
  address/method editing on the draft (this is where `AddressBar`/a new address input gains
  an editable `onPatch` path), `SaveRequestDialog`.
- **plan-07 (⌘K + overview):** `CommandPalette` rewrite opens saved requests via
  `savedRequestToDraft` → `setDraft`.
- **plan-09 (cleanup):** delete `StepRail` if still unused, `catalog/{model,store,Sidebar,
  ServicePanel,…}`, and the now-unused derived-catalog `openCallFromMethod`.

## Spec-coverage self-check

- §3 / §16.3 global pending-draft (one global, separate from history) → Task 3 (`draft`
  slot) + Task 5 (Focus renders it). ✅
- §3 / table "Send → шаг", "Draft после Send" Send appends executed step, draft remains →
  Tasks 2 (`shouldRecordExecuted`/`buildExecutedStep`), 3 (`commitExecutedStep`), 4 (CallPanel
  `onExecuted`). ✅
- §7 / §16.3 / table "Step.auth" inline `auth`, drop `serviceId` → Task 1 (model) + Task 2
  (`resolveAuthHeader`) + Task 4 (CallPanel reads `step.auth`, no `catalogStore`). ✅
- §16.3 "Обновить `CallPanel`/`actions`/`FocusView`" → Tasks 2, 4, 5 (+ List/Ledger Task 6
  for the shared `CallPanel` contract). ✅
- plan-03 follow-up auth seam in `mapping.ts` → Task 8. ✅
- §3 / table "История-вьюхи как есть" history views render `wf.steps` unchanged (only the
  `onPatch` prop threads through) → Task 6, verified by green `ListView`/`LedgerView` tests. ✅
