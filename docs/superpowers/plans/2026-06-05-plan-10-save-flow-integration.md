# Plan 10 — Save-flow integration (wire plan-06 Save/autosave/discard-confirm into the live WorkflowApp)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. **Detail is TDD-complete** — execute task-by-task.

**Status:** 🚧 **TDD-detailed, ready to execute** (no tasks done yet).
**Branch:** `redesign/workflow-ui-spec-plans`
**Spec:** `docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`
§6 «Создание и сохранение», §11 «Клавиатура». UX addendum (locked in this session):
the visible **Save button lives in `FocusView`** next to the draft (spec pins only Ctrl/Cmd+S).
**Predecessors:** plan-06 (`50583ed..4ae7d8e`, ✅) built every Save building block
(`save.ts`, `SaveRequestDialog`, `discardGuard`, `DiscardDraftDialog`, store `draftOrigin`/
`draftDirty`); plan-09 (`b21bc3e..b869b35`, ✅) rewired `WorkflowApp` to the new shell and
**explicitly deferred** this shell-glue. This plan finishes it.

**Goal:** Make the Save affordance real — a visible Save button + Ctrl/Cmd+S open `SaveRequestDialog`
for an unbound draft (creating a saved request and binding its origin); an origin-bound draft
autosaves on every content edit; opening another request over a *dirty unbound* draft prompts
`DiscardDraftDialog` (Cancel / Save… / Discard); Ctrl/Cmd+N starts a fresh draft — all routed
through one guard in `WorkflowApp`.

**Architecture:** Pure glue over existing units. A new debounced `useAutosaveDraft` hook drives
`autosaveDraft` for origin-bound drafts. `FocusView` gains a Save button (unbound) / autosave
status (bound). `WorkflowApp` mounts `SaveRequestDialog` + `DiscardDraftDialog`, owns a
`saveNewRequest`→`setDraftOrigin` orchestrator, the Ctrl+S/Ctrl+N hotkeys, and a single
`guardedRun` that routes **sidebar + ⌘K + overview** opens through `needsDiscardConfirm`.
`SidebarShell` gets optional `onOpenRequest`/`onAddRequest` props (default = today's direct
calls) so the guard can intercept its opens.

**Tech Stack:** TypeScript, React 18, Vitest + Testing Library (`renderHook`, fake timers),
`@/` path alias (= `src/`). No backend changes.

## Build / test commands (repo root, PowerShell)

- All front-end tests: `pnpm test` · single file: `pnpm test <path>`
- Typecheck: `pnpm lint` (`tsc -b`) · Prod build: `pnpm build`
- Grep helper: `pnpm exec rg "<pattern>" src`

## What already exists (do NOT rebuild — just wire)

- `workflowStore` (`src/features/workflow/store.ts`): `draft`, `draftOrigin`, `draftDirty`,
  `setDraft(step, origin?)`, `setDraftOrigin(origin)`, `updateDraft(patch)` (content edits on an
  **unbound** draft set `dirty`; bound drafts never set `dirty`), `useDraft`/`useDraftOrigin`/
  `useDraftDirty`.
- `save.ts`: `saveNewRequest(addItem, draft, {collectionId, parentId, name}) → Promise<string>`
  (returns new id) · `autosaveDraft(updateItemContent, origin, draft) → Promise<void>`.
- `SaveRequestDialog.tsx` props: `{ open, onOpenChange, metas: CollectionMetaIpc[],
  loadCollection: (id)=>Promise<CollectionIpc>, defaultName, onSave: (dest)=>Promise<void>,
  onCreateCollection: (name)=>Promise<string>, originBound?, suggestedPath?, existingLocations? }`.
- `DiscardDraftDialog.tsx` props: `{ open, onOpenChange, onDiscard, onSaveFirst }`.
- `discardGuard.ts`: `needsDiscardConfirm(origin, dirty) = origin === null && dirty`.
- `grouping.ts`: `suggestSavePath(address, service) → string[]` ·
  `findSavedLocations(collections, {service, method, address}) → SaveLocation[]`.
- `useCatalogTree()`: `{ tree: CollectionIpc[], reload, createCollection, addItem,
  updateItemContent, ... }`. `CollectionMetaIpc = { id, name }`, so `cat.tree` is assignable to a
  `CollectionMetaIpc[]` prop.
