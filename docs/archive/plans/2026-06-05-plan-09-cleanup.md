# Plan 09 — Cleanup (delete legacy catalog/collections, wire WorkflowApp to the new shell)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking. **Detail is TDD-complete** — execute
> task-by-task.

**Status:** ✅ **done** (`b21bc3e..57b719b`, 7 commits — 1 plan doc + 5 deletion/wiring +
1 backend-adjacent chore; plus this finalize-docs commit). Full front-end suite green:
**397** tests / 75 files. `pnpm lint` (`tsc -b`) green — **zero** TS errors (the 15
pre-existing legacy errors flagged at plan-08 are gone, now that `features/collections/**`
+ the `ipc/client.ts` `authSetForEnv` wrapper are deleted), which also unblocks `pnpm build`
(green). Rust unchanged: `handshaker-core` 129 passed / 1 ignored, `handshaker` 36 passed.
Only remaining redesign work is the deferred **Save-flow + dirty-confirm follow-up** (its
own plan — see the "Scope decision" section below).
**Branch:** `redesign/workflow-ui-spec-plans`
**Phase:** 8 of spec §16 (`docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`),
spec §16.8 «Зачистка».
**Predecessors:** plan-01 (`cadaccd..625241b`), plan-02 (`41d29bf..0a33cae`),
plan-03 (`7b1b885..2903c8a`), plan-04 (`0381a9d..7d767d4`), plan-05 (`65d8c96..f813bf9`),
plan-06 (`50583ed..4ae7d8e`), plan-07 (`0af64bb..53755a2`), plan-08 (`9004e2f..8090f1a`) —
all ✅ done.

**Goal:** Remove every legacy artifact the redesign replaced — the derived
`CatalogService` model + curated tree (`model`/`store`/`tree`/`Sidebar`/`ServicePanel`/
`ServiceAuthEditor`/`AddServiceForm`), the legacy `features/collections/**` frontend, the
old `src/App.tsx` shell and its now-orphaned `invoke`/`tabs` dependencies, and the dangling
`authSetForEnv` IPC wrapper — then wire `WorkflowApp` onto the new persistent sidebar,
collection overview, and ⌘K palette so the live build is green (`pnpm lint` + `pnpm build`).

**Architecture:** Pure deletion + minimal wiring. `WorkflowApp` swaps the old
`Sidebar`/`ServicePanel` for `SidebarShell` + `CollectionOverview/CollectionOverview`, and
replaces the placeholder ⌘K props with a real `useCatalogTree` snapshot + a direct
`openSavedRequest` open. Two files that mix old and new exports (`actions.ts`, `fuzzy.ts`)
are **trimmed**, not deleted — their new exports (`openSavedRequest`/`newRequestDraft`,
`fuzzyMatch`) are live. The Rust backend already removed `AuthByEnvIpc`/`auth_set_for_env`
in plan-01, so the only backend-adjacent residue is the unused TS `client.ts` wrapper.

**Tech Stack:** TypeScript, React 18, Vitest + Testing Library, `@/` path alias (= `src/`),
Rust (verification-only this phase), PowerShell tooling.

## Build / test commands (repo root, PowerShell)

- All front-end tests: `pnpm test` · single file: `pnpm test <path>`
- Typecheck: `pnpm lint` (`tsc -b`) · Prod build: `pnpm build`
- Rust: `cargo test -p handshaker-core` · `cargo test -p handshaker`
- Grep helper (PowerShell): `pnpm exec rg "<pattern>" src src-tauri crates`

## Scope decision — Save-flow + dirty-confirm are NOT in this plan (deferred)

During detailing it was found that the **entire plan-06 Save flow is unwired into the live
`WorkflowApp`**: `catalog/SaveRequestDialog.tsx`, `catalog/save.ts`,
`catalog/DiscardDraftDialog.tsx`, and `catalog/discardGuard.ts` are referenced **only by
their own tests** — nothing mounts them, and neither `SidebarShell` nor the ⌘K palette routes
opens through a dirty-confirm guard. The header has no Save button / ⌘S and no autosave.

This plan **deliberately does not** wire that flow, because:

1. Spec §16 assigns **Create/Save flow + open-over-dirty confirm to phase 5 (plan-06)**, not
   phase 8. Phase 8 is «Зачистка» — delete legacy + update `WorkflowApp`.
