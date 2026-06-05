# Plan 06 — Create/Save flow: draft origin+dirty, reflection+MethodPicker+skeleton in Focus, SaveRequestDialog (path hint, Save/Save As, origin-bound autosave), open-over-dirty confirm

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking. **Detail is TDD-complete** — execute
> task-by-task.

**Status:** 📝 **detailed — ready to execute** (outline → full TDD; nothing implemented yet).
**Branch:** `redesign/workflow-ui-spec-plans`
**Phase:** 5 of spec §16 (`docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`),
spec §6 (Создание и сохранение) + §10 (Reflection) + §15-table rows.
**Predecessors:** plan-01 (`cadaccd..625241b`), plan-02 (`41d29bf..0a33cae`),
plan-03 (`7b1b885..2903c8a`), plan-04 (`0381a9d..5e3d896`), plan-05 (`65d8c96..f813bf9`) —
all ✅ done. This plan builds the **request-first create/save flow** on top of the global
pending-draft (plan-04), the pure `mapping.ts`/`grouping.ts` (plan-03), and the sidebar +
`useCatalogTree` (plan-05).

**Goal:** Make a draft openable, reflectable, sendable, and **savable**: bind an opened
saved request to its origin (collection+id), track `dirty` for unbound drafts, reflect the
contract from the host (debounced + manual refresh) and pick a method via `MethodPicker`
with an auto-generated body skeleton, **Save** a new request into a chosen collection/folder
(with a suggested `Host > Service` path hint and "already saved in" hints), **autosave** an
origin-bound request on every content edit, **Save As** a copy, and **confirm** before
discarding a dirty unbound draft when opening another request.

**Architecture:** Origin + dirty live in the existing `workflowStore` next to the global
`draft` (`draftOrigin: {collectionId, requestId} | null`, `draftDirty: boolean`); `dirty`
flips only on **content** patches of an **unbound** draft. Reflection is a presentational-free
hook `useDraftReflection` (debounced `grpcDescribe` + manual `grpcRefreshContract`). The
editable Focus header is a new presentational `DraftAddressBar` (host `Input` + refresh +
`MethodPicker` + Send/Cancel); `CallPanel` gains an `editable` flag that swaps the read-only
`AddressBar` for it and wires `applyMethodSelection` (patch service/method + fetch skeleton).
Persistence reuses **existing** IPC only (`collectionAddItem` for new, `collectionUpsert` for
autosave via a new pure `replaceItemInTree` + `useCatalogTree.updateItemContent`) — there is
**no** update-item command and we do **not** add one. The Save UI is a ported, hint-augmented
`SaveRequestDialog`; discard-confirm is a pure `needsDiscardConfirm` + a `DiscardDraftDialog`.

**Wiring scope (mirrors plan-05):** This plan delivers fully unit-tested building blocks +
the `CallPanel`/`FocusView` edits. **Top-level shell glue is plan-09:** the live `Ctrl+S`
hotkey, the debounced autosave *effect*, and the click-interception that shows
`DiscardDraftDialog` before `openSavedRequest`/`newRequestDraft` are wired when `WorkflowApp`
is assembled and the legacy shell deleted (plan-09). Gate here = `pnpm test` + targeted
`pnpm lint` (repo-wide `tsc -b`/`pnpm build` stay blocked by the 15 pre-existing legacy
errors removed in plan-09 — confirm **zero new** errors under `features/{catalog,workflow}`).

**Tech Stack:** TypeScript, React 18, Vitest + Testing Library (`renderHook`/`render`/
`screen`/`fireEvent`/`act`/`waitFor`, fake timers), lucide-react, `@/` path alias (= `src/`).

## Build / test commands (repo root, PowerShell)

- Single test file: `pnpm test src/features/<path>.test.ts`
- All front-end tests: `pnpm test`
- Typecheck: `pnpm lint` (`tsc -b`) · Prod build: `pnpm build`

## Design notes (decisions locked from spec §6, §7, §10, §15-table)

1. **Origin & dirty in the store** (spec §6 «`dirty` актуально только для несвязанного
   draft»; «origin-bound автосейв»): `draft` keeps living in `workflowStore`; add
   `draftOrigin` (the bound saved-request location, or `null` = unbound) and `draftDirty`.
   `setDraft(step, origin = null)` resets `draftDirty=false`. `updateDraft(patch)` sets
   `draftDirty=true` **only when the draft is unbound and the patch touches a content field**
   (`address`/`tls`/`service`/`method`/`auth`/`requestJson`/`metadata`) — never on transient
   `status`/`outcome`/`error`/`requestId` patches (so Send never marks a draft dirty).
2. **Open binds origin** (spec §6, §3): `openSavedRequest(collectionId, saved)` binds
   `origin = { collectionId, requestId: saved.id }`; `newRequestDraft`/`openCallFromMethod`
   stay unbound. `SidebarShell` already threads `collectionId` into `onOpenRequest`.
3. **No update-item IPC** (confirmed: bindings expose only `collectionAddItem`/`RenameItem`/
   `MoveItem`/`DuplicateItem`/`DeleteItem`/`RestoreItem`/`Upsert`). Therefore origin-bound
   autosave of body/address/metadata/method/auth/tls **reconstructs** the owning collection
   (pure `replaceItemInTree`, preserving `id`/`name`/`last_used_at`/`use_count`) and
   `collectionUpsert`s it. New-request save uses `collectionAddItem`. **No backend change.**
4. **Reflection** (spec §6/§10): `useDraftReflection(address, tls, enabled)` debounces
   `grpcDescribe` ~400ms after the address settles **and** exposes `refresh()` →
   `grpcRefreshContract` (immediate, bypasses cache). Empty address ⇒ no call, no catalog.
   No reflection (reject) ⇒ `error` shown; manual service/method entry is **out of scope**.
5. **Skeleton** (spec §6 «авто-скелет тела из дескриптора»): selecting a method patches
   `service`/`method` then fetches `grpcBuildRequestSkeleton` (via `buildRequestSkeletonSafe`,
   falling back to `"{}"`) and patches `requestJson`. `createStepFromMethod` is refactored to
   reuse the same helper (DRY).
6. **Editable header** (spec §6): `CallPanel` gains `editable?: boolean`; `FocusView` passes
   `editable`. When editable it renders `DraftAddressBar` (host `Input`, refresh button,
   `MethodPicker` when a catalog is loaded, reflect status/error otherwise, Send disabled
   until a method is chosen). History (List/Ledger) keeps the read-only `AddressBar`.