- `mapping.ts`: `stepToSavedRequest`, `savedRequestToDraft`. `model.ts`: `newStep`, `Step`
  (content keys: `address`, `tls`, `service`, `method`, `auth`, `requestJson`, `metadata`).

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/features/catalog/useAutosaveDraft.ts` (+`.test.ts`) | **create** | Debounced autosave of an origin-bound draft; no-op for unbound. |
| `src/features/workflow/FocusView.tsx` (+`.test.tsx`) | **modify** / **create test** | Visible Save button (unbound) / autosave status (bound) above the draft. |
| `src/features/catalog/SidebarShell.tsx` (+`.test.tsx`) | **modify** | Optional `onOpenRequest`/`onAddRequest` props (default = direct calls) so opens can be guarded. |
| `src/app/WorkflowApp.tsx` (+`.test.tsx`) | **modify** / **rewrite test** | Mount Save+Discard dialogs; save orchestrator; Ctrl+S/Ctrl+N; autosave; one `guardedRun` for all request-opens. |

## Task ordering

1. `useAutosaveDraft` hook (leaf — no consumers yet).
2. `FocusView` Save button/status (adds optional `onRequestSave` prop; live `WorkflowApp` still
   compiles because it renders `<FocusView/>` without the prop until Task 4).
3. `SidebarShell` guarded-open props (default-compatible; existing tests stay green).
4. `WorkflowApp` full wiring (consumes Tasks 1–3).
5. Verification + banners.

`pnpm test` is the per-task gate. `pnpm lint`/`pnpm build` go green after Task 4.

---

### Task 1: `useAutosaveDraft` — debounced autosave of an origin-bound draft

**Files:**
- Create: `src/features/catalog/useAutosaveDraft.ts`
- Test: `src/features/catalog/useAutosaveDraft.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/catalog/useAutosaveDraft.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const autosaveDraft = vi.fn().mockResolvedValue(undefined);
vi.mock("./save", () => ({
  autosaveDraft: (...args: unknown[]) => autosaveDraft(...args),
}));

import { useAutosaveDraft } from "./useAutosaveDraft";
import { workflowStore } from "@/features/workflow/store";
import { newStep } from "@/features/workflow/model";

const updateItemContent = vi.fn().mockResolvedValue(undefined);
const step = () => newStep({ address: "h:443", tls: false, service: "p.S", method: "M" });