2. The current live `SidebarShell` already opens saved requests with a **direct**
   `openSavedRequest` (no guard). Keeping the same behavior in the wired ⌘K palette is **not a
   regression** — it matches today's live UX.
3. The "Save first" branch of dirty-confirm depends on the whole Save flow being mounted
   (dialog + `save.ts` + collection-meta loading). That is a feature integration, not cleanup,
   and folding it into a deletion phase would blur the phase boundary the project tracks.

**Follow-up (post-plan-09, its own plan — call it "plan-06 integration"):** mount the Save
flow into `WorkflowApp` (header Save / ⌘S, `SaveRequestDialog`, autosave for origin-bound
drafts) and route **both** `SidebarShell` and the ⌘K palette through a shared guarded-open
(`needsDiscardConfirm` + `DiscardDraftDialog`, "Save first" → `SaveRequestDialog`). All
building blocks already exist (`useDraftDirty()` / `useDraftOrigin()` hooks in
`features/workflow/store.ts`); only the wiring is missing.

> Out of scope (pre-existing orphan, unrelated to this cleanup): `features/invoke/
> ResolvesPreview.tsx` is imported nowhere but predates this refactor and only depends on live
> modules — leave it. `features/invoke/BodyEditor.tsx` is **live** (used by
> `features/workflow/RequestTabs.tsx`) — keep it.

## Old-vs-new classification (locked from exploration)

`src/features/catalog/` mixes the old curated model and the new persistent library. **Delete**
only the old; **keep** the new; **trim** the two mixed files.

| File | Verdict | Why |
|------|---------|-----|
| `model.ts` (+test) | **delete** | `CatalogService`/curated model — replaced by `CollectionIpc`. |
| `store.ts` (+test) | **delete** | `catalogStore` in-memory store — replaced by IPC. |
| `tree.ts` (+test) | **delete** | `buildServiceTree`/`filterTree` — replaced by `useCatalogTree`. |
| `Sidebar.tsx` (+test) | **delete** | replaced by `SidebarShell` + `CollectionTree`. |
| `ServicePanel.tsx` (+test) | **delete** | replaced by `overview/CollectionOverview`. |
| `ServiceAuthEditor.tsx` (+test) | **delete** | replaced by `overview/SavedAuthEditor`. |
| `AddServiceForm.tsx` | **delete** | service-add UI gone; create is request-first. |
| `actions.ts` (+test) | **trim** | keep `openSavedRequest`/`newRequestDraft`; drop `describeService`/`refreshContract`/`openCallFromMethod`/`targetOf`. |
| `fuzzy.ts` (+test) | **trim** | keep `fuzzyMatch`/`FuzzyResult` (used by `palette.ts`); drop `rankServices`/`RankedService` (use `CatalogService`). |
| everything else in `catalog/` | **keep** | new library (`SidebarShell`, `CollectionTree`, `overview/*`, `useCatalogTree`, `mapping`, `grouping`, `sort`, `dnd`, `treeEdit`, `treeNav`, `palette`, `CommandPalette`, `save`, `SaveRequestDialog`, `discardGuard`, `DiscardDraftDialog`, `RowMenu`, `RenameInput`, `PinButton`, `SortControl`, `ConfirmDeleteDialog`). |

Legacy frontend (whole subtrees, dead via `App.tsx`):
- `src/App.tsx` — legacy shell (`main.tsx` already mounts `WorkflowApp`).
- `src/features/collections/**` — entire legacy collections frontend.
- `src/features/tabs/**` — `tabModel`/`useTabs`/`RequestTabs`/`CloseConfirm`, imported only by
  `App.tsx`; `tabModel.ts` imports the deleted `collections/draft`.
- `src/features/invoke/{AuthInline,MetadataView,RequestPanel}.tsx` — reachable only from
  `App.tsx` + `collections/draft`. **Keep `invoke/BodyEditor.tsx`** (live) and
  `invoke/ResolvesPreview.tsx` (pre-existing orphan, out of scope).

Backend residue: `src/ipc/client.ts` `authSetForEnv` wrapper + its `ipc` export entry — calls a
`commands.authSetForEnv` that no longer exists in generated `bindings.ts`.

## Task ordering (keeps `pnpm test` green at every commit)