7. **Save dialog** (spec §6 «как Postman; папки руками + подсказка пути; имя=method; дубли
   ок»): port the proven legacy `collections/SaveRequestDialog.tsx` into `catalog/` and add a
   **path hint** — `suggestSavePath(address, service)` (`Host > Service`) and
   `findSavedLocations(...)` ("Already saved in …"). Default name = the draft's `method`.
   Auto-creating folders is **not** done; duplicates are allowed.
8. **Save vs Save As** (spec §6): a new/unbound draft `Save` → `collectionAddItem` then bind
   origin (`setDraftOrigin`). An origin-bound draft autosaves on edit; **Save As** re-opens
   the dialog with `originBound={false}` to create a copy (and rebinds origin to the copy).
9. **Open-over-dirty confirm** (spec §6 «confirm (заменить/сохранить?)»): pure
   `needsDiscardConfirm(origin, dirty) = origin === null && dirty`. `DiscardDraftDialog`
   offers **Cancel / Save… / Discard**. Origin-bound drafts never prompt (already autosaved).
10. **No new backend / no new IPC wrappers.** Everything uses already-wrapped client calls
    (`grpcDescribe`/`grpcRefreshContract`/`grpcBuildRequestSkeleton`/`collectionAddItem`/
    `collectionUpsert`/`collectionGet`). `collectionBumpUsage`/`collectionSetNodeAuth` exist
    in bindings but their wrapping + Send/auth wiring are **out of scope** (later phases).

## File structure (boundaries)

- Modify `src/features/workflow/store.ts` (+ `store.test.ts`) — `DraftOrigin`, `draftOrigin`,
  `draftDirty`, `setDraft(step, origin?)`, `updateDraft` dirty rule, `setDraftOrigin`,
  `clearDraft` reset, `useDraftOrigin`/`useDraftDirty`.
- Modify `src/features/catalog/actions.ts` (+ `actions.test.ts`) — `openSavedRequest(collectionId, saved)`.
- Modify `src/features/catalog/SidebarShell.tsx` — pass `collectionId` through (1-line).
- Modify `src/features/catalog/treeEdit.ts` (+ `treeEdit.test.ts`) — `replaceItemInTree`.
- Modify `src/features/catalog/useCatalogTree.ts` (+ `useCatalogTree.test.ts`) — `updateItemContent`.
- Create `src/features/catalog/save.ts` (+ `save.test.ts`) — `saveNewRequest`, `autosaveDraft`.
- Modify `src/features/workflow/actions.ts` (+ `actions.test.ts`) — `buildRequestSkeletonSafe`,
  `applyMethodSelection`; refactor `createStepFromMethod` to reuse the helper.
- Create `src/features/workflow/useDraftReflection.ts` (+ `useDraftReflection.test.ts`).
- Create `src/features/workflow/DraftAddressBar.tsx` (+ `DraftAddressBar.test.tsx`).
- Modify `src/features/workflow/CallPanel.tsx` (+ `CallPanel.editable.test.tsx`) and
  `src/features/workflow/FocusView.tsx` — `editable` wiring.
- Create `src/features/catalog/SaveRequestDialog.tsx` (+ `SaveRequestDialog.test.tsx`).
- Create `src/features/catalog/DiscardDraftDialog.tsx` (+ `DiscardDraftDialog.test.tsx`) and
  `src/features/catalog/discardGuard.ts` (+ `discardGuard.test.ts`) — `needsDiscardConfirm`.

---

### Task 1: `workflowStore` — draft `origin` + `dirty`

**Files:**
- Modify: `src/features/workflow/store.ts`
- Test: `src/features/workflow/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/workflow/store.test.ts` (the file already `import`s `workflowStore`,
`newStep`, and resets in `beforeEach`):

```ts
import { isContentPatch } from "./store";

describe("draft origin + dirty", () => {
  beforeEach(() => workflowStore.reset());

  it("starts unbound and clean", () => {
    expect(workflowStore.getState().draftOrigin).toBeNull();
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("setDraft(step) leaves it unbound and clean", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    expect(workflowStore.getState().draftOrigin).toBeNull();
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("setDraft(step, origin) binds the origin and is clean", () => {
    const origin = { collectionId: "c1", requestId: "r1" };
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }), origin);
    expect(workflowStore.getState().draftOrigin).toEqual(origin);
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("content edits on an UNBOUND draft set dirty", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    workflowStore.updateDraft({ requestJson: '{"a":1}' });
    expect(workflowStore.getState().draftDirty).toBe(true);
  });

  it("transient (non-content) edits never set dirty", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    workflowStore.updateDraft({ status: "sending", requestId: "req-1" });
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("content edits on a BOUND draft do NOT set dirty (autosave path)", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }), {
      collectionId: "c1", requestId: "r1",
    });
    workflowStore.updateDraft({ requestJson: '{"a":1}' });
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("setDraftOrigin binds and clears dirty (used after Save)", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    workflowStore.updateDraft({ requestJson: '{"a":1}' }); // dirty now
    workflowStore.setDraftOrigin({ collectionId: "c1", requestId: "r1" });
    expect(workflowStore.getState().draftOrigin).toEqual({ collectionId: "c1", requestId: "r1" });
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("clearDraft resets origin and dirty", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }), {
      collectionId: "c1", requestId: "r1",
    });
    workflowStore.clearDraft();
    expect(workflowStore.getState().draftOrigin).toBeNull();
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("isContentPatch detects content vs transient keys", () => {
    expect(isContentPatch({ requestJson: "x" })).toBe(true);
    expect(isContentPatch({ metadata: [] })).toBe(true);
    expect(isContentPatch({ address: "h" })).toBe(true);
    expect(isContentPatch({ status: "ok" })).toBe(false);
    expect(isContentPatch({ requestId: "r" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/workflow/store.test.ts`
Expected: FAIL — `draftOrigin`/`draftDirty`/`setDraftOrigin`/`isContentPatch` do not exist.

- [ ] **Step 3: Implement**

In `src/features/workflow/store.ts`:

(a) Add the origin type + content-key helper near the top (after the imports):

```ts
export interface DraftOrigin {
  collectionId: string;
  requestId: string;
}

const CONTENT_KEYS = ["address", "tls", "service", "method", "auth", "requestJson", "metadata"] as const;

/** True when a draft patch changes saved content (so an unbound draft becomes dirty). */
export function isContentPatch(patch: Partial<Step>): boolean {
  return CONTENT_KEYS.some((k) => k in patch);
}
```

(b) Extend `WorkflowState`:

