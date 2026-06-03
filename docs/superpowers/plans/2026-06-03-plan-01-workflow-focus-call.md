# Workflow Focus Call (Milestone 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new workflow-centric frontend foundation and the **Focus** single-call screen: create a call from a method, get an auto-generated request skeleton, edit it, Send, and see the response — all on top of the existing (already-working) backend IPC.

**Architecture:** Frontend-only milestone. A new session-only **external store** (vanilla pub-sub + `useSyncExternalStore`, mirroring the existing `usePrefs` pattern — the repo has **no Zustand**) holds `Workflow`s, each with `Step`s. The Focus view renders one active `Step` full-bleed (address bar + request editor + response). Calls reuse the existing IPC commands `grpcBuildRequestSkeleton` and `grpcInvokeOneshot`. Response rendering reuses the existing Monaco `ResponsePanel` for this milestone; the custom JSON viewer is Plan #4.

**Tech Stack:** React 18 + TypeScript (strict) + Tailwind/shadcn-ui + Monaco (existing) + **Vitest + React Testing Library (added in Task 1)**. Existing IPC via `@/ipc/client`.

**Scope note (confirm at review):** `Workflow`/`Step` are **frontend-only TS types** here, because they are session-only UI state with no persistence and no IPC payload. The spec (§10) said "schema in Rust core + specta"; that applies to types that cross the IPC boundary (already covered by `InvokeRequest`/`InvokeOutcomeIpc`/`ServiceCatalogIpc`). Revisit if a later sub-plan needs core-side workflow types.

---

## File Structure

**Created:**
- `vitest.config.ts` — Vitest config (jsdom env, `@/` alias).
- `src/test/setup.ts` — RTL/jest-dom setup.
- `src/features/workflow/model.ts` — `Workflow`, `Step`, `ViewMode`, factories.
- `src/features/workflow/model.test.ts` — factory tests.
- `src/features/workflow/reducers.ts` — pure state transitions.
- `src/features/workflow/reducers.test.ts` — reducer tests.
- `src/features/workflow/store.ts` — external store + `useWorkflowStore` hook.
- `src/features/workflow/actions.ts` — async actions (`createStepFromMethod`, `sendStep`).
- `src/features/workflow/actions.test.ts` — action tests (mocked ipc).
- `src/features/workflow/FocusView.tsx` — full-bleed single-call view.
- `src/features/workflow/AddressBar.tsx` — Focus address bar (method title + address + Send).
- `src/app/WorkflowApp.tsx` — new top-level app shell (replaces `App.tsx` usage).

**Modified:**
- `package.json` — add `vitest`, `@testing-library/*`, `jsdom`, test scripts.
- `src/main.tsx` — render `WorkflowApp` instead of `App`.
- `src/ipc/client.ts` — ensure `grpcBuildRequestSkeleton` + `grpcInvokeOneshot` wrappers exist (add if missing).

**Untouched this milestone:** old `App.tsx`, `features/tabs/*`, `features/collections/*` (removed/replaced in later plans; left in place so the build stays green).

---