`pnpm lint`/`pnpm build` are **red today** (15 pre-existing errors in `collections/**` +
`client.ts`); they only go green after Task 6–7. The per-task gate is therefore **`pnpm test`**
(Vitest — runs the suite, fails if any surviving test imports a deleted symbol). Order is
chosen so each delete happens only after its last importer is gone:

1. Rewire `WorkflowApp` (drops the only live importer of old `Sidebar`/`ServicePanel`/`model`).
2. Delete old catalog UI (`Sidebar`/`ServicePanel`/`ServiceAuthEditor`/`AddServiceForm`).
3. Trim `actions.ts` (its old fns were only used by the now-deleted UI).
4. Trim `fuzzy.ts` (drop `rankServices`).
5. Delete old catalog model (`model`/`store`/`tree`) — now importer-free.
6. Delete legacy `App.tsx` + `collections/**` + dead `tabs/**` + dead `invoke/*` together.
7. Remove the `authSetForEnv` client wrapper.
8. Full verification (`pnpm test` + `pnpm lint` + `pnpm build` + `cargo test`) + finalize banner.

---

### Task 1: Rewire `WorkflowApp` to the new shell (SidebarShell + CollectionOverview + real ⌘K)

**Files:**
- Modify: `src/app/WorkflowApp.tsx`
- Test: `src/app/WorkflowApp.test.tsx` (full rewrite)

- [ ] **Step 1: Rewrite the test first**

Replace the entire contents of `src/app/WorkflowApp.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Stub the heavy children so this test focuses on the shell's panel ↔ Focus logic.
vi.mock("@/features/catalog/SidebarShell", () => ({
  SidebarShell: ({ onOpenCollection }: { onOpenCollection: (id: string) => void }) => (
    <button type="button" onClick={() => onOpenCollection("c1")}>
      open-col
    </button>
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
}));
// One controlled catalog tree so opening collection "c1" finds a collection object.
vi.mock("@/features/catalog/useCatalogTree", () => ({
  useCatalogTree: () => ({
    tree: [{ id: "c1", name: "C1", items: [], variables: {}, auth: { kind: "none" } }],
    loading: false,
    error: null,
    reload: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/features/workflow/FocusView", () => ({
  FocusView: () => <div>FOCUS</div>,
}));
// Stub IPC so WorkflowEnvControl's envList() on mount doesn't hit a real backend.
vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

import { WorkflowApp } from "./WorkflowApp";
import { workflowStore } from "@/features/workflow/store";
import { addStep, setView } from "@/features/workflow/reducers";
import { newStep } from "@/features/workflow/model";

beforeEach(() => {
  workflowStore.reset();
});

// What every create-call entry point (sidebar, overview, ⌘K) ultimately does to the store.
function createCall() {
  act(() => {
    workflowStore.update((w) =>
      setView(addStep(w, newStep({ address: "h:443", tls: false, service: "p.S", method: "M" })), "focus"),
    );
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

  it("renders the workflow env control instead of the static chip", async () => {
    render(<WorkflowApp />);
    expect(screen.queryByText("env: default")).not.toBeInTheDocument();
    expect(await screen.findByText(/No environment/i)).toBeInTheDocument();
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

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/app/WorkflowApp.test.tsx`
Expected: FAIL — the mocked modules (`SidebarShell`, `overview/CollectionOverview`,
`useCatalogTree`) aren't imported by the current `WorkflowApp`, so `open-col`/`OVERVIEW:c1`
never render (and the old `Sidebar`/`ServicePanel` mocks are gone).

- [ ] **Step 3: Rewrite `WorkflowApp.tsx`**