```ts
export interface WorkflowState {
  workflows: Workflow[];
  activeWorkflowId: string;
  draft: Step | null;
  draftOrigin: DraftOrigin | null;
  draftDirty: boolean;
}
```

(c) Extend `initialState()`:

```ts
  return { workflows: [wf], activeWorkflowId: wf.id, draft: null, draftOrigin: null, draftDirty: false };
```

(d) Replace `setDraft`, `updateDraft`, `clearDraft` and add `setDraftOrigin`:

```ts
  setDraft(step: Step | null, origin: DraftOrigin | null = null) {
    state = { ...state, draft: step, draftOrigin: origin, draftDirty: false };
    emit();
  },
  setDraftOrigin(origin: DraftOrigin | null) {
    state = { ...state, draftOrigin: origin, draftDirty: false };
    emit();
  },
  updateDraft(patch: Partial<Step>) {
    if (!state.draft) return;
    const dirty =
      state.draftDirty || (state.draftOrigin === null && isContentPatch(patch));
    state = { ...state, draft: { ...state.draft, ...patch }, draftDirty: dirty };
    emit();
  },
  clearDraft() {
    state = { ...state, draft: null, draftOrigin: null, draftDirty: false };
    emit();
  },
```

(e) Add subscribing hooks at the end of the file (next to `useDraft`):

```ts
export function useDraftOrigin(): DraftOrigin | null {
  useWorkflowState(); // subscribe
  return workflowStore.getState().draftOrigin;
}

export function useDraftDirty(): boolean {
  useWorkflowState(); // subscribe
  return workflowStore.getState().draftDirty;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/workflow/store.test.ts`
Expected: PASS — new blocks green; existing "global pending-draft" tests still green
(`setDraft(d)` with the new default `origin` keeps `draft === d`).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/store.ts src/features/workflow/store.test.ts
git commit -m "feat(workflow): draft origin + dirty in store (plan-06)"
```

---

### Task 2: `openSavedRequest(collectionId, saved)` binds origin

**Files:**
- Modify: `src/features/catalog/actions.ts`
- Modify: `src/features/catalog/SidebarShell.tsx`
- Test: `src/features/catalog/actions.test.ts`

- [ ] **Step 1: Update the failing test**

In `src/features/catalog/actions.test.ts`, replace the existing `describe("openSavedRequest", …)`
block with:

```ts
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
```

Also confirm the existing `newRequestDraft` block still asserts unbound — append one line to it:

```ts
    expect(workflowStore.getState().draftOrigin).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: FAIL — `openSavedRequest` takes one arg / does not set `draftOrigin`.

- [ ] **Step 3: Implement**

In `src/features/catalog/actions.ts`, replace `openSavedRequest`:

```ts
/** Open a saved request in Focus as the global pending-draft, bound to its origin. */
export function openSavedRequest(collectionId: string, saved: SavedRequestIpc): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(savedRequestToDraft(saved), { collectionId, requestId: saved.id });
}
```

In `src/features/catalog/SidebarShell.tsx` (line ~108), update the wiring to pass the id:

```tsx
        onOpenRequest={(collectionId, req) => openSavedRequest(collectionId, req)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: PASS. Then `pnpm test src/features/catalog/SidebarShell.test.tsx` — still green
(the click still routes to `openSavedRequest`; only the arg count changed).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/actions.ts src/features/catalog/SidebarShell.tsx src/features/catalog/actions.test.ts
git commit -m "feat(catalog): openSavedRequest binds draft origin (plan-06)"
```

---

### Task 3: `replaceItemInTree` — pure content swap (preserve id/name/usage)

**Files:**
- Modify: `src/features/catalog/treeEdit.ts`
- Test: `src/features/catalog/treeEdit.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/catalog/treeEdit.test.ts` (factories `req`/`folder`/`col` already
exist there):

```ts
import { replaceItemInTree } from "./treeEdit";
import type { SavedRequestIpc } from "@/ipc/bindings";

describe("replaceItemInTree", () => {
  it("swaps content fields but preserves id, name, and usage", () => {
    const tree = [col("c1", [folder("f1", [req("r2", "Original")])])];
    // give the original some usage to prove it is preserved
    const f1 = tree[0].items[0] as Extract<ItemIpc, { type: "folder" }>;
    (f1.items[0] as Extract<ItemIpc, { type: "request" }>).use_count = 7;
    (f1.items[0] as Extract<ItemIpc, { type: "request" }>).last_used_at = 123;

    const content: SavedRequestIpc = {
      id: "ignored", name: "ignored", address_template: "new:443", service: "p.v2.S",
      method: "NewM", body_template: '{"b":2}',
      metadata: [{ key: "k", value: "v", enabled: false }],
      auth: { kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer " },
      tls_override: true, last_used_at: null, use_count: 0,
    };
    const after = replaceItemInTree(tree, "c1", "r2", content);
    const target = (after[0].items[0] as Extract<ItemIpc, { type: "folder" }>).items[0] as Extract<
      ItemIpc, { type: "request" }
    >;
    expect(target.id).toBe("r2"); // preserved
    expect(target.name).toBe("Original"); // preserved
    expect(target.use_count).toBe(7); // preserved
    expect(target.last_used_at).toBe(123); // preserved
    expect(target.address_template).toBe("new:443"); // swapped
    expect(target.service).toBe("p.v2.S");
    expect(target.method).toBe("NewM");
    expect(target.body_template).toBe('{"b":2}');
    expect(target.metadata).toEqual([{ key: "k", value: "v", enabled: false }]);
    expect(target.tls_override).toBe(true);
    expect(target.type).toBe("request");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/treeEdit.test.ts`
Expected: FAIL — `replaceItemInTree` not exported.

- [ ] **Step 3: Implement**

In `src/features/catalog/treeEdit.ts`, add the import and the function (reusing the existing
`mapCollection`/`mapItemsDeep` helpers):

```ts
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
```

```ts
/** Swap a saved request's content fields in place, preserving id/name/usage/type. */
export function replaceItemInTree(
  tree: CollectionIpc[],
  collectionId: string,
  itemId: string,
  content: SavedRequestIpc,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({
    ...c,
    items: mapItemsDeep(c.items, itemId, (it) => {
      if (it.type !== "request") return it;
      return {
        ...it,
        address_template: content.address_template,
        service: content.service,
        method: content.method,
        body_template: content.body_template,
        metadata: content.metadata,
        auth: content.auth,
        tls_override: content.tls_override,
      };
    }),
  }));
}
```

