# Env / Auth / Metadata (Plan #5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

---

## ⛳ EXECUTION STATUS

- **Branch:** `redesign/workflow-ui-spec-plans`
- **Depends on:** Plans #1–#4 (all complete; 151/151 tests green at start of #5).
- **Status:** ✅ **Phase A COMPLETE** (2026-06-04, subagent-driven). Env-on-workflow +
  `{{var}}` resolution implemented, reviewed, review-fixes applied. 175/175 tests green,
  `pnpm lint` clean, `pnpm build` success. Commits: `d73d292`…`4dfd261` (A1+A2, A3, A4, A5,
  A6+A7, review-fix). Key Decision #2 (auth via new `auth_resolve` IPC, not collection-bound
  `auth_set_for_env`) **confirmed** at the Phase B checkpoint.
- **Status:** ✅ **Phase B COMPLETE** (2026-06-04, subagent-driven, B1–B9 full TDD).
  Service-level auth + default metadata + Request/Metadata/Auth sub-tabs implemented,
  reviewed (final review: ready-to-merge, no critical/important issues), review-fix applied.
  Gate green: **pnpm test 204/204**, `pnpm lint` exit 0, `pnpm build` success,
  `cargo test -p handshaker` 25/25. Commits: `eca633b`…`d45fc38` (B1, B2, B3, B4, B5, B6,
  B7, B8, B9, review-fix). Active: **Phase C** — still an outline; **expand to full TDD at
  its /clear-checkpoint before executing** (project cadence: detail-on-reach), and FIRST
  verify (context7/WebSearch) the Tauri promise-drop cancel premise per project convention.
- **Mode:** subagent-driven (default).
- **Build/test commands** (from repo root, PowerShell):
  - Frontend unit tests: `pnpm test` (vitest run) · single file: `pnpm test <path>`
  - Typecheck: `pnpm lint` (tsc -b) · Prod build: `pnpm build`
  - Core tests: `cargo test -p handshaker-core`
  - Tauri tests: `cargo test -p handshaker`
  - **Regenerate TS bindings after ANY Rust IPC change:**
    `cargo run -p handshaker --bin export-bindings` (writes `src/ipc/bindings.ts`)
  - Fresh worktree: `pnpm install` → `pnpm build` (dist/) **before** any `cargo` in `src-tauri`.

**Goal:** Environment-on-workflow with `{{var}}` resolution, service-level auth and
default metadata, request cancel + configurable timeout, explicit network diagnostics,
and parallel sends.