Replace the entire contents of `src/app/WorkflowApp.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Toaster } from "@/components/ui/toaster";
import { FocusView } from "@/features/workflow/FocusView";
import { LedgerView } from "@/features/workflow/LedgerView";
import { ListView } from "@/features/workflow/ListView";
import { ViewSwitcher } from "@/features/workflow/ViewSwitcher";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { WorkflowEnvControl } from "@/features/workflow/WorkflowEnvControl";
import { useActiveWorkflow } from "@/features/workflow/store";
import type { ViewMode } from "@/features/workflow/model";
import { SidebarShell } from "@/features/catalog/SidebarShell";
import { CommandPalette } from "@/features/catalog/CommandPalette";
import { CollectionOverview } from "@/features/catalog/overview/CollectionOverview";
import { useCatalogTree } from "@/features/catalog/useCatalogTree";
import { openSavedRequest } from "@/features/catalog/actions";

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
  // One catalog snapshot for the ⌘K palette + the collection overview. The sidebar keeps its
  // own instance; both reload on their own mutations (overview via onChanged below, palette via
  // the open effect). Unifying them behind a context is a future refactor, not cleanup.
  const cat = useCatalogTree();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelCollectionId, setPanelCollectionId] = useState<string | null>(null);

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

  // Freshen the snapshot whenever the palette opens, so cross-instance edits are searchable.
  useEffect(() => {
    if (paletteOpen) void cat.reload();
  }, [paletteOpen, cat.reload]);

  // Creating a call (sidebar / overview / ⌘K) adds a step and switches the workflow to Focus.
  // Close any open collection overview so the new call is visible.
  useEffect(() => {
    if (wf.activeStepId) setPanelCollectionId(null);
  }, [wf.activeStepId]);

  const panelCollection = panelCollectionId
    ? cat.tree.find((c) => c.id === panelCollectionId) ?? null
    : null;

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
        <SidebarShell onOpenCollection={(id) => setPanelCollectionId(id)} />
        <div className="min-h-0 flex-1">
          {panelCollection ? (
            <CollectionOverview
              collection={panelCollection}
              onChanged={() => void cat.reload()}
              onSelectRequest={(collectionId, req) => openSavedRequest(collectionId, req)}
              onClose={() => setPanelCollectionId(null)}
            />
          ) : (
            renderView(wf.view)
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        collections={cat.tree}
        onOpen={(collectionId, req) => openSavedRequest(collectionId, req)}
      />
      <Toaster />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/app/WorkflowApp.test.tsx`
Expected: PASS — all 5 cases.

- [ ] **Step 5: Confirm no surviving import of the soon-to-be-deleted old UI from live code**

Run: `pnpm exec rg "catalog/(Sidebar|ServicePanel|model)\b" src/app`
Expected: no matches (WorkflowApp no longer imports them).

- [ ] **Step 6: Commit**

```bash
git add src/app/WorkflowApp.tsx src/app/WorkflowApp.test.tsx
git commit -m "feat(app): wire WorkflowApp to SidebarShell + CollectionOverview + real ⌘K (plan-09)"
```

---

### Task 2: Delete old catalog UI components

**Files (delete):**
- `src/features/catalog/Sidebar.tsx` + `src/features/catalog/Sidebar.test.tsx`
- `src/features/catalog/ServicePanel.tsx` + `src/features/catalog/ServicePanel.test.tsx`
- `src/features/catalog/ServiceAuthEditor.tsx` + `src/features/catalog/ServiceAuthEditor.test.tsx`
- `src/features/catalog/AddServiceForm.tsx`

- [ ] **Step 1: Verify these are only imported by each other / their own tests (all being deleted)**

Run: `pnpm exec rg "catalog/(Sidebar|ServicePanel|ServiceAuthEditor|AddServiceForm)\b|from \"\./(Sidebar|ServicePanel|ServiceAuthEditor|AddServiceForm)\"" src`
Expected: matches only inside the four files above and their tests (e.g. `ServicePanel.tsx`
importing `ServiceAuthEditor`, `Sidebar.tsx` importing `AddServiceForm`). No matches under
`src/app`, `src/features/workflow`, or any kept catalog file.

- [ ] **Step 2: Delete the files**

```bash
git rm src/features/catalog/Sidebar.tsx src/features/catalog/Sidebar.test.tsx \
       src/features/catalog/ServicePanel.tsx src/features/catalog/ServicePanel.test.tsx \
       src/features/catalog/ServiceAuthEditor.tsx src/features/catalog/ServiceAuthEditor.test.tsx \
       src/features/catalog/AddServiceForm.tsx
```

- [ ] **Step 3: Run the full suite to verify nothing references the deleted UI**