(The existing top-of-file import is `import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";`
— change it to also import `SavedRequestIpc` rather than adding a second import line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/treeEdit.test.ts`
Expected: PASS (existing transforms still green).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/treeEdit.ts src/features/catalog/treeEdit.test.ts
git commit -m "feat(catalog): replaceItemInTree — content swap preserving id/name/usage (plan-06)"
```

---

### Task 4: `useCatalogTree.updateItemContent` — optimistic autosave via upsert

**Files:**
- Modify: `src/features/catalog/useCatalogTree.ts`
- Test: `src/features/catalog/useCatalogTree.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/catalog/useCatalogTree.test.ts` (inside the existing
`describe("optimistic mutations + rollback", …)`, reusing the `loaded()` helper which seeds
collection `c1` with request `r1`):

```ts
  it("updateItemContent replaces content optimistically and upserts the collection", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    const content = {
      id: "r1", name: "ignored", address_template: "new:443", service: "p.v2.S", method: "NewM",
      body_template: '{"b":2}', metadata: [], auth: { kind: "none" as const },
      tls_override: null, last_used_at: null, use_count: 0,
    };
    await act(async () => { await result.current.updateItemContent("c1", "r1", content); });
    const item = result.current.tree[0].items[0] as Extract<typeof content & { type: "request" }, { type: "request" }>;
    expect(item.method).toBe("NewM");
    expect(item.name).toBe("r1"); // preserved from the original
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }),
    );
  });

  it("updateItemContent rolls back when the upsert rejects", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockRejectedValue({ message: "disk full" });
    const content = {
      id: "r1", name: "x", address_template: "new", service: "S", method: "NewM",
      body_template: "{}", metadata: [], auth: { kind: "none" as const },
      tls_override: null, last_used_at: null, use_count: 0,
    };
    await act(async () => {
      await expect(result.current.updateItemContent("c1", "r1", content)).rejects.toBeTruthy();
    });
    const item = result.current.tree[0].items[0] as Extract<{ type: "request"; method: string }, { type: "request" }>;
    expect(item.method).toBe("m"); // reverted to the seeded value
    expect(result.current.error).toBe("disk full");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/useCatalogTree.test.ts`
Expected: FAIL — `updateItemContent` does not exist.

- [ ] **Step 3: Implement**

In `src/features/catalog/useCatalogTree.ts`:

(a) Add to the `treeEdit` import list: `replaceItemInTree`.
(b) Add `SavedRequestIpc` to the `@/ipc/bindings` type import.
(c) Add to the `UseCatalogTree` interface:

```ts
  updateItemContent: (collectionId: string, itemId: string, content: SavedRequestIpc) => Promise<void>;
```

(d) Add the implementation (next to `renameItem`), and include it in the returned object:

```ts
  const updateItemContent = useCallback(
    (collectionId: string, itemId: string, content: SavedRequestIpc) =>
      optimistic(
        (prev) => replaceItemInTree(prev, collectionId, itemId, content),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
      ),
    [optimistic],
  );
```

Add `updateItemContent` to the final `return { … }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/useCatalogTree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/useCatalogTree.ts src/features/catalog/useCatalogTree.test.ts
git commit -m "feat(catalog): useCatalogTree.updateItemContent — optimistic autosave via upsert (plan-06)"
```

---

### Task 5: `catalog/save.ts` — `saveNewRequest` + `autosaveDraft`

**Files:**
- Create: `src/features/catalog/save.ts`
- Test: `src/features/catalog/save.test.ts`

Pure orchestration over injected mutators (so they are unit-testable without IPC). The caller
binds origin after `saveNewRequest` returns the new id.

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/save.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { newStep } from "@/features/workflow/model";
import { saveNewRequest, autosaveDraft } from "./save";

const draft = newStep({
  address: "h:443", tls: true, service: "p.v1.S", method: "GetX", requestJson: '{"id":"1"}',
  metadata: [{ key: "k", value: "v", enabled: true }],
  auth: { kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer " },
});

describe("saveNewRequest", () => {
  it("mints an id, builds a request item, adds it, and returns the id", async () => {
    const addItem = vi.fn().mockResolvedValue(undefined);
    const id = await saveNewRequest(addItem, draft, { collectionId: "c1", parentId: "f1", name: "My call" });
    expect(typeof id).toBe("string");
    expect(addItem).toHaveBeenCalledTimes(1);
    const [collectionId, parentId, item] = addItem.mock.calls[0];
    expect(collectionId).toBe("c1");
    expect(parentId).toBe("f1");
    expect(item.type).toBe("request");
    expect(item.id).toBe(id);
    expect(item.name).toBe("My call");
    expect(item.address_template).toBe("h:443");
    expect(item.service).toBe("p.v1.S");
    expect(item.method).toBe("GetX");
    expect(item.body_template).toBe('{"id":"1"}');
    expect(item.metadata).toEqual([{ key: "k", value: "v", enabled: true }]);
    expect(item.tls_override).toBe(true);
  });
});

describe("autosaveDraft", () => {
  it("rebuilds content from the draft and updates the origin item", async () => {
    const updateItemContent = vi.fn().mockResolvedValue(undefined);
    await autosaveDraft(updateItemContent, { collectionId: "c1", requestId: "r1" }, draft);
    expect(updateItemContent).toHaveBeenCalledTimes(1);
    const [collectionId, itemId, content] = updateItemContent.mock.calls[0];
    expect(collectionId).toBe("c1");
    expect(itemId).toBe("r1");
    expect(content.id).toBe("r1");
    expect(content.method).toBe("GetX");
    expect(content.body_template).toBe('{"id":"1"}');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/save.test.ts`
Expected: FAIL — module `./save` not found.

- [ ] **Step 3: Implement**

Create `src/features/catalog/save.ts`:

```ts
import type { ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import type { Step } from "@/features/workflow/model";
import type { DraftOrigin } from "@/features/workflow/store";
import { newId } from "@/lib/ids";
import { stepToSavedRequest } from "./mapping";

/** Persist an unbound draft as a NEW saved request. Returns the new request id so the
 *  caller can bind the draft origin. `addItem` is `useCatalogTree.addItem`. */
export async function saveNewRequest(
  addItem: (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>,
  draft: Step,
  dest: { collectionId: string; parentId: string | null; name: string },
): Promise<string> {
  const id = newId();
  const saved = stepToSavedRequest(draft, { id, name: dest.name });
  await addItem(dest.collectionId, dest.parentId, { type: "request", ...saved });
  return id;
}

/** Persist edits to an origin-bound draft. `updateItemContent` preserves id/name/usage, so
 *  the `name` passed here is irrelevant (placeholder). `updateItemContent` is the hook method. */
export async function autosaveDraft(
  updateItemContent: (collectionId: string, itemId: string, content: SavedRequestIpc) => Promise<void>,
  origin: DraftOrigin,
  draft: Step,
): Promise<void> {
  const content = stepToSavedRequest(draft, { id: origin.requestId, name: "" });
  await updateItemContent(origin.collectionId, origin.requestId, content);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/save.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/save.ts src/features/catalog/save.test.ts
git commit -m "feat(catalog): save.ts — saveNewRequest + autosaveDraft (plan-06)"
```

---

### Task 6: `buildRequestSkeletonSafe` + `applyMethodSelection` (workflow actions)

**Files:**
- Modify: `src/features/workflow/actions.ts`
- Test: `src/features/workflow/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/workflow/actions.test.ts` (it already `vi.mock`s `@/ipc/client`; ensure
the mock object includes `grpcBuildRequestSkeleton: vi.fn()` — add it if absent):

```ts
import { buildRequestSkeletonSafe, applyMethodSelection } from "./actions";

describe("buildRequestSkeletonSafe", () => {
  it("returns the backend skeleton on success", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue('{"id":""}');
    const out = await buildRequestSkeletonSafe({ address: "h:443", tls: true }, "p.S", "M");
    expect(out).toBe('{"id":""}');
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false }, "p.S", "M",
    );
  });

  it("falls back to '{}' when reflection/skeleton fails", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockRejectedValue(new Error("nope"));
    expect(await buildRequestSkeletonSafe({ address: "h", tls: false }, "p.S", "M")).toBe("{}");
  });
});

describe("applyMethodSelection", () => {
  it("patches service/method first, then the fetched skeleton", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue('{"a":""}');
    const patch = vi.fn();
    await applyMethodSelection(patch, { address: "h:443", tls: true }, { service: "p.S", method: "M" });
    expect(patch).toHaveBeenNthCalledWith(1, { service: "p.S", method: "M" });
    expect(patch).toHaveBeenNthCalledWith(2, { requestJson: '{"a":""}' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/workflow/actions.test.ts`
Expected: FAIL — `buildRequestSkeletonSafe`/`applyMethodSelection` not exported.

- [ ] **Step 3: Implement**

In `src/features/workflow/actions.ts`, add the helpers and refactor `createStepFromMethod`
to reuse `buildRequestSkeletonSafe`:

```ts
/** Fetch a request-body skeleton for a method; never throws — falls back to "{}". */
export async function buildRequestSkeletonSafe(
  target: CallTargetInit,
  service: string,
  method: string,
): Promise<string> {
  try {
    return await ipc.grpcBuildRequestSkeleton(
      { address: target.address, tls: target.tls, skip_verify: false },
      service,
      method,
    );
  } catch {
    return "{}";
  }
}

/** MethodPicker handler for an editable draft: patch service/method, then the new skeleton. */
export async function applyMethodSelection(
  patch: (p: Partial<Step>) => void,
  target: CallTargetInit,
  m: { service: string; method: string },
): Promise<void> {
  patch({ service: m.service, method: m.method });
  const requestJson = await buildRequestSkeletonSafe(target, m.service, m.method);
  patch({ requestJson });
}
```

Then in `createStepFromMethod`, replace the inline `try { … } catch { … }` skeleton block with:

```ts
  const requestJson = await buildRequestSkeletonSafe(target, service, method);
```

(removing the now-dead `let requestJson = "{}"` + try/catch).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/workflow/actions.test.ts`
Expected: PASS (existing `createStepFromMethod`/`sendStep` tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/actions.ts src/features/workflow/actions.test.ts
git commit -m "feat(workflow): buildRequestSkeletonSafe + applyMethodSelection (plan-06)"
```

---

### Task 7: `useDraftReflection` — debounced describe + manual refresh

**Files:**
- Create: `src/features/workflow/useDraftReflection.ts`
- Test: `src/features/workflow/useDraftReflection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/workflow/useDraftReflection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/ipc/client", () => ({
  grpcDescribe: vi.fn(),
  grpcRefreshContract: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { useDraftReflection } from "./useDraftReflection";

const cat = { services: [{ full_name: "p.v1.S", methods: [] }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.grpcDescribe).mockResolvedValue(cat as never);
  vi.mocked(ipc.grpcRefreshContract).mockResolvedValue(cat as never);
});
afterEach(() => vi.useRealTimers());

describe("useDraftReflection", () => {
  it("describes ~400ms after the address settles", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDraftReflection("h:443", true));
    expect(ipc.grpcDescribe).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(ipc.grpcDescribe).toHaveBeenCalledWith({ address: "h:443", tls: true, skip_verify: false });
    expect(result.current.catalog).toEqual(cat);
  });

  it("does not reflect when the address is empty", async () => {
    vi.useFakeTimers();
    renderHook(() => useDraftReflection("   ", false));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(ipc.grpcDescribe).not.toHaveBeenCalled();
  });

  it("does not reflect when disabled", async () => {
    vi.useFakeTimers();
    renderHook(() => useDraftReflection("h:443", true, false));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(ipc.grpcDescribe).not.toHaveBeenCalled();
  });

  it("refresh() force-refreshes immediately", async () => {
    const { result } = renderHook(() => useDraftReflection("h:443", false));
    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(ipc.grpcRefreshContract).toHaveBeenCalled());
    expect(result.current.catalog).toEqual(cat);
  });

  it("sets error and clears catalog when reflection rejects", async () => {
    vi.mocked(ipc.grpcRefreshContract).mockRejectedValue({ message: "no reflection" });
    const { result } = renderHook(() => useDraftReflection("h:443", false));
    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(result.current.error).toBe("no reflection"));
    expect(result.current.catalog).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/workflow/useDraftReflection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/features/workflow/useDraftReflection.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import * as ipc from "@/ipc/client";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

const DEBOUNCE_MS = 400;

export interface DraftReflection {
  catalog: ServiceCatalogIpc | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function reflectErr(e: unknown): string {
  const t = e as { message?: string };
  return t?.message ?? "No reflection available at this address";
}

/** Reflect a draft's contract: debounced `grpcDescribe` on (address, tls) change, plus a
 *  manual `refresh()` that bypasses the backend cache via `grpcRefreshContract`. */
export function useDraftReflection(address: string, tls: boolean, enabled = true): DraftReflection {
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (force: boolean) => {
      const addr = address.trim();
      if (!enabled || !addr) {
        setCatalog(null);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const target = { address: addr, tls, skip_verify: false };
        const c = force ? await ipc.grpcRefreshContract(target) : await ipc.grpcDescribe(target);
        setCatalog(c);
      } catch (e) {
        setCatalog(null);
        setError(reflectErr(e));
      } finally {
        setLoading(false);
      }
    },
    [address, tls, enabled],
  );

  useEffect(() => {
    if (!enabled || !address.trim()) return;
    const t = setTimeout(() => void run(false), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [run, enabled, address]);

  const refresh = useCallback(() => void run(true), [run]);

  return { catalog, loading, error, refresh };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/workflow/useDraftReflection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/useDraftReflection.ts src/features/workflow/useDraftReflection.test.ts
git commit -m "feat(workflow): useDraftReflection — debounced describe + refresh (plan-06)"
```

---

### Task 8: `DraftAddressBar` — editable host + refresh + MethodPicker

**Files:**
- Create: `src/features/workflow/DraftAddressBar.tsx`
- Test: `src/features/workflow/DraftAddressBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/workflow/DraftAddressBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DraftAddressBar } from "./DraftAddressBar";
import { newStep } from "./model";

const base = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });
const cat = { services: [{ full_name: "p.v1.S", methods: [
  { name: "GetX", path: "/p.v1.S/GetX", input_message: "Req", output_message: "Res",
    client_streaming: false, server_streaming: false },
] }] };

function props(over = {}) {
  return {
    step: base, catalog: null, reflecting: false, reflectError: null,
    onAddress: vi.fn(), onRefresh: vi.fn(), onSelectMethod: vi.fn(),
    onSend: vi.fn(), onCancel: vi.fn(), ...over,
  };
}

describe("DraftAddressBar", () => {
  it("edits the address", () => {
    const p = props();
    render(<DraftAddressBar {...p} />);
    fireEvent.change(screen.getByLabelText("draft-address"), { target: { value: "newhost:8080" } });
    expect(p.onAddress).toHaveBeenCalledWith("newhost:8080");
  });

  it("fires refresh", () => {
    const p = props();
    render(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByLabelText("refresh-reflection"));
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the reflect error when there is no catalog", () => {
    render(<DraftAddressBar {...props({ reflectError: "no reflection here" })} />);
    expect(screen.getByText("no reflection here")).toBeTruthy();
  });

  it("renders the MethodPicker trigger when a catalog is loaded", () => {
    render(<DraftAddressBar {...props({ catalog: cat })} />);
    expect(screen.getByText("GetX")).toBeTruthy(); // method name in the trigger
  });

  it("disables Send until a method is chosen", () => {
    const noMethod = { ...base, method: "" };
    render(<DraftAddressBar {...props({ step: noMethod })} />);
    expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires Send when a method is set", () => {
    const p = props();
    render(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(p.onSend).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/workflow/DraftAddressBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/features/workflow/DraftAddressBar.tsx`:

```tsx
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { MethodPicker } from "@/features/shell/MethodPicker";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import type { Step } from "./model";

export interface DraftAddressBarProps {
  step: Step;
  catalog: ServiceCatalogIpc | null;
  reflecting: boolean;
  reflectError: string | null;
  onAddress: (address: string) => void;
  onRefresh: () => void;
  onSelectMethod: (m: SelectedMethod) => void;
  onSend: () => void;
  onCancel: () => void;
}

/** Editable Focus header for a draft: host input → reflection → MethodPicker → Send. */
export function DraftAddressBar({
  step, catalog, reflecting, reflectError, onAddress, onRefresh, onSelectMethod, onSend, onCancel,
}: DraftAddressBarProps) {
  const sending = step.status === "sending";
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
      <Input
        aria-label="draft-address"
        value={step.address}
        onChange={(e) => onAddress(e.target.value)}
        placeholder="host:port"
        className="h-8 w-56 font-mono text-xs"
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="refresh-reflection"
        onClick={onRefresh}
        disabled={reflecting || step.address.trim().length === 0}
      >
        <RefreshCw className={cn("size-3.5", reflecting && "animate-spin")} />
      </Button>
      {catalog ? (
        <MethodPicker
          selected={{ service: step.service, method: step.method, kind: "unary" }}
          catalog={catalog}
          onSelect={onSelectMethod}
        />
      ) : (
        <span className="truncate text-xs text-muted-foreground">
          {reflecting ? "Reflecting…" : reflectError ? reflectError : "Enter a host to load methods"}
        </span>
      )}
      <div className="flex-1" />
      {sending ? (
        <Button size="sm" variant="outline" onClick={onCancel}>
          ✕ Cancel
        </Button>
      ) : null}
      <Button size="sm" onClick={onSend} disabled={sending || step.method.trim().length === 0}>
        {sending ? "Sending…" : "▶ Send"}
      </Button>
    </div>
  );
}
```

> Note: the `MethodPicker` `selected.kind` is hard-coded `"unary"` here (the `Step` model
> carries no stream kind); this only affects the trigger badge. Deriving the real kind from
> the catalog is a Follow-up (shared with plan-05's monochrome stream-badge follow-up).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/workflow/DraftAddressBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/DraftAddressBar.tsx src/features/workflow/DraftAddressBar.test.tsx
git commit -m "feat(workflow): DraftAddressBar — editable host + refresh + MethodPicker (plan-06)"
```

---

### Task 9: `CallPanel` editable wiring + `FocusView`

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx`
- Modify: `src/features/workflow/FocusView.tsx`
- Test: `src/features/workflow/CallPanel.editable.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/workflow/CallPanel.editable.test.tsx` (mock Monaco `BodyEditor` and the
whole IPC client, as the repo does elsewhere):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));
vi.mock("@/ipc/client", () => ({
  authResolve: vi.fn().mockResolvedValue(null),
  grpcDescribe: vi.fn().mockResolvedValue({ services: [] }),
  grpcRefreshContract: vi.fn().mockResolvedValue({ services: [] }),
  grpcBuildRequestSkeleton: vi.fn().mockResolvedValue("{}"),
  varsResolve: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  grpcCancel: vi.fn(),
}));

import { CallPanel } from "./CallPanel";
import { newStep } from "./model";

const draft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });

beforeEach(() => vi.clearAllMocks());

describe("CallPanel editable", () => {
  it("renders the editable draft header when editable", () => {
    render(<CallPanel step={draft} onPatch={() => {}} editable />);
    expect(screen.getByLabelText("draft-address")).toBeTruthy();
  });

  it("renders the read-only AddressBar when not editable", () => {
    render(<CallPanel step={draft} onPatch={() => {}} />);
    expect(screen.queryByLabelText("draft-address")).toBeNull();
    expect(screen.getByText("GetX")).toBeTruthy(); // AddressBar shows the method name
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/workflow/CallPanel.editable.test.tsx`
Expected: FAIL — `CallPanel` has no `editable` prop / always renders `AddressBar`.

- [ ] **Step 3: Implement**

In `src/features/workflow/CallPanel.tsx`:

(a) Add imports:

```ts
import { DraftAddressBar } from "./DraftAddressBar";
import { useDraftReflection } from "./useDraftReflection";
import { applyMethodSelection } from "./actions";
```

(b) Extend the props and signature:

```ts
interface CallPanelProps {
  step: Step;
  onPatch: (patch: Partial<Step>) => void;
  onExecuted?: (executed: Step) => void;
  /** Focus(draft) only: editable host + reflection + MethodPicker header. */
  editable?: boolean;
}

export function CallPanel({ step, onPatch, onExecuted, editable }: CallPanelProps) {
```

(c) Call the reflection hook unconditionally (inert when `!editable`) and build the header
just before the `return`:

```ts
  const reflection = useDraftReflection(step.address, step.tls, !!editable);

  const header = editable ? (
    <DraftAddressBar
      step={step}
      catalog={reflection.catalog}
      reflecting={reflection.loading}
      reflectError={reflection.error}
      onAddress={(address) => onPatch({ address })}
      onRefresh={reflection.refresh}
      onSelectMethod={(m) =>
        void applyMethodSelection(onPatch, { address: step.address, tls: step.tls }, m)
      }
      onSend={onSend}
      onCancel={onCancel}
    />
  ) : (
    <AddressBar step={step} onSend={onSend} onCancel={onCancel} />
  );
```

(d) In the returned JSX, replace `<AddressBar step={step} onSend={onSend} onCancel={onCancel} />`
with `{header}`.

In `src/features/workflow/FocusView.tsx`, pass `editable` to the draft `CallPanel`:

```tsx
          <CallPanel
            step={draft}
            onPatch={(patch: Partial<Step>) => workflowStore.updateDraft(patch)}
            onExecuted={(executed: Step) => workflowStore.commitExecutedStep(executed)}
            editable
          />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/workflow/CallPanel.editable.test.tsx`
Then: `pnpm test src/features/workflow` — the existing workflow suite (AddressBar, RequestTabs,
store, actions, …) stays green.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/CallPanel.tsx src/features/workflow/FocusView.tsx src/features/workflow/CallPanel.editable.test.tsx
git commit -m "feat(workflow): CallPanel editable draft header + FocusView wiring (plan-06)"
```

---

### Task 10: `SaveRequestDialog` (catalog) with `Host > Service` path hint

**Files:**
- Create: `src/features/catalog/SaveRequestDialog.tsx`
- Test: `src/features/catalog/SaveRequestDialog.test.tsx`

Port the proven legacy `src/features/collections/SaveRequestDialog.tsx` verbatim, then add the
hint block. The legacy props already match the new IPC types.

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/SaveRequestDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaveRequestDialog } from "./SaveRequestDialog";
import type { CollectionIpc, CollectionMetaIpc } from "@/ipc/bindings";

const metas: CollectionMetaIpc[] = [{ id: "c1", name: "My Collection" }];
const collection: CollectionIpc = {
  id: "c1", name: "My Collection", items: [], variables: {}, auth: { kind: "none" },
  default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
};

function props(over = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    metas,
    loadCollection: vi.fn().mockResolvedValue(collection),
    defaultName: "GetX",
    onSave: vi.fn().mockResolvedValue(undefined),
    onCreateCollection: vi.fn().mockResolvedValue("c-new"),
    suggestedPath: ["payments", "PaymentService"],
    existingLocations: [],
    ...over,
  };
}

describe("SaveRequestDialog", () => {
  it("defaults the name to the method and saves to the chosen collection", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    expect((screen.getByPlaceholderText("My request") as HTMLInputElement).value).toBe("GetX");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await Promise.resolve();
    expect(p.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "c1", parentId: null, name: "GetX" }),
    );
  });

  it("shows the suggested Host > Service path hint", () => {
    render(<SaveRequestDialog {...props()} />);
    expect(screen.getByText(/payments\s*›\s*PaymentService/)).toBeTruthy();
  });

  it("shows where the request is already saved", () => {
    render(
      <SaveRequestDialog
        {...props({
          existingLocations: [
            { collectionId: "c1", collectionName: "My Collection", folderPath: ["api"], requestId: "r0", requestName: "GetX" },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Already saved in/i)).toBeTruthy();
    expect(screen.getByText(/My Collection/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/SaveRequestDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/features/catalog/SaveRequestDialog.tsx` by copying the legacy
`src/features/collections/SaveRequestDialog.tsx` verbatim, then:

(a) Add the two hint props to the interface:

```ts
  /** When true the request already belongs to a collection; only the Name field is shown. */
  originBound?: boolean;
  /** Suggested `Host > Service` folder path (display-only hint). */
  suggestedPath?: string[];
  /** Existing saved copies of this call (display-only "already saved in" hint). */
  existingLocations?: SaveLocation[];
```

with the import:

```ts
import type { SaveLocation } from "./grouping";
```

(b) Destructure the new props in the component body (`const { …, suggestedPath, existingLocations } = props;`).

(c) Render the hint block inside the `{!originBound && ( <> … </> )}` section, after the
Collection `<div className="grid gap-1.5"> … </div>`:

```tsx
              {suggestedPath && suggestedPath.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Suggested path: <span className="font-mono">{suggestedPath.join(" › ")}</span>
                </p>
              )}
              {existingLocations && existingLocations.length > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  Already saved in:
                  <ul className="mt-0.5 list-disc pl-4">
                    {existingLocations.map((loc) => (
                      <li key={loc.requestId} className="font-mono">
                        {[loc.collectionName, ...loc.folderPath].join(" › ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/SaveRequestDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/SaveRequestDialog.tsx src/features/catalog/SaveRequestDialog.test.tsx
git commit -m "feat(catalog): SaveRequestDialog with Host > Service path hint (plan-06)"
```

---

### Task 11: `needsDiscardConfirm` + `DiscardDraftDialog`

**Files:**
- Create: `src/features/catalog/discardGuard.ts`
- Create: `src/features/catalog/DiscardDraftDialog.tsx`
- Test: `src/features/catalog/discardGuard.test.ts`
- Test: `src/features/catalog/DiscardDraftDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/discardGuard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { needsDiscardConfirm } from "./discardGuard";

describe("needsDiscardConfirm", () => {
  it("confirms only for a dirty UNBOUND draft", () => {
    expect(needsDiscardConfirm(null, true)).toBe(true);
  });
  it("no confirm when clean", () => {
    expect(needsDiscardConfirm(null, false)).toBe(false);
  });
  it("no confirm when bound (origin-bound autosaves)", () => {
    expect(needsDiscardConfirm({ collectionId: "c1", requestId: "r1" }, true)).toBe(false);
  });
});
```

Create `src/features/catalog/DiscardDraftDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiscardDraftDialog } from "./DiscardDraftDialog";

function props(over = {}) {
  return { open: true, onOpenChange: vi.fn(), onDiscard: vi.fn(), onSaveFirst: vi.fn(), ...over };
}

describe("DiscardDraftDialog", () => {
  it("fires onDiscard and closes", () => {
    const p = props();
    render(<DiscardDraftDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("fires onSaveFirst and closes", () => {
    const p = props();
    render(<DiscardDraftDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(p.onSaveFirst).toHaveBeenCalledTimes(1);
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/discardGuard.test.ts src/features/catalog/DiscardDraftDialog.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `discardGuard.ts`**

Create `src/features/catalog/discardGuard.ts`:

```ts
import type { DraftOrigin } from "@/features/workflow/store";

/** Whether opening another request should prompt before replacing the current draft.
 *  Only an unbound (not origin-bound) draft with unsaved edits needs a prompt;
 *  origin-bound drafts are already autosaved. */
export function needsDiscardConfirm(origin: DraftOrigin | null, dirty: boolean): boolean {
  return origin === null && dirty;
}
```

- [ ] **Step 4: Implement `DiscardDraftDialog.tsx`**

Create `src/features/catalog/DiscardDraftDialog.tsx`:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

export interface DiscardDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Proceed and lose the unsaved draft. */
  onDiscard: () => void;
  /** Open the Save dialog first, then proceed. */
  onSaveFirst: () => void;
}

/** Confirm before replacing a dirty unbound draft (spec §6 «заменить/сохранить?»). */
export function DiscardDraftDialog({ open, onOpenChange, onDiscard, onSaveFirst }: DiscardDraftDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved request?</AlertDialogTitle>
          <AlertDialogDescription>
            The current request has unsaved changes. Save it first, or discard it to open the
            other request.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onSaveFirst();
              onOpenChange(false);
            }}
          >
            Save…
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => {
              onDiscard();
              onOpenChange(false);
            }}
            className={buttonVariants({ variant: "destructive" })}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/discardGuard.test.ts src/features/catalog/DiscardDraftDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/discardGuard.ts src/features/catalog/DiscardDraftDialog.tsx src/features/catalog/discardGuard.test.ts src/features/catalog/DiscardDraftDialog.test.tsx
git commit -m "feat(catalog): needsDiscardConfirm + DiscardDraftDialog (plan-06)"
```

---

### Task 12: Gate, self-review, and index update

**Files:**
- Modify: `docs/superpowers/plans/2026-06-05-plan-00-index.md`
- Modify: this plan file's status banner

- [ ] **Step 1: Full gate**

Run: `pnpm test`
Expected: all front-end tests green (plan-05 baseline 336 + the new tests from this plan).

Run: `pnpm lint`
Expected: only the **15 pre-existing** legacy errors (`src/features/collections/**` ×14 +
`src/ipc/client.ts` ×1). Confirm **zero new** errors under `features/catalog` or
`features/workflow`. (`pnpm build` stays `tsc`-blocked by the legacy 15 until plan-09, as in
plan-04/05.)

- [ ] **Step 2: Self-review against spec §6/§10/§15**

Verify each spec requirement maps to a delivered unit:
- new-request draft → plan-05 `newRequestDraft` (unbound; Task 1 confirms `draftOrigin` null).
- host → reflection (debounce + refresh) → Task 7 `useDraftReflection`.
- MethodPicker from reflection → Task 8 `DraftAddressBar` + Task 9 `CallPanel editable`.
- auto-skeleton → Task 6 `applyMethodSelection`/`buildRequestSkeletonSafe`.
- no-reflection error → Task 7 `error` + Task 8 renders it.
- Save dialog (manual collection/folder + path hint, name=method, dups ok) → Task 10.
- Save (unbound) creates + binds → Task 5 `saveNewRequest` + Task 1 `setDraftOrigin`.
- origin-bound autosave on any content edit → Task 1 dirty rule + Tasks 3–5 `replaceItemInTree`
  /`updateItemContent`/`autosaveDraft`.
- Save As (copy) → Task 10 dialog re-opened with `originBound={false}` (UI re-use; rebind via
  `setDraftOrigin`).
- open-over-dirty confirm → Task 11 `needsDiscardConfirm` + `DiscardDraftDialog`.

- [ ] **Step 3: Update the plan index**

In `docs/superpowers/plans/2026-06-05-plan-00-index.md`, change the `plan-06` row Status from
`outline` to `✅ done (<first>..<last>)` (fill the actual commit range), and update this plan
file's status banner to `✅ done`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-05-plan-00-index.md docs/superpowers/plans/2026-06-05-plan-06-create-save-flow.md
git commit -m "docs(plan-06): mark complete; update index row"
```

---

## Deferred to plan-09 (shell wiring) — explicitly NOT in this plan

- Live `Ctrl/Cmd+S` (Save) and `Ctrl/Cmd+N` (New) hotkeys.
- The **debounced autosave effect** that calls `autosaveDraft(updateItemContent, origin, draft)`
  when an origin-bound draft changes (needs `SidebarShell`'s `useCatalogTree` instance and the
  `FocusView` draft together in `WorkflowApp`).
- The **click interception** that runs `needsDiscardConfirm` and shows `DiscardDraftDialog`
  before `openSavedRequest`/`newRequestDraft`.
- The **Save** orchestration component that opens `SaveRequestDialog`, computes `suggestedPath`
  (`suggestSavePath`) + `existingLocations` (`findSavedLocations`) from the live tree, calls
  `saveNewRequest`, and binds origin via `workflowStore.setDraftOrigin`.
- `collectionBumpUsage`/`collectionSetNodeAuth` client wrappers + their Send/auth wiring.

## Follow-ups

- MethodPicker `selected.kind` is `"unary"` for drafts (Step carries no stream kind); derive
  the real kind from the loaded catalog (shared with plan-05's stream-badge follow-up).
- Auth editing in Focus (spec §6 «правка …auth») is not built here — deferred.