**Architecture:** All workflow/catalog state stays **frontend-only and session-only**
(established in Plans #1–#4). Env is a per-workflow selection that *syncs* the backend's
single global `active_env` on change, so the existing `vars_resolve` IPC needs no change.
`{{var}}` resolution runs client-side at Send time via the existing `vars_resolve`
command, aggregating unresolved/cycle diagnostics and blocking the call on failure.
Service auth is stored on the frontend `CatalogService` and resolved to a header at Send
via a **new thin `auth_resolve` IPC** that wraps core `resolve_auth` (reads OS env for
secrets, never persists plaintext — matches spec §10). Timeout is applied in the backend
via `tokio::time::timeout`; cancel uses a `Notify`-keyed request registry in `AppState`.

**Tech stack:** React 18 + custom `useSyncExternalStore` stores · Tauri 2 + tauri-specta
IPC · Rust `handshaker-core` (tonic/prost-reflect) · vitest + Testing Library.

---

## Spec coverage map

| Spec requirement (§6 / §10) | Phase · Task |
|---|---|
| Env active on whole workflow, pill in titlebar, switch applies to workflow | A1, A2, A3 |
| `{{var}}` substitution in address + body + metadata; unresolved-var error | A4, A5 |
| Auth (None/EnvVar/OAuth2) **only on service**, applied to all its steps | B1–B4 |
| Default metadata on service, inherited into new steps (editable per step) | B5, B6 |
| Metadata / Auth sub-tabs in the call editor (§4.3) | B6, B7 |
| Cancel button + configurable timeout (settings) | C1–C4 |
| Explicit network/TLS diagnostics (refused / TLS / DNS / timeout) | C5 |
| Parallel Send (each step independent) | C6 |

---

## Key architectural decisions (read before executing)

1. **Env per workflow via backend sync (no backend change).**
   The backend resolves `{{var}}` against a *single global* `active_env` held in
   `AppState`. The spec wants env *per workflow*. Rather than rework the backend to be
   per-call env-aware, we store `envName` on the `Workflow` and call `env_active_set`
   to keep the backend's active env equal to the **active** workflow's env. This is
   correct because only one workflow is active at a time, and parallel Sends all belong
   to that one active workflow. Sync points: (a) user switches env via the pill;
   (b) user switches the active workflow.

2. **Auth: store on frontend service + new `auth_resolve` IPC.**
   The outline suggested reusing `auth_set_for_env`, but that command is **collection-
   bound** (`collection_id` + `item_id`) and the redesigned UI has no collections
   (session-only catalog). Instead we store a `SavedAuthConfigIpc` on the frontend
   `CatalogService` and add a thin command `auth_resolve(config) -> AuthCredentialsIpc | null`
   that wraps the existing core `resolve_auth` (EnvVar reads OS env; OAuth2 → NotImplemented).
   The resolved header is injected into the request metadata at Send. **Revisit at the
   Phase B checkpoint** if the user prefers routing through the collection machinery.

3. **Timeout in backend, cancel via `Notify` registry.**
   Timeout: extend `grpc_invoke_oneshot` with `timeout_ms: u32` and wrap activate+invoke
   in `tokio::time::timeout`. Cancel: client passes a `request_id`; `AppState` holds a
   `Mutex<HashMap<String, Arc<Notify>>>`; the invoke races completion against
   `notify.notified()` via `tokio::select!`; a new `grpc_cancel(request_id)` command
   fires the notify. (A dropped JS promise does **not** cancel the Rust future — Tauri
   awaits the command to completion — so a server-side cancel signal is required. **Verify
   this Tauri behavior with context7/WebSearch when detailing Phase C**, per project
   convention.) No new crate needed (`tokio::sync::Notify` is already available via tokio).

---

# PHASE A — Env on workflow + `{{var}}` resolution

> Full TDD. Execute now. Covers outline tasks 1 & 2.

## File structure (Phase A)

- Modify `src/features/workflow/model.ts` — add `Workflow.envName: string | null`.
- Modify `src/features/workflow/reducers.ts` — add pure `setWorkflowEnv`.
- Modify `src/features/workflow/store.ts` — add `setWorkflowEnv` + backend sync on switch.
- Create `src/features/workflow/resolve.ts` — pure template resolver over a step's fields.
- Modify `src/features/workflow/actions.ts` — `sendStep` resolves before invoke; new
  `unresolved` result variant.
- Modify `src/features/workflow/CallPanel.tsx` — surface unresolved-variable errors.
- Create `src/features/workflow/WorkflowEnvControl.tsx` — titlebar env switcher bound to
  the active workflow (reuses `EnvSwitcherMenu` + env dialogs from `features/envs`).
- Modify `src/app/WorkflowApp.tsx` — replace the static `env: default` chip with
  `WorkflowEnvControl`.
- Tests co-located as `*.test.ts(x)`.

---

### Task A1: Add `envName` to the Workflow model

**Files:**
- Modify: `src/features/workflow/model.ts`
- Test: `src/features/workflow/model.test.ts`

- [ ] **Step 1 — Failing test.** Append to `model.test.ts`:

```ts
import { newWorkflow } from "./model";

it("newWorkflow defaults envName to null (No environment)", () => {
  expect(newWorkflow("wf-1").envName).toBeNull();
});
```

- [ ] **Step 2 — Run, expect fail.** `pnpm test src/features/workflow/model.test.ts`
  → FAIL (`envName` does not exist on type / is undefined).

- [ ] **Step 3 — Implement.** In `model.ts`, add the field to the interface and factory:

```ts
export interface Workflow {
  id: string;
  name: string;
  steps: Step[];
  activeStepId: string | null;
  view: ViewMode;
  envName: string | null; // active environment for this workflow; null = "No environment"
}

export function newWorkflow(name: string): Workflow {
  return { id: newId(), name, steps: [], activeStepId: null, view: "focus", envName: null };
}
```

- [ ] **Step 4 — Run, expect pass.** `pnpm test src/features/workflow/model.test.ts` → PASS.

- [ ] **Step 5 — Commit.**

```bash
git add src/features/workflow/model.ts src/features/workflow/model.test.ts
git commit -m "feat(workflow): add per-workflow envName to model"
```

---

### Task A2: Pure `setWorkflowEnv` reducer

**Files:**
- Modify: `src/features/workflow/reducers.ts`
- Test: `src/features/workflow/reducers.test.ts`

- [ ] **Step 1 — Failing test.** Append to `reducers.test.ts`:

```ts
import { setWorkflowEnv } from "./reducers";
import { newWorkflow } from "./model";

describe("setWorkflowEnv", () => {
  it("sets the workflow env name", () => {
    const wf = newWorkflow("wf");
    expect(setWorkflowEnv(wf, "staging").envName).toBe("staging");
  });
  it("clears env when given null", () => {
    const wf = { ...newWorkflow("wf"), envName: "prod" };
    expect(setWorkflowEnv(wf, null).envName).toBeNull();
  });
});
```

- [ ] **Step 2 — Run, expect fail.** `pnpm test src/features/workflow/reducers.test.ts`
  → FAIL (`setWorkflowEnv` not exported).

- [ ] **Step 3 — Implement.** Add to `reducers.ts`:

```ts
export function setWorkflowEnv(wf: Workflow, name: string | null): Workflow {
  return { ...wf, envName: name };
}
```

- [ ] **Step 4 — Run, expect pass.**

- [ ] **Step 5 — Commit.**

```bash
git add src/features/workflow/reducers.ts src/features/workflow/reducers.test.ts
git commit -m "feat(workflow): add setWorkflowEnv reducer"
```

---

### Task A3: Store `setWorkflowEnv` + backend env sync on workflow switch

**Files:**
- Modify: `src/features/workflow/store.ts`
- Test: `src/features/workflow/store.test.ts`

The store gains `setWorkflowEnv(name)` (applies the reducer to the active workflow **and**
pushes the value to the backend via `env_active_set`), and `setActiveWorkflow` re-syncs the
backend to the newly-active workflow's env. The IPC client is mocked in tests.

- [ ] **Step 1 — Failing test.** Add to `store.test.ts` (mock the ipc client at top of file
  if not already mocked):

```ts
import { vi } from "vitest";
const envActiveSet = vi.fn().mockResolvedValue(undefined);
vi.mock("@/ipc/client", () => ({ envActiveSet: (n: string | null) => envActiveSet(n) }));

import { workflowStore } from "./store";

describe("workflow env sync", () => {
  beforeEach(() => { workflowStore.reset(); envActiveSet.mockClear(); });

  it("setWorkflowEnv updates active workflow and pushes to backend", () => {
    workflowStore.setWorkflowEnv("prod");
    expect(workflowStore.activeWorkflow().envName).toBe("prod");
    expect(envActiveSet).toHaveBeenCalledWith("prod");
  });

  it("switching workflows re-syncs backend to that workflow's env", () => {
    workflowStore.setWorkflowEnv("prod");          // wf-1 → prod
    const wf2 = workflowStore.createWorkflow("wf-2"); // new wf, envName null, becomes active
    envActiveSet.mockClear();
    workflowStore.setActiveWorkflow(
      workflowStore.getState().workflows[0].id,     // back to wf-1
    );
    expect(envActiveSet).toHaveBeenLastCalledWith("prod");
    expect(wf2.envName).toBeNull();
  });
});
```

- [ ] **Step 2 — Run, expect fail.** `pnpm test src/features/workflow/store.test.ts`
  → FAIL (`setWorkflowEnv` not a function / no backend call).

- [ ] **Step 3 — Implement.** In `store.ts`, import the reducer + ipc, and extend the store:

```ts
import { newWorkflow, type Workflow } from "./model";
import { setWorkflowEnv as setWorkflowEnvReducer } from "./reducers";
import { envActiveSet } from "@/ipc/client";
```

Add inside the `workflowStore` object:

```ts
  setWorkflowEnv(name: string | null) {
    this.update((w) => setWorkflowEnvReducer(w, name));
    void envActiveSet(name);
  },
```

And make `setActiveWorkflow` re-sync the backend:

```ts
  setActiveWorkflow(id: string) {
    const next = state.workflows.find((w) => w.id === id);
    if (!next) return;
    state = { ...state, activeWorkflowId: id };
    emit();
    void envActiveSet(next.envName);
  },
```

- [ ] **Step 4 — Run, expect pass.** Also run the full workflow suite to catch regressions
  from the `setActiveWorkflow` change: `pnpm test src/features/workflow`.

- [ ] **Step 5 — Commit.**

```bash
git add src/features/workflow/store.ts src/features/workflow/store.test.ts
git commit -m "feat(workflow): sync backend active env to active workflow"
```

---

### Task A4: Pure template resolver for a step's fields

**Files:**
- Create: `src/features/workflow/resolve.ts`
- Test: `src/features/workflow/resolve.test.ts`

A pure function that resolves `address`, `requestJson`, and each enabled metadata value
through an injected resolver (the real one is `ipc.varsResolve`), aggregating unresolved
variables (deduped, encounter order) and the first cycle chain.

- [ ] **Step 1 — Failing test.** Create `resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import { resolveStepTemplates } from "./resolve";

// Fake resolver: substitutes {{x}} from a fixed table; reports the rest unresolved.
function fakeResolver(table: Record<string, string>) {
  return async (tpl: string): Promise<ResolutionReportIpc> => {
    const unresolved: string[] = [];
    const resolved = tpl.replace(/\{\{([a-zA-Z_][\w-]*)\}\}/g, (_, name) => {
      if (name in table) return table[name];
      unresolved.push(name);
      return `{{${name}}}`;
    });
    return { resolved, unresolved_vars: unresolved, cycle_chain: null };
  };
}

const step = {
  address: "{{host}}:443",
  requestJson: '{"id":"{{id}}"}',
  metadata: [
    { key: "x-tenant", value: "{{tenant}}", enabled: true },
    { key: "x-skip", value: "{{nope}}", enabled: false },
    { key: "", value: "{{noKey}}", enabled: true },
  ],
};

describe("resolveStepTemplates", () => {
  it("resolves address, body and enabled metadata", async () => {
    const r = await resolveStepTemplates(step, fakeResolver({ host: "api.internal", id: "42", tenant: "acme" }));
    expect(r.ok).toBe(true);
    expect(r.request.address).toBe("api.internal:443");
    expect(r.request.requestJson).toBe('{"id":"42"}');
    expect(r.request.metadata).toEqual([{ key: "x-tenant", value: "acme" }]);
  });

  it("aggregates unresolved vars (deduped) and blocks", async () => {
    const r = await resolveStepTemplates(step, fakeResolver({ host: "api.internal" }));
    expect(r.ok).toBe(false);
    expect(r.unresolved).toEqual(["id", "tenant"]); // disabled + keyless rows skipped
  });

  it("reports the first cycle chain and is not ok", async () => {
    const resolver = async (tpl: string): Promise<ResolutionReportIpc> =>
      tpl.includes("{{a}}")
        ? { resolved: tpl, unresolved_vars: [], cycle_chain: ["a", "b", "a"] }
        : { resolved: tpl, unresolved_vars: [], cycle_chain: null };
    const r = await resolveStepTemplates(
      { address: "{{a}}", requestJson: "{}", metadata: [] },
      resolver,
    );
    expect(r.ok).toBe(false);
    expect(r.cycle).toEqual(["a", "b", "a"]);
  });
});
```

- [ ] **Step 2 — Run, expect fail.** `pnpm test src/features/workflow/resolve.test.ts`
  → FAIL (module not found).

- [ ] **Step 3 — Implement.** Create `resolve.ts`:

```ts
import type { ResolutionReportIpc } from "@/ipc/bindings";
import type { MetadataRow } from "./model";

export interface ResolvedRequest {
  address: string;
  requestJson: string;
  metadata: { key: string; value: string }[];
}

export interface ResolveOutcome {
  ok: boolean;
  request: ResolvedRequest;
  unresolved: string[]; // deduped, encounter order
  cycle: string[] | null; // first cycle chain encountered
}

export type Resolver = (template: string) => Promise<ResolutionReportIpc>;

export async function resolveStepTemplates(
  step: { address: string; requestJson: string; metadata: MetadataRow[] },
  resolve: Resolver,
): Promise<ResolveOutcome> {
  const unresolved: string[] = [];
  let cycle: string[] | null = null;
  const take = (r: ResolutionReportIpc): string => {
    for (const v of r.unresolved_vars) if (!unresolved.includes(v)) unresolved.push(v);
    if (!cycle && r.cycle_chain) cycle = r.cycle_chain;
    return r.resolved;
  };

  const address = take(await resolve(step.address));
  const requestJson = take(await resolve(step.requestJson));
  const metadata: { key: string; value: string }[] = [];
  for (const row of step.metadata) {
    if (!row.enabled || !row.key) continue;
    metadata.push({ key: row.key, value: take(await resolve(row.value)) });
  }

  return {
    ok: unresolved.length === 0 && cycle === null,
    request: { address, requestJson, metadata },
    unresolved,
    cycle,
  };
}
```

- [ ] **Step 4 — Run, expect pass.**

- [ ] **Step 5 — Commit.**

```bash
git add src/features/workflow/resolve.ts src/features/workflow/resolve.test.ts
git commit -m "feat(workflow): pure {{var}} resolver over step fields"
```

---

### Task A5: Wire resolution into `sendStep` + surface unresolved errors

**Files:**
- Modify: `src/features/workflow/actions.ts`
- Modify: `src/features/workflow/actions.test.ts`
- Modify: `src/features/workflow/CallPanel.tsx`
- Test: `src/features/workflow/CallPanel.test.tsx` (create if absent — see note)

`sendStep` resolves templates first; on unresolved/cycle it returns a new `unresolved`
variant and never invokes. `CallPanel` maps that to a clear step error.

- [ ] **Step 1 — Failing test (actions).** In `actions.test.ts`, ensure `varsResolve` is
  part of the mocked `@/ipc/client`, then add:

```ts
it("sendStep blocks on unresolved variables and does not invoke", async () => {
  // varsResolve echoes input as unresolved when it contains {{...}}
  vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => {
    const m = [...tpl.matchAll(/\{\{([a-zA-Z_][\w-]*)\}\}/g)].map((x) => x[1]);
    return { resolved: tpl, unresolved_vars: m, cycle_chain: null };
  });
  const res = await sendStep({
    address: "{{host}}", tls: false, service: "S", method: "M",
    requestJson: "{}", metadata: [],
  });
  expect(res.kind).toBe("unresolved");
  if (res.kind === "unresolved") expect(res.unresolved).toEqual(["host"]);
  expect(ipc.grpcInvokeOneshot).not.toHaveBeenCalled();
});

it("sendStep invokes with resolved address + metadata when all vars resolve", async () => {
  vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => ({
    resolved: tpl.replace("{{host}}", "api.internal"),
    unresolved_vars: [], cycle_chain: null,
  }));
  vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
    status_code: 0, status_message: "OK", response_json: "{}",
    trailing_metadata: {}, elapsed_ms: 5,
  });
  await sendStep({ address: "{{host}}", tls: true, service: "S", method: "M", requestJson: "{}", metadata: [] });
  expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
    { address: "api.internal", tls: true, skip_verify: false },
    expect.objectContaining({ service: "S", method: "M" }),
  );
});
```

- [ ] **Step 2 — Run, expect fail.** `pnpm test src/features/workflow/actions.test.ts`
  → FAIL (`unresolved` kind absent; invoke still called).

- [ ] **Step 3 — Implement (actions.ts).** Replace `metadataToMap` usage in `sendStep` with
  the resolver. New `SendResult` union and body:

```ts
import { resolveStepTemplates } from "./resolve";

export type SendResult =
  | { kind: "ok"; outcome: InvokeOutcomeIpc }
  | { kind: "error"; message: string }
  | { kind: "unresolved"; unresolved: string[]; cycle: string[] | null };

export async function sendStep(step: {
  address: string;
  tls: boolean;
  service: string;
  method: string;
  requestJson: string;
  metadata: MetadataRow[];
}): Promise<SendResult> {
  const r = await resolveStepTemplates(step, ipc.varsResolve);
  if (!r.ok) return { kind: "unresolved", unresolved: r.unresolved, cycle: r.cycle };
  const metadata: Record<string, string> = {};
  for (const m of r.request.metadata) metadata[m.key] = m.value;
  try {
    const outcome = await ipc.grpcInvokeOneshot(
      { address: r.request.address, tls: step.tls, skip_verify: false },
      { service: step.service, method: step.method, request_json: r.request.requestJson, metadata },
    );
    return { kind: "ok", outcome };
  } catch (e) {
    return { kind: "error", message: errorToMessage(e) };
  }
}
```

(Leave `metadataToMap` only if still referenced elsewhere; otherwise delete it to keep
DRY — the resolver now owns enabled/key filtering.)

- [ ] **Step 4 — Implement (CallPanel.tsx).** Handle the new variant in `onSend`:

```ts
const res = await sendStep(step);
workflowStore.update((w) =>
  updateStep(
    w,
    step.id,
    res.kind === "ok"
      ? { status: res.outcome.status_code === 0 ? "ok" : "error", outcome: res.outcome, error: null }
      : res.kind === "unresolved"
        ? {
            status: "error",
            outcome: null,
            error: res.cycle
              ? `Variable cycle: ${res.cycle.join(" → ")}`
              : `Unresolved variables: ${res.unresolved.map((v) => `{{${v}}}`).join(", ")}`,
          }
        : { status: "error", outcome: null, error: res.message },
  ),
);
```

- [ ] **Step 5 — Run, expect pass.** `pnpm test src/features/workflow` (actions + any
  CallPanel test). Note: `CallPanel` uses Monaco (`BodyEditor`), which is not rendered in
  jsdom; do **not** add a render-based CallPanel test for the editor. If a focused unit
  test is wanted, extract the result→patch mapping into a pure helper
  `stepPatchFromSendResult(res): Partial<Step>` in `actions.ts` and test that instead of
  rendering CallPanel. (Recommended: add this helper for testability and reuse.)

- [ ] **Step 6 — Commit.**

```bash
git add src/features/workflow/actions.ts src/features/workflow/actions.test.ts src/features/workflow/CallPanel.tsx
git commit -m "feat(workflow): resolve {{vars}} before Send; block on unresolved/cycle"
```

---

### Task A6: `WorkflowEnvControl` titlebar switcher

**Files:**
- Create: `src/features/workflow/WorkflowEnvControl.tsx`
- Test: `src/features/workflow/WorkflowEnvControl.test.tsx`

A titlebar control bound to the active workflow's env. It loads environments via
`ipc.envList()`, shows the active workflow's `envName` (or "No environment"), and on
selection calls `workflowStore.setWorkflowEnv(name)`. Reuse the existing
`EnvSwitcherMenu` (from `src/features/envs/EnvSwitcherMenu`) for the dropdown and the
existing `EnvEditorDialog` / `ConfirmDeleteEnvDialog` for create/edit/delete. Do **not**
reuse `EnvPill` directly — its internal `onActiveSet` calls `env_active_set` itself, which
would bypass the workflow store. This control routes everything through the store so the
per-workflow binding and backend sync stay in one place.

- [ ] **Step 1 — Failing test.** Create `WorkflowEnvControl.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const envList = vi.fn().mockResolvedValue([{ name: "staging", variables: {} }, { name: "prod", variables: {} }]);
const envActiveSet = vi.fn().mockResolvedValue(undefined);
vi.mock("@/ipc/client", () => ({ envList: () => envList(), envActiveSet: (n: string | null) => envActiveSet(n) }));

import { workflowStore } from "./store";
import { WorkflowEnvControl } from "./WorkflowEnvControl";

describe("WorkflowEnvControl", () => {
  beforeEach(() => { workflowStore.reset(); });

  it("shows 'No environment' when workflow env is null", async () => {
    render(<WorkflowEnvControl />);
    expect(await screen.findByText(/No environment/i)).toBeInTheDocument();
  });

  it("selecting an env updates the active workflow", async () => {
    const user = userEvent.setup();
    render(<WorkflowEnvControl />);
    await user.click(await screen.findByRole("button"));
    await user.click(await screen.findByText("prod"));
    expect(workflowStore.activeWorkflow().envName).toBe("prod");
  });
});
```

(If `EnvSwitcherMenu`'s portal/menu structure makes the second test brittle in jsdom,
mirror the Plan #3 `WorkflowSelector.test.tsx` approach: assert the trigger label reflects
`envName` and that a direct `setWorkflowEnv` call re-renders the label, rather than
driving the radix menu. Match whichever pattern `EnvSwitcherMenu`'s own tests use.)

- [ ] **Step 2 — Run, expect fail.** → FAIL (module not found).

- [ ] **Step 3 — Implement.** Create `WorkflowEnvControl.tsx`. Sketch (adapt imports to the
  real `EnvSwitcherMenu` prop shape — read that file first):

```tsx
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { envList } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";
import { EnvSwitcherMenu } from "@/features/envs/EnvSwitcherMenu";
import { workflowStore, useActiveWorkflow } from "./store";

export function WorkflowEnvControl() {
  const wf = useActiveWorkflow();
  const [envs, setEnvs] = useState<EnvironmentIpc[]>([]);
  const refresh = () => void envList().then(setEnvs).catch(() => setEnvs([]));
  useEffect(refresh, []);

  return (
    <EnvSwitcherMenu
      envs={envs}
      activeEnv={wf.envName}
      trigger={
        <Button variant="ghost" size="sm" className="gap-1 font-mono">
          {wf.envName ?? "No environment"}
          <ChevronDown className="w-3 h-3" aria-hidden />
        </Button>
      }
      onActiveSet={(next) => workflowStore.setWorkflowEnv(next)}
      onNewEnv={refresh}
      onEditEnv={refresh}
      onDeleteEnv={refresh}
    />
  );
}
```

> Read `src/features/envs/EnvSwitcherMenu.tsx` for its exact prop contract before writing —
> the create/edit/delete callbacks there may expect dialog-opening handlers rather than a
> bare refresh. Wire the existing `EnvEditorDialog` / `ConfirmDeleteEnvDialog` the same way
> `EnvPill.tsx` does, but call `refresh()` (not `env_active_set`) on change.

- [ ] **Step 4 — Run, expect pass.** `pnpm test src/features/workflow/WorkflowEnvControl.test.tsx`.

- [ ] **Step 5 — Commit.**

```bash
git add src/features/workflow/WorkflowEnvControl.tsx src/features/workflow/WorkflowEnvControl.test.tsx
git commit -m "feat(workflow): titlebar env switcher bound to active workflow"
```

---

### Task A7: Mount `WorkflowEnvControl` in the titlebar

**Files:**
- Modify: `src/app/WorkflowApp.tsx`
- Test: `src/app/WorkflowApp.test.tsx`

- [ ] **Step 1 — Failing test.** Add to `WorkflowApp.test.tsx` (it already mocks heavy deps;
  follow the existing mocking style there — Monaco/virtual etc.):

```tsx
it("renders the workflow env control instead of the static chip", () => {
  render(<WorkflowApp />);
  expect(screen.queryByText("env: default")).not.toBeInTheDocument();
  expect(screen.getByText(/No environment/i)).toBeInTheDocument();
});
```

- [ ] **Step 2 — Run, expect fail.** `pnpm test src/app/WorkflowApp.test.tsx`
  → FAIL (static chip still present).

- [ ] **Step 3 — Implement.** In `WorkflowApp.tsx`, replace the static `<span>env: default</span>`
  (lines ~56–58) with `<WorkflowEnvControl />` and add the import. If `envList` mocking in
  the existing test file needs setup, add it alongside the other ipc mocks at the top.

- [ ] **Step 4 — Run, expect pass.** Then the full suite + typecheck:
  `pnpm test` · `pnpm lint` · `pnpm build`.

- [ ] **Step 5 — Commit.**

```bash
git add src/app/WorkflowApp.tsx src/app/WorkflowApp.test.tsx
git commit -m "feat(workflow): mount env switcher in titlebar"
```

---

### Phase A — final review

- [x] Run `pnpm test` (175/175 green), `pnpm lint` (exit 0), `pnpm build` (success).
- [x] Final code review on the Phase A diff → found I1 (uncaught resolver throw leaving
      step stuck on "sending") + M3 (createWorkflow didn't sync backend env); both fixed in
      `4dfd261`. M2 (DRY vs legacy `EnvPill`) deferred — `EnvPill` lives only in the
      unmounted legacy `App.tsx`; fold into that dead-code cleanup. M4/M5 noted (minor).
- [x] EXECUTION STATUS banner updated: Phase A complete + commit range.

## 🧹 /clear-checkpoint — end Phase A. Start a fresh session for Phase B.

---

# PHASE B — Service auth + default metadata + Metadata/Auth sub-tabs

> **Detailed breakdown — expand to full TDD at this checkpoint before executing.**
> Covers outline tasks 3 & 4 + the Metadata/Auth sub-tabs required by spec §4.3.

## File structure (Phase B)

**Backend (Rust):**
- Create: `src-tauri/src/ipc/auth.rs` — `AuthCredentialsIpc { header_name, header_value }`
  (`specta::Type`), `From<AuthCredentials>`. (`SavedAuthConfigIpc` already exists in
  `src-tauri/src/ipc/collection.rs` with `into_core()`.)
- Create/Modify: `src-tauri/src/commands/auth.rs` — new command
  `auth_resolve(config: SavedAuthConfigIpc) -> Result<Option<AuthCredentialsIpc>, IpcError>`
  wrapping core `resolve_auth`.
- Modify: `src-tauri/src/lib.rs` — register `auth_resolve` in `collect_commands!`.
- Modify: `src/ipc/bindings.ts` — **regenerated** (`cargo run -p handshaker --bin export-bindings`).
- Modify: `src/ipc/client.ts` — add `authResolve(config)` wrapper.

**Frontend:**
- Modify: `src/features/catalog/model.ts` — add `auth: SavedAuthConfigIpc` (default
  `{ kind: "none" }`) and `defaultMetadata: MetadataRow[]` to `CatalogService` + factory.
- Modify: `src/features/catalog/store.ts` — `setServiceAuth(id, config)`,
  `setServiceDefaultMetadata(id, rows)`.
- Modify: `src/features/workflow/model.ts` — add `Step.serviceId: string | null`
  (origin service, for live auth lookup at Send).
- Modify: `src/features/workflow/actions.ts` — `createStepFromMethod` seeds `step.metadata`
  from the service's `defaultMetadata` and records `serviceId`; `sendStep` accepts a
  resolved `authHeader?: { key: string; value: string }` and merges it into metadata.
- Modify: `src/features/catalog/actions.ts` — `openCallFromMethod` passes `svc.defaultMetadata`
  + `svc.id` into `createStepFromMethod`.
- Modify: `src/features/workflow/CallPanel.tsx` — before send, look up
  `catalogStore.getService(step.serviceId)?.auth`, call `ipc.authResolve` (skip when
  `kind === "none"`), pass header to `sendStep`; OAuth2 NotImplemented → step error.
- Create: `src/features/workflow/RequestTabs.tsx` — sub-tabs **Request / Metadata / Auth**
  for the call editor (spec §4.3). Request = existing `BodyEditor`; Metadata = a workflow
  metadata editor (see below); Auth = read-only view of inherited service auth + a link to
  edit it in the service panel (spec: auth only on service, no per-step override).
- Create: `src/features/workflow/MetadataEditor.tsx` — editor over the workflow
  `MetadataRow { key, value, enabled }` shape (the existing `features/invoke/MetadataView`
  uses a different `{ k, v }` shape — write a fresh one matching the workflow model;
  do not couple to the legacy component).
- Modify: `src/features/workflow/CallPanel.tsx` — render `RequestTabs` in the left pane
  instead of the bare `BodyEditor`.
- Create: `src/features/catalog/ServiceAuthEditor.tsx` — edit service auth (None / EnvVar
  fields: env var, header, prefix / OAuth2 read-only "not implemented" note). For default
  metadata, **reuse `MetadataEditor`** (no separate `ServiceMetadataEditor` — DRY) bound to
  `setServiceDefaultMetadata`.
- Modify: `src/features/catalog/ServicePanel.tsx` — add Auth + Default-metadata sections.

## Checkpoint decision — confirmed (Key Decision #2)

**Auth routes through a new `auth_resolve` IPC + frontend service storage, NOT the
collection-bound `auth_set_for_env`.** Confirmed sound at this checkpoint: the redesigned
UI has no collections (`auth_set_for_env` needs `collection_id` + `item_id`), so reusing it
is impossible without inventing phantom collections. Core `resolve_auth` already exists and
is fully tested (`crates/handshaker-core/src/auth/mod.rs`), so the new command is a thin
total wrapper — no new external-library behaviour to verify. `SavedAuthConfigIpc` already
exists in `src-tauri/src/ipc/collection.rs`; we reuse it as the command input.

> **TS shape of `SavedAuthConfigIpc`** (from current `bindings.ts`, drives every frontend
> task below):
> `{ kind: "none" } | { kind: "env_var"; env_var: string; header_name: string; prefix: string }`
> `| { kind: "oauth_2_client_credentials"; token_url: string; client_id: string; client_secret_env_var: string; scopes: string[] }`.
> Note the OAuth2 tag is `oauth_2_client_credentials` (specta snake_case of `Oauth2…`).

## Tasks (full TDD)

> Conventions for every task: run the named test first and watch it FAIL before
> implementing (TDD). Frontend tests run via `pnpm test <path>`; Rust via `cargo test -p …`.
> After **any** Rust IPC change (B2) regenerate bindings before touching frontend code.

---

### Task B1: `AuthCredentialsIpc` DTO + `from_core`

**Files:**
- Create: `src-tauri/src/ipc/auth.rs`
- Modify: `src-tauri/src/ipc/mod.rs`

- [ ] **Step 1 — Write the failing test + module.** Create `src-tauri/src/ipc/auth.rs`:

```rust
//! IPC DTO for resolved auth credentials (Plan #5, Phase B). Total conversion
//! from core `AuthCredentials` — a single resolved header to attach to a request.

use handshaker_core::auth::AuthCredentials;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AuthCredentialsIpc {
    pub header_name: String,
    pub header_value: String,
}

impl AuthCredentialsIpc {
    pub fn from_core(c: AuthCredentials) -> Self {
        Self { header_name: c.header_name, header_value: c.header_value }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_core_maps_fields_one_to_one() {
        let core = AuthCredentials {
            header_name: "authorization".into(),
            header_value: "Bearer x".into(),
        };
        let ipc = AuthCredentialsIpc::from_core(core);
        assert_eq!(ipc.header_name, "authorization");
        assert_eq!(ipc.header_value, "Bearer x");
    }
}
```

Register the module in `src-tauri/src/ipc/mod.rs` — add `pub mod auth;` (after `pub mod
target;`) and `pub use auth::AuthCredentialsIpc;` (after the existing `pub use target::…`).

- [ ] **Step 2 — Run, expect pass.** `cargo test -p handshaker ipc::auth`
  Expected: PASS (1 test). (Module is new, so this also confirms it compiles + is wired.)

- [ ] **Step 3 — Commit.**

```bash
git add src-tauri/src/ipc/auth.rs src-tauri/src/ipc/mod.rs
git commit -m "feat(ipc): AuthCredentialsIpc DTO with from_core"
```

---

### Task B2: `auth_resolve` command + bindings + client wrapper

**Files:**
- Create: `src-tauri/src/commands/auth.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Regenerate: `src/ipc/bindings.ts`
- Modify: `src/ipc/client.ts`

- [ ] **Step 1 — Write the failing command + tests.** Create `src-tauri/src/commands/auth.rs`:

```rust
//! Auth-resolution IPC command (Plan #5, Phase B). Thin total wrapper over core
//! `resolve_auth`: `None → Ok(None)`, `EnvVar` reads the OS env var at call time
//! (never persists plaintext, master §10), `OAuth2 → NotImplemented`.

use handshaker_core::auth::resolve_auth;

use crate::ipc::auth::AuthCredentialsIpc;
use crate::ipc::collection::SavedAuthConfigIpc;
use crate::ipc::error::IpcError;

#[tauri::command]
#[specta::specta]
pub async fn auth_resolve(
    config: SavedAuthConfigIpc,
) -> Result<Option<AuthCredentialsIpc>, IpcError> {
    let core = config.into_core();
    let creds = resolve_auth(&core).map_err(IpcError::from)?;
    Ok(creds.map(AuthCredentialsIpc::from_core))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn none_resolves_to_no_header() {
        assert!(auth_resolve(SavedAuthConfigIpc::None).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn env_var_resolves_to_prefixed_header() {
        let var = "HANDSHAKER_TEST_AUTH_RESOLVE_CMD";
        std::env::set_var(var, "tok123");
        let cfg = SavedAuthConfigIpc::EnvVar {
            env_var: var.into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
        };
        let out = auth_resolve(cfg).await.unwrap().unwrap();
        assert_eq!(out.header_name, "authorization");
        assert_eq!(out.header_value, "Bearer tok123");
        std::env::remove_var(var);
    }

    #[tokio::test]
    async fn oauth2_is_not_implemented() {
        let cfg = SavedAuthConfigIpc::Oauth2ClientCredentials {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret_env_var: "SECRET".into(),
            scopes: vec![],
        };
        assert!(matches!(auth_resolve(cfg).await.unwrap_err(), IpcError::NotImplemented { .. }));
    }
}
```

Register the module in `src-tauri/src/commands/mod.rs` — add `pub mod auth;` (first line,
alphabetical).

- [ ] **Step 2 — Run, expect pass.** `cargo test -p handshaker commands::auth`
  Expected: PASS (3 tests). (`env_var_resolves…` uses a unique OS var name so it won't race
  the core-level auth tests.)

- [ ] **Step 3 — Register the command.** In `src-tauri/src/lib.rs`, add the import
  `use commands::auth::auth_resolve;` (above `use commands::collection::…`) and add
  `auth_resolve,` to the `collect_commands![…]` list (e.g. right after `vars_resolve,`).

- [ ] **Step 4 — Regenerate bindings.** From repo root:

```bash
cargo run -p handshaker --bin export-bindings
```

Expected: `src/ipc/bindings.ts` now contains `async authResolve(config: SavedAuthConfigIpc)
: Promise<Result<AuthCredentialsIpc | null, IpcError>>` and an
`export type AuthCredentialsIpc = { header_name: string; header_value: string }`.

- [ ] **Step 5 — Add the client wrapper.** In `src/ipc/client.ts`:
  - extend the type import block with `AuthCredentialsIpc`,
  - add the wrapper (e.g. after `varsResolve`):

```ts
export async function authResolve(
  config: SavedAuthConfigIpc,
): Promise<AuthCredentialsIpc | null> {
  const r = await commands.authResolve(config);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

  - add `authResolve,` to the `export const ipc = { … }` object.

- [ ] **Step 6 — Typecheck.** `pnpm lint` → exit 0.

- [ ] **Step 7 — Commit.**

```bash
git add src-tauri/src/commands/auth.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/ipc/bindings.ts src/ipc/client.ts
git commit -m "feat(auth): auth_resolve IPC wrapping core resolve_auth"
```

---

### Task B3: Service `auth` + `defaultMetadata` on the catalog model + store

**Files:**
- Modify: `src/features/catalog/model.ts`
- Modify: `src/features/catalog/store.ts`
- Test: `src/features/catalog/model.test.ts`
- Test: `src/features/catalog/store.test.ts`

- [ ] **Step 1 — Failing tests (model).** Append to `model.test.ts`:

```ts
it("newCatalogService defaults auth to none and defaultMetadata to empty", () => {
  const svc = newCatalogService({ address: "h:443" });
  expect(svc.auth).toEqual({ kind: "none" });
  expect(svc.defaultMetadata).toEqual([]);
});
```

(Ensure `newCatalogService` is imported in `model.test.ts`; add it to the existing import
if absent.)

- [ ] **Step 2 — Failing tests (store).** Append to `store.test.ts`:

```ts
it("setServiceAuth patches the service auth config", () => {
  const svc = catalogStore.addService({ address: "h" });
  catalogStore.setServiceAuth(svc.id, {
    kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer ",
  });
  expect(catalogStore.getService(svc.id)?.auth).toEqual({
    kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer ",
  });
});

it("setServiceDefaultMetadata patches the default metadata rows", () => {
  const svc = catalogStore.addService({ address: "h" });
  const rows = [{ key: "x-tenant", value: "{{tenant}}", enabled: true }];
  catalogStore.setServiceDefaultMetadata(svc.id, rows);
  expect(catalogStore.getService(svc.id)?.defaultMetadata).toEqual(rows);
});
```

- [ ] **Step 3 — Run, expect fail.**
  `pnpm test src/features/catalog/model.test.ts src/features/catalog/store.test.ts`
  → FAIL (`auth`/`defaultMetadata` undefined; setters not functions).

- [ ] **Step 4 — Implement (model.ts).** Add imports + fields + factory defaults:

```ts
import type { ServiceCatalogIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
import type { MetadataRow } from "@/features/workflow/model";
```

```ts
export interface CatalogService {
  // …existing fields…
  auth: SavedAuthConfigIpc; // service-level auth, applied to all its steps (spec §6)
  defaultMetadata: MetadataRow[]; // inherited (deep-copied) into new steps
}
```

In `newCatalogService`, add to the returned object:

```ts
    auth: { kind: "none" },
    defaultMetadata: [],
```

- [ ] **Step 5 — Implement (store.ts).** Add to the `catalogStore` object (after
  `setContract`):

```ts
  setServiceAuth(id: string, config: SavedAuthConfigIpc) {
    patchService(id, (s) => ({ ...s, auth: config }));
  },
  setServiceDefaultMetadata(id: string, rows: MetadataRow[]) {
    patchService(id, (s) => ({ ...s, defaultMetadata: rows }));
  },
```

Add the imports at the top of `store.ts`:

```ts
import type { ServiceCatalogIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
import type { MetadataRow } from "@/features/workflow/model";
```

- [ ] **Step 6 — Run, expect pass.** `pnpm test src/features/catalog` then `pnpm lint`.

- [ ] **Step 7 — Commit.**

```bash
git add src/features/catalog/model.ts src/features/catalog/store.ts src/features/catalog/model.test.ts src/features/catalog/store.test.ts
git commit -m "feat(catalog): service-level auth + defaultMetadata on model + store"
```

---

### Task B4: `Step.serviceId` + default-metadata inheritance into new steps

**Files:**
- Modify: `src/features/workflow/model.ts`
- Modify: `src/features/workflow/actions.ts`
- Modify: `src/features/catalog/actions.ts`
- Test: `src/features/workflow/model.test.ts`
- Test: `src/features/workflow/actions.test.ts`

- [ ] **Step 1 — Failing test (model).** Append to `model.test.ts`:

```ts
it("newStep defaults serviceId to null and metadata to []", () => {
  const s = newStep({ address: "h", tls: false, service: "S", method: "M" });
  expect(s.serviceId).toBeNull();
  expect(s.metadata).toEqual([]);
});

it("newStep carries provided serviceId and metadata", () => {
  const rows = [{ key: "x", value: "1", enabled: true }];
  const s = newStep({ address: "h", tls: false, service: "S", method: "M", serviceId: "svc-1", metadata: rows });
  expect(s.serviceId).toBe("svc-1");
  expect(s.metadata).toEqual(rows);
});
```

- [ ] **Step 2 — Failing test (actions).** Append to `actions.test.ts` (inside the
  `describe("createStepFromMethod", …)` block):

```ts
it("seeds metadata (deep copy) from service defaultMetadata and records serviceId", async () => {
  vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue("{}");
  const defaults = [{ key: "x-tenant", value: "{{tenant}}", enabled: true }];
  const step = await createStepFromMethod(
    { address: "h:443", tls: true }, "S", "M",
    { serviceId: "svc-1", defaultMetadata: defaults },
  );
  expect(step.serviceId).toBe("svc-1");
  expect(step.metadata).toEqual(defaults);
  expect(step.metadata).not.toBe(defaults);       // deep copy: array identity differs
  expect(step.metadata[0]).not.toBe(defaults[0]); // and row identity differs
});
```

- [ ] **Step 3 — Run, expect fail.**
  `pnpm test src/features/workflow/model.test.ts src/features/workflow/actions.test.ts`
  → FAIL (`serviceId` undefined; `createStepFromMethod` ignores opts).

- [ ] **Step 4 — Implement (model.ts).** Add `serviceId` to `Step` and extend `newStep`:

```ts
export interface Step {
  id: string;
  address: string;
  tls: boolean;
  service: string;
  method: string;
  serviceId: string | null; // origin catalog service, for live auth lookup at Send
  requestJson: string;
  metadata: MetadataRow[];
  status: StepStatus;
  outcome: InvokeOutcomeIpc | null;
  error: string | null;
}

export function newStep(init: {
  address: string;
  tls: boolean;
  service: string;
  method: string;
  requestJson?: string;
  metadata?: MetadataRow[];
  serviceId?: string | null;
}): Step {
  return {
    id: newId(),
    address: init.address,
    tls: init.tls,
    service: init.service,
    method: init.method,
    serviceId: init.serviceId ?? null,
    requestJson: init.requestJson ?? "{}",
    metadata: init.metadata ?? [],
    status: "draft",
    outcome: null,
    error: null,
  };
}
```

- [ ] **Step 5 — Implement (workflow/actions.ts).** Extend `createStepFromMethod`:

```ts
export async function createStepFromMethod(
  target: CallTargetInit,
  service: string,
  method: string,
  opts: { serviceId?: string | null; defaultMetadata?: MetadataRow[] } = {},
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
    serviceId: opts.serviceId ?? null,
    metadata: (opts.defaultMetadata ?? []).map((r) => ({ ...r })), // deep copy → editable
  });
}
```

- [ ] **Step 6 — Implement (catalog/actions.ts).** In `openCallFromMethod`, pass the service
  id + default metadata, and update the stale comment:

```ts
  const step = await createStepFromMethod(
    { address: svc.address, tls: svc.tls },
    service,
    method,
    { serviceId: svc.id, defaultMetadata: svc.defaultMetadata },
  );
```

  (Remove the `NOTE: skipVerify/auth are NOT wired…` comment line that says auth is unwired —
  it is being wired now.)

- [ ] **Step 7 — Run, expect pass.** `pnpm test src/features/workflow src/features/catalog`
  then `pnpm lint`.

- [ ] **Step 8 — Commit.**

```bash
git add src/features/workflow/model.ts src/features/workflow/actions.ts src/features/catalog/actions.ts src/features/workflow/model.test.ts src/features/workflow/actions.test.ts
git commit -m "feat(workflow): step.serviceId + inherit service defaultMetadata into new steps"
```

---

### Task B5: Apply resolved auth at Send (`sendStep` merge + `resolveStepAuthHeader`)

**Files:**
- Modify: `src/features/workflow/actions.ts`
- Test: `src/features/workflow/actions.test.ts`

`sendStep` gains an optional final `authHeader` that is merged into the invoke metadata map
**verbatim** (it is already final from `auth_resolve` — NOT `{{var}}`-resolved). A pure
helper `resolveStepAuthHeader` looks up the origin service's auth and resolves it (so
`CallPanel` stays thin and testable without Monaco).

- [ ] **Step 1 — Failing tests.** Append to `actions.test.ts`. First add `authResolve` to the
  mocked client at the top of the file (extend the existing `vi.mock("@/ipc/client", …)`):

```ts
vi.mock("@/ipc/client", () => ({
  grpcBuildRequestSkeleton: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  varsResolve: vi.fn(),
  authResolve: vi.fn(),
}));
```

Then add the tests:

```ts
import { resolveStepAuthHeader } from "./actions";

describe("sendStep authHeader merge", () => {
  beforeEach(() => {
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, elapsed_ms: 1,
    });
  });

  it("merges the auth header verbatim alongside resolved metadata rows", async () => {
    await sendStep(
      { address: "h:443", tls: true, service: "S", method: "M", requestJson: "{}",
        metadata: [{ key: "x", value: "1", enabled: true }] },
      { key: "authorization", value: "Bearer {{notresolved}}" }, // verbatim: no var resolution
    );
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}",
        metadata: { x: "1", authorization: "Bearer {{notresolved}}" } },
    );
  });

  it("injects nothing when no authHeader is given", async () => {
    await sendStep({ address: "h:443", tls: true, service: "S", method: "M", requestJson: "{}", metadata: [] });
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}", metadata: {} },
    );
  });
});

describe("resolveStepAuthHeader", () => {
  const getNone = () => ({ auth: { kind: "none" as const } });

  it("returns kind 'none' when serviceId is null", async () => {
    const r = await resolveStepAuthHeader(null, () => undefined, ipc.authResolve);
    expect(r.kind).toBe("none");
    expect(ipc.authResolve).not.toHaveBeenCalled();
  });

  it("returns kind 'none' when the service auth is none", async () => {
    const r = await resolveStepAuthHeader("svc-1", getNone, ipc.authResolve);
    expect(r.kind).toBe("none");
    expect(ipc.authResolve).not.toHaveBeenCalled();
  });

  it("returns a header when EnvVar auth resolves", async () => {
    vi.mocked(ipc.authResolve).mockResolvedValue({ header_name: "authorization", header_value: "Bearer t" });
    const svc = { auth: { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " } };
    const r = await resolveStepAuthHeader("svc-1", () => svc, ipc.authResolve);
    expect(r).toEqual({ kind: "header", header: { key: "authorization", value: "Bearer t" } });
  });

  it("returns kind 'error' when authResolve throws (OAuth2 NotImplemented)", async () => {
    vi.mocked(ipc.authResolve).mockRejectedValue({ type: "NotImplemented", message: "oauth2 token fetch" });
    const svc = { auth: { kind: "oauth_2_client_credentials" as const, token_url: "u", client_id: "c", client_secret_env_var: "S", scopes: [] } };
    const r = await resolveStepAuthHeader("svc-1", () => svc, ipc.authResolve);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("oauth2");
  });
});
```

- [ ] **Step 2 — Run, expect fail.** `pnpm test src/features/workflow/actions.test.ts`
  → FAIL (`sendStep` takes no `authHeader`; `resolveStepAuthHeader` not exported).

- [ ] **Step 3 — Implement.** In `actions.ts` add the import and helper, and extend
  `sendStep`:

```ts
import type { InvokeOutcomeIpc, SavedAuthConfigIpc, AuthCredentialsIpc } from "@/ipc/bindings";
```

```ts
export type AuthHeader = { key: string; value: string };

export type AuthHeaderResult =
  | { kind: "none" }
  | { kind: "header"; header: AuthHeader }
  | { kind: "error"; message: string };

export async function resolveStepAuthHeader(
  serviceId: string | null,
  getService: (id: string) => { auth: SavedAuthConfigIpc } | undefined,
  authResolve: (c: SavedAuthConfigIpc) => Promise<AuthCredentialsIpc | null>,
): Promise<AuthHeaderResult> {
  if (!serviceId) return { kind: "none" };
  const svc = getService(serviceId);
  if (!svc || svc.auth.kind === "none") return { kind: "none" };
  try {
    const creds = await authResolve(svc.auth);
    if (!creds) return { kind: "none" };
    return { kind: "header", header: { key: creds.header_name, value: creds.header_value } };
  } catch (e) {
    return { kind: "error", message: errorToMessage(e) };
  }
}
```

Extend `sendStep` (add the `authHeader` param and merge it verbatim after the resolved rows):

```ts
export async function sendStep(
  step: {
    address: string;
    tls: boolean;
    service: string;
    method: string;
    requestJson: string;
    metadata: MetadataRow[];
  },
  authHeader?: AuthHeader | null,
): Promise<SendResult> {
  try {
    const r = await resolveStepTemplates(step, ipc.varsResolve);
    if (!r.ok) return { kind: "unresolved", unresolved: r.unresolved, cycle: r.cycle };
    const metadata: Record<string, string> = {};
    for (const m of r.request.metadata) metadata[m.key] = m.value;
    if (authHeader) metadata[authHeader.key] = authHeader.value; // verbatim, not {{var}}-resolved
    const outcome = await ipc.grpcInvokeOneshot(
      { address: r.request.address, tls: step.tls, skip_verify: false },
      { service: step.service, method: step.method, request_json: r.request.requestJson, metadata },
    );
    return { kind: "ok", outcome };
  } catch (e) {
    return { kind: "error", message: errorToMessage(e) };
  }
}
```

- [ ] **Step 4 — Run, expect pass.** `pnpm test src/features/workflow/actions.test.ts`
  then `pnpm lint`.

- [ ] **Step 5 — Commit.**

```bash
git add src/features/workflow/actions.ts src/features/workflow/actions.test.ts
git commit -m "feat(workflow): resolve + merge service auth header at Send"
```

---

### Task B6: `MetadataEditor` over the workflow `MetadataRow` shape

**Files:**
- Create: `src/features/workflow/MetadataEditor.tsx`
- Test: `src/features/workflow/MetadataEditor.test.tsx`

A fresh editor over `MetadataRow { key, value, enabled }` (the legacy `invoke/MetadataView`
uses `{ k, v }` and has no `enabled` — do **not** reuse it). Controlled component:
`{ rows, onChange }`.

- [ ] **Step 1 — Failing test.** Create `MetadataEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MetadataEditor } from "./MetadataEditor";

const rows = [{ key: "x-tenant", value: "acme", enabled: true }];

describe("MetadataEditor", () => {
  it("edits a key and calls back with the new rows", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MetadataEditor rows={rows} onChange={onChange} />);
    await user.type(screen.getByLabelText("metadata-key-0"), "!");
    expect(onChange).toHaveBeenLastCalledWith([{ key: "x-tenant!", value: "acme", enabled: true }]);
  });

  it("toggles enabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MetadataEditor rows={rows} onChange={onChange} />);
    await user.click(screen.getByLabelText("metadata-enabled-0"));
    expect(onChange).toHaveBeenLastCalledWith([{ key: "x-tenant", value: "acme", enabled: false }]);
  });

  it("adds a row", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MetadataEditor rows={rows} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(onChange).toHaveBeenLastCalledWith([...rows, { key: "", value: "", enabled: true }]);
  });

  it("removes a row", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MetadataEditor rows={rows} onChange={onChange} />);
    await user.click(screen.getByLabelText("metadata-remove-0"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
```

> Note: `userEvent.type` with `"!"` fires one `onChange` whose batched value is the full
> string; the editor must apply the patch against the row prop (controlled), so the asserted
> call is the new full key. Keep each input controlled (`value={row.key}`).

- [ ] **Step 2 — Run, expect fail.** `pnpm test src/features/workflow/MetadataEditor.test.tsx`
  → FAIL (module not found).

- [ ] **Step 3 — Implement.** Create `MetadataEditor.tsx` (model on `invoke/MetadataView`
  but with the `{key,value,enabled}` shape + an enable checkbox; aria-labels carry the row
  index for test targeting):

```tsx
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MetadataRow } from "./model";

export interface MetadataEditorProps {
  rows: MetadataRow[];
  onChange: (next: MetadataRow[]) => void;
}

export function MetadataEditor({ rows, onChange }: MetadataEditorProps) {
  const updateRow = (i: number, patch: Partial<MetadataRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const addRow = () => onChange([...rows, { key: "", value: "", enabled: true }]);

  return (
    <div className="p-3.5">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[28px_1fr_1.6fr_28px] border-b border-border bg-muted/30">
          <div />
          <div className="px-3 py-1.5 label-cap">Key</div>
          <div className="px-3 py-1.5 label-cap">Value</div>
          <div />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[28px_1fr_1.6fr_28px] border-b border-border/60 last:border-0">
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={row.enabled}
                aria-label={`metadata-enabled-${i}`}
                onChange={(e) => updateRow(i, { enabled: e.target.checked })}
              />
            </div>
            <div className="flex h-8 items-center px-3">
              <input
                value={row.key}
                aria-label={`metadata-key-${i}`}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                placeholder="x-request-id"
                className="w-full bg-transparent font-mono text-xs placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <div className="flex h-8 items-center px-3">
              <input
                value={row.value}
                aria-label={`metadata-value-${i}`}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                placeholder="value or {{var}}"
                className="w-full bg-transparent font-mono text-xs placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-center">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`metadata-remove-${i}`}
                onClick={() => removeRow(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-2.5" />
              </Button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          aria-label="add metadata row"
          className="grid w-full grid-cols-[28px_1fr_1.6fr_28px] text-left transition-colors hover:bg-accent/40"
        >
          <div />
          <div className="flex h-8 items-center px-3 text-xs text-muted-foreground">Add key…</div>
          <div />
          <div className="flex items-center justify-center text-muted-foreground">
            <Plus className="size-2.5" />
          </div>
        </button>
      </div>
    </div>
  );
}
```

> Verify `size="icon-xs"` exists on the `Button` variant (it is used by `invoke/MetadataView`,
> so it does). If `userEvent.type("!")` produces a multi-call assertion mismatch, switch the
> first test to `fireEvent.change(input, { target: { value: "x-tenant!" } })` and assert the
> single resulting `onChange`.

- [ ] **Step 4 — Run, expect pass.** `pnpm test src/features/workflow/MetadataEditor.test.tsx`.

- [ ] **Step 5 — Commit.**

```bash
git add src/features/workflow/MetadataEditor.tsx src/features/workflow/MetadataEditor.test.tsx
git commit -m "feat(workflow): MetadataEditor over {key,value,enabled} rows"
```

---

### Task B7: `RequestTabs` — Request / Metadata / Auth sub-tabs (spec §4.3)

**Files:**
- Create: `src/features/workflow/RequestTabs.tsx`
- Test: `src/features/workflow/RequestTabs.test.tsx`

Sub-tabs for the call editor. **Request** = the existing `BodyEditor`; **Metadata** =
`MetadataEditor` over the step's metadata; **Auth** = read-only view of the inherited
service auth (spec: auth lives only on the service — no per-step override). Local `useState`
tab (matches the codebase's lightweight `ViewSwitcher` style; no new dependency).

Props: `{ step, serviceAuth, onBody, onMetadata }`.

- [ ] **Step 1 — Failing test.** Create `RequestTabs.test.tsx` (mock `BodyEditor` so Monaco
  never loads in jsdom — same approach Plan #3 used for Monaco):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));

import { RequestTabs } from "./RequestTabs";
import { newStep } from "./model";

function setup(authKind: "none" | "env_var" = "none") {
  const step = { ...newStep({ address: "h", tls: false, service: "S", method: "M", requestJson: '{"a":1}' }),
    metadata: [{ key: "x", value: "1", enabled: true }] };
  const serviceAuth =
    authKind === "none"
      ? { kind: "none" as const }
      : { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
  return { step, serviceAuth, onBody: vi.fn(), onMetadata: vi.fn() };
}

describe("RequestTabs", () => {
  it("shows the Request (body) pane by default", () => {
    const p = setup();
    render(<RequestTabs {...p} />);
    expect(screen.getByTestId("body-editor")).toHaveTextContent('{"a":1}');
  });

  it("switches to the Metadata pane", async () => {
    const user = userEvent.setup();
    const p = setup();
    render(<RequestTabs {...p} />);
    await user.click(screen.getByRole("tab", { name: /metadata/i }));
    expect(screen.getByLabelText("metadata-key-0")).toHaveValue("x");
  });

  it("Auth pane renders the inherited service auth read-only", async () => {
    const user = userEvent.setup();
    const p = setup("env_var");
    render(<RequestTabs {...p} />);
    await user.click(screen.getByRole("tab", { name: /auth/i }));
    expect(screen.getByText(/env_var/i)).toBeInTheDocument();
    expect(screen.getByText(/TOK/)).toBeInTheDocument();
    // read-only: no editable inputs in the Auth pane
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2 — Run, expect fail.** `pnpm test src/features/workflow/RequestTabs.test.tsx`
  → FAIL (module not found).

- [ ] **Step 3 — Implement.** Create `RequestTabs.tsx`:

```tsx
import { useState } from "react";
import { BodyEditor } from "@/features/invoke/BodyEditor";
import { cn } from "@/lib/cn";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import { MetadataEditor } from "./MetadataEditor";
import type { MetadataRow, Step } from "./model";

type Tab = "request" | "metadata" | "auth";

export interface RequestTabsProps {
  step: Step;
  serviceAuth: SavedAuthConfigIpc;
  onBody: (value: string) => void;
  onMetadata: (rows: MetadataRow[]) => void;
}

export function RequestTabs({ step, serviceAuth, onBody, onMetadata }: RequestTabsProps) {
  const [tab, setTab] = useState<Tab>("request");
  const tabs: { id: Tab; label: string }[] = [
    { id: "request", label: "Request" },
    { id: "metadata", label: "Metadata" },
    { id: "auth", label: "Auth" },
  ];
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" className="flex flex-none gap-1 border-b border-border px-2 py-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded px-2 py-0.5 text-xs",
              tab === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "request" ? <BodyEditor value={step.requestJson} onChange={onBody} /> : null}
        {tab === "metadata" ? <MetadataEditor rows={step.metadata} onChange={onMetadata} /> : null}
        {tab === "auth" ? <AuthReadOnly auth={serviceAuth} /> : null}
      </div>
    </div>
  );
}

function AuthReadOnly({ auth }: { auth: SavedAuthConfigIpc }) {
  return (
    <div className="space-y-2 p-3.5 text-xs">
      <div className="text-muted-foreground">
        Auth наследуется от сервиса (настраивается в панели сервиса).
      </div>
      <div className="rounded-md border border-border bg-card p-3 font-mono">
        <div>kind: {auth.kind}</div>
        {auth.kind === "env_var" ? (
          <>
            <div>env_var: {auth.env_var}</div>
            <div>header: {auth.header_name}</div>
            <div>prefix: {auth.prefix}</div>
          </>
        ) : null}
        {auth.kind === "oauth_2_client_credentials" ? (
          <div className="text-destructive">OAuth2 — не реализовано (master §5.4)</div>
        ) : null}
      </div>
    </div>
  );
}
```

> Confirm `@/lib/cn` exists (used by `invoke/MetadataView`). It does.

- [ ] **Step 4 — Run, expect pass.** `pnpm test src/features/workflow/RequestTabs.test.tsx`.

- [ ] **Step 5 — Commit.**

```bash
git add src/features/workflow/RequestTabs.tsx src/features/workflow/RequestTabs.test.tsx
git commit -m "feat(workflow): Request/Metadata/Auth sub-tabs (spec §4.3)"
```

---

### Task B8: `ServiceAuthEditor` + default-metadata section in `ServicePanel`

**Files:**
- Create: `src/features/catalog/ServiceAuthEditor.tsx`
- Test: `src/features/catalog/ServiceAuthEditor.test.tsx`
- Modify: `src/features/catalog/ServicePanel.tsx`
- Test: `src/features/catalog/ServicePanel.test.tsx`

`ServiceAuthEditor` is a controlled `{ value: SavedAuthConfigIpc, onChange }` control: a
kind selector (none / env_var / oauth_2_client_credentials) plus the fields for the chosen
kind. `ServicePanel` mounts it (→ `setServiceAuth`) and a `MetadataEditor` for default
metadata (→ `setServiceDefaultMetadata`).

- [ ] **Step 1 — Failing test (ServiceAuthEditor).** Create `ServiceAuthEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServiceAuthEditor } from "./ServiceAuthEditor";

describe("ServiceAuthEditor", () => {
  it("switching kind to env_var emits an env_var config with empty fields", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ServiceAuthEditor value={{ kind: "none" }} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("auth-kind"), "env_var");
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("editing the env var name emits an updated config", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ServiceAuthEditor
        value={{ kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer " }}
        onChange={onChange}
      />,
    );
    await user.type(screen.getByLabelText("auth-env-var"), "T");
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer ",
    });
  });
});
```

- [ ] **Step 2 — Run, expect fail.** → FAIL (module not found).

- [ ] **Step 3 — Implement `ServiceAuthEditor.tsx`:**

```tsx
import type { SavedAuthConfigIpc } from "@/ipc/bindings";

export interface ServiceAuthEditorProps {
  value: SavedAuthConfigIpc;
  onChange: (next: SavedAuthConfigIpc) => void;
}

const ENV_VAR_DEFAULT: SavedAuthConfigIpc = {
  kind: "env_var",
  env_var: "",
  header_name: "authorization",
  prefix: "Bearer ",
};

const OAUTH_DEFAULT: SavedAuthConfigIpc = {
  kind: "oauth_2_client_credentials",
  token_url: "",
  client_id: "",
  client_secret_env_var: "",
  scopes: [],
};

export function ServiceAuthEditor({ value, onChange }: ServiceAuthEditorProps) {
  const onKind = (kind: SavedAuthConfigIpc["kind"]) => {
    if (kind === "none") onChange({ kind: "none" });
    else if (kind === "env_var") onChange(ENV_VAR_DEFAULT);
    else onChange(OAUTH_DEFAULT);
  };

  return (
    <div className="space-y-2 text-xs">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Auth</span>
        <select
          aria-label="auth-kind"
          value={value.kind}
          onChange={(e) => onKind(e.target.value as SavedAuthConfigIpc["kind"])}
          className="h-7 rounded border border-border bg-background px-2"
        >
          <option value="none">None</option>
          <option value="env_var">Env var (Bearer)</option>
          <option value="oauth_2_client_credentials">OAuth2 (client credentials)</option>
        </select>
      </label>

      {value.kind === "env_var" ? (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 font-mono">
          <span className="text-muted-foreground">env var</span>
          <input
            aria-label="auth-env-var"
            value={value.env_var}
            onChange={(e) => onChange({ ...value, env_var: e.target.value })}
            placeholder="API_TOKEN"
            className="h-7 rounded border border-border bg-background px-2"
          />
          <span className="text-muted-foreground">header</span>
          <input
            aria-label="auth-header-name"
            value={value.header_name}
            onChange={(e) => onChange({ ...value, header_name: e.target.value })}
            className="h-7 rounded border border-border bg-background px-2"
          />
          <span className="text-muted-foreground">prefix</span>
          <input
            aria-label="auth-prefix"
            value={value.prefix}
            onChange={(e) => onChange({ ...value, prefix: e.target.value })}
            className="h-7 rounded border border-border bg-background px-2"
          />
        </div>
      ) : null}

      {value.kind === "oauth_2_client_credentials" ? (
        <div className="text-destructive">OAuth2 — не реализовано (master §5.4)</div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4 — Run, expect pass.** `pnpm test src/features/catalog/ServiceAuthEditor.test.tsx`.

- [ ] **Step 5 — Failing test (ServicePanel wiring).** Append to `ServicePanel.test.tsx`:

```tsx
it("editing service auth kind persists via setServiceAuth", async () => {
  const user = userEvent.setup();
  const svc = catalogStore.addService({ address: "h:443" });
  catalogStore.setContract(svc.id, contract, 1);
  render(<ServicePanel serviceId={svc.id} onClose={() => {}} />);
  await user.selectOptions(screen.getByLabelText("auth-kind"), "env_var");
  expect(catalogStore.getService(svc.id)?.auth.kind).toBe("env_var");
});

it("editing default metadata persists via setServiceDefaultMetadata", async () => {
  const user = userEvent.setup();
  const svc = catalogStore.addService({ address: "h:443" });
  catalogStore.setContract(svc.id, contract, 1);
  render(<ServicePanel serviceId={svc.id} onClose={() => {}} />);
  await user.click(screen.getByRole("button", { name: /add metadata row/i }));
  expect(catalogStore.getService(svc.id)?.defaultMetadata).toEqual([
    { key: "", value: "", enabled: true },
  ]);
});
```

- [ ] **Step 6 — Run, expect fail.** `pnpm test src/features/catalog/ServicePanel.test.tsx`
  → FAIL (controls not mounted).

- [ ] **Step 7 — Implement (ServicePanel.tsx).** Import the editors + store setters and add
  an Auth + Default-metadata section. Insert this block **inside** the scrollable body, after
  the methods tree `</div>` that closes the tree map area (i.e. just before the final
  closing `</div></div>` of the panel — keep it within the `overflow-auto` container or add
  a sibling section above it):

```tsx
import { ServiceAuthEditor } from "./ServiceAuthEditor";
import { MetadataEditor } from "@/features/workflow/MetadataEditor";
```

```tsx
<div className="border-t border-border px-4 py-3 space-y-3">
  <div className="label-cap">Auth (на весь сервис)</div>
  <ServiceAuthEditor
    value={svc.auth}
    onChange={(cfg) => catalogStore.setServiceAuth(svc.id, cfg)}
  />
  <div className="label-cap">Default metadata</div>
  <MetadataEditor
    rows={svc.defaultMetadata}
    onChange={(rows) => catalogStore.setServiceDefaultMetadata(svc.id, rows)}
  />
</div>
```

  (`useCatalog()` is already subscribed at the top of `ServicePanel`, so `svc.auth` /
  `svc.defaultMetadata` re-render on change.)

- [ ] **Step 8 — Run, expect pass.** `pnpm test src/features/catalog/ServicePanel.test.tsx`
  then `pnpm lint`.

- [ ] **Step 9 — Commit.**

```bash
git add src/features/catalog/ServiceAuthEditor.tsx src/features/catalog/ServiceAuthEditor.test.tsx src/features/catalog/ServicePanel.tsx src/features/catalog/ServicePanel.test.tsx
git commit -m "feat(catalog): service auth + default-metadata editors in ServicePanel"
```

---

### Task B9: Wire `RequestTabs` + auth-at-Send into `CallPanel`

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx`

`CallPanel` renders `RequestTabs` instead of the bare `BodyEditor`, and on Send resolves the
service auth header (via `resolveStepAuthHeader`) before calling `sendStep`. An auth error
(OAuth2 NotImplemented / missing env var) becomes a step error and does **not** invoke.
No new render test (Monaco doesn't run in jsdom — the logic is already covered by the pure
helpers in B5; this task is wiring + the full-suite/lint/build gate).

- [ ] **Step 1 — Implement (CallPanel.tsx).** Replace the body/editor wiring:

```tsx
import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { catalogStore } from "@/features/catalog/store";
import { authResolve } from "@/ipc/client";
import { AddressBar } from "./AddressBar";
import { RequestTabs } from "./RequestTabs";
import { workflowStore } from "./store";
import { updateStep } from "./reducers";
import { resolveStepAuthHeader, sendStep, stepPatchFromSendResult } from "./actions";
import type { MetadataRow, Step } from "./model";

export function CallPanel({ step }: { step: Step }) {
  const onBody = (value: string) =>
    workflowStore.update((w) => updateStep(w, step.id, { requestJson: value }));
  const onMetadata = (rows: MetadataRow[]) =>
    workflowStore.update((w) => updateStep(w, step.id, { metadata: rows }));

  const onSend = async () => {
    workflowStore.update((w) => updateStep(w, step.id, { status: "sending", error: null }));
    const auth = await resolveStepAuthHeader(
      step.serviceId,
      (id) => catalogStore.getService(id),
      authResolve,
    );
    if (auth.kind === "error") {
      workflowStore.update((w) =>
        updateStep(w, step.id, { status: "error", outcome: null, error: auth.message }),
      );
      return;
    }
    const res = await sendStep(step, auth.kind === "header" ? auth.header : null);
    workflowStore.update((w) => updateStep(w, step.id, stepPatchFromSendResult(res)));
  };

  const serviceAuth = (step.serviceId && catalogStore.getService(step.serviceId)?.auth) || { kind: "none" as const };

  return (
    <div className="flex h-full flex-col">
      <AddressBar step={step} onSend={onSend} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-border">
          <RequestTabs step={step} serviceAuth={serviceAuth} onBody={onBody} onMetadata={onMetadata} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <ResponseSlot step={step} />
        </div>
      </div>
    </div>
  );
}
```

  Keep the existing `ResponseSlot` function below unchanged.

> `catalogStore.getService(id)` returns `CatalogService | undefined`; the `|| { kind: "none" }`
> guard covers an orphaned `serviceId` (service deleted after the step was created).

- [ ] **Step 2 — Full gate.** `pnpm test` (all green, ≥ new totals) · `pnpm lint` (exit 0) ·
  `pnpm build` (success) · `cargo test -p handshaker` (auth IPC tests green).

- [ ] **Step 3 — Commit.**

```bash
git add src/features/workflow/CallPanel.tsx
git commit -m "feat(workflow): wire RequestTabs + service auth into CallPanel send"
```

---

### Phase B — final review

- [x] Run full suite + typecheck + build + Rust tests (B9 gate): pnpm test 204/204, lint
  exit 0, build success, `cargo test -p handshaker` 25/25.
- [x] Final code review on the Phase B diff (`4ea8f22..bbd286b`) → **ready to merge**, no
  critical/important issues. Two minor notes: (1) orphaned-serviceId branch of
  `resolveStepAuthHeader` was untested → **fixed** in `d45fc38`; (2) `CallPanel`'s read-only
  Auth-tab display is computed synchronously from `catalogStore` (no `useCatalog()` subscribe)
  so it can be momentarily stale — **accepted** (no correctness risk: the header actually sent
  is read fresh in `onSend`; a one-line `useCatalog()` would make the display live if desired).
- [x] EXECUTION STATUS banner updated: Phase B complete + commit range; Active = Phase C.

## 🧹 /clear-checkpoint — end Phase B. Start a fresh session for Phase C.

---

# PHASE C — Cancel / timeout + network diagnostics + parallel send

> **Detailed breakdown — expand to full TDD at this checkpoint before executing.**
> Covers outline tasks 5, 6 & 7. **Before detailing: verify (context7/WebSearch) that a
> dropped JS promise does not abort the awaited Rust Tauri command** — this is the premise
> for the server-side cancel registry. Cite the source in the detailed plan (project
> convention: verify design-impacting claims).

## File structure (Phase C)

**Backend (Rust):**
- Modify: `src-tauri/src/state.rs` — add
  `pub in_flight: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>` (std `Mutex` is fine —
  held only for insert/remove, never across `.await`).
- Modify: `src-tauri/src/commands/grpc.rs`:
  - `grpc_invoke_oneshot(state, target, request, request_id: String, timeout_ms: u32)`:
    register a `Notify` under `request_id`; run `activate + invoke_unary` inside
    `tokio::select!` racing `notify.notified()`; wrap the invoke arm in
    `tokio::time::timeout(Duration::from_millis(timeout_ms as u64), …)`; always remove the
    registry entry on exit (guard struct / `scopeguard`-style drop). Cancelled → return a
    dedicated `IpcError` (or `CoreError::Transport("request cancelled")`); timeout →
    `CoreError::Transport("request timed out after {ms}ms")`.
  - New command `grpc_cancel(state, request_id: String) -> Result<(), IpcError>`: look up
    and `notify_waiters()`.
- Modify: `src-tauri/src/lib.rs` — register `grpc_cancel`.
- Regenerate bindings; update `src/ipc/client.ts` (`grpcInvokeOneshot` gains
  `request_id` + `timeout_ms`; add `grpcCancel`).

> **Decision to confirm at this checkpoint:** dedicated `CoreError::Cancelled` /
> `CoreError::Timeout` variants (cleaner diagnostics, ripples through `error.rs` +
> `IpcError` + bindings + existing error rendering) **vs** reusing `Transport(msg)` and
> classifying by message on the frontend (less invasive; the diagnostics classifier in C5
> already parses messages). Default: reuse `Transport(msg)` to bound scope.

**Frontend:**
- Modify: `src/lib/use-prefs.ts` — add `requestTimeoutMs: number` (default `30000`) to
  `Prefs` + `PREFS_DEFAULTS`.
- Modify: `src/features/settings/NetworkPane.tsx` — make "Request deadline" an editable,
  validated number input bound to `usePrefs("requestTimeoutMs", …)` (seconds in the UI,
  ms in storage); drop the read-only placeholder note for that row.
- Modify: `src/features/workflow/model.ts` — `Step` gains an in-flight `requestId`
  (transient) so Cancel can target the live call. (Store on the step only while
  `status === "sending"`.)
- Modify: `src/features/workflow/actions.ts` — `sendStep` generates a `request_id`
  (`newId()`), reads the timeout from prefs, passes both to `grpcInvokeOneshot`; export a
  `cancelStep(requestId)` that calls `ipc.grpcCancel`.
- Modify: `src/features/workflow/AddressBar.tsx` — while sending, show a **Cancel** button
  (calls `cancelStep(step.requestId)`); cancelled result resets the step to `draft`
  (idle), not `error`.
- Create: `src/features/workflow/netDiagnostics.ts` — pure classifier
  `classifyTransportError(message): { kind: "refused"|"tls"|"dns"|"timeout"|"cancelled"|"other"; hint: string }`
  matching substrings (`connection refused`/`ECONNREFUSED`, `certificate`/`tls`, `dns`/
  `name resolution`, `timed out`, `cancelled`). Used by the error renderer.
- Modify: `src/features/response/ErrorView.tsx` (and/or `CallPanel` client-error block) —
  when the error is a client/transport error, run it through `classifyTransportError` and
  render the friendly kind + hint (spec §10: refused / TLS / DNS / timeout).

## Tasks (TDD intentions)

- **C1 — Timeout pref.** Test: default `30000`; `NetworkPane` input round-trips
  seconds↔ms; invalid input clamped to a sane min (e.g. ≥ 1000 ms).
- **C2 — Backend timeout.** Rust test: an invoke against a dead/slow target with
  `timeout_ms = small` returns the timeout `Transport` error within the budget. (Use the
  existing dead-listener pattern from `tonic_impl.rs` tests.)
- **C3 — Backend cancel registry.** Rust test: register a request, `grpc_cancel` fires the
  `Notify`, the `select!` arm resolves to cancelled; registry entry is removed on exit
  (no leak). Unit-test the registry insert/remove + notify in isolation.
- **C4 — Frontend cancel wiring.** Tests: `sendStep` passes a `request_id` + `timeout_ms`;
  `cancelStep` calls `grpcCancel(requestId)`; a cancelled send resets the step to `draft`.
  `AddressBar` shows Cancel while sending and calls `cancelStep`.
- **C5 — Network diagnostics classifier.** Pure tests over `classifyTransportError` for
  each kind (refused/TLS/DNS/timeout/cancelled/other) + the rendered hint. Wire into
  `ErrorView`/client-error block; test that a "connection refused" message renders the
  refused hint.
- **C6 — Parallel Send.** Verify each step's Send is independent (per-step `sending` is
  already isolated in the store from Plan #1). Test: kicking two `onSend`s on different
  steps tracks two independent in-flight states and two distinct `request_id`s; no global
  lock. Confirm the store keys nothing globally on "sending". (Likely already true — this
  task is mostly a regression test + removing any accidental global guard.)

## 🧹 /clear-checkpoint at completion — **redesign feature-complete.**

---

## Self-review notes (planner)

- **Spec coverage:** every §6/§10 env/auth/metadata/cancel/timeout/diagnostics/parallel
  requirement maps to a task (see coverage table). ✅
- **Type consistency:** `envName`, `setWorkflowEnv`, `resolveStepTemplates`,
  `SendResult.kind = "unresolved"`, `Step.serviceId`, `AuthCredentialsIpc`,
  `auth_resolve`/`authResolve`, `grpc_cancel`/`grpcCancel`, `requestTimeoutMs`,
  `classifyTransportError` — names are used consistently across phases. ✅
- **Deviation from outline (logged):** auth uses a new `auth_resolve` IPC + frontend
  service storage instead of `auth_set_for_env` (collection-bound, unused by the new UI).
  See Key Decision #2. Confirm at the Phase B checkpoint.
- **Open items to settle when detailing later phases:** Tauri promise-drop cancel premise
  (verify), dedicated vs message-classified error variants (C), `EnvSwitcherMenu` exact
  prop contract (A6).