beforeEach(() => {
  vi.useFakeTimers();
  autosaveDraft.mockClear();
  updateItemContent.mockClear();
  workflowStore.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosaveDraft", () => {
  it("does not autosave an unbound draft", () => {
    renderHook(() => useAutosaveDraft(updateItemContent, 500));
    act(() => {
      workflowStore.setDraft(step()); // unbound
    });
    act(() => {
      workflowStore.updateDraft({ requestJson: '{"a":1}' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(autosaveDraft).not.toHaveBeenCalled();
  });

  it("does not autosave on the bind itself (no edit yet)", () => {
    renderHook(() => useAutosaveDraft(updateItemContent, 500));
    act(() => {
      workflowStore.setDraft(step(), { collectionId: "c1", requestId: "r1" });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(autosaveDraft).not.toHaveBeenCalled();
  });

  it("debounced-autosaves an origin-bound draft after a content edit", () => {
    renderHook(() => useAutosaveDraft(updateItemContent, 500));
    act(() => {
      workflowStore.setDraft(step(), { collectionId: "c1", requestId: "r1" });
    });
    act(() => {
      workflowStore.updateDraft({ requestJson: '{"a":1}' });
    });
    expect(autosaveDraft).not.toHaveBeenCalled(); // still within debounce window
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(autosaveDraft).toHaveBeenCalledTimes(1);
    expect(autosaveDraft).toHaveBeenCalledWith(
      updateItemContent,
      { collectionId: "c1", requestId: "r1" },
      expect.objectContaining({ requestJson: '{"a":1}' }),
    );
  });

  it("coalesces rapid edits into a single autosave", () => {
    renderHook(() => useAutosaveDraft(updateItemContent, 500));
    act(() => {
      workflowStore.setDraft(step(), { collectionId: "c1", requestId: "r1" });
    });
    act(() => {
      workflowStore.updateDraft({ requestJson: '{"a":1}' });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      workflowStore.updateDraft({ requestJson: '{"a":2}' });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(autosaveDraft).not.toHaveBeenCalled(); // timer reset by the 2nd edit
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(autosaveDraft).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/catalog/useAutosaveDraft.test.ts`
Expected: FAIL — `useAutosaveDraft` does not exist (`Cannot find module './useAutosaveDraft'`).

- [ ] **Step 3: Implement the hook**

Create `src/features/catalog/useAutosaveDraft.ts` with:

```ts
import { useEffect, useRef } from "react";
import type { SavedRequestIpc } from "@/ipc/bindings";
import { useDraft, useDraftOrigin } from "@/features/workflow/store";
import { autosaveDraft } from "./save";

const AUTOSAVE_DELAY_MS = 500;

/**
 * Debounced autosave of an **origin-bound** draft: every content edit reconstructs the owning
 * request and persists it via `updateItemContent`. Unbound drafts (and the bind moment itself,
 * which carries no edit yet) never autosave.
 */
export function useAutosaveDraft(
  updateItemContent: (collectionId: string, itemId: string, content: SavedRequestIpc) => Promise<void>,
  delayMs: number = AUTOSAVE_DELAY_MS,
): void {
  const draft = useDraft();
  const origin = useDraftOrigin();
  const boundKey = origin ? `${origin.collectionId}/${origin.requestId}` : null;
  // Armed on every (re)bind so the first content effect for a freshly bound origin is skipped.
  const skipRef = useRef<string | null>(null);

  useEffect(() => {
    skipRef.current = boundKey;
  }, [boundKey]);

  useEffect(() => {
    if (!origin || !draft) return;
    if (skipRef.current === boundKey) {
      // First run after (re)bind — consume the skip, do not save.
      skipRef.current = null;
      return;
    }
    const t = setTimeout(() => {
      void autosaveDraft(updateItemContent, origin, draft);
    }, delayMs);
    return () => clearTimeout(t);
  }, [draft, origin, boundKey, delayMs, updateItemContent]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/features/catalog/useAutosaveDraft.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/useAutosaveDraft.ts src/features/catalog/useAutosaveDraft.test.ts
git commit -m "feat(catalog): useAutosaveDraft — debounced origin-bound autosave (plan-10)"
```
End the commit body with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 2: `FocusView` — visible Save button (unbound) / autosave status (bound)

**Files:**
- Modify: `src/features/workflow/FocusView.tsx`
- Test: `src/features/workflow/FocusView.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/features/workflow/FocusView.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./CallPanel", () => ({
  CallPanel: ({ step }: { step: { method: string } }) => <div>CALL:{step.method}</div>,
}));

import { FocusView } from "./FocusView";
import { workflowStore } from "./store";
import { newStep } from "./model";

beforeEach(() => {
  workflowStore.reset();
});

describe("FocusView Save affordance", () => {
  it("shows the empty state and no Save button when there is no draft", () => {
    render(<FocusView />);
    expect(screen.getByText(/Нет активного реквеста/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сохранить" })).not.toBeInTheDocument();
  });

  it("shows a Save button for an unbound draft and calls onRequestSave", async () => {
    const user = userEvent.setup();
    const onRequestSave = vi.fn();
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    render(<FocusView onRequestSave={onRequestSave} />);
    expect(screen.getByText("CALL:GetX")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onRequestSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("autosave-status")).not.toBeInTheDocument();
  });

  it("shows the autosave status (no Save button) for an origin-bound draft", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("autosave-status")).toHaveTextContent("Сохранено");
    expect(screen.queryByRole("button", { name: "Сохранить" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/workflow/FocusView.test.tsx`
Expected: FAIL — current `FocusView` renders no toolbar, so there is no "Сохранить" button / no
`autosave-status` element.

- [ ] **Step 3: Rewrite `FocusView.tsx`**

Replace the entire contents of `src/features/workflow/FocusView.tsx` with:

```tsx
import { CallPanel } from "./CallPanel";
import { useDraft, useDraftOrigin, workflowStore } from "./store";
import type { Step } from "./model";

export interface FocusViewProps {
  /** Open the Save dialog for the current unbound draft (Ctrl+S / the Save button). */
  onRequestSave?: () => void;
}

export function FocusView({ onRequestSave }: FocusViewProps = {}) {
  const draft = useDraft();
  const origin = useDraftOrigin();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {draft && (
        <div className="flex h-8 items-center justify-end gap-2 border-b border-border px-3 text-xs">
          {origin ? (
            <span className="text-muted-foreground" data-testid="autosave-status">
              Сохранено
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onRequestSave?.()}
              className="rounded border border-border px-2 py-0.5 hover:bg-accent"
            >
              Сохранить
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {draft ? (
          <CallPanel
            step={draft}
            onPatch={(patch: Partial<Step>) => workflowStore.updateDraft(patch)}
            onExecuted={(executed: Step) => workflowStore.commitExecutedStep(executed)}
            editable
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/features/workflow/FocusView.test.tsx`
Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/FocusView.tsx src/features/workflow/FocusView.test.tsx
git commit -m "feat(workflow): FocusView Save button + autosave status (plan-10)"
```
End the commit body with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 3: `SidebarShell` — optional guarded-open props

**Files:**
- Modify: `src/features/catalog/SidebarShell.tsx`
- Test: `src/features/catalog/SidebarShell.test.tsx` (add one case)

The sidebar currently calls `openSavedRequest`/`newRequestDraft` directly (lines ~87/108/115).
Add optional `onOpenRequest`/`onAddRequest` props (default = those direct calls) so `WorkflowApp`
can route the sidebar's opens through the dirty-confirm guard.

- [ ] **Step 1: Add the failing test case**

In `src/features/catalog/SidebarShell.test.tsx`, add this case inside the existing
`describe("SidebarShell", …)` block (right after the existing `"the + button starts a new request
draft"` case):

```tsx
  it("the + button calls onAddRequest when provided (guarded open)", () => {
    const onAddRequest = vi.fn();
    render(<SidebarShell onAddRequest={onAddRequest} />);
    fireEvent.click(screen.getByLabelText("new-request"));
    expect(onAddRequest).toHaveBeenCalledTimes(1);
    expect(newRequestDraft).not.toHaveBeenCalled();
  });
```

(The harness already imports `newRequestDraft` from the mocked `./actions` and exposes
`fireEvent`/`screen`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/catalog/SidebarShell.test.tsx`
Expected: FAIL — `SidebarShell` ignores `onAddRequest`, so the click still calls the default
`newRequestDraft` (the `expect(onAddRequest).toHaveBeenCalledTimes(1)` assertion fails).

- [ ] **Step 3: Edit `SidebarShell.tsx` — widen the type import**

Change the bindings type import (top of file):

```tsx
import type { ItemIpc } from "@/ipc/bindings";
```

to:

```tsx
import type { ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
```

- [ ] **Step 4: Edit `SidebarShell.tsx` — props interface + defaults**

Replace:

```tsx
export interface SidebarShellProps {
  onOpenCollection?: (collectionId: string) => void;
}

export function SidebarShell({ onOpenCollection }: SidebarShellProps) {
```

with:

```tsx
export interface SidebarShellProps {
  onOpenCollection?: (collectionId: string) => void;
  /** Open a saved request (default: direct `openSavedRequest`). Lets a parent guard the open. */
  onOpenRequest?: (collectionId: string, req: SavedRequestIpc) => void;
  /** Start a new request draft (default: direct `newRequestDraft`). Lets a parent guard it. */
  onAddRequest?: () => void;
}

export function SidebarShell({ onOpenCollection, onOpenRequest, onAddRequest }: SidebarShellProps) {
  const openRequest = onOpenRequest ?? openSavedRequest;
  const addRequest = onAddRequest ?? newRequestDraft;
```

(Note: the existing function body opens with `const cat = useCatalogTree();` etc. — insert the two
`const openRequest`/`addRequest` lines as the **first statements** of the function body, directly
under the new signature, as shown.)

- [ ] **Step 5: Edit `SidebarShell.tsx` — route the three call sites through the locals**

Make these three replacements:

1. The `+` new-request button:

```tsx
        <Button size="icon" variant="ghost" aria-label="new-request" onClick={() => newRequestDraft()}>
```
→
```tsx
        <Button size="icon" variant="ghost" aria-label="new-request" onClick={() => addRequest()}>
```

2. `CollectionTree`'s `onOpenRequest`:

```tsx
        onOpenRequest={(collectionId, req) => openSavedRequest(collectionId, req)}
```
→
```tsx
        onOpenRequest={(collectionId, req) => openRequest(collectionId, req)}
```

3. `CollectionTree`'s `onAddRequest`:

```tsx
        onAddRequest={() => newRequestDraft()}
```
→
```tsx
        onAddRequest={() => addRequest()}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test src/features/catalog/SidebarShell.test.tsx`
Expected: PASS — the new case plus all pre-existing cases (defaults preserve old behavior).

- [ ] **Step 7: Commit**

```bash
git add src/features/catalog/SidebarShell.tsx src/features/catalog/SidebarShell.test.tsx
git commit -m "feat(catalog): SidebarShell optional onOpenRequest/onAddRequest props (plan-10)"
```
End the commit body with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 4: `WorkflowApp` — Save dialog + orchestrator + Ctrl+S/Ctrl+N + autosave + guarded open

**Files:**
- Modify: `src/app/WorkflowApp.tsx`
- Test: `src/app/WorkflowApp.test.tsx` (full rewrite)

- [ ] **Step 1: Rewrite the test first**

Replace the entire contents of `src/app/WorkflowApp.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/features/catalog/SidebarShell", () => ({
  SidebarShell: ({
    onOpenCollection,
    onOpenRequest,
    onAddRequest,
  }: {
    onOpenCollection: (id: string) => void;
    onOpenRequest?: (collectionId: string, req: { id: string }) => void;
    onAddRequest?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onOpenCollection("c1")}>open-col</button>
      <button type="button" onClick={() => onOpenRequest?.("c2", { id: "rX" } as never)}>open-req</button>
      <button type="button" onClick={() => onAddRequest?.()}>add-req</button>
    </div>
  ),
}));
vi.mock("@/features/catalog/overview/CollectionOverview", () => ({
  CollectionOverview: ({ collection }: { collection: { id: string } }) => (
    <div>OVERVIEW:{collection.id}</div>
  ),
}));
vi.mock("@/features/catalog/CommandPalette", () => ({
  CommandPalette: () => null,
}));
vi.mock("@/features/catalog/actions", () => ({
  openSavedRequest: vi.fn(),
  newRequestDraft: vi.fn(),
}));
vi.mock("@/features/catalog/save", () => ({
  saveNewRequest: vi.fn().mockResolvedValue("req-new"),
  autosaveDraft: vi.fn(),
}));
vi.mock("@/features/catalog/useAutosaveDraft", () => ({
  useAutosaveDraft: vi.fn(),
}));
vi.mock("@/features/catalog/SaveRequestDialog", () => ({
  SaveRequestDialog: ({
    open,
    onSave,
    defaultName,
  }: {
    open: boolean;
    onSave: (d: { collectionId: string; parentId: string | null; name: string }) => Promise<void>;
    defaultName: string;
  }) =>
    open ? (
      <button type="button" onClick={() => void onSave({ collectionId: "c1", parentId: null, name: defaultName })}>
        do-save
      </button>
    ) : null,
}));
vi.mock("@/features/catalog/DiscardDraftDialog", () => ({
  DiscardDraftDialog: ({
    open,
    onDiscard,
    onSaveFirst,
  }: {
    open: boolean;
    onDiscard: () => void;
    onSaveFirst: () => void;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={onDiscard}>discard-confirm</button>
        <button type="button" onClick={onSaveFirst}>discard-savefirst</button>
      </div>
    ) : null,
}));
vi.mock("@/features/catalog/useCatalogTree", () => ({
  useCatalogTree: () => ({
    tree: [{ id: "c1", name: "C1", items: [], variables: {}, auth: { kind: "none" } }],
    loading: false,
    error: null,
    reload: vi.fn().mockResolvedValue(undefined),
    addItem: vi.fn().mockResolvedValue(undefined),
    createCollection: vi.fn().mockResolvedValue("c-new"),
    updateItemContent: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/features/workflow/FocusView", () => ({
  FocusView: ({ onRequestSave }: { onRequestSave?: () => void }) => (
    <div>
      FOCUS
      <button type="button" onClick={() => onRequestSave?.()}>focus-save</button>
    </div>
  ),
}));
vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

import { WorkflowApp } from "./WorkflowApp";
import { workflowStore } from "@/features/workflow/store";
import { addStep, setView } from "@/features/workflow/reducers";
import { newStep } from "@/features/workflow/model";
import { saveNewRequest } from "@/features/catalog/save";
import { openSavedRequest, newRequestDraft } from "@/features/catalog/actions";

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

function createCall() {
  act(() => {
    workflowStore.update((w) =>
      setView(addStep(w, newStep({ address: "h:443", tls: false, service: "p.S", method: "M" })), "focus"),
    );
  });
}
function setUnboundDraft() {
  act(() => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
  });
}
function setBoundDraft() {
  act(() => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "M" }),
      { collectionId: "c1", requestId: "r1" },
    );
  });
}
function setDirtyUnboundDraft() {
  act(() => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    workflowStore.updateDraft({ requestJson: '{"a":1}' });
  });
}

describe("WorkflowApp shell", () => {
  it("shows FocusView by default and the collection overview after opening a collection", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    expect(screen.getByText("FOCUS")).toBeInTheDocument();
    await user.click(screen.getByText("open-col"));
    expect(screen.getByText("OVERVIEW:c1")).toBeInTheDocument();
    expect(screen.queryByText("FOCUS")).not.toBeInTheDocument();
  });

  it("closes the open collection overview and returns to Focus when a call is created", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.click(screen.getByText("open-col"));
    expect(screen.getByText("OVERVIEW:c1")).toBeInTheDocument();
    createCall();
    expect(screen.getByText("FOCUS")).toBeInTheDocument();
    expect(screen.queryByText("OVERVIEW:c1")).not.toBeInTheDocument();
  });
});

describe("WorkflowApp titlebar + view dispatch", () => {
  it("renders the workflow selector, env control and view switcher", async () => {
    render(<WorkflowApp />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
    expect(await screen.findByText(/No environment/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Лента" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Список" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Фокус" })).toBeInTheDocument();
  });

  it("defaults to Focus and switches to the real List view", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    expect(screen.getByText("FOCUS")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Список" }));
    expect(screen.queryByText("FOCUS")).not.toBeInTheDocument();
    expect(screen.getByText(/Нет шагов/)).toBeInTheDocument();
  });
});

describe("WorkflowApp Save flow", () => {
  it("opens the Save dialog on Ctrl+S for an unbound draft and binds origin on save", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setUnboundDraft();
    await user.keyboard("{Control>}s{/Control}");
    await user.click(await screen.findByText("do-save"));
    await waitFor(() => {
      expect(workflowStore.getState().draftOrigin).toEqual({ collectionId: "c1", requestId: "req-new" });
    });
    expect(saveNewRequest).toHaveBeenCalledTimes(1);
  });

  it("does not open the Save dialog on Ctrl+S when the draft is origin-bound", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setBoundDraft();
    await user.keyboard("{Control>}s{/Control}");
    expect(screen.queryByText("do-save")).not.toBeInTheDocument();
  });

  it("opens the Save dialog from the FocusView Save button", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setUnboundDraft();
    await user.click(screen.getByText("focus-save"));
    expect(await screen.findByText("do-save")).toBeInTheDocument();
  });

  it("Ctrl+N starts a fresh request draft", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.keyboard("{Control>}n{/Control}");
    expect(newRequestDraft).toHaveBeenCalledTimes(1);
  });
});

describe("WorkflowApp open-over-dirty guard", () => {
  it("opens a saved request directly when there is no dirty unbound draft", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.click(screen.getByText("open-req"));
    expect(openSavedRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("discard-confirm")).not.toBeInTheDocument();
  });

  it("prompts before replacing a dirty unbound draft, then discards", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setDirtyUnboundDraft();
    expect(workflowStore.getState().draftDirty).toBe(true);
    await user.click(screen.getByText("open-req"));
    expect(openSavedRequest).not.toHaveBeenCalled();
    expect(screen.getByText("discard-confirm")).toBeInTheDocument();
    await user.click(screen.getByText("discard-confirm"));
    expect(openSavedRequest).toHaveBeenCalledTimes(1);
  });

  it("Save first → opens the Save dialog, and after saving proceeds to open the request", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setDirtyUnboundDraft();
    await user.click(screen.getByText("open-req"));
    await user.click(screen.getByText("discard-savefirst"));
    await user.click(await screen.findByText("do-save"));
    await waitFor(() => expect(openSavedRequest).toHaveBeenCalledTimes(1));
    expect(saveNewRequest).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/app/WorkflowApp.test.tsx`
Expected: FAIL — the current `WorkflowApp` has no Save dialog, no Ctrl+S/Ctrl+N, no guard, and the
mocked `SidebarShell`'s `open-req`/`add-req` callbacks aren't wired (`do-save`/`discard-confirm`
never render).

- [ ] **Step 3: Rewrite `WorkflowApp.tsx`**

Replace the entire contents of `src/app/WorkflowApp.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Toaster } from "@/components/ui/toaster";
import { FocusView } from "@/features/workflow/FocusView";
import { LedgerView } from "@/features/workflow/LedgerView";
import { ListView } from "@/features/workflow/ListView";
import { ViewSwitcher } from "@/features/workflow/ViewSwitcher";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { WorkflowEnvControl } from "@/features/workflow/WorkflowEnvControl";
import { useActiveWorkflow, useDraft, workflowStore } from "@/features/workflow/store";
import type { ViewMode } from "@/features/workflow/model";
import type { SavedRequestIpc } from "@/ipc/bindings";
import { SidebarShell } from "@/features/catalog/SidebarShell";
import { CommandPalette } from "@/features/catalog/CommandPalette";
import { CollectionOverview } from "@/features/catalog/overview/CollectionOverview";
import { useCatalogTree } from "@/features/catalog/useCatalogTree";
import { openSavedRequest, newRequestDraft } from "@/features/catalog/actions";
import { SaveRequestDialog } from "@/features/catalog/SaveRequestDialog";
import { DiscardDraftDialog } from "@/features/catalog/DiscardDraftDialog";
import { needsDiscardConfirm } from "@/features/catalog/discardGuard";
import { saveNewRequest } from "@/features/catalog/save";
import { useAutosaveDraft } from "@/features/catalog/useAutosaveDraft";
import { suggestSavePath, findSavedLocations } from "@/features/catalog/grouping";

function renderView(view: ViewMode, onRequestSave: () => void) {
  switch (view) {
    case "ledger":
      return <LedgerView />;
    case "list":
      return <ListView />;
    default:
      return <FocusView onRequestSave={onRequestSave} />;
  }
}

export function WorkflowApp() {
  const wf = useActiveWorkflow();
  const draft = useDraft();
  // One catalog snapshot for ⌘K + overview + Save dialog; the sidebar keeps its own instance.
  const cat = useCatalogTree();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelCollectionId, setPanelCollectionId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  // The open-request/new-draft action deferred while the discard confirm is up.
  const pendingOpenRef = useRef<(() => void) | null>(null);

  // Debounced autosave of an origin-bound draft on every content edit (spec §6).
  useAutosaveDraft(cat.updateItemContent);

  // Run an open action, but confirm first if it would drop a dirty *unbound* draft (spec §6).
  function guardedRun(action: () => void) {
    const st = workflowStore.getState();
    if (needsDiscardConfirm(st.draftOrigin, st.draftDirty)) {
      pendingOpenRef.current = action;
      setDiscardOpen(true);
    } else {
      action();
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        // Save only opens the dialog for an UNBOUND draft; bound drafts already autosave.
        const st = workflowStore.getState();
        if (st.draft && st.draftOrigin === null) setSaveOpen(true);
      } else if (mod && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        guardedRun(() => newRequestDraft());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // guardedRun reads fresh store state and only calls stable setters; bind once.
  }, []);

  // Freshen the snapshot whenever the palette opens, so cross-instance edits are searchable.
  useEffect(() => {
    if (paletteOpen) void cat.reload();
  }, [paletteOpen, cat.reload]);

  // Creating a call switches to Focus; close any open collection overview so it is visible.
  useEffect(() => {
    if (wf.activeStepId) setPanelCollectionId(null);
  }, [wf.activeStepId]);

  const panelCollection = panelCollectionId
    ? cat.tree.find((c) => c.id === panelCollectionId) ?? null
    : null;

  // Save the current unbound draft as a new request, bind its origin, then run any pending open.
  async function handleSave(dest: { collectionId: string; parentId: string | null; name: string }) {
    const current = workflowStore.getState().draft;
    if (!current) return;
    const id = await saveNewRequest(cat.addItem, current, dest);
    workflowStore.setDraftOrigin({ collectionId: dest.collectionId, requestId: id });
    await cat.reload();
    const pending = pendingOpenRef.current;
    pendingOpenRef.current = null;
    pending?.();
  }

  const openRequest = (collectionId: string, req: SavedRequestIpc) =>
    guardedRun(() => openSavedRequest(collectionId, req));

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-9 items-center gap-3 border-b border-border px-3 text-sm">
        <span className="font-semibold">⚡ Handshaker</span>
        <WorkflowSelector />
        <WorkflowEnvControl />
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
        <SidebarShell
          onOpenCollection={(id) => setPanelCollectionId(id)}
          onOpenRequest={openRequest}
          onAddRequest={() => guardedRun(() => newRequestDraft())}
        />
        <div className="min-h-0 flex-1">
          {panelCollection ? (
            <CollectionOverview
              collection={panelCollection}
              onChanged={() => void cat.reload()}
              onSelectRequest={openRequest}
              onClose={() => setPanelCollectionId(null)}
            />
          ) : (
            renderView(wf.view, () => setSaveOpen(true))
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        collections={cat.tree}
        onOpen={openRequest}
      />

      <SaveRequestDialog
        open={saveOpen}
        onOpenChange={(o) => {
          setSaveOpen(o);
          if (!o) pendingOpenRef.current = null;
        }}
        metas={cat.tree}
        loadCollection={(id) => Promise.resolve(cat.tree.find((c) => c.id === id)!)}
        defaultName={draft?.method ?? ""}
        onSave={handleSave}
        onCreateCollection={cat.createCollection}
        suggestedPath={draft ? suggestSavePath(draft.address, draft.service) : []}
        existingLocations={
          draft
            ? findSavedLocations(cat.tree, {
                service: draft.service,
                method: draft.method,
                address: draft.address,
              })
            : []
        }
      />

      <DiscardDraftDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={() => {
          const a = pendingOpenRef.current;
          pendingOpenRef.current = null;
          a?.();
        }}
        onSaveFirst={() => {
          setDiscardOpen(false);
          setSaveOpen(true);
        }}
      />

      <Toaster />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/app/WorkflowApp.test.tsx`
Expected: PASS — all cases (shell 2, titlebar 2, Save flow 4, guard 3).

- [ ] **Step 5: Typecheck the wiring**

Run: `pnpm lint`
Expected: PASS (exit 0). `metas={cat.tree}` typechecks because `CollectionIpc` satisfies
`CollectionMetaIpc = { id, name }`. If `tsc` flags a real signature mismatch, read the actual prop
type of the kept component and report it — do NOT loosen types to force a pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/WorkflowApp.tsx src/app/WorkflowApp.test.tsx
git commit -m "feat(app): wire Save dialog + autosave + Ctrl+S/N + open-over-dirty guard (plan-10)"
```
End the commit body with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 5: Full verification + finalize banners

**Files:**
- Modify: this plan file (status banner), `docs/superpowers/plans/2026-06-05-plan-00-index.md`.

- [ ] **Step 1: Full front-end suite**

Run: `pnpm test`
Expected: PASS — green. Record test-file + test counts.

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: PASS (exit 0), zero TypeScript errors.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: SUCCESS — `tsc -b` + Vite bundle, no unresolved imports.

- [ ] **Step 4: Rust regression guard (no backend edits this plan)**

Run: `cargo test -p handshaker-core` then `cargo test -p handshaker`
Expected: PASS — unchanged (core 129 / handshaker 36, per plan-09). Record counts.

- [ ] **Step 5: Finalize the plan banner + index**

Update this file's **Status** line to `✅ done` with the commit range and a one-line suite summary
(front-end test count, `pnpm lint`/`pnpm build` green, Rust unchanged), mirroring the plan-09
banner style.

In `docs/superpowers/plans/2026-06-05-plan-00-index.md`, add (or update) a **plan-10** row with
Status `✅ done` and the commit range, and update the intro line to note plan-10 completes the
deferred Save-flow follow-up — the redesign is then feature-complete.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-06-05-plan-10-save-flow-integration.md docs/superpowers/plans/2026-06-05-plan-00-index.md
git commit -m "docs(plan-10): mark Save-flow integration complete; update index (plan-10)"
```
End the commit body with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Self-review (against spec §6/§11 + plan-06 banner)

- **Spec coverage:** §6 «Save (Ctrl+S) → диалог» (Task 4 Ctrl+S + `SaveRequestDialog`) ·
  «несвязанный draft Save создаёт и привязывает» (Task 4 `handleSave`→`saveNewRequest`+
  `setDraftOrigin`) · «origin-bound автосейв при любой правке» (Task 1 `useAutosaveDraft`) ·
  «`dirty` только у несвязанного; open-over-dirty confirm» (Task 4 `guardedRun`+`needsDiscardConfirm`
  +`DiscardDraftDialog`) · «New request Ctrl+N» (Task 4) · §11 hotkeys `Ctrl/Cmd+S`/`Ctrl/Cmd+N`
  (Task 4). Visible Save button addendum → `FocusView` (Task 2). ✅ all mapped.
- **Plan-06 deferred list (banner):** live `Ctrl+S` ✅ (Task 4) · debounced autosave *effect* ✅
  (Task 1+4) · click-interception → `DiscardDraftDialog` before `openSavedRequest`/`newRequestDraft`
  ✅ (Task 4, via `SidebarShell` props in Task 3 + ⌘K `onOpen` + overview `onSelectRequest`) ·
  Save orchestrator ✅ (Task 4). **Save As** is spec'd but the existing `SaveRequestDialog` has no
  Save-As control; it is **out of scope** here (no UI exists to trigger it) and noted as a tiny
  follow-up — not part of "I don't see the Save button".
- **Type consistency:** `onOpenRequest(collectionId, req: SavedRequestIpc)` identical across
  `SidebarShell` (Task 3), `WorkflowApp.openRequest`, `CommandPalette.onOpen`,
  `CollectionOverview.onSelectRequest`. `handleSave` dest `{collectionId, parentId, name}` matches
  `SaveRequestDialog.onSave` and `saveNewRequest`'s 3rd arg. `useAutosaveDraft(updateItemContent)`
  matches `useCatalogTree.updateItemContent` + `autosaveDraft`'s 1st arg. `FocusView` prop
  `onRequestSave?: () => void` matches the `renderView` call.
- **No placeholders:** every code step shows the full file or the exact old→new replacement; every
  command has an expected result.
