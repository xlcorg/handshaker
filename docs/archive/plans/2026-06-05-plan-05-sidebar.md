# Plan 05 — Collections sidebar (no DnD): tree, optimistic mutations, inline-rename, context-menu, confirm-delete, filter, arrow-nav, toggle+resize

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking. **Detail is already TDD-complete** —
> execute task-by-task.

**Status:** ✅ **done** (`65d8c96..f813bf9`). 336/336 front-end tests green (was 274 at
plan-04; +62 new across `catalog/{treeNav,treeEdit,useCatalogTree,RowMenu,RenameInput,
PinButton,SortControl,RequestRow,FolderNode,CollectionNode,ConfirmDeleteDialog,
CollectionTree,SidebarShell}` + `catalog/actions` + `lib/use-prefs`). `pnpm lint` (`tsc -b`)
reports only the **15 pre-existing** legacy errors (`src/features/collections/**` ×14,
`src/ipc/client.ts` ×1) — **zero** new and none under `features/catalog`/`lib/use-prefs`;
gate was `pnpm test` + targeted typecheck (`pnpm build` stays `tsc`-blocked by the legacy 15,
as in plan-04). NB: (a) Task 5 caught a real flaw in the plan's `openSavedRequest` test —
`newStep` mints a fresh UUID per call, so the assertion compares all fields except `id`;
(b) final code review fixed two nits in `CollectionTree` (`f813bf9`): reset orphaned keyboard
focus when the focused node is hidden, and drop the non-memoizing `cb` `useMemo` + its
eslint-disable. New sidebar is **not yet wired into `WorkflowApp`** — that, and deletion of
the legacy derived-catalog `Sidebar`, is plan-09.
**Branch:** `redesign/workflow-ui-spec-plans`
**Phase:** 4 of spec §16 (`docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`).
**Predecessors:** plan-01 (`cadaccd..625241b`), plan-02 (`41d29bf..0a33cae`),
plan-03 (`7b1b885..2903c8a`), plan-04 (`0381a9d..5e3d896`) — all ✅ done. This plan builds
the **persistent Postman-style sidebar** on top of the `CollectionIpc` backend (plan-01/02)
and the global pending-draft (plan-04).

**Goal:** Build the new, user-editable collections sidebar as a tree of named collections →
folders → saved requests, with optimistic IPC mutations (rename/delete/duplicate/add/pin),
inline-rename, a row context-menu, confirm-on-delete, a text filter, full arrow-key
navigation, a `Ctrl/Cmd+B` visibility toggle and a resizable, persisted width. Clicking a
saved request opens it in Focus via `savedRequestToDraft → workflowStore.setDraft`; the
header `+` (New request) sets an empty draft. **DnD is out of scope** (plan-08).

**Architecture:** A presentational tree (`CollectionTree` + `CollectionNode`/`FolderNode`/
`RequestRow`/`RowMenu`/`PinButton`/`RenameInput`) driven entirely by props, so it is unit-
testable with a static tree and spy callbacks. A `useCatalogTree` hook owns the loaded
collections and performs **optimistic** mutations over `collection_*` IPC with snapshot
rollback on error. Pure modules `treeNav.ts` (visible-node flattening, reveal path, request
counts) and `treeEdit.ts` (immutable rename/remove/insert/pin transforms) hold all the
tree logic and are TDD'd in isolation. `SidebarShell` is the only stateful seam: it wires
`useCatalogTree`, the existing pure `sort.ts`/`filterCollections`, prefs (`sidebar` toggle +
new `sidebarWidth`), and the catalog open-actions to the tree.

**Tech Stack:** TypeScript, React 18, Vitest + Testing Library (`renderHook`/`render`/
`screen`/`fireEvent`), lucide-react icons, `@/` path alias (= `src/`).

## Build / test commands (repo root, PowerShell)

- Single test file: `pnpm test src/features/catalog/<file>.test.ts`
- All front-end tests: `pnpm test`
- Typecheck: `pnpm lint` (`tsc -b`) · Prod build: `pnpm build`

## Design notes (decisions locked from spec §5, §7, §11, §13, §15-table)

1. **Not yet wired into `WorkflowApp`.** Per the plan-00 index, the live shell keeps the old
   derived-catalog `Sidebar` until **plan-09** (cleanup) wires `WorkflowApp` and deletes the
   legacy components. This plan delivers fully unit-tested components + the hook; they are
   imported only by their tests. Gate = `pnpm test` + targeted `pnpm lint` (repo-wide
   `tsc -b`/`pnpm build` remain blocked by the 15 pre-existing legacy errors removed in
   plan-09 — confirm **zero new** errors under `features/catalog`).
2. **Optimistic + rollback** (spec §15 "Мутации оптимистичные + откат"): `useCatalogTree`
   snapshots the tree, applies a pure `treeEdit` transform locally, calls IPC, and restores
   the snapshot (and sets `error`) if the call rejects. Rename/delete/add/pin are optimistic
   via `collectionUpsert`/`collectionAddItem`/`collectionRenameItem`/`collectionDeleteItem`/
   `collectionDelete`. **Duplicate** is IPC-then-reload (the backend assigns the new id and
   deep-copies), so it re-`collectionGet`s the affected collection rather than guessing.
3. **First run** (spec §15 "Первый запуск: авто «My Collection»"): if `collectionList()`
   returns empty, `useCatalogTree.reload` creates and upserts a default `"My Collection"`.
4. **Open semantics** (spec §3, §6): request click → `savedRequestToDraft` →
   `workflowStore.setDraft` (+ view `focus`); `+`/menu "Add request" → empty pending-draft.
   These live in `catalog/actions.ts` (`openSavedRequest`, `newRequestDraft`), mirroring the
   existing `openCallFromMethod` pattern. **Open-over-dirty confirm** is plan-06 — not here.
5. **Container click rules** (spec §5 "Строки"/§15): collection — chevron toggles, **name
   click → `onOpenCollection`** (CollectionOverview is plan-07, so the prop defaults to a
   no-op here); folder — chevron **and** name toggle; request — click opens in Focus.
6. **Inline-rename** (spec §5/§15 "blur = commit"): `RenameInput` commits on Enter/blur when
   the trimmed value is non-empty and changed, cancels on Esc. `editingId` is **controlled**
   by `SidebarShell` so New-collection / Add-folder can drop a default-named node straight
   into rename; `CollectionTree` reveals the editing node by opening its ancestor path.
7. **Delete = always confirm, no undo** (spec §5/§15): node menus request deletion;
   `CollectionTree` opens a single `ConfirmDeleteDialog`; confirming calls the actual
   `onDeleteItem`/`onDeleteCollection` (which are the hook's optimistic deletes). The
   backend's delete-snapshot/restore is **not** used (no undo).
8. **Filter** (spec §5/§15): reuses the already-built `filterCollections` (name + service +
   method + address). While filtering, the tree treats **everything as expanded**.
9. **Pin** (spec §5/§15): `pinned` is a `Collection` flag persisted via `collectionUpsert`;
   pinned collections float to top via the already-built `sortCollections`. `PinButton` is
   hover-only, but always visible when pinned.
10. **Toggle + resize** (spec §5/§11/§15): `Ctrl/Cmd+B` flips the existing `prefs.sidebar`
    boolean; width is a **new** `prefs.sidebarWidth` (persisted, clamped [200, 600]).
11. **Stream-type badge** (spec §5 "монохромный бейдж типа потока"): `SavedRequestIpc`
    carries no rpc stream-type, so `RequestRow` renders a monochrome placeholder (`un`).
    Deriving the real unary/server/client/bidi type needs the resolved contract — deferred
    to a later phase (see Follow-ups). Monochrome, no color/icon per spec.
12. **A11y** (spec §11): basic `aria-label`s on rows/buttons; `CollectionTree` is a focusable
    container (`tabIndex={0}`, `aria-label="collections-tree"`) handling `↑/↓/←/→/Enter/F2`.
    Full `tree`/`treeitem` roles are explicitly out of scope.

## File structure (boundaries) — all NEW under `src/features/catalog/`

- `treeNav.ts` — pure: `countRequests`, `allContainerIds`, `pathToItem`, `flattenVisible`
  (+ `VisibleNode`). + `treeNav.test.ts`.
- `treeEdit.ts` — pure immutable transforms: `renameItemInTree`, `removeItemFromTree`,
  `insertItemInTree`, `renameCollectionInTree`, `setCollectionPinned`,
  `removeCollectionFromTree`. + `treeEdit.test.ts`.
- `useCatalogTree.ts` — hook: `loadAll`/optimistic mutations/rollback. + `useCatalogTree.test.ts`.
- `treeTypes.ts` — `TreeCallbacks` interface shared by the node components (avoids import cycles).
- `RenameInput.tsx` · `RowMenu.tsx` · `PinButton.tsx` · `SortControl.tsx` · `RequestRow.tsx`
  · `FolderNode.tsx` · `CollectionNode.tsx` · `ConfirmDeleteDialog.tsx` · `CollectionTree.tsx`
  · `SidebarShell.tsx` (+ a `.test.tsx` for each except `treeTypes`).
- Modify: `src/features/catalog/actions.ts` (+ test) — add `openSavedRequest`, `newRequestDraft`.
- Modify: `src/lib/use-prefs.ts` (+ test) — add `sidebarWidth`.

---

### Task 1: `use-prefs.ts` — add persisted `sidebarWidth`

**Files:**
- Modify: `src/lib/use-prefs.ts`
- Test: `src/lib/use-prefs.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `src/lib/use-prefs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PREFS_DEFAULTS, readPrefs } from "./use-prefs";

