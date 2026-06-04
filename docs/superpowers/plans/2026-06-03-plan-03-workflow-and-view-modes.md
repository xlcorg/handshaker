# Workflow & View Modes (Plan #3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-Focus shell into a multi-workflow, three-mode workspace: a titlebar **workflow-history selector** (switch/create) + **view switcher** (Лента / Список / Фокус) + env-pill placeholder; the three view modes themselves (Ledger ledger-of-steps, List master-detail, Focus with a step rail); and per-row **delete** + **drag-reorder** wired to Plan #1's reducers.

**Architecture:** Frontend-only milestone on top of Plan #1's `workflowStore` + reducers (`addStep`/`updateStep`/`removeStep`/`reorderStep`/`setActiveStep`/`setView`) and Plan #2's catalog sidebar/⌘K. The request/response editor currently inlined in `FocusView` is **extracted into a reusable `CallPanel`** so all three views render the same editable+sendable call surface (this satisfies the spec's "re-run in place / edit mutates the same step" — §10 — for free, since every view drives the same step through `CallPanel`). A pure `summarizeStep` helper backs the collapsed step rows and the Focus rail dots. Drag-reorder uses native HTML5 DnD (no new deps) via a small testable `makeDragHandlers` factory.

**Tech Stack:** React 18 + TypeScript (strict) + Tailwind/shadcn-ui (existing primitives only — `dropdown-menu`, `toggle-group` already vendored; no new deps) + Vitest + React Testing Library (configured in Plan #1).

**Spec refs:** §3.4 (workflows in main area, titlebar selector), §4 (three modes), §6 (titlebar layout, env pill), §10 (delete+drag, re-run in place, stable ids, view remembered per workflow, rail click stays in Focus).

**Scope notes (confirm at review):**
1. **Env pill is a static placeholder** ("env: default") — environments are Plan #5. Only the titlebar slot is reserved here.
2. **⌘↵ Send keybinding is deferred** (not in this outline; Send stays button-driven as in Plan #1). The Focus address bar already has a Send button via `AddressBar`.
3. **The catalog Sidebar (Plan #2) stays visible in all three views.** The spec's "sidebar collapses to a thin rail in Focus" is realized here as the Focus **view's own** step rail (left column of the main area), not by collapsing the catalog sidebar — that visual refinement is out of scope for this outline ("extend Plan #1 `FocusView`").
4. **No workflow rename/delete UI** — the outline scopes the selector to *switch + create* only.

---

## File Structure

**Created (pure logic):**
- `src/features/workflow/stepView.ts` — `summarizeStep` + `shortService` (collapsed-row / rail display model).
- `src/features/workflow/stepView.test.ts`
- `src/features/workflow/dnd.ts` — `makeDragHandlers` (native DnD → reducer index pair).
- `src/features/workflow/dnd.test.ts`

**Created (components):**
- `src/features/workflow/CallPanel.tsx` — extracted editable call surface (address bar + body editor + response + send/edit wiring).
- `src/features/workflow/StepRow.tsx` — one collapsed step row (number, proto-service · method, status, time, delete, drag).
- `src/features/workflow/StepRow.test.tsx`
- `src/features/workflow/StepList.tsx` — vertical step list (select / delete / reorder) used by List view.
- `src/features/workflow/StepList.test.tsx`
- `src/features/workflow/LedgerView.tsx` — Лента: all steps, only active expanded, "свернуть все".
- `src/features/workflow/LedgerView.test.tsx`
- `src/features/workflow/ListView.tsx` — Список: master step list + one detail.
- `src/features/workflow/ListView.test.tsx`
- `src/features/workflow/StepRail.tsx` — Focus thin rail of status dots.
- `src/features/workflow/ViewSwitcher.tsx` — Лента/Список/Фокус toggle (titlebar).
- `src/features/workflow/ViewSwitcher.test.tsx`
- `src/features/workflow/WorkflowSelector.tsx` — workflow-history dropdown (switch + create).
- `src/features/workflow/WorkflowSelector.test.tsx`

**Modified:**
- `src/features/workflow/reducers.ts` — widen `setActiveStep` to accept `string | null` (collapse-all).
- `src/features/workflow/reducers.test.ts` — add the null case.
- `src/features/workflow/FocusView.tsx` — render `StepRail` + `CallPanel`; drop the inlined editor; refresh the stale empty-state copy.
- `src/app/WorkflowApp.tsx` — titlebar gets `WorkflowSelector` + env pill + `ViewSwitcher`; main area dispatches on `wf.view`.

**Untouched:** Plan #1 `model.ts`/`store.ts`/`actions.ts`/`AddressBar.tsx`; Plan #2 catalog files. Old `App.tsx`, `features/tabs/*`, `features/collections/*` left in place (build stays green).

---

## Task 1: Step display model (`summarizeStep`)

A pure helper that maps a `Step` + its position into the fields the collapsed rows and rail dots render. Pure ⇒ trivially unit-tested; reused by `StepRow`, `LedgerView`, and `StepRail`.

**Files:**
- Create: `src/features/workflow/stepView.ts`
- Test: `src/features/workflow/stepView.test.ts`

- [ ] **Step 1: Write the failing test `src/features/workflow/stepView.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { newStep } from "./model";
import { shortService, summarizeStep } from "./stepView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

function outcome(code: number, ms = 12): InvokeOutcomeIpc {
  return {
    status_code: code,
    status_message: code === 0 ? "OK" : "ERR",
    response_json: "{}",
    trailing_metadata: {},
    elapsed_ms: ms,
  };
}

describe("shortService", () => {
  it("keeps only the last dotted segment", () => {
    expect(shortService("payments.v1.PaymentService")).toBe("PaymentService");
    expect(shortService("Health")).toBe("Health");
  });
});

describe("summarizeStep", () => {
  const base = { address: "h:443", tls: true, service: "p.v1.S", method: "Get" };

  it("uses a 1-based number and a short title", () => {
    const s = summarizeStep(newStep(base), 0);
    expect(s.number).toBe(1);
    expect(s.title).toBe("S · Get");
  });

  it("reports a pending draft", () => {
    const s = summarizeStep(newStep(base), 2);
    expect(s.number).toBe(3);
    expect(s.tone).toBe("pending");
    expect(s.statusText).toBe("draft");
    expect(s.elapsedMs).toBeNull();
  });

  it("reports a sending step", () => {
    const step = { ...newStep(base), status: "sending" as const };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("pending");
    expect(s.statusText).toBe("…");
  });

  it("reports an OK outcome with code and elapsed", () => {
    const step = { ...newStep(base), status: "ok" as const, outcome: outcome(0, 53) };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("ok");
    expect(s.statusText).toBe("✓ 0");
    expect(s.elapsedMs).toBe(53);
  });

  it("reports a non-OK gRPC outcome as error with its code", () => {
    const step = { ...newStep(base), status: "error" as const, outcome: outcome(5, 7) };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("error");
    expect(s.statusText).toBe("✕ 5");
    expect(s.elapsedMs).toBe(7);
  });

  it("reports a client-side error (no outcome)", () => {
    const step = { ...newStep(base), status: "error" as const, error: "refused" };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("error");
    expect(s.statusText).toBe("✕ error");
    expect(s.elapsedMs).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/stepView.test.ts`
Expected: FAIL ("Failed to resolve import ./stepView").

- [ ] **Step 3: Implement `src/features/workflow/stepView.ts`**

```ts
import type { Step } from "./model";

export type StepTone = "ok" | "error" | "pending";

export interface StepSummary {
  number: number; // 1-based display position
  service: string; // full proto-service name
  method: string;
  title: string; // "shortService · method"
  tone: StepTone;
  statusText: string; // "draft" | "…" | "✓ 0" | "✕ 5" | "✕ error"
  elapsedMs: number | null;
}

/** Last dotted segment of a proto-service full name (display-friendly). */
export function shortService(service: string): string {
  const parts = service.split(".");
  return parts[parts.length - 1] || service;
}

/** Map a step + its list position to its collapsed-row / rail display model. */
export function summarizeStep(step: Step, index: number): StepSummary {
  const common = {
    number: index + 1,
    service: step.service,
    method: step.method,
    title: `${shortService(step.service)} · ${step.method}`,
  };

  if (step.status === "sending") {
    return { ...common, tone: "pending", statusText: "…", elapsedMs: null };
  }
  if (step.outcome) {
    const ok = step.outcome.status_code === 0;
    return {
      ...common,
      tone: ok ? "ok" : "error",
      statusText: `${ok ? "✓" : "✕"} ${step.outcome.status_code}`,
      elapsedMs: step.outcome.elapsed_ms,
    };
  }
  if (step.error) {
    return { ...common, tone: "error", statusText: "✕ error", elapsedMs: null };
  }
  return { ...common, tone: "pending", statusText: "draft", elapsedMs: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/stepView.test.ts`
Expected: PASS (7 assertions across 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/stepView.ts src/features/workflow/stepView.test.ts
git commit -m "feat(workflow): step display model (summarizeStep)"
```

---

## Task 2: Allow collapse-all (`setActiveStep` accepts null)

Лента's "свернуть все" needs `activeStepId = null`. Plan #1's `setActiveStep(wf, id: string)` is widened to `string | null` (backward-compatible — existing string callers are unaffected).

**Files:**
- Modify: `src/features/workflow/reducers.ts`
- Modify: `src/features/workflow/reducers.test.ts`

- [ ] **Step 1: Add the failing test case**

Append inside the existing `describe("setActiveStep / setView", …)` block in `src/features/workflow/reducers.test.ts`:

```ts
  it("clears active when given null (collapse all)", () => {
    const wf = wfWith(1, 2);
    expect(setActiveStep(wf, null).activeStepId).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/reducers.test.ts`
Expected: FAIL — TypeScript rejects `null` for the `string` parameter (compile error in the test), or the assertion fails.

- [ ] **Step 3: Widen the signature in `src/features/workflow/reducers.ts`**

Replace the existing `setActiveStep`:

```ts
export function setActiveStep(wf: Workflow, id: string | null): Workflow {
  return { ...wf, activeStepId: id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/reducers.test.ts`
Expected: PASS (all prior reducer tests + the new null case).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/reducers.ts src/features/workflow/reducers.test.ts
git commit -m "feat(workflow): setActiveStep accepts null (collapse all)"
```

---

## Task 3: Drag-reorder handlers (`makeDragHandlers`)

Native HTML5 DnD wrapped in a tiny factory so the index math is unit-testable without a real drag. Returns per-row handler props; on drop it calls back with `(from, to)` to feed `reorderStep`.

**Files:**
- Create: `src/features/workflow/dnd.ts`
- Test: `src/features/workflow/dnd.test.ts`

- [ ] **Step 1: Write the failing test `src/features/workflow/dnd.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { makeDragHandlers } from "./dnd";

function fakeEvent() {
  const store: Record<string, string> = {};
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      effectAllowed: "",
      setData: (k: string, v: string) => {
        store[k] = v;
      },
      getData: (k: string) => store[k] ?? "",
    },
  };
}

describe("makeDragHandlers", () => {
  it("carries the source index from dragStart to drop and calls onReorder(from,to)", () => {
    const onReorder = vi.fn();
    const handlersFor = makeDragHandlers(onReorder);

    const dragEvt = fakeEvent();
    handlersFor(2).onDragStart(dragEvt as never); // dragging row index 2

    const dropEvt = { ...fakeEvent(), dataTransfer: dragEvt.dataTransfer };
    handlersFor(0).onDrop(dropEvt as never); // dropping on row index 0

    expect(onReorder).toHaveBeenCalledWith(2, 0);
    expect(dropEvt.preventDefault).toHaveBeenCalled();
  });

  it("marks each handler-set draggable and prevents default on dragOver", () => {
    const h = makeDragHandlers(vi.fn())(1);
    expect(h.draggable).toBe(true);
    const evt = fakeEvent();
    h.onDragOver(evt as never);
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it("ignores a drop with no/garbage source index", () => {
    const onReorder = vi.fn();
    const evt = fakeEvent(); // empty dataTransfer → getData returns ""
    makeDragHandlers(onReorder)(0).onDrop(evt as never);
    expect(onReorder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/dnd.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/features/workflow/dnd.ts`**

```ts
import type { DragEvent } from "react";

const DND_KEY = "text/plain";

export interface RowDragProps {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

/**
 * Build a per-row drag-handler factory. The returned function takes a row index
 * and yields DnD props; dropping row A onto row B invokes `onReorder(A, B)`.
 */
export function makeDragHandlers(
  onReorder: (from: number, to: number) => void,
): (index: number) => RowDragProps {
  return (index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DND_KEY, String(index));
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DND_KEY);
      const from = Number(raw);
      if (raw === "" || Number.isNaN(from) || from === index) return;
      onReorder(from, index);
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/dnd.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/dnd.ts src/features/workflow/dnd.test.ts
git commit -m "feat(workflow): testable drag-reorder handlers"
```

---

## Task 4: Extract `CallPanel` from `FocusView`

The editable call surface (address bar + Monaco body editor + response + send/edit wiring) is pulled out of `FocusView` verbatim into `CallPanel` so List/Ledger/Focus all reuse it. No behavior change — `FocusView` keeps working.

**Files:**
- Create: `src/features/workflow/CallPanel.tsx`
- Modify: `src/features/workflow/FocusView.tsx`

> **Why no unit test here:** `CallPanel` renders the Monaco-backed `BodyEditor`, which Plan #1 deliberately left untested under jsdom. Coverage comes from the view tests (which mock `./CallPanel`) plus the typecheck. This task is a pure refactor verified by `pnpm lint` + the existing suite staying green.

- [ ] **Step 1: Create `src/features/workflow/CallPanel.tsx`**

This is the body of the current `FocusView` (the active-step branch), moved unchanged:

```tsx
import { BodyEditor } from "@/features/invoke/BodyEditor";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { AddressBar } from "./AddressBar";
import { workflowStore } from "./store";
import { updateStep } from "./reducers";
import { sendStep } from "./actions";
import type { Step } from "./model";

/** The editable, sendable surface for one step — reused by Focus/List/Ledger. */
export function CallPanel({ step }: { step: Step }) {
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
          ? {
              status: res.outcome.status_code === 0 ? "ok" : "error",
              outcome: res.outcome,
              error: null,
            }
          : { status: "error", outcome: null, error: res.message },
      ),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AddressBar step={step} onSend={onSend} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-border">
          <BodyEditor value={step.requestJson} onChange={onBody} />
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
      {step.error && !step.outcome ? (
        <div className="m-3 flex-none rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {step.error}
        </div>
      ) : null}
      <ResponsePanel state={respState} outcome={step.outcome} />
    </>
  );
}
```

- [ ] **Step 2: Slim `src/features/workflow/FocusView.tsx` down to consume `CallPanel`**

Replace the entire file with (the rail is added in Task 8 — for now Focus is just `CallPanel` + a refreshed empty state):

```tsx
import { CallPanel } from "./CallPanel";
import { useActiveWorkflow } from "./store";

export function FocusView() {
  const wf = useActiveWorkflow();
  const step = wf.steps.find((s) => s.id === wf.activeStepId) ?? null;

  if (!step) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Нет активного вызова — выбери метод в сайдбаре или нажми ⌘K.
      </div>
    );
  }

  return <CallPanel step={step} />;
}
```

- [ ] **Step 3: Typecheck + run the existing suite**

Run: `pnpm lint`
Expected: PASS (no TS errors).
Run: `pnpm test`
Expected: PASS — no regressions in the Plan #1/#2 suites.

- [ ] **Step 4: Commit**

```bash
git add src/features/workflow/CallPanel.tsx src/features/workflow/FocusView.tsx
git commit -m "refactor(workflow): extract reusable CallPanel from FocusView"
```

---

## Task 5: `StepRow` (collapsed step row)

A presentational row: tone dot, number, `proto-service · method`, status text, elapsed, and a delete button. It is store-agnostic — the container passes `onSelect`/`onDelete` and (optionally) drag props.

**Files:**
- Create: `src/features/workflow/StepRow.tsx`
- Test: `src/features/workflow/StepRow.test.tsx`

- [ ] **Step 1: Write the failing test `src/features/workflow/StepRow.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newStep } from "./model";
import { StepRow } from "./StepRow";

const step = { ...newStep({ address: "h", tls: true, service: "p.v1.OrderService", method: "GetOrder" }) };

describe("StepRow", () => {
  it("renders number, short title and status", () => {
    render(<StepRow step={step} index={2} active={false} onSelect={() => {}} onDelete={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument(); // 1-based
    expect(screen.getByText(/OrderService · GetOrder/)).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
  });

  it("selects on row click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<StepRow step={step} index={0} active={false} onSelect={onSelect} onDelete={() => {}} />);
    await user.click(screen.getByText(/OrderService · GetOrder/));
    expect(onSelect).toHaveBeenCalled();
  });

  it("deletes without selecting (stops propagation)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<StepRow step={step} index={0} active={false} onSelect={onSelect} onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: "delete-step" }));
    expect(onDelete).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks the active row aria-current", () => {
    render(<StepRow step={step} index={0} active onSelect={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/StepRow.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/features/workflow/StepRow.tsx`**

```tsx
import type { HTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { summarizeStep, type StepTone } from "./stepView";
import type { Step } from "./model";

const TONE_DOT: Record<StepTone, string> = {
  ok: "text-ok",
  error: "text-destructive",
  pending: "text-muted-foreground",
};

export function StepRow({
  step,
  index,
  active,
  onSelect,
  onDelete,
  dragProps,
}: {
  step: Step;
  index: number;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  dragProps?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const s = summarizeStep(step, index);
  return (
    <div
      role="listitem"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      {...dragProps}
      className={cn(
        "group flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/50",
        active && "bg-accent",
      )}
    >
      <span className="w-4 flex-none text-right font-mono text-[10px] text-muted-foreground">
        {s.number}
      </span>
      <span className={cn("flex-none", TONE_DOT[s.tone])} aria-hidden>
        ●
      </span>
      <span className="min-w-0 flex-1 truncate font-mono">{s.title}</span>
      <span className={cn("flex-none font-mono text-[11px]", TONE_DOT[s.tone])}>{s.statusText}</span>
      {s.elapsedMs !== null ? (
        <span className="flex-none font-mono text-[10px] text-muted-foreground">{s.elapsedMs}ms</span>
      ) : null}
      <button
        type="button"
        aria-label="delete-step"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="flex-none text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/StepRow.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/StepRow.tsx src/features/workflow/StepRow.test.tsx
git commit -m "feat(workflow): collapsed step row component"
```

---

## Task 6: `StepList` (select / delete / reorder)

The store-connected vertical list used by the List view: renders `StepRow`s, wires selection (`setActiveStep`), deletion (`removeStep`), and drag-reorder (`reorderStep` via `makeDragHandlers`).

**Files:**
- Create: `src/features/workflow/StepList.tsx`
- Test: `src/features/workflow/StepList.test.tsx`

- [ ] **Step 1: Write the failing test `src/features/workflow/StepList.test.tsx`**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { addStep } from "./reducers";
import { newStep } from "./model";
import { StepList } from "./StepList";

function seed(...methods: string[]) {
  for (const m of methods) {
    workflowStore.update((w) =>
      addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: m })),
    );
  }
}

beforeEach(() => workflowStore.reset());

describe("StepList", () => {
  it("renders one row per step", () => {
    seed("A", "B", "C");
    render(<StepList />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("selecting a row sets it active in the store", async () => {
    const user = userEvent.setup();
    seed("A", "B");
    const firstId = workflowStore.activeWorkflow().steps[0].id;
    render(<StepList />);
    await user.click(screen.getByText(/S · A/));
    expect(workflowStore.activeWorkflow().activeStepId).toBe(firstId);
  });

  it("deleting a row removes it from the store", async () => {
    const user = userEvent.setup();
    seed("A", "B");
    render(<StepList />);
    const rows = screen.getAllByRole("listitem");
    const delBtn = rows[0].querySelector("button")!;
    await user.click(delBtn);
    expect(workflowStore.activeWorkflow().steps.map((s) => s.method)).toEqual(["B"]);
  });

  it("dropping row 2 onto row 0 reorders via reducer", () => {
    seed("A", "B", "C");
    render(<StepList />);
    const rows = screen.getAllByRole("listitem");
    const dt = {
      _s: {} as Record<string, string>,
      effectAllowed: "",
      setData(k: string, v: string) {
        this._s[k] = v;
      },
      getData(k: string) {
        return this._s[k] ?? "";
      },
    };
    fireEvent.dragStart(rows[2], { dataTransfer: dt });
    fireEvent.drop(rows[0], { dataTransfer: dt });
    expect(workflowStore.activeWorkflow().steps.map((s) => s.method)).toEqual(["C", "A", "B"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/StepList.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/features/workflow/StepList.tsx`**

```tsx
import { useActiveWorkflow, workflowStore } from "./store";
import { removeStep, reorderStep, setActiveStep } from "./reducers";
import { makeDragHandlers } from "./dnd";
import { StepRow } from "./StepRow";

const dragFor = makeDragHandlers((from, to) =>
  workflowStore.update((w) => reorderStep(w, from, to)),
);

export function StepList() {
  const wf = useActiveWorkflow();
  return (
    <div role="list" className="flex flex-col py-1">
      {wf.steps.map((step, i) => (
        <StepRow
          key={step.id}
          step={step}
          index={i}
          active={step.id === wf.activeStepId}
          onSelect={() => workflowStore.update((w) => setActiveStep(w, step.id))}
          onDelete={() => workflowStore.update((w) => removeStep(w, step.id))}
          dragProps={dragFor(i)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/StepList.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/StepList.tsx src/features/workflow/StepList.test.tsx
git commit -m "feat(workflow): step list with select/delete/reorder"
```

---

## Task 7: `ListView` (Список — master-detail)

Narrow `StepList` on the left, one expanded `CallPanel` on the right. Empty when there are no steps; prompts to pick one when steps exist but none is active.

**Files:**
- Create: `src/features/workflow/ListView.tsx`
- Test: `src/features/workflow/ListView.test.tsx`

- [ ] **Step 1: Write the failing test `src/features/workflow/ListView.test.tsx`**

`CallPanel` (Monaco) is stubbed so the layout/selection logic is tested in isolation.

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { workflowStore } from "./store";
import { addStep, setActiveStep } from "./reducers";
import { newStep } from "./model";

vi.mock("./CallPanel", () => ({
  CallPanel: ({ step }: { step: { method: string } }) => (
    <div data-testid="call-panel">{step.method}</div>
  ),
}));

import { ListView } from "./ListView";

beforeEach(() => workflowStore.reset());

describe("ListView", () => {
  it("shows an empty hint with no steps", () => {
    render(<ListView />);
    expect(screen.getByText(/Нет шагов/)).toBeInTheDocument();
  });

  it("renders the rows and the active step's detail", () => {
    workflowStore.update((w) => addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: "Alpha" })));
    workflowStore.update((w) => addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: "Beta" })));
    render(<ListView />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // addStep made the last step active → its detail shows
    expect(screen.getByTestId("call-panel")).toHaveTextContent("Beta");
  });

  it("prompts to choose when steps exist but none is active", () => {
    workflowStore.update((w) => addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: "Alpha" })));
    workflowStore.update((w) => setActiveStep(w, null));
    render(<ListView />);
    expect(screen.getByText(/Выбери шаг/)).toBeInTheDocument();
    expect(screen.queryByTestId("call-panel")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/ListView.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/features/workflow/ListView.tsx`**

```tsx
import { CallPanel } from "./CallPanel";
import { StepList } from "./StepList";
import { useActiveWorkflow } from "./store";

export function ListView() {
  const wf = useActiveWorkflow();
  const active = wf.steps.find((s) => s.id === wf.activeStepId) ?? null;

  if (wf.steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Нет шагов — создай вызов в сайдбаре или ⌘K.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-72 flex-none overflow-auto border-r border-border">
        <StepList />
      </div>
      <div className="min-w-0 flex-1">
        {active ? (
          <CallPanel step={active} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Выбери шаг слева.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/ListView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/ListView.tsx src/features/workflow/ListView.test.tsx
git commit -m "feat(workflow): List (master-detail) view"
```

---

## Task 8: `StepRail` + Focus rail wiring

A thin vertical rail of status dots (one per step) for the Focus view. Clicking a dot switches the active step **without leaving Focus** (§10). Then `FocusView` is updated to render the rail beside `CallPanel`.

**Files:**
- Create: `src/features/workflow/StepRail.tsx`
- Modify: `src/features/workflow/FocusView.tsx`
- Test: extend via `FocusView` is Monaco-bound, so the rail is tested through `StepRail` directly — Create: `src/features/workflow/StepRail.test.tsx`

- [ ] **Step 1: Write the failing test `src/features/workflow/StepRail.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { addStep, setActiveStep } from "./reducers";
import { newStep } from "./model";
import { StepRail } from "./StepRail";

function seed(...methods: string[]) {
  for (const m of methods) {
    workflowStore.update((w) =>
      addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: m })),
    );
  }
}

beforeEach(() => workflowStore.reset());

describe("StepRail", () => {
  it("renders one dot per step", () => {
    seed("A", "B", "C");
    render(<StepRail />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("clicking a dot makes that step active (stays in store)", async () => {
    const user = userEvent.setup();
    seed("A", "B", "C");
    const secondId = workflowStore.activeWorkflow().steps[1].id;
    workflowStore.update((w) => setActiveStep(w, null));
    render(<StepRail />);
    await user.click(screen.getByRole("button", { name: "step-2" }));
    expect(workflowStore.activeWorkflow().activeStepId).toBe(secondId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/StepRail.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/features/workflow/StepRail.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { useActiveWorkflow, workflowStore } from "./store";
import { setActiveStep } from "./reducers";
import { summarizeStep, type StepTone } from "./stepView";

const TONE_DOT: Record<StepTone, string> = {
  ok: "bg-ok",
  error: "bg-destructive",
  pending: "bg-muted-foreground",
};

export function StepRail() {
  const wf = useActiveWorkflow();
  return (
    <div className="flex w-10 flex-none flex-col items-center gap-1 overflow-auto border-r border-border py-2">
      {wf.steps.map((step, i) => {
        const s = summarizeStep(step, i);
        const active = step.id === wf.activeStepId;
        return (
          <button
            key={step.id}
            type="button"
            aria-label={`step-${s.number}`}
            title={`${s.number}. ${s.title} — ${s.statusText}`}
            onClick={() => workflowStore.update((w) => setActiveStep(w, step.id))}
            className={cn(
              "flex size-6 flex-none items-center justify-center rounded-full text-[9px]",
              active ? "ring-2 ring-ring" : "hover:bg-accent",
            )}
          >
            <span className={cn("size-2.5 rounded-full", TONE_DOT[s.tone])} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/StepRail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the rail into `src/features/workflow/FocusView.tsx`**

Replace the file with (rail shows whenever the workflow has ≥1 step):

```tsx
import { CallPanel } from "./CallPanel";
import { StepRail } from "./StepRail";
import { useActiveWorkflow } from "./store";

export function FocusView() {
  const wf = useActiveWorkflow();
  const step = wf.steps.find((s) => s.id === wf.activeStepId) ?? null;

  return (
    <div className="flex h-full min-h-0">
      {wf.steps.length > 0 ? <StepRail /> : null}
      <div className="min-w-0 flex-1">
        {step ? (
          <CallPanel step={step} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Нет активного вызова — выбери метод в сайдбаре или нажми ⌘K.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/StepRail.tsx src/features/workflow/StepRail.test.tsx src/features/workflow/FocusView.tsx
git commit -m "feat(workflow): Focus step rail (jump without leaving Focus)"
```

---

## Task 9: `LedgerView` (Лента — ledger of steps)

All steps top-to-bottom; only the active one expands into a `CallPanel`; the rest stay collapsed `StepRow`s. A "свернуть все" button collapses everything (`setActiveStep(null)`). Delete + reorder work on every row.

**Files:**
- Create: `src/features/workflow/LedgerView.tsx`
- Test: `src/features/workflow/LedgerView.test.tsx`

- [ ] **Step 1: Write the failing test `src/features/workflow/LedgerView.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { addStep, setActiveStep } from "./reducers";
import { newStep } from "./model";

vi.mock("./CallPanel", () => ({
  CallPanel: ({ step }: { step: { method: string } }) => (
    <div data-testid="call-panel">{step.method}</div>
  ),
}));

import { LedgerView } from "./LedgerView";

function seed(...methods: string[]) {
  for (const m of methods) {
    workflowStore.update((w) =>
      addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: m })),
    );
  }
}

beforeEach(() => workflowStore.reset());

describe("LedgerView", () => {
  it("shows an empty hint with no steps", () => {
    render(<LedgerView />);
    expect(screen.getByText(/Нет шагов/)).toBeInTheDocument();
  });

  it("expands only the active step, collapses the rest", () => {
    seed("Alpha", "Beta", "Gamma"); // Gamma is active (last added)
    render(<LedgerView />);
    // every step has a collapsed row
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    // exactly one expanded detail, for the active step
    const panels = screen.getAllByTestId("call-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveTextContent("Gamma");
  });

  it("'свернуть все' collapses everything (no expanded detail)", async () => {
    const user = userEvent.setup();
    seed("Alpha", "Beta");
    render(<LedgerView />);
    await user.click(screen.getByRole("button", { name: /свернуть все/i }));
    expect(workflowStore.activeWorkflow().activeStepId).toBeNull();
    expect(screen.queryByTestId("call-panel")).not.toBeInTheDocument();
  });

  it("clicking a collapsed row expands it", async () => {
    const user = userEvent.setup();
    seed("Alpha", "Beta");
    workflowStore.update((w) => setActiveStep(w, null));
    render(<LedgerView />);
    await user.click(screen.getByText(/S · Alpha/));
    expect(screen.getByTestId("call-panel")).toHaveTextContent("Alpha");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/LedgerView.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/features/workflow/LedgerView.tsx`**

```tsx
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { CallPanel } from "./CallPanel";
import { StepRow } from "./StepRow";
import { useActiveWorkflow, workflowStore } from "./store";
import { removeStep, reorderStep, setActiveStep } from "./reducers";
import { makeDragHandlers } from "./dnd";

const dragFor = makeDragHandlers((from, to) =>
  workflowStore.update((w) => reorderStep(w, from, to)),
);

export function LedgerView() {
  const wf = useActiveWorkflow();

  if (wf.steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Нет шагов — создай вызов в сайдбаре или ⌘K.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 flex-none items-center justify-end border-b border-border px-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => workflowStore.update((w) => setActiveStep(w, null))}
        >
          свернуть все
        </Button>
      </div>
      <div role="list" className="min-h-0 flex-1 overflow-auto">
        {wf.steps.map((step, i) => {
          const active = step.id === wf.activeStepId;
          return (
            <Fragment key={step.id}>
              <StepRow
                step={step}
                index={i}
                active={active}
                onSelect={() => workflowStore.update((w) => setActiveStep(w, step.id))}
                onDelete={() => workflowStore.update((w) => removeStep(w, step.id))}
                dragProps={dragFor(i)}
              />
              {active ? (
                <div className="h-[480px] border-y border-border">
                  <CallPanel step={step} />
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/LedgerView.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/LedgerView.tsx src/features/workflow/LedgerView.test.tsx
git commit -m "feat(workflow): Ledger (Лента) view"
```

---

## Task 10: Titlebar controls — `ViewSwitcher` + `WorkflowSelector`

The two titlebar widgets. Both are self-contained (subscribe to the store via hooks) so `WorkflowApp` just drops them in.

**Files:**
- Create: `src/features/workflow/ViewSwitcher.tsx`
- Test: `src/features/workflow/ViewSwitcher.test.tsx`
- Create: `src/features/workflow/WorkflowSelector.tsx`
- Test: `src/features/workflow/WorkflowSelector.test.tsx`

- [ ] **Step 1: Write the failing test `src/features/workflow/ViewSwitcher.test.tsx`**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { ViewSwitcher } from "./ViewSwitcher";

beforeEach(() => workflowStore.reset());

describe("ViewSwitcher", () => {
  it("offers the three modes and reflects the active one", () => {
    render(<ViewSwitcher />);
    expect(screen.getByRole("radio", { name: "Лента" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Список" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Фокус" })).toBeInTheDocument();
  });

  it("switching updates the active workflow's view", async () => {
    const user = userEvent.setup();
    render(<ViewSwitcher />);
    await user.click(screen.getByRole("radio", { name: "Список" }));
    expect(workflowStore.activeWorkflow().view).toBe("list");
  });
});
```

> **Note:** radix `ToggleGroup` items expose `role="radio"` for a single-select group. If this repo's build reports a different role, query by accessible name with `getByRole("button", …)` instead — do not change the labels.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/ViewSwitcher.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/features/workflow/ViewSwitcher.tsx`**

```tsx
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useActiveWorkflow, workflowStore } from "./store";
import { setView } from "./reducers";
import type { ViewMode } from "./model";

const OPTIONS = [
  { value: "ledger", label: "Лента" },
  { value: "list", label: "Список" },
  { value: "focus", label: "Фокус" },
];

export function ViewSwitcher() {
  const wf = useActiveWorkflow();
  return (
    <ToggleGroup
      ariaLabel="view-mode"
      value={wf.view}
      onValueChange={(v) => workflowStore.update((w) => setView(w, v as ViewMode))}
      options={OPTIONS}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/workflow/ViewSwitcher.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test `src/features/workflow/WorkflowSelector.test.tsx`**

The dropdown content is a radix portal (finicky under jsdom); the reliable signal is that the **trigger reflects the active workflow** and updates when the store changes. Switch/create mutations are already covered by `store.test.ts` (Plan #1).

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { workflowStore } from "./store";
import { WorkflowSelector } from "./WorkflowSelector";

beforeEach(() => workflowStore.reset());

describe("WorkflowSelector", () => {
  it("shows the active workflow name in the trigger", () => {
    render(<WorkflowSelector />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
  });

  it("re-renders when the active workflow changes", () => {
    render(<WorkflowSelector />);
    workflowStore.createWorkflow("incident-42");
    expect(screen.getByRole("button", { name: /incident-42/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/features/workflow/WorkflowSelector.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 7: Implement `src/features/workflow/WorkflowSelector.tsx`**

```tsx
import { ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkflowState, workflowStore } from "./store";

export function WorkflowSelector() {
  const { workflows, activeWorkflowId } = useWorkflowState();
  const active = workflows.find((w) => w.id === activeWorkflowId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent">
        <span className="max-w-[180px] truncate text-foreground">{active?.name ?? "—"}</span>
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Workflows
        </DropdownMenuLabel>
        {workflows.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onSelect={() => workflowStore.setActiveWorkflow(w.id)}
            className="flex items-center gap-2"
          >
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            <span className="flex-none font-mono text-[10px] text-muted-foreground">
              {w.steps.length}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => workflowStore.createWorkflow(`workflow-${workflows.length + 1}`)}
          className="flex items-center gap-2"
        >
          <Plus className="size-3" /> Новый workflow
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test src/features/workflow/WorkflowSelector.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/features/workflow/ViewSwitcher.tsx src/features/workflow/ViewSwitcher.test.tsx src/features/workflow/WorkflowSelector.tsx src/features/workflow/WorkflowSelector.test.tsx
git commit -m "feat(workflow): titlebar view switcher + workflow selector"
```

---

## Task 11: Wire titlebar + view dispatch into `WorkflowApp`

Drop the two controls and a static env pill into the titlebar, and render the main area by `wf.view`. The service panel still takes precedence over the workflow views when open (Plan #2 behavior).

**Files:**
- Modify: `src/app/WorkflowApp.tsx`
- Modify: `src/app/WorkflowApp.test.tsx` (an existing file from Plan #2 — **extend, do not clobber**)

> **Existing test (do not delete):** `src/app/WorkflowApp.test.tsx` already exists from Plan #2. It `vi.mock`s `Sidebar`, `ServicePanel`, `CommandPalette`, and `FocusView` and has a `describe("WorkflowApp shell", …)` block asserting the panel↔Focus logic. **Keep that block and its mocks intact.** Add a **new** `describe` block for the titlebar/view-dispatch, reusing the same mocks (so `FocusView` stays the `<div>FOCUS</div>` stub and no Monaco mounts). `LedgerView`/`ListView` are *not* mocked, so switching to them renders the real (empty-state) view — safe, since their empty branch never reaches `CallPanel`.

- [ ] **Step 1: Add the failing titlebar tests to `src/app/WorkflowApp.test.tsx`**

Append this `describe` block to the existing file (the `WorkflowApp`, `workflowStore`, `render`, `screen`, `userEvent` imports are already present at the top — do not duplicate them):

```tsx
describe("WorkflowApp titlebar + view dispatch", () => {
  it("renders the workflow selector, env pill and view switcher", () => {
    render(<WorkflowApp />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
    expect(screen.getByText(/env:/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Лента" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Список" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Фокус" })).toBeInTheDocument();
  });

  it("defaults to Focus (the mocked FocusView) and switches to the real List view", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    expect(screen.getByText("FOCUS")).toBeInTheDocument(); // mocked FocusView
    await user.click(screen.getByRole("radio", { name: "Список" }));
    expect(screen.queryByText("FOCUS")).not.toBeInTheDocument();
    expect(screen.getByText(/Нет шагов/)).toBeInTheDocument(); // real ListView empty state
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/WorkflowApp.test.tsx`
Expected: FAIL — titlebar still has no selector/switcher/env pill (old markup); the 2 existing "WorkflowApp shell" tests still PASS.

- [ ] **Step 3: Rewrite `src/app/WorkflowApp.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { FocusView } from "@/features/workflow/FocusView";
import { LedgerView } from "@/features/workflow/LedgerView";
import { ListView } from "@/features/workflow/ListView";
import { ViewSwitcher } from "@/features/workflow/ViewSwitcher";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { useActiveWorkflow } from "@/features/workflow/store";
import type { ViewMode } from "@/features/workflow/model";
import { Sidebar } from "@/features/catalog/Sidebar";
import { CommandPalette } from "@/features/catalog/CommandPalette";
import { ServicePanel } from "@/features/catalog/ServicePanel";
import type { CatalogService } from "@/features/catalog/model";

function renderView(view: ViewMode) {
  switch (view) {
    case "ledger":
      return <LedgerView />;
    case "list":
      return <ListView />;
    default:
      return <FocusView />;
  }
}

export function WorkflowApp() {
  const wf = useActiveWorkflow();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelServiceId, setPanelServiceId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Creating a call (sidebar / service panel / ⌘K) adds a step and switches the
  // workflow to Focus. Close any open service panel so the new call is visible.
  useEffect(() => {
    if (wf.activeStepId) setPanelServiceId(null);
  }, [wf.activeStepId]);

  const openService = (svc: CatalogService) => setPanelServiceId(svc.id);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-9 items-center gap-3 border-b border-border px-3 text-sm">
        <span className="font-semibold">⚡ Handshaker</span>
        <WorkflowSelector />
        <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          env: default
        </span>
        <div className="flex-1" />
        <ViewSwitcher />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
        >
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenService={openService} onOpenPalette={() => setPaletteOpen(true)} />
        <div className="min-h-0 flex-1">
          {panelServiceId ? (
            <ServicePanel serviceId={panelServiceId} onClose={() => setPanelServiceId(null)} />
          ) : (
            renderView(wf.view)
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/WorkflowApp.test.tsx`
Expected: PASS (4 tests — 2 existing "shell" + 2 new "titlebar").

- [ ] **Step 5: Typecheck**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/WorkflowApp.tsx src/app/WorkflowApp.test.tsx
git commit -m "feat(workflow): titlebar selector/switcher + view dispatch in shell"
```

---

## Task 12: Whole-milestone verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — Plan #1 (20) + Plan #2 (40) + Plan #3 new tests, all green.

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm lint`
Expected: PASS (`tsc -b` exit 0).

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: `vite build` succeeds (the new views/components compile into the bundle).

- [ ] **Step 4: Manual smoke (human at the GUI — deferred like Plans #1–#2)**

Run: `pnpm tauri:dev`. Verify, against a reachable reflection-enabled gRPC server:
- Titlebar shows the workflow selector (`workflow-1`), `env: default` pill, and the Лента/Список/Фокус switcher.
- Create a couple of calls (sidebar/⌘K) → they land in Focus; the **rail** shows a dot per step; clicking a dot switches the focused step without leaving Focus.
- Switch to **Лента**: all steps listed; only the active one expanded; "свернуть все" collapses; clicking a collapsed row expands it.
- Switch to **Список**: step list + one detail; selecting a row swaps the detail.
- **Delete** a step (X on a row) and **drag-reorder** rows; the displayed numbers re-flow by position; the selected step stays selected.
- Switch view, then switch workflow in the selector and back — the **view is remembered per workflow**.
- Re-Send an existing step → its outcome is replaced in place; edit the body and re-Send → same step mutates.

- [ ] **Step 5: Commit any incidental changes**

```bash
git add -A
git commit -m "chore(plan-03): milestone verification" || echo "nothing to commit"
```

---

## 🧹 /clear-checkpoint

**Plan #3 done.** New session before Plan #4:
1. `/clear`
2. Re-read `CLAUDE.md` + this plan's checkboxes + `docs/superpowers/plans/2026-06-03-plan-04-*.md`.
3. Continue with Plan #4 (custom JSON viewer + double-click copy + Postman-style errors).

---

## Self-Review (author checklist)

- **Spec coverage:**
  - §3.4 titlebar workflow selector → Task 10 `WorkflowSelector` + Task 11 wiring.
  - §4.1 Лента (active expanded, collapsed rows, свернуть все) → Task 9.
  - §4.2 Список (master-detail) → Task 7.
  - §4.3 Фокус rail (click jumps, stays in Focus) → Task 8.
  - §6 titlebar layout + env pill → Task 11 (env pill = static placeholder, scope note 1).
  - §10 delete + drag → Tasks 5/6/9; re-run in place + edit-same-step → Task 4 `CallPanel` (single shared surface); stable ids + recomputed numbers → `summarizeStep` (Task 1) over `reorderStep`; view remembered per workflow → `Workflow.view` already per-workflow, driven by `ViewSwitcher`; rail click stays in Focus → Task 8.
- **Placeholder scan:** every code step ships complete code; the only intentional placeholder is the env pill (documented as Plan #5 scope).
- **Type consistency:** `ViewMode` (`"ledger"|"list"|"focus"`), `StepTone` (`"ok"|"error"|"pending"`), `summarizeStep(step,index): StepSummary`, `makeDragHandlers(onReorder)(index): RowDragProps`, `setActiveStep(wf, id: string|null)`, `CallPanel({step})`, `StepRow({step,index,active,onSelect,onDelete,dragProps})` are used identically across every consuming task. Reducers (`addStep/updateStep/removeStep/reorderStep/setActiveStep/setView`) and store (`update/createWorkflow/setActiveWorkflow/useWorkflowState/useActiveWorkflow`) match Plan #1's actual exports (verified against `reducers.ts`/`store.ts`).
- **Deferred (flagged):** ⌘↵ Send keybinding (scope note 2); catalog-sidebar collapse-in-Focus (scope note 3); workflow rename/delete (scope note 4); live-GUI smoke (Task 12 Step 4, human step).