Run: `pnpm test`
Expected: PASS — the suite shrinks by the deleted test files; no "Cannot find module" /
"is not exported" errors from surviving tests. (`actions.ts`/`fuzzy.ts` still compile — their
old exports are untouched until Tasks 3–4.)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(catalog): delete old service-panel UI (Sidebar/ServicePanel/ServiceAuthEditor/AddServiceForm) (plan-09)"
```

---

### Task 3: Trim `actions.ts` to the new exports only

**Files:**
- Modify: `src/features/catalog/actions.ts`
- Test: `src/features/catalog/actions.test.ts` (remove the old describe blocks + old setup)

- [ ] **Step 1: Trim the test first**

Replace the entire contents of `src/features/catalog/actions.test.ts` with (drops the
`describeService`/`refreshContract`/`openCallFromMethod` blocks and the `catalogStore`/
`createStepFromMethod`/`grpc*` mocks they needed; keeps `openSavedRequest`/`newRequestDraft`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  envActiveSet: vi.fn(),
}));

import { workflowStore } from "@/features/workflow/store";
import { openSavedRequest, newRequestDraft } from "./actions";
import { savedRequestToDraft } from "./mapping";
import type { SavedRequestIpc } from "@/ipc/bindings";

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("openSavedRequest", () => {
  const saved: SavedRequestIpc = {
    id: "req-1", name: "GetX", address_template: "{{host}}:443", service: "p.v1.S",
    method: "GetX", body_template: '{"id":"1"}',
    metadata: [{ key: "x", value: "y", enabled: true }],
    auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
    tls_override: true, last_used_at: null, use_count: 0,
  };

  it("loads a saved request into the draft, binds origin, and switches to Focus", () => {
    openSavedRequest("c1", saved);
    const draft = workflowStore.getState().draft;
    const { id: _draftId, ...draftRest } = draft!;
    const { id: _expectedId, ...expectedRest } = savedRequestToDraft(saved);
    expect(draftRest).toEqual(expectedRest);
    expect(workflowStore.getState().draftOrigin).toEqual({ collectionId: "c1", requestId: "req-1" });
    expect(workflowStore.getState().draftDirty).toBe(false);
    expect(workflowStore.activeWorkflow().view).toBe("focus");
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });
});

describe("newRequestDraft", () => {
  it("sets an empty draft and switches to Focus", () => {
    newRequestDraft();
    const draft = workflowStore.getState().draft;
    expect(draft?.status).toBe("draft");
    expect(draft?.address).toBe("");
    expect(draft?.service).toBe("");
    expect(draft?.method).toBe("");
    expect(workflowStore.activeWorkflow().view).toBe("focus");
    expect(workflowStore.getState().draftOrigin).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: FAIL — `actions.ts` still imports `./store` (`catalogStore`) and `./model`
(`CatalogService`), which are fine now but the test no longer mocks them; more importantly this
step proves the *new* tests run against the trimmed surface. (If it happens to pass because the
old exports still exist, that's acceptable — Step 3 makes the trim real and Step 4 reconfirms.)

- [ ] **Step 3: Trim `actions.ts`**

Replace the entire contents of `src/features/catalog/actions.ts` with:

```ts
import type { SavedRequestIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { setView } from "@/features/workflow/reducers";
import { newStep } from "@/features/workflow/model";
import { savedRequestToDraft } from "./mapping";

/** Open a saved request in Focus as the global pending-draft, bound to its origin. */
export function openSavedRequest(collectionId: string, saved: SavedRequestIpc): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(savedRequestToDraft(saved), { collectionId, requestId: saved.id });
}