## Task 1: Test infrastructure (Vitest + RTL)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `src/test/setup.ts`, `src/features/workflow/smoke.test.ts`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
pnpm add -D vitest@^2 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14 jsdom@^25
```

- [ ] **Step 2: Add test scripts to `package.json`**

In the `"scripts"` block add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Create a smoke test `src/features/workflow/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("test infra", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run tests to verify infra works**

Run: `pnpm test`
Expected: PASS (1 test passed).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/test/setup.ts src/features/workflow/smoke.test.ts
git commit -m "test: add vitest + react-testing-library infra"
```

---

## Task 2: Workflow domain model + factories

**Files:**
- Create: `src/features/workflow/model.ts`
- Test: `src/features/workflow/model.test.ts`

- [ ] **Step 1: Write the failing test `src/features/workflow/model.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { newStep, newWorkflow } from "./model";

describe("newStep", () => {
  it("creates a draft step with defaults and a unique id", () => {
    const a = newStep({ address: "h:443", tls: true, service: "p.S", method: "M" });
    const b = newStep({ address: "h:443", tls: true, service: "p.S", method: "M" });
    expect(a.id).not.toEqual(b.id);
    expect(a.status).toBe("draft");
    expect(a.outcome).toBeNull();
    expect(a.error).toBeNull();
    expect(a.requestJson).toBe("{}");
    expect(a.metadata).toEqual([]);
    expect(a.service).toBe("p.S");
    expect(a.method).toBe("M");
  });
});

describe("newWorkflow", () => {
  it("creates a workflow with no steps, focus view, no active step", () => {
    const wf = newWorkflow("incident");
    expect(wf.name).toBe("incident");
    expect(wf.steps).toEqual([]);
    expect(wf.activeStepId).toBeNull();
    expect(wf.view).toBe("focus");
    expect(wf.id).toMatch(/.+/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/model.test.ts`
Expected: FAIL ("Failed to resolve import ./model" / functions not defined).

- [ ] **Step 3: Implement `src/features/workflow/model.ts`**

```ts
import { newId } from "@/lib/ids";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export type ViewMode = "ledger" | "list" | "focus";
export type StepStatus = "draft" | "sending" | "ok" | "error";

export interface MetadataRow {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Step {
  id: string;
  address: string; // resolved or {{var}} template
  tls: boolean;
  service: string; // proto service full name, e.g. "payments.v1.PaymentService"
  method: string; // method name, e.g. "GetPayment"
  requestJson: string; // editable request body (skeleton-prefilled)
  metadata: MetadataRow[];
  status: StepStatus;
  outcome: InvokeOutcomeIpc | null;
  error: string | null; // client-side (non-gRPC) error message
}

export interface Workflow {
  id: string;
  name: string;
  steps: Step[];
  activeStepId: string | null;
  view: ViewMode;
}

export function newStep(init: {
  address: string;
  tls: boolean;
  service: string;
  method: string;
  requestJson?: string;
}): Step {
  return {
    id: newId(),
    address: init.address,
    tls: init.tls,
    service: init.service,
    method: init.method,
    requestJson: init.requestJson ?? "{}",
    metadata: [],
    status: "draft",
    outcome: null,
    error: null,
  };
}

export function newWorkflow(name: string): Workflow {
  return { id: newId(), name, steps: [], activeStepId: null, view: "focus" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/model.ts src/features/workflow/model.test.ts
git commit -m "feat(workflow): domain model + factories"
```

---

## Task 3: Pure state reducers

**Files:**
- Create: `src/features/workflow/reducers.ts`
- Test: `src/features/workflow/reducers.test.ts`

- [ ] **Step 1: Write the failing test `src/features/workflow/reducers.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { newWorkflow, newStep, type Workflow } from "./model";
import {
  addStep,
  updateStep,
  removeStep,
  setActiveStep,
  setView,
  reorderStep,
} from "./reducers";

function wfWith(...n: number[]): Workflow {
  let wf = newWorkflow("t");
  for (const i of n) {
    wf = addStep(wf, newStep({ address: "h", tls: true, service: "S", method: `M${i}` }));
  }
  return wf;
}

describe("addStep", () => {
  it("appends and makes the new step active", () => {
    const wf = wfWith(1, 2);
    expect(wf.steps.map((s) => s.method)).toEqual(["M1", "M2"]);
    expect(wf.activeStepId).toBe(wf.steps[1].id);
  });
});

describe("updateStep", () => {
  it("patches one step immutably, leaves others", () => {
    const wf = wfWith(1, 2);
    const id = wf.steps[0].id;
    const next = updateStep(wf, id, { requestJson: "{\"a\":1}" });
    expect(next.steps[0].requestJson).toBe("{\"a\":1}");
    expect(next.steps[1]).toBe(wf.steps[1]); // untouched reference
    expect(next).not.toBe(wf);
  });
  it("ignores unknown id", () => {
    const wf = wfWith(1);
    expect(updateStep(wf, "nope", { error: "x" }).steps[0].error).toBeNull();
  });
});

describe("removeStep", () => {
  it("removes and reselects the previous step", () => {
    const wf = wfWith(1, 2, 3);
    const mid = wf.steps[1].id;
    const next = removeStep(wf, mid);
    expect(next.steps.map((s) => s.method)).toEqual(["M1", "M3"]);
    expect(next.activeStepId).toBe(next.steps[0].id);
  });
  it("clears active when last step removed", () => {
    const wf = wfWith(1);
    const next = removeStep(wf, wf.steps[0].id);
    expect(next.steps).toEqual([]);
    expect(next.activeStepId).toBeNull();
  });
});

describe("reorderStep", () => {
  it("moves a step to a new index", () => {
    const wf = wfWith(1, 2, 3);
    const next = reorderStep(wf, 2, 0);
    expect(next.steps.map((s) => s.method)).toEqual(["M3", "M1", "M2"]);
  });
});

describe("setActiveStep / setView", () => {
  it("sets active id and view", () => {
    const wf = wfWith(1, 2);
    expect(setActiveStep(wf, wf.steps[0].id).activeStepId).toBe(wf.steps[0].id);
    expect(setView(wf, "ledger").view).toBe("ledger");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/reducers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/features/workflow/reducers.ts`**

```ts
import type { Step, ViewMode, Workflow } from "./model";

export function addStep(wf: Workflow, step: Step): Workflow {
  return { ...wf, steps: [...wf.steps, step], activeStepId: step.id };
}

export function updateStep(wf: Workflow, id: string, patch: Partial<Step>): Workflow {
  let changed = false;
  const steps = wf.steps.map((s) => {
    if (s.id !== id) return s;
    changed = true;
    return { ...s, ...patch };
  });
  return changed ? { ...wf, steps } : wf;
}

export function removeStep(wf: Workflow, id: string): Workflow {
  const idx = wf.steps.findIndex((s) => s.id === id);
  if (idx < 0) return wf;
  const steps = wf.steps.filter((s) => s.id !== id);
  let activeStepId = wf.activeStepId;
  if (wf.activeStepId === id) {
    if (steps.length === 0) activeStepId = null;
    else activeStepId = steps[Math.max(0, idx - 1)].id;
  }
  return { ...wf, steps, activeStepId };
}

export function reorderStep(wf: Workflow, from: number, to: number): Workflow {
  if (from === to || from < 0 || from >= wf.steps.length) return wf;
  const steps = [...wf.steps];
  const [moved] = steps.splice(from, 1);
  steps.splice(to, 0, moved);
  return { ...wf, steps };
}

export function setActiveStep(wf: Workflow, id: string): Workflow {
  return { ...wf, activeStepId: id };
}

export function setView(wf: Workflow, view: ViewMode): Workflow {
  return { ...wf, view };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/reducers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/reducers.ts src/features/workflow/reducers.test.ts
git commit -m "feat(workflow): pure state reducers"
```

---

## Task 4: External store + React hook

**Files:**
- Create: `src/features/workflow/store.ts`
- Test: `src/features/workflow/store.test.ts`

- [ ] **Step 1: Write the failing test `src/features/workflow/store.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { workflowStore } from "./store";
import { newStep } from "./model";

beforeEach(() => workflowStore.reset());

describe("workflowStore", () => {
  it("starts with one empty workflow that is active", () => {
    const s = workflowStore.getState();
    expect(s.workflows).toHaveLength(1);
    expect(s.activeWorkflowId).toBe(s.workflows[0].id);
  });

  it("applies a transition to the active workflow and notifies subscribers", () => {
    let calls = 0;
    const unsub = workflowStore.subscribe(() => calls++);
    const step = newStep({ address: "h", tls: true, service: "S", method: "M" });
    workflowStore.update((wf) => ({ ...wf, steps: [...wf.steps, step] }));
    expect(calls).toBe(1);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
    unsub();
  });

  it("createWorkflow adds and activates a new workflow", () => {
    const wf = workflowStore.createWorkflow("second");
    expect(workflowStore.getState().activeWorkflowId).toBe(wf.id);
    expect(workflowStore.getState().workflows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/features/workflow/store.ts`**

```ts
import { useSyncExternalStore } from "react";
import { newWorkflow, type Workflow } from "./model";

export interface WorkflowState {
  workflows: Workflow[];
  activeWorkflowId: string;
}

function initialState(): WorkflowState {
  const wf = newWorkflow("workflow-1");
  return { workflows: [wf], activeWorkflowId: wf.id };
}

let state: WorkflowState = initialState();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const workflowStore = {
  getState(): WorkflowState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reset() {
    state = initialState();
    emit();
  },
  activeWorkflow(): Workflow {
    return state.workflows.find((w) => w.id === state.activeWorkflowId)!;
  },
  /** Apply a pure transition to the active workflow. */
  update(fn: (wf: Workflow) => Workflow) {
    state = {
      ...state,
      workflows: state.workflows.map((w) =>
        w.id === state.activeWorkflowId ? fn(w) : w,
      ),
    };
    emit();
  },
  createWorkflow(name: string): Workflow {
    const wf = newWorkflow(name);
    state = { workflows: [...state.workflows, wf], activeWorkflowId: wf.id };
    emit();
    return wf;
  },
  setActiveWorkflow(id: string) {
    if (state.workflows.some((w) => w.id === id)) {
      state = { ...state, activeWorkflowId: id };
      emit();
    }
  },
};

export function useWorkflowState(): WorkflowState {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getState);
}

export function useActiveWorkflow(): Workflow {
  useWorkflowState(); // subscribe
  return workflowStore.activeWorkflow();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/store.ts src/features/workflow/store.test.ts
git commit -m "feat(workflow): external store + react hooks"
```

---

## Task 5: Async actions — create step from method, send step

**Files:**
- Create: `src/features/workflow/actions.ts`
- Test: `src/features/workflow/actions.test.ts`
- Verify/Modify: `src/ipc/client.ts` (ensure wrappers exist)

- [ ] **Step 1: Confirm IPC wrappers exist**

Run: `git grep -n "grpcInvokeOneshot\|grpcBuildRequestSkeleton" src/ipc/client.ts`
Expected: both wrappers found. If EITHER is missing, add it to `src/ipc/client.ts` following the existing `grpcDescribe` pattern:

```ts
import { commands } from "./bindings";
import type { GrpcTargetIpc, InvokeRequest, InvokeOutcomeIpc } from "./bindings";

export async function grpcBuildRequestSkeleton(
  target: GrpcTargetIpc,
  service: string,
  method: string,
): Promise<string> {
  const r = await commands.grpcBuildRequestSkeleton(target, service, method);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcInvokeOneshot(
  target: GrpcTargetIpc,
  request: InvokeRequest,
): Promise<InvokeOutcomeIpc> {
  const r = await commands.grpcInvokeOneshot(target, request);
  if (r.status === "error") throw r.error;
  return r.data;
}
```
(Ensure both are re-exported via the `ipc` object in `src/ipc/index.ts` if that file aggregates them — match the existing export style.)

- [ ] **Step 2: Write the failing test `src/features/workflow/actions.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  grpcBuildRequestSkeleton: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { createStepFromMethod, sendStep } from "./actions";

beforeEach(() => vi.clearAllMocks());

describe("createStepFromMethod", () => {
  it("builds a step with skeleton body from the contract", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue(
      '{\n  "order_id": ""\n}',
    );
    const step = await createStepFromMethod(
      { address: "order-api:443", tls: true },
      "order.v1.OrderService",
      "GetOrderState",
    );
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      { address: "order-api:443", tls: true, skip_verify: false },
      "order.v1.OrderService",
      "GetOrderState",
    );
    expect(step.requestJson).toContain("order_id");
    expect(step.status).toBe("draft");
    expect(step.service).toBe("order.v1.OrderService");
  });

  it("falls back to {} when skeleton fails", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockRejectedValue(new Error("boom"));
    const step = await createStepFromMethod(
      { address: "h:443", tls: true },
      "S",
      "M",
    );
    expect(step.requestJson).toBe("{}");
  });
});

describe("sendStep", () => {
  it("returns ok outcome on success", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0,
      status_message: "OK",
      response_json: '{"state":"OK"}',
      trailing_metadata: {},
      elapsed_ms: 12,
    });
    const res = await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [{ key: "x", value: "1", enabled: true }],
    });
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.outcome.status_code).toBe(0);
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}", metadata: { x: "1" } },
    );
  });

  it("returns error kind on client failure", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockRejectedValue({ type: "Transport", data: "refused" });
    const res = await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [],
    });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.message).toContain("refused");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/features/workflow/actions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/features/workflow/actions.ts`**

```ts
import * as ipc from "@/ipc/client";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";
import { newStep, type MetadataRow, type Step } from "./model";

export interface CallTargetInit {
  address: string;
  tls: boolean;
}

export async function createStepFromMethod(
  target: CallTargetInit,
  service: string,
  method: string,
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
  return newStep({ address: target.address, tls: target.tls, service, method, requestJson });
}

export type SendResult =
  | { kind: "ok"; outcome: InvokeOutcomeIpc }
  | { kind: "error"; message: string };

function metadataToMap(rows: MetadataRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.enabled && r.key) out[r.key] = r.value;
  return out;
}

export async function sendStep(step: {
  address: string;
  tls: boolean;
  service: string;
  method: string;
  requestJson: string;
  metadata: MetadataRow[];
}): Promise<SendResult> {
  try {
    const outcome = await ipc.grpcInvokeOneshot(
      { address: step.address, tls: step.tls, skip_verify: false },
      {
        service: step.service,
        method: step.method,
        request_json: step.requestJson,
        metadata: metadataToMap(step.metadata),
      },
    );
    return { kind: "ok", outcome };
  } catch (e) {
    return { kind: "error", message: errorToMessage(e) };
  }
}

function errorToMessage(e: unknown): string {
  if (e && typeof e === "object" && "data" in e) return String((e as { data: unknown }).data);
  if (e instanceof Error) return e.message;
  return String(e);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/features/workflow/actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/actions.ts src/features/workflow/actions.test.ts src/ipc/client.ts
git commit -m "feat(workflow): create-step-from-method and send-step actions"
```

---

## Task 6: Focus address bar component

**Files:**
- Create: `src/features/workflow/AddressBar.tsx`

- [ ] **Step 1: Implement `src/features/workflow/AddressBar.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import type { Step } from "./model";

export function AddressBar({
  step,
  onSend,
}: {
  step: Step;
  onSend: () => void;
}) {
  const sending = step.status === "sending";
  return (
    <div className="flex h-14 items-center gap-3 border-b border-border px-4">
      <span className="text-[var(--ok)]" aria-hidden>
        🔒
      </span>
      <span className="font-mono text-[13px] font-semibold text-foreground">
        {step.method}
      </span>
      <span className="truncate font-mono text-xs text-muted-foreground">
        {step.address} / {step.service}
      </span>
      <div className="flex-1" />
      {step.status === "ok" && step.outcome ? (
        <span className="text-xs text-[var(--ok)]">
          ✓ OK · {step.outcome.elapsed_ms}ms
        </span>
      ) : null}
      {step.status === "error" ? (
        <span className="text-xs text-destructive">✕ error</span>
      ) : null}
      <Button size="sm" onClick={onSend} disabled={sending}>
        {sending ? "Sending…" : "▶ Send"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: PASS (no TS errors).

- [ ] **Step 3: Commit**

```bash
git add src/features/workflow/AddressBar.tsx
git commit -m "feat(workflow): focus address bar"
```

---

## Task 7: Focus view (wires store + actions + editor + response)

**Files:**
- Create: `src/features/workflow/FocusView.tsx`

- [ ] **Step 1: Implement `src/features/workflow/FocusView.tsx`**

Reuses the existing Monaco editor (`@/lib/monaco` → `MonacoEditor`) for the request body and the existing `ResponsePanel` (`@/features/response/ResponsePanel`) for the response. Match the existing `ResponsePanel` props by reading `src/features/response/ResponsePanel.tsx` before wiring; it expects an `InvokeOutcomeIpc | null` plus an error string (props named per that file).

```tsx
import { Suspense } from "react";
import { MonacoEditor } from "@/lib/monaco";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import { AddressBar } from "./AddressBar";
import { workflowStore, useActiveWorkflow } from "./store";
import { updateStep } from "./reducers";
import { sendStep } from "./actions";
import type { Step } from "./model";

export function FocusView() {
  const wf = useActiveWorkflow();
  const step = wf.steps.find((s) => s.id === wf.activeStepId) ?? null;

  if (!step) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Нет активного вызова — выбери метод, чтобы создать (⌘K появится в Plan #2)
      </div>
    );
  }

  const onBody = (value: string) =>
    workflowStore.update((w) => updateStep(w, step.id, { requestJson: value }));

  const onSend = async () => {
    workflowStore.update((w) => updateStep(w, step.id, { status: "sending", error: null }));
    const res = await sendStep(step);
    workflowStore.update((w) =>
      updateStep(
        w,
        step.id,
        res.kind === "ok"
          ? { status: "ok", outcome: res.outcome, error: null }
          : { status: "error", outcome: null, error: res.message },
      ),
    );
  };

  return (
    <div className="flex h-full flex-col">
      <AddressBar step={step} onSend={onSend} />
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 border-r border-border">
          <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Загрузка редактора…</div>}>
            <MonacoEditor
              value={step.requestJson}
              language="json-with-vars"
              onChange={(v: string | undefined) => onBody(v ?? "")}
            />
          </Suspense>
        </div>
        <div className="flex-1">
          <ResponseSlot step={step} />
        </div>
      </div>
    </div>
  );
}

function ResponseSlot({ step }: { step: Step }) {
  // ResponsePanel renders body/trailers/headers from the outcome + error.
  return <ResponsePanel outcome={step.outcome} invokeError={step.error} sending={step.status === "sending"} />;
}
```

> **Wiring note for the implementer:** open `src/features/response/ResponsePanel.tsx` and `src/lib/monaco.ts` first and adjust the prop names in `ResponseSlot` / `MonacoEditor` to match their actual signatures (the Explore report confirms `MonacoEditor` is the lazy export and `ResponsePanel` shows Body/Trailers/Headers from an `InvokeOutcomeIpc`). Do not invent new props — use what those components already accept.

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: PASS. If TS complains about prop mismatches, fix them against the real `ResponsePanel`/`MonacoEditor` signatures (read those files).

- [ ] **Step 3: Commit**

```bash
git add src/features/workflow/FocusView.tsx
git commit -m "feat(workflow): focus view wiring store, editor, response"
```

---

## Task 8: New app shell + temporary call entry, render it

**Files:**
- Create: `src/app/WorkflowApp.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Implement `src/app/WorkflowApp.tsx`**

Minimal titlebar (logo + workflow name + view-switch placeholder + ⌘K placeholder) and the Focus view. A temporary "New call" button creates a step from a typed address+service+method so the milestone is runnable before ⌘K (Plan #2) exists.

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FocusView } from "@/features/workflow/FocusView";
import { workflowStore, useActiveWorkflow } from "@/features/workflow/store";
import { addStep } from "@/features/workflow/reducers";
import { createStepFromMethod } from "@/features/workflow/actions";

export function WorkflowApp() {
  const wf = useActiveWorkflow();
  const [open, setOpen] = useState(wf.steps.length === 0);
  const [address, setAddress] = useState("");
  const [service, setService] = useState("");
  const [method, setMethod] = useState("");

  const create = async () => {
    if (!address || !service || !method) return;
    const step = await createStepFromMethod({ address, tls: true }, service, method);
    workflowStore.update((w) => addStep(w, step));
    setOpen(false);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-9 items-center gap-3 border-b border-border px-3 text-sm">
        <span className="font-semibold">⚡ Handshaker</span>
        <span className="text-muted-foreground">{wf.name}</span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          + New call
        </Button>
      </div>
      {open ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 p-3">
          <Input placeholder="host:port" value={address} onChange={(e) => setAddress(e.target.value)} className="w-64 font-mono" />
          <Input placeholder="pkg.Service" value={service} onChange={(e) => setService(e.target.value)} className="w-56 font-mono" />
          <Input placeholder="Method" value={method} onChange={(e) => setMethod(e.target.value)} className="w-44 font-mono" />
          <Button size="sm" onClick={create}>Create</Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <FocusView />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Point `src/main.tsx` at the new shell**

Replace the render of `App` with `WorkflowApp`. Change the import and the JSX element:
```tsx
import { WorkflowApp } from "@/app/WorkflowApp";
// ...
// <App /> becomes:
<WorkflowApp />
```
Keep all existing Monaco/setup imports in `main.tsx` intact (they preload the editor).

- [ ] **Step 3: Typecheck the whole project**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/WorkflowApp.tsx src/main.tsx
git commit -m "feat(workflow): app shell with focus view and temporary call entry"
```

---

## Task 9: Verify end-to-end in the running app

**Files:** none (verification only).

- [ ] **Step 1: Ensure IPC bindings are current**

Run: `cargo run -p handshaker --bin export-bindings --quiet`
Expected: `src/ipc/bindings.ts` regenerated, no error.

- [ ] **Step 2: Run all unit tests**

Run: `pnpm test`
Expected: PASS (model, reducers, store, actions, smoke).

- [ ] **Step 3: Launch the app**

Run: `pnpm tauri:dev`
Expected: window opens showing `⚡ Handshaker` titlebar and the New-call inputs.

- [ ] **Step 4: Manual smoke against a real/local gRPC server with reflection**

- Enter a reachable `host:port`, a proto service full name, and a unary method; click **Create**.
- Expected: a Focus screen with the request body **pre-filled by the generated skeleton** (fields from the method's input message).
- Edit a field, click **Send (⌘↵ wiring comes in a later task)**.
- Expected: response appears in the right pane; on success a green `✓ OK · Nms` shows in the address bar; on a gRPC error the response pane shows the error (reusing existing `ResponsePanel`).

- [ ] **Step 5: Commit any binding/lock changes**

```bash
git add -A
git commit -m "chore: milestone-1 verification (bindings, lockfile)" || echo "nothing to commit"
```

---

## 🧹 /clear-checkpoint

**Milestone 1 done.** New session before Plan #2:
1. `/clear`
2. Re-read `CLAUDE.md` + this plan's checkboxes + `docs/superpowers/plans/2026-06-03-plan-02-*.md`.
3. Continue with Plan #2 (catalog + navigation + ⌘K).

---

## Self-Review (author checklist — completed)

- **Spec coverage (this milestone):** Focus single-call (§4.3), skeleton-from-contract (§5), session-only in-memory state (§6), reuse existing IPC (§9 plan 1). Deferred by design to later plans: ⌘K/finder (#2), Лента/Список + view switch (#3), custom JSON viewer/copy (#4), env/auth/metadata (#5).
- **Placeholders:** none — every code step has complete code; UI wiring notes point the implementer at real existing components rather than inventing props.
- **Type consistency:** `Step`/`Workflow` fields used consistently across model/reducers/store/actions/components; `sendStep`/`createStepFromMethod` signatures match their call sites; IPC payloads (`GrpcTargetIpc`, `InvokeRequest`, `InvokeOutcomeIpc`) match the Explore-confirmed backend types.
- **Open item flagged:** Workflow/Step kept frontend-only (vs spec's "schema in core") — rationale documented at top; confirm at plan review.