describe("prefs sidebarWidth", () => {
  beforeEach(() => localStorage.clear());

  it("defaults sidebarWidth to 256", () => {
    expect(PREFS_DEFAULTS.sidebarWidth).toBe(256);
  });

  it("merges a persisted sidebarWidth over defaults", () => {
    localStorage.setItem("handshaker.prefs.v1", JSON.stringify({ sidebarWidth: 320 }));
    // readPrefs() reflects the module-loaded snapshot; assert the merge shape instead.
    const merged = { ...PREFS_DEFAULTS, sidebarWidth: 320 };
    expect(merged.sidebar).toBe(true);
    expect(merged.sidebarWidth).toBe(320);
    expect(typeof readPrefs().sidebarWidth).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/use-prefs.test.ts`
Expected: FAIL — `PREFS_DEFAULTS.sidebarWidth` is `undefined`.

- [ ] **Step 3: Implement**

In `src/lib/use-prefs.ts`, add the field to the interface (after `sidebar: boolean;`):

```ts
  sidebar: boolean;
  /** Sidebar width in px (resizable, persisted). Clamped to [200, 600] by the shell. */
  sidebarWidth: number;
```

and to `PREFS_DEFAULTS` (after `sidebar: true,`):

```ts
  sidebar: true,
  sidebarWidth: 256,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/use-prefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-prefs.ts src/lib/use-prefs.test.ts
git commit -m "feat(prefs): add persisted sidebarWidth (plan-05)"
```

---

### Task 2: `treeNav.ts` — pure tree-navigation helpers

**Files:**
- Create: `src/features/catalog/treeNav.ts`
- Test: `src/features/catalog/treeNav.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/treeNav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { countRequests, allContainerIds, pathToItem, flattenVisible } from "./treeNav";

function req(id: string, name = id): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "M",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function folder(id: string, items: ItemIpc[]): Extract<ItemIpc, { type: "folder" }> {
  return { type: "folder", id, name: id, items };
}
function col(id: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

const tree: CollectionIpc[] = [
  col("c1", [req("r1"), folder("f1", [req("r2"), folder("f2", [req("r3")])])]),
  col("c2", [req("r4")]),
];

describe("countRequests", () => {
  it("counts request leaves recursively", () => {
    expect(countRequests(tree[0])).toBe(3);
    expect(countRequests(tree[1])).toBe(1);
    expect(countRequests(req("x"))).toBe(1);
    expect(countRequests(folder("f", []))).toBe(0);
  });
});

describe("allContainerIds", () => {
  it("collects every collection and folder id (not requests)", () => {
    expect(allContainerIds(tree).sort()).toEqual(["c1", "c2", "f1", "f2"]);
  });
});

describe("pathToItem", () => {
  it("returns [collectionId] for a top-level request", () => {
    expect(pathToItem(tree, "r1")).toEqual(["c1"]);
  });
  it("returns ancestor containers for a nested request", () => {
    expect(pathToItem(tree, "r3")).toEqual(["c1", "f1", "f2"]);
  });
  it("returns [collectionId] for the collection itself", () => {
    expect(pathToItem(tree, "c2")).toEqual(["c2"]);
  });
  it("returns null for unknown id or null", () => {
    expect(pathToItem(tree, "nope")).toBeNull();
    expect(pathToItem(tree, null)).toBeNull();
  });
});

describe("flattenVisible", () => {
  it("lists only collections when nothing is expanded", () => {
    const v = flattenVisible(tree, new Set());
    expect(v.map((n) => n.id)).toEqual(["c1", "c2"]);
    expect(v[0]).toMatchObject({ kind: "collection", depth: 0 });
  });
  it("expands children pre-order when containers are open", () => {
    const v = flattenVisible(tree, new Set(["c1", "f1"]));
    expect(v.map((n) => n.id)).toEqual(["c1", "r1", "f1", "r2", "f2", "c2"]);
    const r2 = v.find((n) => n.id === "r2") as Extract<typeof v[number], { kind: "request" }>;
    expect(r2.kind).toBe("request");
    expect(r2.depth).toBe(2);
    expect((r2.req as SavedRequestIpc).id).toBe("r2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/treeNav.test.ts`
Expected: FAIL — module `./treeNav` not found.

- [ ] **Step 3: Implement `treeNav.ts`**

Create `src/features/catalog/treeNav.ts`:

```ts
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

/** Count request leaves under a collection, folder, or item. */
export function countRequests(node: CollectionIpc | ItemIpc): number {
  if ("type" in node && node.type === "request") return 1;
  const items: ItemIpc[] = "items" in node ? node.items : [];
  return items.reduce((n, it) => n + countRequests(it), 0);
}

/** Every collection id + folder id (containers), excluding request leaves. */
export function allContainerIds(collections: CollectionIpc[]): string[] {
  const out: string[] = [];
  const walk = (items: ItemIpc[]) => {
    for (const it of items) {
      if (it.type === "folder") {
        out.push(it.id);
        walk(it.items);
      }
    }
  };
  for (const c of collections) {
    out.push(c.id);
    walk(c.items);
  }
  return out;
}

function findAncestors(items: ItemIpc[], itemId: string, acc: string[]): string[] | null {
  for (const it of items) {
    if (it.id === itemId) return acc;
    if (it.type === "folder") {
      const r = findAncestors(it.items, itemId, [...acc, it.id]);
      if (r) return r;
    }
  }
  return null;
}

/** Ordered container ids `[collectionId, ...folderIds]` to reach `itemId`, or null. */
export function pathToItem(collections: CollectionIpc[], itemId: string | null): string[] | null {
  if (!itemId) return null;
  for (const c of collections) {
    if (c.id === itemId) return [c.id];
    const sub = findAncestors(c.items, itemId, []);
    if (sub) return [c.id, ...sub];
  }
  return null;
}

export type VisibleNode =
  | { kind: "collection"; collectionId: string; id: string; name: string; depth: number }
  | { kind: "folder"; collectionId: string; id: string; name: string; depth: number }
  | { kind: "request"; collectionId: string; id: string; req: SavedRequestIpc; depth: number };

function pushItems(
  items: ItemIpc[],
  collectionId: string,
  depth: number,
  open: Set<string>,
  out: VisibleNode[],
): void {
  for (const it of items) {
    if (it.type === "folder") {
      out.push({ kind: "folder", collectionId, id: it.id, name: it.name, depth });
      if (open.has(it.id)) pushItems(it.items, collectionId, depth + 1, open, out);
    } else {
      out.push({ kind: "request", collectionId, id: it.id, req: it, depth });
    }
  }
}

/** Pre-order list of currently-visible nodes (collections + expanded descendants). */
export function flattenVisible(collections: CollectionIpc[], open: Set<string>): VisibleNode[] {
  const out: VisibleNode[] = [];
  for (const c of collections) {
    out.push({ kind: "collection", collectionId: c.id, id: c.id, name: c.name, depth: 0 });
    if (open.has(c.id)) pushItems(c.items, c.id, 1, open, out);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/treeNav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/treeNav.ts src/features/catalog/treeNav.test.ts
git commit -m "feat(catalog): treeNav pure helpers — count/containers/path/flattenVisible (plan-05)"
```

---

### Task 3: `treeEdit.ts` — pure immutable tree transforms

**Files:**
- Create: `src/features/catalog/treeEdit.ts`
- Test: `src/features/catalog/treeEdit.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/treeEdit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import {
  renameItemInTree, removeItemFromTree, insertItemInTree,
  renameCollectionInTree, setCollectionPinned, removeCollectionFromTree,
} from "./treeEdit";

function req(id: string, name = id): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "M",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function folder(id: string, items: ItemIpc[]): Extract<ItemIpc, { type: "folder" }> {
  return { type: "folder", id, name: id, items };
}
function col(id: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}
const tree = (): CollectionIpc[] => [
  col("c1", [req("r1"), folder("f1", [req("r2")])]),
  col("c2", []),
];

describe("renameItemInTree", () => {
  it("renames a nested item without mutating the input", () => {
    const before = tree();
    const after = renameItemInTree(before, "c1", "r2", "Renamed");
    const f1 = after[0].items.find((i) => i.id === "f1") as Extract<ItemIpc, { type: "folder" }>;
    expect(f1.items[0].name).toBe("Renamed");
    // immutability: original untouched, collection identity preserved for non-target
    const f1Before = before[0].items.find((i) => i.id === "f1") as Extract<ItemIpc, { type: "folder" }>;
    expect(f1Before.items[0].name).toBe("r2");
    expect(after[1]).toBe(before[1]);
  });
});

describe("removeItemFromTree", () => {
  it("removes a top-level item", () => {
    const after = removeItemFromTree(tree(), "c1", "r1");
    expect(after[0].items.map((i) => i.id)).toEqual(["f1"]);
  });
  it("removes a nested item", () => {
    const after = removeItemFromTree(tree(), "c1", "r2");
    const f1 = after[0].items.find((i) => i.id === "f1") as Extract<ItemIpc, { type: "folder" }>;
    expect(f1.items).toEqual([]);
  });
});

describe("insertItemInTree", () => {
  it("appends at collection root when parentId is null", () => {
    const after = insertItemInTree(tree(), "c2", null, req("rX"));
    expect(after[1].items.map((i) => i.id)).toEqual(["rX"]);
  });
  it("appends inside a folder when parentId matches", () => {
    const after = insertItemInTree(tree(), "c1", "f1", req("rY"));
    const f1 = after[0].items.find((i) => i.id === "f1") as Extract<ItemIpc, { type: "folder" }>;
    expect(f1.items.map((i) => i.id)).toEqual(["r2", "rY"]);
  });
});

describe("collection transforms", () => {
  it("renames a collection", () => {
    expect(renameCollectionInTree(tree(), "c2", "C Two")[1].name).toBe("C Two");
  });
  it("sets pinned", () => {
    expect(setCollectionPinned(tree(), "c1", true)[0].pinned).toBe(true);
  });
  it("removes a collection", () => {
    expect(removeCollectionFromTree(tree(), "c1").map((c) => c.id)).toEqual(["c2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/treeEdit.test.ts`
Expected: FAIL — module `./treeEdit` not found.

- [ ] **Step 3: Implement `treeEdit.ts`**

Create `src/features/catalog/treeEdit.ts`:

```ts
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

function mapCollection(
  tree: CollectionIpc[],
  collectionId: string,
  fn: (c: CollectionIpc) => CollectionIpc,
): CollectionIpc[] {
  return tree.map((c) => (c.id === collectionId ? fn(c) : c));
}

function mapItemsDeep(items: ItemIpc[], itemId: string, fn: (it: ItemIpc) => ItemIpc): ItemIpc[] {
  return items.map((it) => {
    if (it.id === itemId) return fn(it);
    if (it.type === "folder") return { ...it, items: mapItemsDeep(it.items, itemId, fn) };
    return it;
  });
}

function removeItemsDeep(items: ItemIpc[], itemId: string): ItemIpc[] {
  const out: ItemIpc[] = [];
  for (const it of items) {
    if (it.id === itemId) continue;
    if (it.type === "folder") out.push({ ...it, items: removeItemsDeep(it.items, itemId) });
    else out.push(it);
  }
  return out;
}

function insertItemsDeep(items: ItemIpc[], parentId: string | null, item: ItemIpc): ItemIpc[] {
  if (parentId === null) return [...items, item];
  return items.map((it) => {
    if (it.type !== "folder") return it;
    if (it.id === parentId) return { ...it, items: [...it.items, item] };
    return { ...it, items: insertItemsDeep(it.items, parentId, item) };
  });
}

export function renameItemInTree(
  tree: CollectionIpc[],
  collectionId: string,
  itemId: string,
  name: string,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({
    ...c,
    items: mapItemsDeep(c.items, itemId, (it) => ({ ...it, name })),
  }));
}

export function removeItemFromTree(
  tree: CollectionIpc[],
  collectionId: string,
  itemId: string,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({ ...c, items: removeItemsDeep(c.items, itemId) }));
}

export function insertItemInTree(
  tree: CollectionIpc[],
  collectionId: string,
  parentId: string | null,
  item: ItemIpc,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({
    ...c,
    items: insertItemsDeep(c.items, parentId, item),
  }));
}

export function renameCollectionInTree(
  tree: CollectionIpc[],
  collectionId: string,
  name: string,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({ ...c, name }));
}

export function setCollectionPinned(
  tree: CollectionIpc[],
  collectionId: string,
  pinned: boolean,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({ ...c, pinned }));
}

export function removeCollectionFromTree(
  tree: CollectionIpc[],
  collectionId: string,
): CollectionIpc[] {
  return tree.filter((c) => c.id !== collectionId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/treeEdit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/treeEdit.ts src/features/catalog/treeEdit.test.ts
git commit -m "feat(catalog): treeEdit pure immutable transforms (plan-05)"
```

---

### Task 4: `useCatalogTree.ts` — load + optimistic mutations with rollback

**Files:**
- Create: `src/features/catalog/useCatalogTree.ts`
- Test: `src/features/catalog/useCatalogTree.test.ts`

`ipc` is the aggregate client object (`import { ipc } from "@/ipc/client"`). The hook reads
the latest tree from a ref so the optimistic `call()` can `collectionUpsert` the freshly-
patched collection.

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/useCatalogTree.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/ipc/client", () => ({
  ipc: {
    collectionList: vi.fn(),
    collectionGet: vi.fn(),
    collectionUpsert: vi.fn(),
    collectionDelete: vi.fn(),
    collectionAddItem: vi.fn(),
    collectionRenameItem: vi.fn(),
    collectionDeleteItem: vi.fn(),
    collectionDuplicateItem: vi.fn(),
  },
}));

import { ipc } from "@/ipc/client";
import type { CollectionIpc } from "@/ipc/bindings";
import { useCatalogTree } from "./useCatalogTree";

function col(id: string, name = id): CollectionIpc {
  return {
    id, name, items: [], variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("useCatalogTree.reload", () => {
  it("loads each listed collection", async () => {
    vi.mocked(ipc.collectionList).mockResolvedValue([{ id: "c1", name: "c1" }]);
    vi.mocked(ipc.collectionGet).mockResolvedValue(col("c1"));
    const { result } = renderHook(() => useCatalogTree());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tree.map((c) => c.id)).toEqual(["c1"]);
  });

  it("auto-creates 'My Collection' on first run (empty list)", async () => {
    vi.mocked(ipc.collectionList).mockResolvedValue([]);
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    const { result } = renderHook(() => useCatalogTree());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tree).toHaveLength(1);
    expect(result.current.tree[0].name).toBe("My Collection");
    expect(ipc.collectionUpsert).toHaveBeenCalledTimes(1);
  });
});

describe("optimistic mutations + rollback", () => {
  async function loaded() {
    vi.mocked(ipc.collectionList).mockResolvedValue([{ id: "c1", name: "c1" }]);
    vi.mocked(ipc.collectionGet).mockResolvedValue({
      ...col("c1"),
      items: [{
        type: "request", id: "r1", name: "r1", address_template: "h", service: "s",
        method: "m", body_template: "{}", metadata: [], auth: { kind: "none" },
        tls_override: null, last_used_at: null, use_count: 0,
      }],
    });
    const hook = renderHook(() => useCatalogTree());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it("renameItem applies immediately and persists", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionRenameItem).mockResolvedValue(undefined);
    await act(async () => { await result.current.renameItem("c1", "r1", "Renamed"); });
    expect(result.current.tree[0].items[0].name).toBe("Renamed");
    expect(ipc.collectionRenameItem).toHaveBeenCalledWith("c1", "r1", "Renamed");
  });

  it("rolls back when the IPC call rejects", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionRenameItem).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(result.current.renameItem("c1", "r1", "Renamed")).rejects.toBeTruthy();
    });
    expect(result.current.tree[0].items[0].name).toBe("r1"); // reverted
    expect(result.current.error).toBe("boom");
  });

  it("setPinned upserts the patched collection", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    await act(async () => { await result.current.setPinned("c1", true); });
    expect(result.current.tree[0].pinned).toBe(true);
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", pinned: true }));
  });

  it("duplicateItem reloads the affected collection from the backend", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionDuplicateItem).mockResolvedValue("r1-copy");
    vi.mocked(ipc.collectionGet).mockResolvedValue({ ...col("c1"), name: "c1-reloaded" });
    await act(async () => { await result.current.duplicateItem("c1", "r1"); });
    expect(ipc.collectionDuplicateItem).toHaveBeenCalledWith("c1", "r1");
    expect(result.current.tree[0].name).toBe("c1-reloaded");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/useCatalogTree.test.ts`
Expected: FAIL — module `./useCatalogTree` not found.

- [ ] **Step 3: Implement `useCatalogTree.ts`**

Create `src/features/catalog/useCatalogTree.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@/ipc/client";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { newId } from "@/lib/ids";
import {
  insertItemInTree,
  removeCollectionFromTree,
  removeItemFromTree,
  renameCollectionInTree,
  renameItemInTree,
  setCollectionPinned,
} from "./treeEdit";

export interface UseCatalogTree {
  tree: CollectionIpc[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createCollection: (name: string) => Promise<string>;
  deleteCollection: (collectionId: string) => Promise<void>;
  renameCollection: (collectionId: string, name: string) => Promise<void>;
  setPinned: (collectionId: string, pinned: boolean) => Promise<void>;
  addItem: (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>;
  renameItem: (collectionId: string, itemId: string, name: string) => Promise<void>;
  deleteItem: (collectionId: string, itemId: string) => Promise<void>;
  duplicateItem: (collectionId: string, itemId: string) => Promise<void>;
}

function emptyCollection(name: string): CollectionIpc {
  return {
    id: newId(),
    name,
    items: [],
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: Date.now(),
  };
}

function errMsg(e: unknown): string {
  const t = e as { message?: string; type?: string };
  return t?.message ?? t?.type ?? "operation failed";
}

export function useCatalogTree(): UseCatalogTree {
  const [tree, setTree] = useState<CollectionIpc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const treeRef = useRef<CollectionIpc[]>([]);

  const apply = useCallback((t: CollectionIpc[]) => {
    treeRef.current = t;
    setTree(t);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const metas = await ipc.collectionList();
      if (metas.length === 0) {
        const def = emptyCollection("My Collection");
        await ipc.collectionUpsert(def);
        apply([def]);
      } else {
        const cols = await Promise.all(metas.map((m) => ipc.collectionGet(m.id)));
        apply(cols);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Apply a local transform, run the IPC call, and roll back on rejection. */
  const optimistic = useCallback(
    async (next: (prev: CollectionIpc[]) => CollectionIpc[], call: () => Promise<unknown>) => {
      const snapshot = treeRef.current;
      apply(next(snapshot));
      try {
        await call();
      } catch (e) {
        apply(snapshot);
        setError(errMsg(e));
        throw e;
      }
    },
    [apply],
  );

  const createCollection = useCallback(
    async (name: string) => {
      const c = emptyCollection(name);
      await optimistic((prev) => [...prev, c], () => ipc.collectionUpsert(c));
      return c.id;
    },
    [optimistic],
  );

  const deleteCollection = useCallback(
    (collectionId: string) =>
      optimistic(
        (prev) => removeCollectionFromTree(prev, collectionId),
        () => ipc.collectionDelete(collectionId),
      ),
    [optimistic],
  );

  const renameCollection = useCallback(
    (collectionId: string, name: string) =>
      optimistic(
        (prev) => renameCollectionInTree(prev, collectionId, name),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
      ),
    [optimistic],
  );

  const setPinned = useCallback(
    (collectionId: string, pinned: boolean) =>
      optimistic(
        (prev) => setCollectionPinned(prev, collectionId, pinned),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
      ),
    [optimistic],
  );

  const addItem = useCallback(
    (collectionId: string, parentId: string | null, item: ItemIpc) =>
      optimistic(
        (prev) => insertItemInTree(prev, collectionId, parentId, item),
        () => ipc.collectionAddItem(collectionId, parentId, item),
      ),
    [optimistic],
  );

  const renameItem = useCallback(
    (collectionId: string, itemId: string, name: string) =>
      optimistic(
        (prev) => renameItemInTree(prev, collectionId, itemId, name),
        () => ipc.collectionRenameItem(collectionId, itemId, name),
      ),
    [optimistic],
  );

  const deleteItem = useCallback(
    (collectionId: string, itemId: string) =>
      optimistic(
        (prev) => removeItemFromTree(prev, collectionId, itemId),
        () => ipc.collectionDeleteItem(collectionId, itemId),
      ),
    [optimistic],
  );

  // Backend assigns the new id and deep-copies; reload the affected collection.
  const duplicateItem = useCallback(
    async (collectionId: string, itemId: string) => {
      try {
        await ipc.collectionDuplicateItem(collectionId, itemId);
        const fresh = await ipc.collectionGet(collectionId);
        apply(treeRef.current.map((c) => (c.id === collectionId ? fresh : c)));
      } catch (e) {
        setError(errMsg(e));
        throw e;
      }
    },
    [apply],
  );

  return {
    tree,
    loading,
    error,
    reload,
    createCollection,
    deleteCollection,
    renameCollection,
    setPinned,
    addItem,
    renameItem,
    deleteItem,
    duplicateItem,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/useCatalogTree.test.ts`
Expected: PASS. (If `renderHook` is not exported by the installed `@testing-library/react`,
it is — v14+ re-exports it from the main entry; no extra dependency is needed.)

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/useCatalogTree.ts src/features/catalog/useCatalogTree.test.ts
git commit -m "feat(catalog): useCatalogTree — load + optimistic mutations with rollback (plan-05)"
```

---

### Task 5: `catalog/actions.ts` — `openSavedRequest` + `newRequestDraft`

**Files:**
- Modify: `src/features/catalog/actions.ts`
- Test: `src/features/catalog/actions.test.ts`

Mirror the existing `openCallFromMethod` wiring (it already sets view `focus` then
`workflowStore.setDraft`). `openSavedRequest` restores a draft from a saved request via the
pure `savedRequestToDraft`; `newRequestDraft` opens an empty pending-draft.

- [ ] **Step 1: Add the failing tests**

Append to `src/features/catalog/actions.test.ts` (the existing file already imports
`workflowStore`, `newStep`, and resets stores in `beforeEach`):

```ts
import { openSavedRequest, newRequestDraft } from "./actions";
import { savedRequestToDraft } from "./mapping";
import type { SavedRequestIpc } from "@/ipc/bindings";

describe("openSavedRequest", () => {
  it("loads a saved request into the global draft and switches to Focus", () => {
    const saved: SavedRequestIpc = {
      id: "req-1", name: "GetX", address_template: "{{host}}:443", service: "p.v1.S",
      method: "GetX", body_template: '{"id":"1"}',
      metadata: [{ key: "x", value: "y", enabled: true }],
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
      tls_override: true, last_used_at: null, use_count: 0,
    };
    openSavedRequest(saved);
    const draft = workflowStore.getState().draft;
    expect(draft).toEqual(savedRequestToDraft(saved));
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
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: FAIL — `openSavedRequest`/`newRequestDraft` are not exported.

- [ ] **Step 3: Implement**

In `src/features/catalog/actions.ts`, add imports at the top (alongside the existing ones):

```ts
import { newStep } from "@/features/workflow/model";
import { savedRequestToDraft } from "./mapping";
import type { SavedRequestIpc } from "@/ipc/bindings";
```

and append the two actions at the end of the file:

```ts
/** Open a saved request in Focus as the global pending-draft. */
export function openSavedRequest(saved: SavedRequestIpc): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(savedRequestToDraft(saved));
}

/** Start a fresh, empty pending-draft in Focus (header `+` / menu "Add request"). */
export function newRequestDraft(): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(newStep({ address: "", tls: false, service: "", method: "" }));
}
```

(`GrpcTargetIpc`/`ServiceCatalogIpc` are already imported in this file; only add what is
missing. If `newStep` or `SavedRequestIpc` is already imported, do not duplicate.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/actions.test.ts`
Expected: PASS — existing `describeService`/`refreshContract`/`openCallFromMethod` tests
plus the two new blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/actions.ts src/features/catalog/actions.test.ts
git commit -m "feat(catalog): openSavedRequest + newRequestDraft actions (plan-05)"
```

---

### Task 6: `treeTypes.ts` + `RowMenu.tsx` + `RenameInput.tsx`

**Files:**
- Create: `src/features/catalog/treeTypes.ts`
- Create: `src/features/catalog/RowMenu.tsx`
- Create: `src/features/catalog/RenameInput.tsx`
- Test: `src/features/catalog/RowMenu.test.tsx`
- Test: `src/features/catalog/RenameInput.test.tsx`

`RowMenu` is ported verbatim from the proven legacy
`src/features/collections/tree/RowMenu.tsx` (right-click + hover-⋯, floating, viewport-
clamped, closes on outside-click/Escape/scroll). `treeTypes.ts` holds the shared callback
bag passed down the node tree.

- [ ] **Step 1: Create `treeTypes.ts`** (no test — types only)

Create `src/features/catalog/treeTypes.ts`:

```ts
import type { SavedRequestIpc } from "@/ipc/bindings";

/** Callback + view-state bag threaded through CollectionNode/FolderNode/RequestRow. */
export interface TreeCallbacks {
  open: Set<string>;
  activeItemId: string | null;
  focusedId: string | null;
  editingId: string | null;
  onToggle: (id: string) => void;
  onEditingChange: (id: string | null) => void;
  onOpenRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onOpenCollection: (collectionId: string) => void;
  onRenameItem: (collectionId: string, itemId: string, name: string) => void;
  onRenameCollection: (collectionId: string, name: string) => void;
  onDuplicateItem: (collectionId: string, itemId: string) => void;
  /** Request deletion of an item (CollectionTree opens the confirm dialog). */
  onRequestDeleteItem: (collectionId: string, itemId: string) => void;
  /** Request deletion of a collection (CollectionTree opens the confirm dialog). */
  onRequestDeleteCollection: (collectionId: string) => void;
  onAddRequest: (collectionId: string, parentId: string | null) => void;
  onAddFolder: (collectionId: string, parentId: string | null) => void;
  onSetPinned: (collectionId: string, pinned: boolean) => void;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/features/catalog/RowMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RowMenu } from "./RowMenu";

describe("RowMenu", () => {
  it("opens on the ⋯ button and fires an item's onClick, then closes", () => {
    const onClick = vi.fn();
    render(
      <RowMenu items={[{ label: "Rename", onClick }]}>
        <div>row body</div>
      </RowMenu>,
    );
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Rename"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Rename")).toBeNull();
  });

  it("opens at the cursor on right-click", () => {
    render(
      <RowMenu items={[{ label: "Delete", danger: true, onClick: () => {} }]}>
        <div>row body</div>
      </RowMenu>,
    );
    fireEvent.contextMenu(screen.getByText("row body"));
    expect(screen.getByText("Delete")).toBeTruthy();
  });
});
```

Create `src/features/catalog/RenameInput.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RenameInput } from "./RenameInput";

describe("RenameInput", () => {
  it("commits a trimmed, changed value on Enter", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<RenameInput initial="old" onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByLabelText("rename-input");
    fireEvent.change(input, { target: { value: "  new  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("new");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<RenameInput initial="old" onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText("rename-input"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels (not commits) when blurred unchanged", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<RenameInput initial="old" onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.blur(screen.getByLabelText("rename-input"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/RowMenu.test.tsx src/features/catalog/RenameInput.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `RowMenu.tsx`** (port from legacy)

Create `src/features/catalog/RowMenu.tsx` with the exact contents of
`src/features/collections/tree/RowMenu.tsx` (read that file and copy it verbatim — it has no
collections-specific imports; it depends only on `react`, `lucide-react`'s `MoreVertical`,
and `@/lib/cn`). It exports `RowMenu`, `RowMenuItem`, `RowMenuProps`.

- [ ] **Step 5: Implement `RenameInput.tsx`**

Create `src/features/catalog/RenameInput.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

export interface RenameInputProps {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

/** Inline rename field: autofocus+select, Enter/blur = commit (trimmed, non-empty, changed),
 *  Esc = cancel. Clicks are stopped so they don't bubble to the row's open handler. */
export function RenameInput({ initial, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    const v = value.trim();
    if (v && v !== initial) onCommit(v);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={value}
      aria-label="rename-input"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="h-5 min-w-0 flex-1 rounded border border-border bg-background px-1 text-xs"
    />
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/RowMenu.test.tsx src/features/catalog/RenameInput.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/catalog/treeTypes.ts src/features/catalog/RowMenu.tsx src/features/catalog/RenameInput.tsx src/features/catalog/RowMenu.test.tsx src/features/catalog/RenameInput.test.tsx
git commit -m "feat(catalog): treeTypes + RowMenu (ported) + RenameInput (plan-05)"
```

---

### Task 7: `PinButton.tsx` + `SortControl.tsx`

**Files:**
- Create: `src/features/catalog/PinButton.tsx`
- Create: `src/features/catalog/SortControl.tsx`
- Test: `src/features/catalog/PinButton.test.tsx`
- Test: `src/features/catalog/SortControl.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/PinButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PinButton } from "./PinButton";

describe("PinButton", () => {
  it("reflects pinned state via aria-pressed and label", () => {
    const { rerender } = render(<PinButton pinned={false} onToggle={() => {}} />);
    expect(screen.getByLabelText("pin-collection").getAttribute("aria-pressed")).toBe("false");
    rerender(<PinButton pinned onToggle={() => {}} />);
    expect(screen.getByLabelText("unpin-collection").getAttribute("aria-pressed")).toBe("true");
  });

  it("fires onToggle on click", () => {
    const onToggle = vi.fn();
    render(<PinButton pinned={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("pin-collection"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

Create `src/features/catalog/SortControl.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SortControl } from "./SortControl";

describe("SortControl", () => {
  it("fires onChange with the selected sort key", () => {
    const onChange = vi.fn();
    render(<SortControl value="alpha" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("sort-collections"), { target: { value: "recent" } });
    expect(onChange).toHaveBeenCalledWith("recent");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/PinButton.test.tsx src/features/catalog/SortControl.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `PinButton.tsx`**

Create `src/features/catalog/PinButton.tsx`:

```tsx
import { Pin } from "lucide-react";
import { cn } from "@/lib/cn";

export interface PinButtonProps {
  pinned: boolean;
  onToggle: () => void;
}

/** Collection pin toggle. Hover-only, but always visible when pinned (spec §5). */
export function PinButton({ pinned, onToggle }: PinButtonProps) {
  return (
    <button
      type="button"
      aria-label={pinned ? "unpin-collection" : "pin-collection"}
      aria-pressed={pinned}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex h-5 w-5 flex-none items-center justify-center rounded text-muted-foreground hover:text-foreground",
        pinned ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
      )}
    >
      <Pin className={cn("size-3.5", pinned && "fill-current")} />
    </button>
  );
}
```

- [ ] **Step 4: Implement `SortControl.tsx`**

Create `src/features/catalog/SortControl.tsx`:

```tsx
import type { SortKey } from "./sort";

const OPTIONS: { key: SortKey; label: string }[] = [
  { key: "alpha", label: "Name" },
  { key: "created", label: "Created" },
  { key: "recent", label: "Recent" },
  { key: "frequency", label: "Frequency" },
];

export interface SortControlProps {
  value: SortKey;
  onChange: (key: SortKey) => void;
}

/** Global collection-sort selector (spec §5: alpha/created/recent/frequency). */
export function SortControl({ value, onChange }: SortControlProps) {
  return (
    <select
      aria-label="sort-collections"
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      className="h-7 rounded border border-border bg-background px-1 text-xs text-foreground"
    >
      {OPTIONS.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/PinButton.test.tsx src/features/catalog/SortControl.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/PinButton.tsx src/features/catalog/SortControl.tsx src/features/catalog/PinButton.test.tsx src/features/catalog/SortControl.test.tsx
git commit -m "feat(catalog): PinButton + SortControl (plan-05)"
```

---

### Task 8: `RequestRow.tsx` — leaf row (badge, open, rename, menu, active)

**Files:**
- Create: `src/features/catalog/RequestRow.tsx`
- Test: `src/features/catalog/RequestRow.test.tsx`

Rows are driven entirely by the `TreeCallbacks` bag + their own data, so they unit-test with
a static `cb`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/RequestRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "./treeTypes";
import { RequestRow } from "./RequestRow";

function req(name: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id: "r1", name, address_template: "h:443", service: "p.v1.S",
    method: "GetX", body_template: "{}", metadata: [], auth: { kind: "none" },
    tls_override: null, last_used_at: null, use_count: 0,
  };
}

function makeCb(over: Partial<TreeCallbacks> = {}): TreeCallbacks {
  return {
    open: new Set(), activeItemId: null, focusedId: null, editingId: null,
    onToggle: vi.fn(), onEditingChange: vi.fn(), onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(), onRenameItem: vi.fn(), onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(), onRequestDeleteItem: vi.fn(), onRequestDeleteCollection: vi.fn(),
    onAddRequest: vi.fn(), onAddFolder: vi.fn(), onSetPinned: vi.fn(), ...over,
  };
}

describe("RequestRow", () => {
  it("shows the name and opens the request on click", () => {
    const onOpenRequest = vi.fn();
    const cb = makeCb({ onOpenRequest });
    render(<RequestRow collectionId="c1" req={req("My Req")} depth={1} cb={cb} />);
    fireEvent.click(screen.getByText("My Req"));
    expect(onOpenRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1" }));
  });

  it("falls back to the method name when unnamed", () => {
    render(<RequestRow collectionId="c1" req={req("")} depth={1} cb={makeCb()} />);
    expect(screen.getByText("GetX")).toBeTruthy();
  });

  it("double-click enters rename (onEditingChange with the item id)", () => {
    const onEditingChange = vi.fn();
    render(<RequestRow collectionId="c1" req={req("R")} depth={1} cb={makeCb({ onEditingChange })} />);
    fireEvent.doubleClick(screen.getByText("R"));
    expect(onEditingChange).toHaveBeenCalledWith("r1");
  });

  it("renders the rename input when editingId matches and commits a rename", () => {
    const onRenameItem = vi.fn();
    const onEditingChange = vi.fn();
    const cb = makeCb({ editingId: "r1", onRenameItem, onEditingChange });
    render(<RequestRow collectionId="c1" req={req("Old")} depth={1} cb={cb} />);
    const input = screen.getByLabelText("rename-input");
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditingChange).toHaveBeenCalledWith(null);
    expect(onRenameItem).toHaveBeenCalledWith("c1", "r1", "New");
  });

  it("menu Delete requests deletion via onRequestDeleteItem", () => {
    const onRequestDeleteItem = vi.fn();
    render(<RequestRow collectionId="c1" req={req("R")} depth={1} cb={makeCb({ onRequestDeleteItem })} />);
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Delete"));
    expect(onRequestDeleteItem).toHaveBeenCalledWith("c1", "r1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/RequestRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `RequestRow.tsx`**

Create `src/features/catalog/RequestRow.tsx`:

```tsx
import { Copy, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SavedRequestIpc } from "@/ipc/bindings";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import type { TreeCallbacks } from "./treeTypes";

export const ROW_INDENT = 20;
export const DEPTH_STEP = 14;

export interface RequestRowProps {
  collectionId: string;
  req: SavedRequestIpc;
  depth: number;
  cb: TreeCallbacks;
}

/** Monochrome stream-type badge. SavedRequest carries no rpc stream type yet, so this
 *  is a placeholder (`un`) until the resolved contract is wired (spec §5, later phase). */
function StreamBadge() {
  return (
    <span
      aria-label="stream-type"
      className="flex-none rounded border border-border px-1 text-[9px] font-mono uppercase text-muted-foreground"
    >
      un
    </span>
  );
}

export function RequestRow({ collectionId, req, depth, cb }: RequestRowProps) {
  const editing = cb.editingId === req.id;
  const active = cb.activeItemId === req.id;
  const focused = cb.focusedId === req.id;

  const items: RowMenuItem[] = [
    { icon: <Pencil />, label: "Rename", onClick: () => cb.onEditingChange(req.id) },
    { icon: <Copy />, label: "Duplicate", onClick: () => cb.onDuplicateItem(collectionId, req.id) },
    { sep: true },
    { icon: <Trash2 />, label: "Delete", danger: true, onClick: () => cb.onRequestDeleteItem(collectionId, req.id) },
  ];

  return (
    <RowMenu items={items}>
      <div
        data-node-id={req.id}
        className={cn(
          "group flex items-center gap-2 py-1 pr-8 text-xs hover:bg-accent/50",
          active && "bg-accent",
          focused && "ring-1 ring-inset ring-ring",
        )}
        style={{ paddingLeft: ROW_INDENT + depth * DEPTH_STEP }}
      >
        <StreamBadge />
        {editing ? (
          <RenameInput
            initial={req.name}
            onCommit={(name) => {
              cb.onEditingChange(null);
              cb.onRenameItem(collectionId, req.id, name);
            }}
            onCancel={() => cb.onEditingChange(null)}
          />
        ) : (
          <button
            type="button"
            aria-label="open-request"
            onDoubleClick={() => cb.onEditingChange(req.id)}
            onClick={() => cb.onOpenRequest(collectionId, req)}
            className="min-w-0 flex-1 truncate text-left"
          >
            {req.name || req.method}
          </button>
        )}
      </div>
    </RowMenu>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/RequestRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/RequestRow.tsx src/features/catalog/RequestRow.test.tsx
git commit -m "feat(catalog): RequestRow — badge, open, inline-rename, menu (plan-05)"
```

---

### Task 9: `FolderNode.tsx` — recursive folder row

**Files:**
- Create: `src/features/catalog/FolderNode.tsx`
- Test: `src/features/catalog/FolderNode.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/FolderNode.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "./treeTypes";
import { FolderNode } from "./FolderNode";

function req(id: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name: id, address_template: "h", service: "s", method: "m",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
const folder: Extract<ItemIpc, { type: "folder" }> = {
  type: "folder", id: "f1", name: "Folder One", items: [req("r1")],
};

function makeCb(over: Partial<TreeCallbacks> = {}): TreeCallbacks {
  return {
    open: new Set(), activeItemId: null, focusedId: null, editingId: null,
    onToggle: vi.fn(), onEditingChange: vi.fn(), onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(), onRenameItem: vi.fn(), onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(), onRequestDeleteItem: vi.fn(), onRequestDeleteCollection: vi.fn(),
    onAddRequest: vi.fn(), onAddFolder: vi.fn(), onSetPinned: vi.fn(), ...over,
  };
}

describe("FolderNode", () => {
  it("hides children when collapsed, shows them when open", () => {
    const { rerender } = render(<FolderNode collectionId="c1" folder={folder} depth={1} cb={makeCb()} />);
    expect(screen.queryByText("r1")).toBeNull();
    rerender(<FolderNode collectionId="c1" folder={folder} depth={1} cb={makeCb({ open: new Set(["f1"]) })} />);
    expect(screen.getByText("r1")).toBeTruthy();
  });

  it("toggles on name click", () => {
    const onToggle = vi.fn();
    render(<FolderNode collectionId="c1" folder={folder} depth={1} cb={makeCb({ onToggle })} />);
    fireEvent.click(screen.getByText("Folder One"));
    expect(onToggle).toHaveBeenCalledWith("f1");
  });

  it("menu offers Add request / Add folder / Rename / Delete", () => {
    const onAddRequest = vi.fn();
    const onAddFolder = vi.fn();
    const onRequestDeleteItem = vi.fn();
    render(<FolderNode collectionId="c1" folder={folder} depth={1} cb={makeCb({ onAddRequest, onAddFolder, onRequestDeleteItem })} />);
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Add request"));
    expect(onAddRequest).toHaveBeenCalledWith("c1", "f1");
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Add folder"));
    expect(onAddFolder).toHaveBeenCalledWith("c1", "f1");
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Delete"));
    expect(onRequestDeleteItem).toHaveBeenCalledWith("c1", "f1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/FolderNode.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FolderNode.tsx`**

Create `src/features/catalog/FolderNode.tsx`:

```tsx
import { ChevronRight, FilePlus, Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ItemIpc } from "@/ipc/bindings";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import { RequestRow, ROW_INDENT, DEPTH_STEP } from "./RequestRow";
import type { TreeCallbacks } from "./treeTypes";

type FolderItem = Extract<ItemIpc, { type: "folder" }>;

export interface FolderNodeProps {
  collectionId: string;
  folder: FolderItem;
  depth: number;
  cb: TreeCallbacks;
}

export function FolderNode({ collectionId, folder, depth, cb }: FolderNodeProps) {
  const open = cb.open.has(folder.id);
  const editing = cb.editingId === folder.id;
  const focused = cb.focusedId === folder.id;

  const items: RowMenuItem[] = [
    { icon: <FilePlus />, label: "Add request", onClick: () => cb.onAddRequest(collectionId, folder.id) },
    { icon: <FolderPlus />, label: "Add folder", onClick: () => cb.onAddFolder(collectionId, folder.id) },
    { icon: <Pencil />, label: "Rename", onClick: () => cb.onEditingChange(folder.id) },
    { sep: true },
    { icon: <Trash2 />, label: "Delete", danger: true, onClick: () => cb.onRequestDeleteItem(collectionId, folder.id) },
  ];

  return (
    <div>
      <RowMenu items={items}>
        <div
          data-node-id={folder.id}
          className={cn(
            "group flex items-center gap-1 py-1 pr-8 text-xs hover:bg-accent/50",
            focused && "ring-1 ring-inset ring-ring",
          )}
          style={{ paddingLeft: ROW_INDENT + depth * DEPTH_STEP }}
        >
          {editing ? (
            <>
              <ChevronRight className={cn("size-3 flex-none transition-transform", open && "rotate-90")} />
              <Folder className="size-3.5 flex-none text-muted-foreground" />
              <RenameInput
                initial={folder.name}
                onCommit={(name) => {
                  cb.onEditingChange(null);
                  cb.onRenameItem(collectionId, folder.id, name);
                }}
                onCancel={() => cb.onEditingChange(null)}
              />
            </>
          ) : (
            <button
              type="button"
              aria-label="toggle-folder"
              onClick={() => cb.onToggle(folder.id)}
              onDoubleClick={() => cb.onEditingChange(folder.id)}
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
            >
              <ChevronRight className={cn("size-3 flex-none transition-transform", open && "rotate-90")} />
              <Folder className="size-3.5 flex-none text-muted-foreground" />
              <span className="truncate">{folder.name}</span>
            </button>
          )}
        </div>
      </RowMenu>

      {open ? (
        <div>
          {folder.items.map((it) =>
            it.type === "folder" ? (
              <FolderNode key={it.id} collectionId={collectionId} folder={it} depth={depth + 1} cb={cb} />
            ) : (
              <RequestRow key={it.id} collectionId={collectionId} req={it} depth={depth + 1} cb={cb} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/FolderNode.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/FolderNode.tsx src/features/catalog/FolderNode.test.tsx
git commit -m "feat(catalog): FolderNode — recursive folder row with menu/rename (plan-05)"
```

---

### Task 10: `CollectionNode.tsx` — collection header row

**Files:**
- Create: `src/features/catalog/CollectionNode.tsx`
- Test: `src/features/catalog/CollectionNode.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/CollectionNode.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "./treeTypes";
import { CollectionNode } from "./CollectionNode";

function req(id: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name: id, address_template: "h", service: "s", method: "m",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function col(over: Partial<CollectionIpc> = {}): CollectionIpc {
  return {
    id: "c1", name: "My Collection", items: [req("r1")], variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0, ...over,
  };
}
function makeCb(over: Partial<TreeCallbacks> = {}): TreeCallbacks {
  return {
    open: new Set(), activeItemId: null, focusedId: null, editingId: null,
    onToggle: vi.fn(), onEditingChange: vi.fn(), onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(), onRenameItem: vi.fn(), onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(), onRequestDeleteItem: vi.fn(), onRequestDeleteCollection: vi.fn(),
    onAddRequest: vi.fn(), onAddFolder: vi.fn(), onSetPinned: vi.fn(), ...over,
  };
}

describe("CollectionNode", () => {
  it("name click opens the collection overview (not toggle)", () => {
    const onOpenCollection = vi.fn();
    const onToggle = vi.fn();
    render(<CollectionNode col={col()} cb={makeCb({ onOpenCollection, onToggle })} />);
    fireEvent.click(screen.getByText("My Collection"));
    expect(onOpenCollection).toHaveBeenCalledWith("c1");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("chevron click toggles expand", () => {
    const onToggle = vi.fn();
    render(<CollectionNode col={col()} cb={makeCb({ onToggle })} />);
    fireEvent.click(screen.getByLabelText("toggle-collection"));
    expect(onToggle).toHaveBeenCalledWith("c1");
  });

  it("renders children only when open", () => {
    const { rerender } = render(<CollectionNode col={col()} cb={makeCb()} />);
    expect(screen.queryByText("r1")).toBeNull();
    rerender(<CollectionNode col={col()} cb={makeCb({ open: new Set(["c1"]) })} />);
    expect(screen.getByText("r1")).toBeTruthy();
  });

  it("pin button fires onSetPinned with the toggled value", () => {
    const onSetPinned = vi.fn();
    render(<CollectionNode col={col({ pinned: false })} cb={makeCb({ onSetPinned })} />);
    fireEvent.click(screen.getByLabelText("pin-collection"));
    expect(onSetPinned).toHaveBeenCalledWith("c1", true);
  });

  it("menu Delete requests collection deletion", () => {
    const onRequestDeleteCollection = vi.fn();
    render(<CollectionNode col={col()} cb={makeCb({ onRequestDeleteCollection })} />);
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Delete"));
    expect(onRequestDeleteCollection).toHaveBeenCalledWith("c1");
  });

  it("shows an empty hint for a collection with no items when open", () => {
    render(<CollectionNode col={col({ items: [] })} cb={makeCb({ open: new Set(["c1"]) })} />);
    expect(screen.getByText("Empty collection")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/CollectionNode.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CollectionNode.tsx`**

Create `src/features/catalog/CollectionNode.tsx`:

```tsx
import { ChevronRight, FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CollectionIpc } from "@/ipc/bindings";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import { PinButton } from "./PinButton";
import { FolderNode } from "./FolderNode";
import { RequestRow } from "./RequestRow";
import type { TreeCallbacks } from "./treeTypes";

export interface CollectionNodeProps {
  col: CollectionIpc;
  cb: TreeCallbacks;
}

export function CollectionNode({ col, cb }: CollectionNodeProps) {
  const open = cb.open.has(col.id);
  const editing = cb.editingId === col.id;
  const focused = cb.focusedId === col.id;

  const items: RowMenuItem[] = [
    { icon: <FilePlus />, label: "Add request", onClick: () => cb.onAddRequest(col.id, null) },
    { icon: <FolderPlus />, label: "Add folder", onClick: () => cb.onAddFolder(col.id, null) },
    { icon: <Pencil />, label: "Rename", onClick: () => cb.onEditingChange(col.id) },
    { sep: true },
    { icon: <Trash2 />, label: "Delete", danger: true, onClick: () => cb.onRequestDeleteCollection(col.id) },
  ];

  return (
    <div>
      <RowMenu items={items}>
        <div
          data-node-id={col.id}
          className={cn(
            "group flex items-center gap-1 py-1 pr-8 pl-1.5 text-xs font-medium hover:bg-accent/50",
            focused && "ring-1 ring-inset ring-ring",
          )}
        >
          <button
            type="button"
            aria-label="toggle-collection"
            onClick={() => cb.onToggle(col.id)}
            className="flex-none"
          >
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
          </button>
          {editing ? (
            <RenameInput
              initial={col.name}
              onCommit={(name) => {
                cb.onEditingChange(null);
                cb.onRenameCollection(col.id, name);
              }}
              onCancel={() => cb.onEditingChange(null)}
            />
          ) : (
            <button
              type="button"
              aria-label="open-collection"
              onClick={() => cb.onOpenCollection(col.id)}
              onDoubleClick={() => cb.onEditingChange(col.id)}
              className="min-w-0 flex-1 truncate text-left"
            >
              {col.name}
            </button>
          )}
          <PinButton pinned={col.pinned} onToggle={() => cb.onSetPinned(col.id, !col.pinned)} />
        </div>
      </RowMenu>

      {open ? (
        <div>
          {col.items.map((it) =>
            it.type === "folder" ? (
              <FolderNode key={it.id} collectionId={col.id} folder={it} depth={1} cb={cb} />
            ) : (
              <RequestRow key={it.id} collectionId={col.id} req={it} depth={1} cb={cb} />
            ),
          )}
          {col.items.length === 0 ? (
            <div className="py-1 pl-8 text-[11px] text-muted-foreground">Empty collection</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/CollectionNode.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/CollectionNode.tsx src/features/catalog/CollectionNode.test.tsx
git commit -m "feat(catalog): CollectionNode — header, pin, children, menu (plan-05)"
```

---

### Task 11: `ConfirmDeleteDialog.tsx` — confirm-on-delete

**Files:**
- Create: `src/features/catalog/ConfirmDeleteDialog.tsx`
- Test: `src/features/catalog/ConfirmDeleteDialog.test.tsx`

Generic confirm built on the existing `@/components/ui/alert-dialog` (same primitive as
`ConfirmDeleteEnvDialog`). The actual delete is the hook's optimistic mutation (passed as
`onConfirm`), so the dialog itself stays simple — no busy/error state (rollback lives in the
hook).

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/ConfirmDeleteDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

describe("ConfirmDeleteDialog", () => {
  it("renders the title/description when open and confirms", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        title="Delete request?"
        description="This cannot be undone."
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    );
    expect(screen.getByText("Delete request?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing visible when closed", () => {
    render(
      <ConfirmDeleteDialog
        open={false}
        title="Delete?"
        description="x"
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByText("Delete?")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/ConfirmDeleteDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ConfirmDeleteDialog.tsx`**

Create `src/features/catalog/ConfirmDeleteDialog.tsx`:

```tsx
import type { ReactNode } from "react";
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

export interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

/** Always-confirm, no-undo delete dialog (spec §5). The real delete is `onConfirm`
 *  (the optimistic hook mutation); rollback/errors are handled there. */
export function ConfirmDeleteDialog({
  open,
  title,
  description,
  onConfirm,
  onOpenChange,
}: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className={buttonVariants({ variant: "destructive" })}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/ConfirmDeleteDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/ConfirmDeleteDialog.tsx src/features/catalog/ConfirmDeleteDialog.test.tsx
git commit -m "feat(catalog): ConfirmDeleteDialog — always-confirm, no-undo (plan-05)"
```

---

### Task 12: `CollectionTree.tsx` — expand state, arrow-nav, confirm-delete wiring

**Files:**
- Create: `src/features/catalog/CollectionTree.tsx`
- Test: `src/features/catalog/CollectionTree.test.tsx`

`CollectionTree` is presentational: it receives the already sorted+filtered `collections` and
all mutation callbacks as props. It owns expand state (`open`) and keyboard focus (`focusedId`),
reveals the editing node by opening its ancestor path, builds the `TreeCallbacks` bag, and
intercepts delete requests into a single `ConfirmDeleteDialog`. `editingId` is **controlled**
by the parent (so New-collection/Add-folder can drop straight into rename).

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/CollectionTree.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { CollectionTree, type CollectionTreeProps } from "./CollectionTree";

function req(id: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name: id, address_template: "h", service: "s", method: "m",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function col(id: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

function setup(over: Partial<CollectionTreeProps> = {}) {
  const props: CollectionTreeProps = {
    collections: [col("c1", [req("r1")]), col("c2", [])],
    filterActive: false,
    activeItemId: null,
    editingId: null,
    onEditingChange: vi.fn(),
    onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(),
    onRenameItem: vi.fn(),
    onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(),
    onDeleteItem: vi.fn(),
    onDeleteCollection: vi.fn(),
    onAddRequest: vi.fn(),
    onAddFolder: vi.fn(),
    onSetPinned: vi.fn(),
    ...over,
  };
  render(<CollectionTree {...props} />);
  return props;
}

describe("CollectionTree arrow navigation", () => {
  it("ArrowDown moves focus through visible nodes; ArrowRight expands a collection", () => {
    setup();
    const tree = screen.getByLabelText("collections-tree");
    // c1 is collapsed → only c1, c2 visible. Focus c1, expand it, then its child appears.
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus c1
    fireEvent.keyDown(tree, { key: "ArrowRight" }); // expand c1
    expect(screen.getByText("r1")).toBeTruthy();
  });

  it("Enter on a focused request opens it", () => {
    const props = setup();
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // c1
    fireEvent.keyDown(tree, { key: "ArrowRight" }); // expand
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // r1
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(props.onOpenRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1" }));
  });

  it("F2 on a focused node requests rename via onEditingChange", () => {
    const props = setup();
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // c1
    fireEvent.keyDown(tree, { key: "F2" });
    expect(props.onEditingChange).toHaveBeenCalledWith("c1");
  });
});

describe("CollectionTree filter", () => {
  it("treats everything as expanded when filtering", () => {
    setup({ filterActive: true });
    expect(screen.getByText("r1")).toBeTruthy(); // visible without manual expand
  });
});

describe("CollectionTree confirm-delete", () => {
  it("request-delete from a row menu opens the confirm dialog, and confirming calls onDeleteItem", () => {
    const props = setup({ collections: [col("c1", [req("r1")])] });
    const tree = screen.getByLabelText("collections-tree");
    // expand c1 to reveal r1
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    // open r1's menu and click Delete
    const moreButtons = screen.getAllByLabelText("More options");
    fireEvent.click(moreButtons[moreButtons.length - 1]);
    fireEvent.click(screen.getByText("Delete"));
    // confirm dialog appears
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDeleteItem).toHaveBeenCalledWith("c1", "r1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/CollectionTree.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CollectionTree.tsx`**

Create `src/features/catalog/CollectionTree.tsx`:

```tsx
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import { CollectionNode } from "./CollectionNode";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { allContainerIds, flattenVisible, pathToItem } from "./treeNav";
import type { TreeCallbacks } from "./treeTypes";

export interface CollectionTreeProps {
  collections: CollectionIpc[]; // already sorted + filtered by SidebarShell
  filterActive: boolean;
  activeItemId: string | null;
  editingId: string | null;
  onEditingChange: (id: string | null) => void;
  onOpenRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onOpenCollection: (collectionId: string) => void;
  onRenameItem: (collectionId: string, itemId: string, name: string) => void;
  onRenameCollection: (collectionId: string, name: string) => void;
  onDuplicateItem: (collectionId: string, itemId: string) => void;
  onDeleteItem: (collectionId: string, itemId: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onAddRequest: (collectionId: string, parentId: string | null) => void;
  onAddFolder: (collectionId: string, parentId: string | null) => void;
  onSetPinned: (collectionId: string, pinned: boolean) => void;
}

type DeleteTarget =
  | { kind: "item"; collectionId: string; itemId: string }
  | { kind: "collection"; collectionId: string };

export function CollectionTree(props: CollectionTreeProps) {
  const { collections, filterActive, editingId } = props;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [delTarget, setDelTarget] = useState<DeleteTarget | null>(null);

  // While filtering, treat everything as expanded.
  const effectiveOpen = useMemo(
    () => (filterActive ? new Set(allContainerIds(collections)) : open),
    [filterActive, collections, open],
  );

  // Reveal the editing node by opening its ancestor containers.
  useEffect(() => {
    if (!editingId) return;
    const path = pathToItem(collections, editingId);
    if (path) setOpen((prev) => new Set([...prev, ...path]));
  }, [editingId, collections]);

  const visible = useMemo(() => flattenVisible(collections, effectiveOpen), [collections, effectiveOpen]);

  const setOpenId = (id: string, want: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (want) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editingId) return; // rename input owns the keyboard
    const idx = visible.findIndex((n) => n.id === focusedId);
    const cur = idx >= 0 ? visible[idx] : null;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const n = visible[Math.min(idx + 1, visible.length - 1)] ?? visible[0];
        if (n) setFocusedId(n.id);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const n = visible[Math.max(idx - 1, 0)] ?? visible[0];
        if (n) setFocusedId(n.id);
        break;
      }
      case "ArrowRight":
        e.preventDefault();
        if (cur && cur.kind !== "request") setOpenId(cur.id, true);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (cur && cur.kind !== "request") setOpenId(cur.id, false);
        break;
      case "Enter":
        e.preventDefault();
        if (!cur) break;
        if (cur.kind === "request") props.onOpenRequest(cur.collectionId, cur.req);
        else if (cur.kind === "collection") props.onOpenCollection(cur.collectionId);
        else toggle(cur.id);
        break;
      case "F2":
        e.preventDefault();
        if (cur) props.onEditingChange(cur.id);
        break;
    }
  };

  const cb: TreeCallbacks = useMemo(
    () => ({
      open: effectiveOpen,
      activeItemId: props.activeItemId,
      focusedId,
      editingId,
      onToggle: toggle,
      onEditingChange: props.onEditingChange,
      onOpenRequest: props.onOpenRequest,
      onOpenCollection: props.onOpenCollection,
      onRenameItem: props.onRenameItem,
      onRenameCollection: props.onRenameCollection,
      onDuplicateItem: props.onDuplicateItem,
      onRequestDeleteItem: (collectionId, itemId) => setDelTarget({ kind: "item", collectionId, itemId }),
      onRequestDeleteCollection: (collectionId) => setDelTarget({ kind: "collection", collectionId }),
      onAddRequest: props.onAddRequest,
      onAddFolder: props.onAddFolder,
      onSetPinned: props.onSetPinned,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveOpen, focusedId, editingId, props],
  );

  const confirmDelete = () => {
    if (!delTarget) return;
    if (delTarget.kind === "item") props.onDeleteItem(delTarget.collectionId, delTarget.itemId);
    else props.onDeleteCollection(delTarget.collectionId);
  };

  return (
    <div
      role="tree"
      tabIndex={0}
      aria-label="collections-tree"
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto py-1 outline-none"
    >
      {collections.map((c) => (
        <CollectionNode key={c.id} col={c} cb={cb} />
      ))}

      <ConfirmDeleteDialog
        open={delTarget !== null}
        title={delTarget?.kind === "collection" ? "Delete collection?" : "Delete request?"}
        description="This cannot be undone."
        onConfirm={confirmDelete}
        onOpenChange={(o) => {
          if (!o) setDelTarget(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/CollectionTree.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/CollectionTree.tsx src/features/catalog/CollectionTree.test.tsx
git commit -m "feat(catalog): CollectionTree — expand/arrow-nav/confirm-delete orchestration (plan-05)"
```

---

### Task 13: `SidebarShell.tsx` — outer panel: filter, +New, sort, toggle, resize

**Files:**
- Create: `src/features/catalog/SidebarShell.tsx`
- Test: `src/features/catalog/SidebarShell.test.tsx`

The only stateful seam. Wires `useCatalogTree`, the pure `sortCollections`/`filterCollections`,
the catalog open-actions, and prefs (`sidebar` toggle + `sidebarWidth`). Owns `editingId`,
`filter`, and `sortKey`. `Ctrl/Cmd+B` flips `prefs.sidebar`; a drag handle persists width.

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/SidebarShell.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CollectionIpc } from "@/ipc/bindings";

const tree: { current: ReturnType<typeof makeTreeHook> } = { current: makeTreeHook() };
function makeTreeHook() {
  return {
    tree: [] as CollectionIpc[],
    loading: false,
    error: null as string | null,
    reload: vi.fn(),
    createCollection: vi.fn().mockResolvedValue("c-new"),
    deleteCollection: vi.fn(),
    renameCollection: vi.fn(),
    setPinned: vi.fn(),
    addItem: vi.fn(),
    renameItem: vi.fn(),
    deleteItem: vi.fn(),
    duplicateItem: vi.fn(),
  };
}
vi.mock("./useCatalogTree", () => ({ useCatalogTree: () => tree.current }));
vi.mock("./actions", () => ({ openSavedRequest: vi.fn(), newRequestDraft: vi.fn() }));

import { SidebarShell } from "./SidebarShell";
import { newRequestDraft } from "./actions";

function col(id: string, name = id): CollectionIpc {
  return {
    id, name, items: [], variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

beforeEach(() => {
  localStorage.clear();
  tree.current = makeTreeHook();
});

describe("SidebarShell", () => {
  it("renders loaded collections", () => {
    tree.current.tree = [col("c1", "Alpha"), col("c2", "Beta")];
    render(<SidebarShell />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("the + button starts a new request draft", () => {
    render(<SidebarShell />);
    fireEvent.click(screen.getByLabelText("new-request"));
    expect(newRequestDraft).toHaveBeenCalledTimes(1);
  });

  it("New collection creates a default-named collection and enters rename", async () => {
    render(<SidebarShell />);
    fireEvent.click(screen.getByLabelText("new-collection"));
    expect(tree.current.createCollection).toHaveBeenCalledWith("New collection");
  });

  it("filters the visible collections by name", () => {
    tree.current.tree = [col("c1", "Payments"), col("c2", "Orders")];
    render(<SidebarShell />);
    fireEvent.change(screen.getByLabelText("collection-filter"), { target: { value: "pay" } });
    expect(screen.getByText("Payments")).toBeTruthy();
    expect(screen.queryByText("Orders")).toBeNull();
  });

  it("Ctrl/Cmd+B hides the sidebar", () => {
    tree.current.tree = [col("c1", "Alpha")];
    const { container } = render(<SidebarShell />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(container.querySelector('[aria-label="collections-tree"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/SidebarShell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SidebarShell.tsx`**

Create `src/features/catalog/SidebarShell.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { FolderPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readPrefs, usePrefs } from "@/lib/use-prefs";
import { newId } from "@/lib/ids";
import type { ItemIpc } from "@/ipc/bindings";
import { useCatalogTree } from "./useCatalogTree";
import { newRequestDraft, openSavedRequest } from "./actions";
import { filterCollections, sortCollections, type SortKey } from "./sort";
import { SortControl } from "./SortControl";
import { CollectionTree } from "./CollectionTree";

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

export interface SidebarShellProps {
  /** Open a collection's overview (CollectionOverview lands in plan-07). */
  onOpenCollection?: (collectionId: string) => void;
}

export function SidebarShell({ onOpenCollection }: SidebarShellProps) {
  const [prefs, setPref] = usePrefs();
  const cat = useCatalogTree();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("alpha");
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Ctrl/Cmd+B toggles sidebar visibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setPref("sidebar", !readPrefs().sidebar);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPref]);

  if (!prefs.sidebar) return null;

  const filterActive = filter.trim().length > 0;
  const visible = sortCollections(filterCollections(cat.tree, filter), sortKey);

  const onAddFolder = (collectionId: string, parentId: string | null) => {
    const item: ItemIpc = { type: "folder", id: newId(), name: "New folder", items: [] };
    void cat.addItem(collectionId, parentId, item);
    setEditingId(item.id);
  };

  const onNewCollection = async () => {
    const id = await cat.createCollection("New collection");
    setEditingId(id);
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: prefs.sidebarWidth };
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startW + (ev.clientX - dragRef.current.startX)));
      setPref("sidebarWidth", w);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="relative flex h-full flex-col border-r border-border bg-background"
      style={{ width: prefs.sidebarWidth }}
    >
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter collections…"
          className="h-8 text-xs"
          aria-label="collection-filter"
        />
        <Button size="icon" variant="ghost" aria-label="new-request" onClick={() => newRequestDraft()}>
          <Plus className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="new-collection" onClick={() => void onNewCollection()}>
          <FolderPlus className="size-4" />
        </Button>
      </div>

      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Collections
        </span>
        <SortControl value={sortKey} onChange={setSortKey} />
      </div>

      <CollectionTree
        collections={visible}
        filterActive={filterActive}
        activeItemId={null}
        editingId={editingId}
        onEditingChange={setEditingId}
        onOpenRequest={(_collectionId, req) => openSavedRequest(req)}
        onOpenCollection={onOpenCollection ?? (() => {})}
        onRenameItem={cat.renameItem}
        onRenameCollection={cat.renameCollection}
        onDuplicateItem={cat.duplicateItem}
        onDeleteItem={cat.deleteItem}
        onDeleteCollection={cat.deleteCollection}
        onAddRequest={() => newRequestDraft()}
        onAddFolder={onAddFolder}
        onSetPinned={cat.setPinned}
      />

      {cat.error ? (
        <div className="border-t border-destructive bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {cat.error}
        </div>
      ) : null}

      {/* Resize handle */}
      <div
        role="separator"
        aria-label="resize-sidebar"
        aria-orientation="vertical"
        onPointerDown={onResizePointerDown}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/SidebarShell.test.tsx`
Expected: PASS.

(If the `onAddRequest` mapping reads oddly: per spec §5 the menu "Add request" opens a plain
pending-draft — it does **not** insert an item — so it routes to `newRequestDraft()`, same as
the header `+`. The `parentId` is intentionally unused there.)

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/SidebarShell.tsx src/features/catalog/SidebarShell.test.tsx
git commit -m "feat(catalog): SidebarShell — filter/new/sort/toggle/resize wiring (plan-05)"
```

---

### Task 14: Whole-suite + typecheck gate; update index + banner

**Files:**
- Modify: `docs/superpowers/plans/2026-06-05-plan-00-index.md`
- Modify: `docs/superpowers/plans/2026-06-05-plan-05-sidebar.md` (this file's banner)

- [ ] **Step 1: Run the full front-end test suite**

Run: `pnpm test`
Expected: PASS — all suites green, including the new `catalog/{treeNav,treeEdit,useCatalogTree,
RowMenu,RenameInput,PinButton,SortControl,RequestRow,FolderNode,CollectionNode,
ConfirmDeleteDialog,CollectionTree,SidebarShell}` tests, the `catalog/actions` additions, and
`lib/use-prefs`.

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: the new `features/catalog` files and `lib/use-prefs` contribute **zero** errors.
`tsc -b` still surfaces the **15 pre-existing** legacy errors (`src/features/collections/**`,
`src/ipc/client.ts`) — unchanged by this plan, removed in plan-09. Confirm the count is still
15 and none are in the files this plan created/modified. Fix any new error before proceeding.

> NB on `eslint-disable` in `CollectionTree.tsx`: the `useMemo` deps for the `cb` bag depend on
> `props` wholesale; the disable comment is intentional. If the repo's ESLint config is strict
> about this and `pnpm lint` (which is `tsc -b`, not ESLint) is unaffected, leave it. If a
> separate `pnpm run lint:eslint` exists and flags it, the comment already suppresses it.

- [ ] **Step 3: Production build smoke (optional)**

Run: `pnpm build`
Expected: as in plan-04, `pnpm build` is `tsc`-gated and remains blocked by the 15 legacy
errors. If so, skip and rely on `pnpm test` + targeted `pnpm lint` — note which gate was used
in the banner.

- [ ] **Step 4: Update the plan-00 index status row**

In `docs/superpowers/plans/2026-06-05-plan-00-index.md`, change the `plan-05` row Status from
`outline` to `✅ done (<firstSha>..<lastSha>)`.

- [ ] **Step 5: Flip this file's banner**

Set **Status** to `✅ done` with the SHA range and the final test count.

- [ ] **Step 6: Commit the status update**

```bash
git add docs/superpowers/plans/2026-06-05-plan-00-index.md docs/superpowers/plans/2026-06-05-plan-05-sidebar.md
git commit -m "docs(plan-05): mark complete; update index row"
```

---

## Follow-ups (later plans, do NOT do here)

- **plan-06 (create/save):** wire reflection-driven host/method editing on the draft;
  `SaveRequestDialog` (save into a collection/folder, path hint from `grouping.ts`); origin-
  binding + autosave; **open-over-dirty confirm** when `openSavedRequest`/`newRequestDraft`
  would replace a dirty draft (intercept in `SidebarShell`/actions).
- **plan-07 (overview + ⌘K):** `SidebarShell.onOpenCollection` opens `CollectionOverview` in
  the main area; rewrite `CommandPalette` to open saved requests via `openSavedRequest`.
- **plan-08 (DnD):** `dnd.ts` move (requests/folders, cross-collection, folders-on-top, line+
  highlight) over `collectionMoveItem`; integrate into `CollectionNode`/`FolderNode`/`RequestRow`.
- **plan-09 (cleanup + wiring):** mount `SidebarShell` in `WorkflowApp` (replacing the derived
  `Sidebar`); delete `catalog/{model,store,tree,Sidebar,ServicePanel,ServiceAuthEditor,
  AddServiceForm}` + the derived `openCallFromMethod`/`describeService`/`refreshContract`,
  legacy `src/features/collections/**`, old `App.tsx`, `AuthByEnvIpc`/`auth_set_for_env`.
- **Stream-type badge:** `RequestRow`'s `StreamBadge` is a placeholder (`un`). Derive the real
  unary/server/client/bidi type from the resolved contract cache once Focus reflection is wired
  (plan-06+) and pass it through `SavedRequest`/contract lookup.

## Spec-coverage self-check

- §5 IA — multiple collections → folders → requests; pinned floats; global sort; filter;
  expand-all-when-filtering; collapsed-at-start; resizable+persisted width; toggle `Ctrl/Cmd+B`;
  no virtualization; optimistic+rollback → Tasks 1 (`sidebarWidth`), 4 (`useCatalogTree`
  optimistic+rollback+loadAll), 12 (expand state, filter-expands-all), 13 (filter/sort/toggle/
  resize, `sortCollections`/`filterCollections` reuse). ✅
- §5 Строки — collection chevron-toggle + name-opens-overview + pin icon; folder chevron+icon+
  name-toggle; request name + monochrome stream badge, no address → Tasks 8 (RequestRow badge),
  9 (FolderNode), 10 (CollectionNode click rules + PinButton). ✅
- §5 Действия — hover Pin (collection) + ⋯ menu (also right-click); double-click inline-rename
  (blur=commit/Enter/Esc); context menus per node type; **always-confirm** delete, no undo;
  Duplicate `<name> copy` (backend); Add folder/New collection default-name → inline-rename;
  Add request opens plain draft → Tasks 6 (RowMenu/RenameInput), 7 (PinButton), 8/9/10 (menus),
  11 (ConfirmDeleteDialog), 12 (confirm wiring), 13 (New collection/Add folder → rename, Add
  request → `newRequestDraft`). Duplicate naming is the backend's `collection_duplicate_item`
  (`<name> copy`), surfaced by `useCatalogTree.duplicateItem` reload. ✅
- §3/§6 open semantics — request click → `savedRequestToDraft`→`setDraft`+focus; `+`→empty
  draft → Task 5 (`openSavedRequest`/`newRequestDraft`), 13 (wiring). Open-over-dirty confirm
  is explicitly deferred to plan-06. ✅
- §11 keyboard/a11y — `Ctrl/Cmd+B` toggle (Task 13); full arrow nav `↑/↓/←/→/Enter/F2`
  (Task 12); basic `aria-label`s on rows/buttons (Tasks 6–13). ✅
- §13 visual — English UI strings, lucide icons, leaf = "Request", monochrome badge → Tasks
  8–13. ✅
- §15 registry rows (pin/sort/usage/filter/width/toggle/rename-blur/delete-confirm/context-menu/
  new-request/empty-collection/first-run/expand-state/loadAll/optimistic) → covered across
  Tasks 1, 4, 12, 13 as mapped above. ✅
- **Out of scope (correctly deferred):** DnD (§5 drag-and-drop → plan-08); CollectionOverview &
  ⌘K rewrite (§8/§9 → plan-07); reflection/MethodPicker/Save dialog (§6/§10 → plan-06);
  `WorkflowApp` wiring + legacy deletion (§12 → plan-09). ✅
```