/** Start a fresh, empty pending-draft in Focus (header `+` / menu "Add request"). */
export function newRequestDraft(): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(newStep({ address: "", tls: false, service: "", method: "" }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: PASS — both blocks.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/actions.ts src/features/catalog/actions.test.ts
git commit -m "refactor(catalog): trim actions.ts to openSavedRequest/newRequestDraft (plan-09)"
```

---

### Task 4: Trim `fuzzy.ts` to `fuzzyMatch` only

**Files:**
- Modify: `src/features/catalog/fuzzy.ts` (drop `rankServices`/`RankedService` + the
  `CatalogService` import; keep `fuzzyMatch`/`FuzzyResult`)
- Test: `src/features/catalog/fuzzy.test.ts` (remove any `rankServices` describe block)

- [ ] **Step 1: Inspect the test for `rankServices` usage**

Run: `pnpm exec rg "rankServices|RankedService|CatalogService" src/features/catalog/fuzzy.test.ts`
Expected: lists the `rankServices` describe block (and its imports) to remove. If there are **no**
matches, skip the test edit (Step 2) — the test only covers `fuzzyMatch`.

- [ ] **Step 2: Remove the `rankServices` coverage from `fuzzy.test.ts`**

Delete the `import { ... rankServices ... }`/`RankedService`/`CatalogService` references and the
entire `describe("rankServices", …)` block, leaving the `fuzzyMatch` import and its
`describe("fuzzyMatch", …)` block(s) intact. (The exact lines are whatever Step 1 reported; the
file must end importing only `fuzzyMatch`/`FuzzyResult` from `./fuzzy`.)

- [ ] **Step 3: Trim `fuzzy.ts`**

In `src/features/catalog/fuzzy.ts`, delete line 1 (`import type { CatalogService } from "./model";`)
and the trailing `RankedService` interface + `rankServices` function (current lines ~46–67). The
resulting file is exactly:

```ts
export interface FuzzyResult {
  matched: boolean;
  score: number; // higher is better; 0 when query is empty
  indices: number[]; // matched char positions in the target
}

const WORD_BOUNDARY = ".:/_- ";

/**
 * Subsequence fuzzy match with bonuses for prefix, contiguity and word starts.
 * An empty query matches everything with score 0.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return { matched: true, score: 0, indices: [] };

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
    }
    if (found < 0) return { matched: false, score: 0, indices: [] };
    indices.push(found);
    score += 1; // base point per matched char
    if (found === prev + 1) score += 5; // contiguity
    if (found === 0) score += 8; // prefix
    else if (WORD_BOUNDARY.includes(t[found - 1])) score += 3; // word start
    prev = found;
    ti = found + 1;
  }
  score += Math.max(0, 5 - (t.length - q.length) / 4); // prefer tighter targets
  return { matched: true, score, indices };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/features/catalog/fuzzy.test.ts`
Expected: PASS — `fuzzyMatch` coverage only.

- [ ] **Step 5: Confirm `palette.ts` (the live consumer) still resolves `fuzzyMatch`**

Run: `pnpm test src/features/catalog/palette.test.ts`
Expected: PASS — `palette.ts` imports `fuzzyMatch` from the trimmed `./fuzzy`.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/fuzzy.ts src/features/catalog/fuzzy.test.ts
git commit -m "refactor(catalog): trim fuzzy.ts to fuzzyMatch (drop rankServices) (plan-09)"
```

---

### Task 5: Delete old catalog model (`model` / `store` / `tree`)

**Files (delete):**
- `src/features/catalog/model.ts` + `src/features/catalog/model.test.ts`
- `src/features/catalog/store.ts` + `src/features/catalog/store.test.ts`
- `src/features/catalog/tree.ts` + `src/features/catalog/tree.test.ts`

- [ ] **Step 1: Verify no surviving importer (outside the trio + its own tests)**

Run: `pnpm exec rg "catalog/(model|store|tree)\b|from \"\./(model|store|tree)\"" src`
Expected: matches only inside `model.ts`/`store.ts`/`tree.ts` and their three `*.test.ts` files
(e.g. `store.ts` imports `./model`, `tree.ts` imports `./model`). **No** match in `actions.ts`,
`fuzzy.ts`, `palette.ts`, `SidebarShell.tsx`, or any other kept file. (If `rg` flags
`treeEdit`/`treeNav`/`treeTypes`, those are the kept new files — the `\b` after `tree`
excludes them; if your `rg` build still lists them, confirm by eye they are the `tree`-prefixed
*new* modules, not `./tree`.)

- [ ] **Step 2: Delete the files**

```bash
git rm src/features/catalog/model.ts src/features/catalog/model.test.ts \
       src/features/catalog/store.ts src/features/catalog/store.test.ts \
       src/features/catalog/tree.ts src/features/catalog/tree.test.ts
```

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: PASS — no module-resolution errors; the catalog feature now contains only the new
persistent library.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(catalog): delete derived CatalogService model/store/tree (plan-09)"
```

---

### Task 6: Delete the legacy frontend (`App.tsx` + `collections/**` + dead `tabs/**` + dead `invoke/*`)

These must go in **one commit** — `tabs/tabModel.ts` imports `collections/draft` and
`invoke/AuthInline.tsx` imports `collections/overview/EnvVarField`, so deleting `collections/`
alone would leave dangling imports.

**Files (delete):**
- `src/App.tsx`
- `src/features/collections/` (entire directory)
- `src/features/tabs/` (entire directory: `tabModel.ts`, `useTabs.ts`, `RequestTabs.tsx`,
  `CloseConfirm.tsx`)
- `src/features/invoke/AuthInline.tsx`, `src/features/invoke/MetadataView.tsx`,
  `src/features/invoke/RequestPanel.tsx`

**Keep:** `src/features/invoke/BodyEditor.tsx` (live, used by `features/workflow/RequestTabs.tsx`)
and `src/features/invoke/ResolvesPreview.tsx` (pre-existing orphan, out of scope).

- [ ] **Step 1: Verify the live entrypoint does not use `App.tsx`**

Run: `pnpm exec rg "from \"@/App\"|from \"\./App\"|\bApp\b" src/main.tsx`
Expected: `main.tsx` imports `WorkflowApp` only — no reference to `./App`.

- [ ] **Step 2: Verify the only live `invoke` import is `BodyEditor`**

Run: `pnpm exec rg "@/features/invoke/(AuthInline|MetadataView|RequestPanel)" src`
Expected: matches only in `src/App.tsx`, `src/features/invoke/RequestPanel.tsx`, and
`src/features/collections/draft.ts` — all being deleted in this task. No match in
`src/features/workflow/**` or `src/features/catalog/**`.

Run: `pnpm exec rg "@/features/tabs/" src`
Expected: matches only in `src/App.tsx` (being deleted).

- [ ] **Step 3: Delete the files**

```bash
git rm src/App.tsx
git rm -r src/features/collections
git rm -r src/features/tabs
git rm src/features/invoke/AuthInline.tsx src/features/invoke/MetadataView.tsx \
       src/features/invoke/RequestPanel.tsx
```

- [ ] **Step 4: Verify `BodyEditor` survives and has no dangling deps**

Run: `pnpm exec rg "AuthInline|MetadataView|RequestPanel|features/collections|features/tabs" src/features/invoke/BodyEditor.tsx src/features/invoke/ResolvesPreview.tsx`
Expected: no matches (neither kept file depends on a deleted module).

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: PASS — the legacy collections/tabs/invoke test files are gone; no surviving test
imports them. (`features/workflow/RequestTabs.tsx` + `CallPanel.tsx` still import
`invoke/BodyEditor` — those pass.)

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: delete legacy App.tsx shell + collections/tabs/invoke dead code (plan-09)"
```

---

### Task 7: Remove the dangling `authSetForEnv` client wrapper

**Files:**
- Modify: `src/ipc/client.ts` (delete the `authSetForEnv` function + its `ipc` export entry)

The backend command `auth_set_for_env` and DTO `AuthByEnvIpc` were already removed in plan-01
(0 occurrences in `src-tauri/` / `crates/handshaker-core/src/`), and generated `bindings.ts`
no longer declares `commands.authSetForEnv` — so this wrapper is the lone TS compile error
(`Property 'authSetForEnv' does not exist`).

- [ ] **Step 1: Confirm nothing imports the wrapper**

Run: `pnpm exec rg "authSetForEnv" src`
Expected: matches **only** in `src/ipc/client.ts` (the function definition + the `ipc` export
entry). No consumer.

- [ ] **Step 2: Delete the function**

In `src/ipc/client.ts`, remove this block (currently ~lines 173–176):

```ts
export async function authSetForEnv(collectionId: string, itemId: string | null, envName: string, config: SavedAuthConfigIpc | null): Promise<void> {
  const r = await commands.authSetForEnv(collectionId, itemId, envName, config);
  if (r.status === "error") throw r.error;
}
```

- [ ] **Step 3: Remove the `ipc` export entry**

In the `export const ipc = { … }` object, delete the `authSetForEnv,` line (currently ~line 220),
leaving `collectionRestoreItem,` followed directly by `authResolve,`.

- [ ] **Step 4: Verify `SavedAuthConfigIpc` is still imported (used by `authResolve`/`collectionSetNodeAuth`)**

Run: `pnpm exec rg "SavedAuthConfigIpc" src/ipc/client.ts`
Expected: still referenced by `authResolve` and `collectionSetNodeAuth` — its import stays.
(If it became unused, remove it from the import — but it should not.)

- [ ] **Step 5: Run the IPC client tests + a typecheck of the file**

Run: `pnpm test src/ipc`
Expected: PASS — `client.collectionAuth.test.ts` + `client.moveAcross.test.ts` green (neither
touches `authSetForEnv`).

- [ ] **Step 6: Commit**

```bash
git add src/ipc/client.ts
git commit -m "chore(ipc): drop dead authSetForEnv wrapper (auth_set_for_env removed in plan-01) (plan-09)"
```

---

### Task 8: Full verification + finalize the banner

**Files:**
- Modify: this plan file (status banner), `docs/superpowers/plans/2026-06-05-plan-00-index.md`
  (mark plan-09 done)

- [ ] **Step 1: Confirm the backend residue is truly absent (verification-only — no Rust changes)**

Run: `pnpm exec rg "AuthByEnvIpc|auth_set_for_env|authSetForEnv" src-tauri crates/handshaker-core/src`
Expected: **no matches** (plan-01 already removed them; this phase has zero Rust edits).

- [ ] **Step 2: Full front-end test suite**

Run: `pnpm test`
Expected: PASS — green, with the deleted legacy/old test files no longer counted.

- [ ] **Step 3: Typecheck — the 15 pre-existing errors must be gone**

Run: `pnpm lint`
Expected: PASS (exit 0) — the 14 `features/collections/**` errors and the 1 `ipc/client.ts`
error are eliminated by Tasks 6–7. Zero TypeScript errors.

- [ ] **Step 4: Production build (now unblocked)**

Run: `pnpm build`
Expected: SUCCESS — `tsc -b` + Vite bundle complete with no unresolved imports. (This is the
gate plan-08 noted as blocked by the legacy errors.)

- [ ] **Step 5: Rust suites (regression guard — should be unchanged)**

Run: `cargo test -p handshaker-core`
Then: `cargo test -p handshaker`
Expected: PASS — unchanged from plan-08 (no backend edits this phase).

- [ ] **Step 6: Finalize the plan banner + index**

Update this file's **Status** line to `✅ done` with the commit range and a one-line summary of
suite counts (front-end test count, `pnpm lint`/`pnpm build` green, Rust unchanged), mirroring
the plan-08 banner style. Note the deferred **Save-flow + dirty-confirm follow-up** as the only
remaining redesign work.

In `docs/superpowers/plans/2026-06-05-plan-00-index.md`, change the plan-09 row Status from
`outline` to `✅ done` with the commit range.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-06-05-plan-09-cleanup.md docs/superpowers/plans/2026-06-05-plan-00-index.md
git commit -m "docs(plan-09): mark cleanup complete; update index row (plan-09)"
```

---

## Self-review (run against spec §16.8 before executing)

- **Spec coverage:** §16.8 lists `CatalogService` (Task 5 + Tasks 3–4 trims) · `ServicePanel`
  (Task 2) · `ServiceAuthEditor` (Task 2) · `AddServiceForm` (Task 2) · `catalog tree/store`
  (Task 5) · legacy `collections/` front (Task 6) · old `App.tsx` (Task 6) ·
  `AuthByEnvIpc`/`auth_set_for_env` (already gone — Task 7 removes the lone TS wrapper, Task 8
  verifies) · update `WorkflowApp` (Task 1). ✅ all mapped.
- **Discovered scope beyond the one-line outline** (handled so the build stays green):
  transitive-dead `tabs/**` + `invoke/{AuthInline,MetadataView,RequestPanel}` (Task 6); the
  mixed files `actions.ts`/`fuzzy.ts` are trimmed not deleted (Tasks 3–4). The Save-flow +
  dirty-confirm integration is explicitly **deferred** (see the Scope decision section).
- **Type consistency:** `openSavedRequest(collectionId, req)` signature is identical across
  `actions.ts`, `SidebarShell`, `CommandPalette.onOpen`, and `CollectionOverview.onSelectRequest`.
  `CollectionOverview` props used in Task 1 (`collection`/`onChanged`/`onSelectRequest`/`onClose`)
  match `overview/CollectionOverview.tsx`. `CommandPalette` props (`open`/`onClose`/`collections`/
  `onOpen`) match `CommandPalette.tsx`. `useCatalogTree()` exposes `tree`/`reload`/`loading`/
  `error` as used.
- **No placeholders:** every edit step shows the full resulting file; every delete step shows the
  exact `git rm` + a grep that proves importer-freedom; every command has an expected result.
```