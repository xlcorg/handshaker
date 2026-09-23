# Collapse all / Expand all buttons — Implementation Plan

**Статус:** 🎉 DONE — все задачи выполнены, ребейз+ff в `main` (2026-06-18). Гейт
после ребейза на актуальный `main`: vitest 1025 · tsc · vite build. Остаток — live
WebView2-проход.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **Collapse all** and **Expand all** icon buttons to the collections-panel header that fold/unfold every top-level collection in one click.

**Architecture:** `CollectionTree` owns the render-truth `open` Set, so it exposes a tiny imperative handle `{ expandAll, collapseAll }` via `forwardRef` + `useImperativeHandle`. `SidebarShell` holds a ref and renders the two header buttons next to `SortControl`; each button updates the tree's local `open` (collection ids only) and persists each collection's `expanded` flag through the existing `onSetExpanded(collectionId, null, expanded)` → `collection_set_expanded` IPC. Pure frontend — no backend/IPC/bindings changes.

**Tech Stack:** React 18 (`forwardRef`/`useImperativeHandle`), TypeScript, lucide-react (`ChevronsDownUp`/`ChevronsUpDown`), shadcn `Button`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-17-collection-expand-collapse-all-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/features/catalog/CollectionTree.tsx` | Tree view + open-state | `forwardRef` + `useImperativeHandle` exposing `expandAll`/`collapseAll` |
| `src/features/catalog/CollectionTree.test.tsx` | Tree tests | `makeProps` refactor + handle tests |
| `src/features/catalog/SidebarShell.tsx` | Collections panel shell + header | `treeRef` + two header buttons |
| `src/features/catalog/SidebarShell.test.tsx` | Shell tests | button render / click / disabled tests |

Reused as-is (no edits): `treeNav.ts`, `treeEdit.ts`, `useCatalogTree.ts`, `src/ipc/bindings.ts`, all Rust.

---

## Task 1: `CollectionTree` imperative handle (`expandAll` / `collapseAll`)

**Files:**
- Modify: `src/features/catalog/CollectionTree.tsx`
- Test: `src/features/catalog/CollectionTree.test.tsx`

### Context for the implementer

`CollectionTree` is currently a plain function component:

```tsx
export function CollectionTree(props: CollectionTreeProps) {
  const { collections, filterActive, editingId } = props;
  const [open, setOpen] = useState<Set<string>>(new Set());
  // …
  const persistExpanded = (id: string, expanded: boolean) => { … };
  const setOpenId = (id: string, want: boolean) => setOpen(…);
  const toggle = (id) => …; const expand = (id) => …; const collapse = (id) => …;
  // …
  return ( <>…</> );
}
```

We convert it to `forwardRef` and add the handle. `open` is the Set that drives rendering (via `effectiveOpen` → `flattenVisible`). Manual toggles already update **both** `open` (local) and persist via `props.onSetExpanded`. The handle does the same, for **all collection ids** (`itemId = null`).

- [ ] **Step 1: Refactor the test setup to expose a reusable `makeProps`, then write the failing handle tests**

In `src/features/catalog/CollectionTree.test.tsx`:

First add a `createRef` import. Change line 3-ish imports — add this line after the existing `import userEvent …` line:

```tsx
import { createRef } from "react";
```

And update the `CollectionTree` import to also pull the handle type (replace the existing `import { CollectionTree, type CollectionTreeProps } from "./CollectionTree";` line):

```tsx
import { CollectionTree, type CollectionTreeProps, type CollectionTreeHandle } from "./CollectionTree";
```

Replace the existing `setup` function (the block starting `function setup(over: Partial<CollectionTreeProps> = {}) {` through its closing `}`) with a split `makeProps` + `setup`:

```tsx
function makeProps(over: Partial<CollectionTreeProps> = {}): CollectionTreeProps {
  return {
    collections: [col("c1", [req("r1")]), col("c2", [])],
    filterActive: false,
    activeItemId: null,
    activeCollectionId: null,
    editingId: null,
    onEditingChange: vi.fn(),
    onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(),
    onRenameItem: vi.fn(),
    onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(),
    onDeleteItem: vi.fn(),
    onDeleteCollection: vi.fn(),
    onExportCollection: vi.fn(),
    onAddRequest: vi.fn(),
    onAddFolder: vi.fn(),
    onSetPinned: vi.fn(),
    onMoveItem: vi.fn(),
    onMoveItemAcross: vi.fn(),
    onSetExpanded: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<CollectionTreeProps> = {}) {
  const props = makeProps(over);
  renderWithSidebar(<CollectionTree {...props} />);
  return props;
}
```

Then append a new `describe` block at the end of the file (after the `CollectionTree persisted expansion` block's closing `});`):

```tsx
describe("CollectionTree expand/collapse all handle", () => {
  function efolder(id: string, items: ItemIpc[], expanded: boolean): Extract<ItemIpc, { type: "folder" }> {
    return { type: "folder", id, name: id, items, expanded };
  }

  it("expandAll() opens every collection and persists each with null itemId", () => {
    const props = makeProps({ collections: [col("c1", [req("r1")]), col("c2", [req("r2")])] });
    const ref = createRef<CollectionTreeHandle>();
    renderWithSidebar(<CollectionTree {...props} ref={ref} />);

    // Both collections start collapsed -> children hidden.
    expect(screen.queryByText("r1")).toBeNull();
    expect(screen.queryByText("r2")).toBeNull();

    act(() => ref.current!.expandAll());

    expect(screen.getByText("r1")).toBeTruthy();
    expect(screen.getByText("r2")).toBeTruthy();
    expect(props.onSetExpanded).toHaveBeenCalledWith("c1", null, true);
    expect(props.onSetExpanded).toHaveBeenCalledWith("c2", null, true);
  });

  it("collapseAll() closes every collection and persists each with null itemId", () => {
    // Both collections start expanded (children visible).
    const c1 = { ...col("c1", [req("r1")]), expanded: true };
    const c2 = { ...col("c2", [req("r2")]), expanded: true };
    const props = makeProps({ collections: [c1, c2] });
    const ref = createRef<CollectionTreeHandle>();
    renderWithSidebar(<CollectionTree {...props} ref={ref} />);

    expect(screen.getByText("r1")).toBeTruthy();

    act(() => ref.current!.collapseAll());

    expect(screen.queryByText("r1")).toBeNull();
    expect(screen.queryByText("r2")).toBeNull();
    expect(props.onSetExpanded).toHaveBeenCalledWith("c1", null, false);
    expect(props.onSetExpanded).toHaveBeenCalledWith("c2", null, false);
  });

  it("expandAll() targets collection ids only, never folder ids (top-level scope)", () => {
    // c1 holds a collapsed folder f1; expandAll must not persist f1.
    const props = makeProps({ collections: [{ ...col("c1", [efolder("f1", [req("rIn")], false)]), expanded: false }] });
    const ref = createRef<CollectionTreeHandle>();
    renderWithSidebar(<CollectionTree {...props} ref={ref} />);

    act(() => ref.current!.expandAll());

    expect(props.onSetExpanded).toHaveBeenCalledWith("c1", null, true);
    expect(props.onSetExpanded).not.toHaveBeenCalledWith("c1", "f1", true);
    // f1's own folded state is untouched: rIn stays hidden.
    expect(screen.queryByText("rIn")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm test src/features/catalog/CollectionTree.test.tsx`
Expected: FAIL — TypeScript/runtime error that `CollectionTreeHandle` is not exported and `ref.current` is null (component does not forward a ref yet).

- [ ] **Step 3: Convert `CollectionTree` to `forwardRef` and implement the handle**

In `src/features/catalog/CollectionTree.tsx`:

Update the React import (line 1) to add `forwardRef` and `useImperativeHandle`:

```tsx
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react";
```

Add the handle interface just above the `CollectionTreeProps` interface (before `export interface CollectionTreeProps {`):

```tsx
export interface CollectionTreeHandle {
  /** Expand every top-level collection (nested folders keep their own state). */
  expandAll(): void;
  /** Collapse every top-level collection. */
  collapseAll(): void;
}
```

Change the component declaration from a function to a `forwardRef`. Replace:

```tsx
export function CollectionTree(props: CollectionTreeProps) {
  const { collections, filterActive, editingId } = props;
```

with:

```tsx
export const CollectionTree = forwardRef<CollectionTreeHandle, CollectionTreeProps>(
  function CollectionTree(props, ref) {
  const { collections, filterActive, editingId } = props;
```

Then add the handle implementation immediately after the `collapse` function (after the block `const collapse = (id: string) => { … };`, around line 118):

```tsx
  useImperativeHandle(
    ref,
    () => ({
      expandAll() {
        const ids = collections.map((c) => c.id);
        setOpen((prev) => new Set([...prev, ...ids]));
        for (const id of ids) props.onSetExpanded(id, null, true);
      },
      collapseAll() {
        const ids = collections.map((c) => c.id);
        setOpen((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
        for (const id of ids) props.onSetExpanded(id, null, false);
      },
    }),
    [collections, props.onSetExpanded],
  );
```

Finally, close the `forwardRef` call. The component currently ends with:

```tsx
    </>
  );
}
```

Change that closing to add the extra `)` for `forwardRef`:

```tsx
    </>
  );
  },
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/features/catalog/CollectionTree.test.tsx`
Expected: PASS — all existing tree tests plus the three new handle tests.

- [ ] **Step 5: Type-check**

Run: `pnpm lint`
Expected: no errors (no `tsc` output).

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/CollectionTree.tsx src/features/catalog/CollectionTree.test.tsx
git commit -m "feat(catalog): expose expandAll/collapseAll handle on CollectionTree"
```

---

## Task 2: `SidebarShell` header buttons (wire the handle)

**Files:**
- Modify: `src/features/catalog/SidebarShell.tsx`
- Test: `src/features/catalog/SidebarShell.test.tsx`

### Context for the implementer

The Collections caption row lives at `SidebarShell.tsx:108-130`. Its right-hand control cluster is `<div className="flex items-center gap-1"> <SortControl …/> <DropdownMenu>…⋯</DropdownMenu> </div>`. We insert the two new buttons **before** `SortControl`. `filterActive` (line 64) and `visible` (line 65) are already computed in the component and drive the `disabled` state.

- [ ] **Step 1: Write the failing button tests**

In `src/features/catalog/SidebarShell.test.tsx`, append these tests inside the `describe("SidebarShell", …)` block (before its closing `});`):

```tsx
  it("renders collapse all and expand all buttons in the header", () => {
    tree.current.tree = [col("c1", "Alpha")];
    renderShell();
    expect(screen.getByLabelText("collapse all")).toBeTruthy();
    expect(screen.getByLabelText("expand all")).toBeTruthy();
  });

  it("expand all reveals collapsed collections' children", () => {
    tree.current.tree = [{ ...col("c1", "Alpha", [req("r1", "Req1")]), expanded: false }];
    renderShell();
    expect(screen.queryByText("Req1")).toBeNull();
    fireEvent.click(screen.getByLabelText("expand all"));
    expect(screen.getByText("Req1")).toBeTruthy();
  });

  it("collapse all hides expanded collections' children", () => {
    tree.current.tree = [{ ...col("c1", "Alpha", [req("r1", "Req1")]), expanded: true }];
    renderShell();
    expect(screen.getByText("Req1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("collapse all"));
    expect(screen.queryByText("Req1")).toBeNull();
  });

  it("disables both buttons while a filter is active", () => {
    tree.current.tree = [col("c1", "Alpha")];
    renderShell();
    fireEvent.change(screen.getByLabelText("collection-filter"), { target: { value: "alpha" } });
    expect(screen.getByLabelText("collapse all")).toBeDisabled();
    expect(screen.getByLabelText("expand all")).toBeDisabled();
  });

  it("disables both buttons when there are no collections", () => {
    tree.current.tree = [];
    renderShell();
    expect(screen.getByLabelText("collapse all")).toBeDisabled();
    expect(screen.getByLabelText("expand all")).toBeDisabled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/features/catalog/SidebarShell.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: collapse all` (buttons don't exist yet).

- [ ] **Step 3: Add the buttons and ref wiring**

In `src/features/catalog/SidebarShell.tsx`:

Add `useRef` to the React import (line 1):

```tsx
import { useEffect, useRef, useState } from "react";
```

Add the two icons to the lucide import (line 2):

```tsx
import { ChevronsDownUp, ChevronsUpDown, Download, FilePlus, FolderPlus, MoreHorizontal, Plus, Upload } from "lucide-react";
```

Add the handle type to the `CollectionTree` import (line 18):

```tsx
import { CollectionTree, type CollectionTreeHandle } from "./CollectionTree";
```

Declare the ref near the other hooks (after `const [editingId, setEditingId] = useState<string | null>(null);`, ~line 50):

```tsx
  const treeRef = useRef<CollectionTreeHandle>(null);
```

Insert the two buttons at the start of the control cluster — replace this block (lines 110-111):

```tsx
          <div className="flex items-center gap-1">
            <SortControl value={sortKey} onChange={onChangeSort} />
```

with:

```tsx
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-6"
              aria-label="collapse all"
              title="Collapse all"
              disabled={filterActive || visible.length === 0}
              onClick={() => treeRef.current?.collapseAll()}
            >
              <ChevronsDownUp className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-6"
              aria-label="expand all"
              title="Expand all"
              disabled={filterActive || visible.length === 0}
              onClick={() => treeRef.current?.expandAll()}
            >
              <ChevronsUpDown className="size-4" />
            </Button>
            <SortControl value={sortKey} onChange={onChangeSort} />
```

Pass the ref to the tree — change the opening tag `<CollectionTree` (line 134) to add `ref`:

```tsx
        <CollectionTree
          ref={treeRef}
          collections={visible}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/features/catalog/SidebarShell.test.tsx`
Expected: PASS — all existing shell tests plus the five new button tests.

- [ ] **Step 5: Type-check**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/SidebarShell.tsx src/features/catalog/SidebarShell.test.tsx
git commit -m "feat(catalog): collapse-all/expand-all buttons in collections header"
```

---

## Task 3: Full gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — entire Vitest suite green (the prior per-file runs plus everything else; new test count = previous + 8).

- [ ] **Step 2: Type-check + production build**

Run: `pnpm build`
Expected: `tsc -b` clean, `vite build` succeeds.

- [ ] **Step 3: Confirm no backend drift**

The change is frontend-only. Confirm nothing under `src-tauri/`, `crates/`, or `src/ipc/bindings.ts` was modified:

Run: `git diff --name-only main...HEAD`
Expected: only the four files listed in File Structure plus this plan/spec doc — no `bindings.ts`, no Rust.

- [ ] **Step 4: Live verification note (manual, WebView2)**

Not automated. After merge, verify in `pnpm tauri:dev`: with ≥2 collections, **Collapse all** folds all collections, **Expand all** unfolds them (nested folders keep their state); the state survives an app restart; typing in the filter disables both buttons; with zero collections both are disabled.

---

## Self-Review

**Spec coverage:**
- Two header buttons, Collapse-all then Expand-all, left of `SortControl` → Task 2, Step 3. ✓
- Top-level collections only (collection ids, not folders) → Task 1 handle + Task 1 Step 1 scope-regression test. ✓
- Persist via existing `onSetExpanded(id, null, expanded)` → Task 1 handle + assertions. ✓
- Disabled while filtering / when empty → Task 2 button `disabled` + two disabled tests. ✓
- Icons `ChevronsDownUp` (collapse) / `ChevronsUpDown` (expand) → Task 2 Step 3. ✓
- No backend/IPC/bindings changes → Task 3 Step 3 drift check. ✓

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `CollectionTreeHandle { expandAll(): void; collapseAll(): void }` is defined in Task 1 and consumed verbatim in Task 1 tests and Task 2 (`useRef<CollectionTreeHandle>`, `treeRef.current?.expandAll()`). `onSetExpanded(collectionId, itemId, expanded)` signature matches the existing prop. `Button` `size="icon-sm"` matches existing usage in the file.
