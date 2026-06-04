# Env / Auth / Metadata (Plan #5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

---

## ⛳ EXECUTION STATUS

- **Branch:** `redesign/workflow-ui-spec-plans`
- **Depends on:** Plans #1–#4 (all complete; 151/151 tests green at start of #5).
- **Status:** Phase A detailed to full TDD (execution-ready). Phases B & C are
  detailed task breakdowns — **expand to full TDD at their /clear-checkpoint
  before executing** (project cadence: detail-on-reach).
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

- [ ] Run `pnpm test` (all green), `pnpm lint` (exit 0), `pnpm build` (success).
- [ ] Use `superpowers:requesting-code-review` on the Phase A diff.
- [ ] Update the EXECUTION STATUS banner: Phase A complete + commit range.

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
- Create: `src/features/catalog/ServiceAuthEditor.tsx` + `ServiceMetadataEditor.tsx` — edit
  service auth (None / EnvVar fields: env var, header, prefix / OAuth2 fields) and default
  metadata; mount both in `ServicePanel`.
- Modify: `src/features/catalog/ServicePanel.tsx` — add Auth + Default-metadata sections.

## Tasks (TDD intentions)

- **B1 — `AuthCredentialsIpc` + `From`.** Core test already covers `resolve_auth`; add a
  Tauri-side unit test that `AuthCredentialsIpc::from(core)` maps fields 1:1.
- **B2 — `auth_resolve` command.** Test (core-level, in `handshaker-core/src/auth`):
  `resolve_auth(None) → Ok(None)`; `EnvVar` with a set OS var → header
  `prefix + value`; `EnvVar` with missing var → `CoreError::Auth`;
  `OAuth2 → CoreError::NotImplemented`. (Use `std::env::set_var` in a serialized test.)
  Register in `lib.rs`; regenerate bindings; add `authResolve` to `client.ts`.
- **B3 — Service auth model + store.** Tests: factory default `auth = { kind: "none" }`;
  `setServiceAuth` patches; `setServiceDefaultMetadata` patches.
- **B4 — Apply auth at Send.** Tests in `actions.test.ts`: when service auth is EnvVar,
  `CallPanel`/send path injects `header_name → header_value` into invoke metadata; `none`
  injects nothing; OAuth2 surfaces a NotImplemented step error and does not invoke.
  (Test the pure merge: extend `sendStep` to take `authHeader?` and assert it lands in the
  metadata map alongside resolved rows; auth header is **not** `{{var}}`-resolved — it is
  already final from `auth_resolve`.)
- **B5 — Default metadata inheritance.** Test `createStepFromMethod` copies the service's
  `defaultMetadata` (deep copy, editable) into the new step and records `serviceId`.
- **B6 — `MetadataEditor` + `RequestTabs`.** Component tests: editing a row calls back with
  the new `MetadataRow[]`; toggling `enabled`; add/remove row. Tabs switch panes; the
  Request pane keeps the Monaco editor (mock it in tests as in Plan #3).
- **B7 — Service auth/metadata editors in `ServicePanel`.** Tests: changing auth kind shows
  the right fields and calls `setServiceAuth`; editing default metadata calls
  `setServiceDefaultMetadata`. Auth tab in the call editor renders the inherited service
  auth read-only.

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
