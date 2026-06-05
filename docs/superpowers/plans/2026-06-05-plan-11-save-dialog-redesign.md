# Save-Dialog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** ready for execution · **Branch:** `redesign/workflow-ui-spec-plans`
**Spec:** `docs/superpowers/specs/2026-06-05-save-request-dialog-redesign-design.md`

**Goal:** Replace the two-`<select>` Save dialog with a Postman-style navigable collection/folder picker (80vh, scrollable tree, search) plus a server-structure recommendation chip (`NotesApiService/Create` → folder `NotesApi`, name `Create`).

**Architecture:** A new pure function `suggestSaveTarget` derives folder + request name from the gRPC service/method. A pure `augmentTree` helper splices not-yet-saved ("pending") collections/folders into the real tree so the picker renders uniformly. A new presentational `CollectionPicker` renders the augmented tree with single-select + search (reusing `flattenVisible` from `treeNav`). `SaveRequestDialog` is rewritten to compose these, hold pending state, and materialize pending nodes into real ids at Save before calling the unchanged `onSave`. No backend, `useCatalogTree`, or `saveNewRequest` changes.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, shadcn/ui `Dialog`/`Input`/`Button`/`Label`, Tailwind.

**Test commands:**
- Single file: `pnpm exec vitest run src/features/catalog/<file>.test.tsx`
- All: `pnpm test`

---

## File Structure

- **Create** `src/features/catalog/savePicker.ts` — `PendingCollection`/`PendingFolder` types + pure `augmentTree`.
- **Create** `src/features/catalog/savePicker.test.ts` — unit tests for `augmentTree`.
- **Create** `src/features/catalog/CollectionPicker.tsx` — presentational navigable single-select tree + search filter.
- **Create** `src/features/catalog/CollectionPicker.test.tsx` — component tests.
- **Modify** `src/features/catalog/grouping.ts` — add `suggestSaveTarget`, export `serviceShortName`, remove `suggestSavePath`.
- **Modify** `src/features/catalog/grouping.test.ts` — add `suggestSaveTarget` tests, remove `suggestSavePath` tests.
- **Rewrite** `src/features/catalog/SaveRequestDialog.tsx` — new props + layout + chip + picker + pending state + materialization.
- **Rewrite** `src/features/catalog/SaveRequestDialog.test.tsx` — tests for the new behavior.
- **Modify** `src/app/WorkflowApp.tsx` — pass `collections`/`draftService`/`draftMethod`/`onCreateFolder`; drop `metas`/`loadCollection`/`suggestedPath`/`suggestSavePath` import.

---

## Task 1: `suggestSaveTarget` pure function

**Files:**
- Modify: `src/features/catalog/grouping.ts:13-22`
- Test: `src/features/catalog/grouping.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire `describe("suggestSavePath", ...)` block (lines 5-25) in `grouping.test.ts` with:

```ts
describe("suggestSaveTarget", () => {
  it("drops a trailing 'Service' suffix from the short service name", () => {
    expect(suggestSaveTarget("notes.v1.NotesApiService", "Create")).toEqual({
      folderName: "NotesApi",
      requestName: "Create",
    });
  });

  it("keeps the short name when there is no 'Service' suffix", () => {
    expect(suggestSaveTarget("payments.v1.Payments", "Charge")).toEqual({
      folderName: "Payments",
      requestName: "Charge",
    });
  });

  it("uses only the last dot-segment of the service", () => {
    expect(suggestSaveTarget("pkg.sub.EchoService", "Ping").folderName).toBe("Echo");
  });

  it("never collapses a bare 'Service' to an empty folder name", () => {
    expect(suggestSaveTarget("Service", "Do").folderName).toBe("Service");
  });

  it("passes the method through as the request name", () => {
    expect(suggestSaveTarget("a.b.FooService", "DeleteThing").requestName).toBe("DeleteThing");
  });
});
```

Update the import on line 2 to drop `suggestSavePath` and add `suggestSaveTarget`:

```ts
import { suggestSaveTarget, findSavedLocations } from "./grouping";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/grouping.test.ts`
Expected: FAIL — `suggestSaveTarget is not a function` (or import error).

- [ ] **Step 3: Implement `suggestSaveTarget` and remove `suggestSavePath`**

In `grouping.ts`, replace lines 13-22 (the `serviceShortName` helper + `suggestSavePath`) with:

```ts
/** Last dot-segment of a full service name. */
export function serviceShortName(service: string): string {
  const parts = service.split(".");
  return (parts[parts.length - 1] ?? "").trim();
}

export interface SaveTarget {
  /** Folder name derived from the service (short name minus a trailing "Service"). */
  folderName: string;
  /** Request name = the method's short name. */
  requestName: string;
}

/**
 * Recommend where a gRPC call should be saved, mirroring the server's structure:
 * `notes.v1.NotesApiService` + `Create` → folder `NotesApi`, request `Create`.
 * A trailing "Service" is stripped, but a bare "Service" is left intact (never empty).
 */
export function suggestSaveTarget(service: string, method: string): SaveTarget {
  const short = serviceShortName(service);
  const stripped = short.replace(/Service$/, "");
  return {
    folderName: stripped.length > 0 ? stripped : short,
    requestName: method.trim(),
  };
}
```

Note: `hostOf` (lines 8-11) becomes unused after removing `suggestSavePath` — delete the `hostOf` function too.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/grouping.test.ts`
Expected: PASS (all `suggestSaveTarget` + existing `findSavedLocations` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/grouping.ts src/features/catalog/grouping.test.ts
git commit -m "feat(catalog): suggestSaveTarget — derive folder+name from gRPC service/method (plan-11)"
```

---

## Task 2: `augmentTree` + pending types

Pending (not-yet-saved) collections/folders are spliced into the real tree so the picker renders them as ordinary nodes. Their `id` is a temporary id; the dialog resolves temp→real at Save (Task 7).

**Files:**
- Create: `src/features/catalog/savePicker.ts`
- Test: `src/features/catalog/savePicker.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/savePicker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { augmentTree } from "./savePicker";
import type { CollectionIpc } from "@/ipc/bindings";

function col(id: string, name: string, items: CollectionIpc["items"] = []): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

describe("augmentTree", () => {
  it("returns the tree unchanged when there is nothing pending", () => {
    const tree = [col("c1", "My APIs")];
    expect(augmentTree(tree, [], [])).toEqual(tree);
  });

  it("appends pending collections as empty collections", () => {
    const out = augmentTree([col("c1", "My APIs")], [{ tempId: "t1", name: "Sandbox" }], []);
    expect(out.map((c) => c.name)).toEqual(["My APIs", "Sandbox"]);
    expect(out[1]).toMatchObject({ id: "t1", name: "Sandbox", items: [] });
  });

  it("inserts a pending folder at the collection root", () => {
    const out = augmentTree(
      [col("c1", "My APIs")],
      [],
      [{ tempId: "f1", collectionId: "c1", parentId: null, name: "NotesApi" }],
    );
    expect(out[0].items).toEqual([{ type: "folder", id: "f1", name: "NotesApi", items: [] }]);
  });

  it("inserts a pending folder inside a pending collection", () => {
    const out = augmentTree(
      [],
      [{ tempId: "t1", name: "New" }],
      [{ tempId: "f1", collectionId: "t1", parentId: null, name: "NotesApi" }],
    );
    expect(out[0].items).toEqual([{ type: "folder", id: "f1", name: "NotesApi", items: [] }]);
  });

  it("nests a pending folder under an earlier pending folder", () => {
    const out = augmentTree(
      [col("c1", "My APIs")],
      [],
      [
        { tempId: "f1", collectionId: "c1", parentId: null, name: "Outer" },
        { tempId: "f2", collectionId: "c1", parentId: "f1", name: "Inner" },
      ],
    );
    const outer = out[0].items[0];
    expect(outer).toMatchObject({ id: "f1", name: "Outer" });
    expect(outer.type === "folder" && outer.items).toEqual([
      { type: "folder", id: "f2", name: "Inner", items: [] },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/savePicker.test.ts`
Expected: FAIL — cannot find module `./savePicker`.

- [ ] **Step 3: Implement `savePicker.ts`**

Create `src/features/catalog/savePicker.ts`:

```ts
import type { CollectionIpc } from "@/ipc/bindings";
import { insertItemInTree } from "./treeEdit";

/** A collection the user added in the Save dialog but hasn't persisted yet. */
export interface PendingCollection {
  tempId: string;
  name: string;
}

/** A folder the user added in the Save dialog but hasn't persisted yet.
 *  `collectionId`/`parentId` may reference a pending node's tempId. */
export interface PendingFolder {
  tempId: string;
  collectionId: string;
  parentId: string | null;
  name: string;
}

function emptyCollection(id: string, name: string): CollectionIpc {
  return {
    id,
    name,
    items: [],
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: 0,
  };
}

/**
 * Splice pending collections/folders into a copy of the real tree so the picker
 * renders them as ordinary nodes. Pending folders are applied in array order, so a
 * parent folder must appear before its children (the dialog appends in that order).
 */
export function augmentTree(
  collections: CollectionIpc[],
  pendingCollections: PendingCollection[],
  pendingFolders: PendingFolder[],
): CollectionIpc[] {
  let tree: CollectionIpc[] = [
    ...collections,
    ...pendingCollections.map((p) => emptyCollection(p.tempId, p.name)),
  ];
  for (const pf of pendingFolders) {
    tree = insertItemInTree(tree, pf.collectionId, pf.parentId, {
      type: "folder",
      id: pf.tempId,
      name: pf.name,
      items: [],
    });
  }
  return tree;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/savePicker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/savePicker.ts src/features/catalog/savePicker.test.ts
git commit -m "feat(catalog): augmentTree + pending types for the Save picker (plan-11)"
```

---

## Task 3: `CollectionPicker` component

Presentational. Renders the (already-augmented) tree, supports expand/collapse, single-select of a collection or folder, and a search filter. Reuses `flattenVisible` + `allContainerIds` from `treeNav`. Requests are NOT shown (this picks a save *destination*, not a request).

**Files:**
- Create: `src/features/catalog/CollectionPicker.tsx`
- Test: `src/features/catalog/CollectionPicker.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/CollectionPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CollectionPicker, type PickTarget } from "./CollectionPicker";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

function folder(id: string, name: string, items: ItemIpc[] = []): ItemIpc {
  return { type: "folder", id, name, items };
}
function col(id: string, name: string, items: ItemIpc[] = []): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

const tree = [
  col("c1", "My APIs", [folder("f1", "Staging"), folder("f2", "Prod")]),
  col("c2", "Sandbox"),
];

function setup(over: Partial<React.ComponentProps<typeof CollectionPicker>> = {}) {
  const onChange = vi.fn();
  const value: PickTarget = { collectionId: "c1", parentId: null };
  render(
    <CollectionPicker collections={tree} query="" value={value} onChange={onChange} {...over} />,
  );
  return { onChange };
}

describe("CollectionPicker", () => {
  it("renders top-level collections", () => {
    setup();
    expect(screen.getByText("My APIs")).toBeTruthy();
    expect(screen.getByText("Sandbox")).toBeTruthy();
  });

  it("selecting a collection emits {collectionId, parentId:null}", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByText("Sandbox"));
    expect(onChange).toHaveBeenCalledWith({ collectionId: "c2", parentId: null });
  });

  it("expanding a collection reveals its folders, and selecting one emits parentId=folderId", () => {
    const { onChange } = setup();
    // expand c1 via its toggle, then pick the folder
    fireEvent.click(screen.getByLabelText("expand My APIs"));
    fireEvent.click(screen.getByText("Staging"));
    expect(onChange).toHaveBeenCalledWith({ collectionId: "c1", parentId: "f1" });
  });

  it("with a query, filters to matching nodes and shows them expanded", () => {
    setup({ query: "prod" });
    expect(screen.getByText("Prod")).toBeTruthy();
    expect(screen.queryByText("Sandbox")).toBeNull();
  });

  it("marks the selected node", () => {
    setup();
    expect(screen.getByText("My APIs").closest("[data-selected='true']")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/CollectionPicker.test.tsx`
Expected: FAIL — cannot find module `./CollectionPicker`.

- [ ] **Step 3: Implement `CollectionPicker.tsx`**

Create `src/features/catalog/CollectionPicker.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { CollectionIpc } from "@/ipc/bindings";
import { allContainerIds, flattenVisible } from "./treeNav";

export interface PickTarget {
  collectionId: string;
  parentId: string | null; // null = collection root; otherwise a folder id
}

export interface CollectionPickerProps {
  collections: CollectionIpc[];
  query: string;
  value: PickTarget | null;
  onChange: (t: PickTarget) => void;
}

/** Case-insensitive substring filter that keeps a container if it OR any descendant matches. */
function filterTree(collections: CollectionIpc[], q: string): CollectionIpc[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return collections;
  const keepItems = (items: CollectionIpc["items"]): CollectionIpc["items"] =>
    items
      .filter((it) => it.type === "folder")
      .map((it) => (it.type === "folder" ? { ...it, items: keepItems(it.items) } : it))
      .filter((it) => it.type === "folder" && (it.name.toLowerCase().includes(needle) || it.items.length > 0));
  return collections
    .map((c) => ({ ...c, items: keepItems(c.items) }))
    .filter((c) => c.name.toLowerCase().includes(needle) || c.items.length > 0);
}

export function CollectionPicker({ collections, query, value, onChange }: CollectionPickerProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => filterTree(collections, query), [collections, query]);
  const filtering = query.trim().length > 0;
  const effectiveOpen = useMemo(
    () => (filtering ? new Set(allContainerIds(filtered)) : open),
    [filtering, filtered, open],
  );

  // Only containers (collections + folders) are selectable destinations.
  const visible = useMemo(
    () => flattenVisible(filtered, effectiveOpen).filter((n) => n.kind !== "request"),
    [filtered, effectiveOpen],
  );

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isSelected = (n: { kind: string; collectionId: string; id: string }) =>
    value != null &&
    value.collectionId === n.collectionId &&
    (n.kind === "collection" ? value.parentId === null : value.parentId === n.id);

  return (
    <div role="tree" aria-label="save-destination" className="min-h-0 flex-1 overflow-auto rounded-md border border-input p-1">
      {visible.map((n) => {
        const expandable = n.kind !== "request";
        const expanded = effectiveOpen.has(n.id);
        return (
          <div
            key={n.id}
            role="treeitem"
            data-selected={isSelected(n)}
            aria-selected={isSelected(n)}
            onClick={() => onChange({ collectionId: n.collectionId, parentId: n.kind === "collection" ? null : n.id })}
            style={{ paddingLeft: 6 + n.depth * 16 }}
            className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-accent ${
              isSelected(n) ? "bg-accent" : ""
            }`}
          >
            {expandable ? (
              <button
                type="button"
                aria-label={`expand ${n.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(n.id);
                }}
                className="w-4 text-muted-foreground"
              >
                {expanded ? "▾" : "▸"}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span>📁</span>
            <span className="truncate">{n.name}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/CollectionPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/CollectionPicker.tsx src/features/catalog/CollectionPicker.test.tsx
git commit -m "feat(catalog): CollectionPicker — navigable single-select destination tree (plan-11)"
```

---

## Task 4: Rewrite `SaveRequestDialog` shell (props + layout + picker + search)

This task establishes the new prop surface, 80vh layout, name prefill, search box, and the picker — WITHOUT the chip or "+ New" yet (those are Tasks 5-6). Save in this task writes to the currently-selected real target (no pending materialization yet — added in Task 7).

**Files:**
- Rewrite: `src/features/catalog/SaveRequestDialog.tsx`
- Rewrite: `src/features/catalog/SaveRequestDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the ENTIRE contents of `src/features/catalog/SaveRequestDialog.test.tsx` with:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveRequestDialog } from "./SaveRequestDialog";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

function folder(id: string, name: string, items: ItemIpc[] = []): ItemIpc {
  return { type: "folder", id, name, items };
}
function col(id: string, name: string, items: ItemIpc[] = []): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

const collections = [col("c1", "My APIs", [folder("f1", "Staging")]), col("c2", "Sandbox")];

function props(over = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    collections,
    defaultName: "Create",
    draftService: "notes.v1.NotesApiService",
    draftMethod: "Create",
    onSave: vi.fn().mockResolvedValue(undefined),
    onCreateCollection: vi.fn().mockResolvedValue("c-new"),
    onCreateFolder: vi.fn().mockResolvedValue("f-new"),
    existingLocations: [],
    ...over,
  };
}

describe("SaveRequestDialog — shell", () => {
  it("prefills the name from defaultName", () => {
    render(<SaveRequestDialog {...props()} />);
    expect((screen.getByLabelText("Request name") as HTMLInputElement).value).toBe("Create");
  });

  it("saves to the selected collection root by default (first collection)", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: null, name: "Create" }),
    );
  });

  it("saves into a folder the user selects", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByLabelText("expand My APIs"));
    fireEvent.click(screen.getByText("Staging"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: "f1", name: "Create" }),
    );
  });

  it("filters the tree via the search box", () => {
    render(<SaveRequestDialog {...props()} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "sandbox" } });
    expect(screen.getByText("Sandbox")).toBeTruthy();
    expect(screen.queryByText("My APIs")).toBeNull();
  });

  it("originBound mode shows only the name field titled 'Update request'", () => {
    render(<SaveRequestDialog {...props({ originBound: true })} />);
    expect(screen.getByText("Update request")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: FAIL — old component props (`metas`/`loadCollection`) gone; `getByLabelText("Request name")` not found.

- [ ] **Step 3: Rewrite `SaveRequestDialog.tsx`**

Replace the ENTIRE contents of `src/features/catalog/SaveRequestDialog.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CollectionIpc } from "@/ipc/bindings";
import type { SaveLocation } from "./grouping";
import { CollectionPicker, type PickTarget } from "./CollectionPicker";

export interface SaveRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full catalog tree (collections with items). */
  collections: CollectionIpc[];
  /** Initial request name (method short name). */
  defaultName: string;
  /** gRPC service/method of the draft — drives the recommendation chip. */
  draftService: string;
  draftMethod: string;
  onSave: (args: { collectionId: string; parentId: string | null; name: string }) => Promise<void>;
  onCreateCollection: (name: string) => Promise<string>;
  /** Create a folder; returns its new id. */
  onCreateFolder: (collectionId: string, parentId: string | null, name: string) => Promise<string>;
  /** When true the request already belongs to a collection; only the Name field is shown. */
  originBound?: boolean;
  /** Existing saved copies of this call (display-only "already saved in" hint). */
  existingLocations?: SaveLocation[];
}

export function SaveRequestDialog(props: SaveRequestDialogProps) {
  const { open, onOpenChange, collections, defaultName, onSave, originBound, existingLocations } = props;
  const [name, setName] = useState(defaultName);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<PickTarget | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setQuery("");
      setTarget(collections.length > 0 ? { collectionId: collections[0].id, parentId: null } : null);
    }
  }, [open, defaultName, collections]);

  async function submit() {
    if (!name.trim() || !target) return;
    setBusy(true);
    try {
      if (originBound) {
        await onSave({ collectionId: "", parentId: null, name: name.trim() });
      } else {
        await onSave({ collectionId: target.collectionId, parentId: target.parentId, name: name.trim() });
      }
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-[640px] flex-col">
        <DialogHeader>
          <DialogTitle>{originBound ? "Update request" : "Save request"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="save-name" className="text-xs">Request name</Label>
          <Input
            id="save-name"
            aria-label="Request name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My request"
            autoFocus
          />
        </div>

        {!originBound && (
          <>
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

            <Input
              placeholder="🔍 Search collection or folder"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <CollectionPicker collections={collections} query={query} value={target} onChange={setTarget} />
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note: `useMemo` is imported for use in Tasks 5-6; if your linter flags it as unused now, leave it — Task 5 uses it. If the lint config errors on unused imports in CI, drop `useMemo` here and re-add it in Task 5.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/SaveRequestDialog.tsx src/features/catalog/SaveRequestDialog.test.tsx
git commit -m "feat(catalog): rewrite SaveRequestDialog shell — 80vh picker + search (plan-11)"
```

---

## Task 5: Recommendation chip + "Добавить"

The chip shows the full recommended path `<selected collection> / <folderName> / <name>` and an "Добавить" button that adds the recommended folder (as a pending folder) under the selected collection and selects it. Shown only when `draftService` and `draftMethod` are non-empty. If a real folder named `folderName` already exists at the collection root, "Добавить" selects it instead of adding a duplicate.

**Files:**
- Modify: `src/features/catalog/SaveRequestDialog.tsx`
- Modify: `src/features/catalog/SaveRequestDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("SaveRequestDialog — shell", ...)` block (or add a new describe block) in `SaveRequestDialog.test.tsx`:

```tsx
describe("SaveRequestDialog — recommendation chip", () => {
  it("shows the recommended full path from the selected collection", () => {
    render(<SaveRequestDialog {...props()} />);
    // first collection = "My APIs"; service NotesApiService → folder "NotesApi"; name "Create"
    expect(screen.getByText(/My APIs\s*\/\s*NotesApi\s*\/\s*Create/)).toBeTruthy();
  });

  it("hides the chip when the draft has no method", () => {
    render(<SaveRequestDialog {...props({ draftMethod: "", draftService: "" })} />);
    expect(screen.queryByText(/Рекомендуем/i)).toBeNull();
  });

  it("'Добавить' adds the recommended folder and saves into it", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onCreateFolder).toHaveBeenCalledWith("c1", null, "NotesApi"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: "f-new", name: "Create" }),
    );
  });

  it("'Добавить' reuses an existing folder of the same name (no duplicate)", async () => {
    const withFolder = [col("c1", "My APIs", [folder("nf", "NotesApi")]), col("c2", "Sandbox")];
    const p = props({ collections: withFolder });
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: "nf", name: "Create" }),
    );
    expect(p.onCreateFolder).not.toHaveBeenCalled();
  });
});
```

These tests reference pending-folder materialization (`onCreateFolder` returning `f-new`, then `onSave` with `parentId: "f-new"`). Task 7 implements materialization; in THIS task implement the chip + pending state so the "shows path" / "hides chip" tests pass. The two `onCreateFolder`/`onSave` assertions will pass once Task 7 lands — to keep this task green now, the chip's "Добавить" must already record a pending folder and the submit path must already resolve it. Therefore this task ALSO implements materialization for the single-pending-folder case (Task 7 generalizes + adds pending collections).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: FAIL — no chip text, no "Добавить" button.

- [ ] **Step 3: Implement the chip + pending folder + single-folder materialization**

In `SaveRequestDialog.tsx`:

(a) Update imports:

```tsx
import { newId } from "@/lib/ids";
import { suggestSaveTarget } from "./grouping";
import { augmentTree, type PendingFolder } from "./savePicker";
```

(b) Destructure the two new props at the top of the component body:

```tsx
const { draftService, draftMethod, onCreateFolder } = props;
```

(c) Add pending-folder state next to the other `useState` hooks:

```tsx
const [pendingFolders, setPendingFolders] = useState<PendingFolder[]>([]);
```

(d) Reset it in the `open` effect (add `setPendingFolders([])` inside the `if (open)` block).

(e) Derive the recommendation and the augmented tree (place after the state hooks):

```tsx
const reco = useMemo(
  () => (draftService && draftMethod ? suggestSaveTarget(draftService, draftMethod) : null),
  [draftService, draftMethod],
);

const augmented = useMemo(
  () => augmentTree(collections, [], pendingFolders),
  [collections, pendingFolders],
);

const selectedCollection = target
  ? augmented.find((c) => c.id === target.collectionId) ?? null
  : null;
```

The chip composes its path string directly from `selectedCollection.name`, `reco.folderName`, and `name` (see step (g)) — there is no separate `fullPath` variable.

(f) Render `CollectionPicker` against `augmented` (change its `collections={collections}` to `collections={augmented}`).

(g) Add the chip + "Добавить" handler. Insert this JSX directly above the search `<Input>` (inside the `!originBound` block):

```tsx
{reco && reco.folderName && (
  <div className="rounded-md border border-blue-500/60 bg-blue-500/10 px-2.5 py-2 text-xs">
    <div className="mb-0.5 text-blue-400">✨ Рекомендуем сохранить как</div>
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-foreground">
        {(selectedCollection?.name ?? "") + " / " + reco.folderName + " / " + name.trim()}
      </span>
      <Button size="sm" variant="secondary" onClick={applyReco}>Добавить</Button>
    </div>
  </div>
)}
```

(h) Add the `applyReco` handler (above `submit`):

```tsx
function applyReco() {
  if (!reco || !target) return;
  const collection = augmented.find((c) => c.id === target.collectionId);
  if (!collection) return;
  // Reuse an existing root folder of the same name.
  const existing = collection.items.find(
    (it) => it.type === "folder" && it.name === reco.folderName,
  );
  if (existing) {
    setTarget({ collectionId: target.collectionId, parentId: existing.id });
    return;
  }
  const tempId = newId();
  setPendingFolders((prev) => [
    ...prev,
    { tempId, collectionId: target.collectionId, parentId: null, name: reco.folderName },
  ]);
  setTarget({ collectionId: target.collectionId, parentId: tempId });
}
```

(i) Replace the `submit()` body's non-originBound branch to materialize pending folders. Replace the whole `submit` function with:

```tsx
async function submit() {
  if (!name.trim() || !target) return;
  setBusy(true);
  try {
    if (originBound) {
      await onSave({ collectionId: "", parentId: null, name: name.trim() });
      onOpenChange(false);
      return;
    }
    // Resolve the (possibly pending) target into a real {collectionId, parentId}.
    const idMap = new Map<string, string>();
    for (const pf of pendingFolders) {
      const realCollectionId = idMap.get(pf.collectionId) ?? pf.collectionId;
      const realParentId = pf.parentId ? idMap.get(pf.parentId) ?? pf.parentId : null;
      const newRealId = await onCreateFolder(realCollectionId, realParentId, pf.name);
      idMap.set(pf.tempId, newRealId);
    }
    const finalCollectionId = idMap.get(target.collectionId) ?? target.collectionId;
    const finalParentId = target.parentId ? idMap.get(target.parentId) ?? target.parentId : null;
    await onSave({ collectionId: finalCollectionId, parentId: finalParentId, name: name.trim() });
    onOpenChange(false);
  } finally {
    setBusy(false);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: PASS (all shell + chip tests green).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/SaveRequestDialog.tsx src/features/catalog/SaveRequestDialog.test.tsx
git commit -m "feat(catalog): Save dialog recommendation chip + pending-folder apply (plan-11)"
```

---

## Task 6: Contextual "＋ New" (collection / folder)

A single button whose label + action depend on the current selection: no selection / collection-root semantics → "New collection"; a collection selected → "New folder in «X»"; a folder selected → "New folder in «folder»". New collections are tracked as pending (materialized at Save in Task 7).

**Files:**
- Modify: `src/features/catalog/SaveRequestDialog.tsx`
- Modify: `src/features/catalog/SaveRequestDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add a new describe block to `SaveRequestDialog.test.tsx`:

```tsx
describe("SaveRequestDialog — contextual New", () => {
  it("labels the button 'New folder in' the selected collection", () => {
    render(<SaveRequestDialog {...props()} />);
    expect(screen.getByRole("button", { name: /New folder in .*My APIs/ })).toBeTruthy();
  });

  it("creates a new folder under the selected collection and saves into it", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /New folder in/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Billing" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onCreateFolder).toHaveBeenCalledWith("c1", null, "Billing"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: "f-new", name: "Create" }),
    );
  });

  it("labels the button 'New collection' when nothing is selected", () => {
    render(<SaveRequestDialog {...props({ collections: [] })} />);
    expect(screen.getByRole("button", { name: /New collection/ })).toBeTruthy();
  });

  it("creates a new collection (pending) and saves into it", async () => {
    const p = props({ collections: [] });
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /New collection/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onCreateCollection).toHaveBeenCalledWith("Fresh"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c-new", parentId: null, name: "Create" }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: FAIL — no "New …" button / no "New node name" input.

- [ ] **Step 3: Implement contextual New + pending collections**

In `SaveRequestDialog.tsx`:

(a) Extend the `savePicker` import to add the pending-collection type. Change the line added in Task 5:

```tsx
import { augmentTree, type PendingFolder } from "./savePicker";
```

to:

```tsx
import { augmentTree, type PendingFolder, type PendingCollection } from "./savePicker";
```

(b) Destructure `onCreateCollection`:

```tsx
const { draftService, draftMethod, onCreateFolder, onCreateCollection } = props;
```

(c) Add pending-collection state + an inline-input state:

```tsx
const [pendingCollections, setPendingCollections] = useState<PendingCollection[]>([]);
const [adding, setAdding] = useState(false);
const [newName, setNewName] = useState("");
```

Reset all three in the `open` effect (`setPendingCollections([]); setAdding(false); setNewName("");`).

(d) Update `augmented` to include pending collections:

```tsx
const augmented = useMemo(
  () => augmentTree(collections, pendingCollections, pendingFolders),
  [collections, pendingCollections, pendingFolders],
);
```

(e) Compute the contextual button label:

```tsx
const newLabel = !target
  ? "＋ New collection"
  : `＋ New folder in "${selectedCollection?.name ?? ""}"`;
```

(f) Add the create handler:

```tsx
function commitNew() {
  const trimmed = newName.trim();
  if (!trimmed) return;
  if (!target) {
    // New top-level collection.
    const tempId = newId();
    setPendingCollections((prev) => [...prev, { tempId, name: trimmed }]);
    setTarget({ collectionId: tempId, parentId: null });
  } else {
    // New folder under the current selection (collection root or folder).
    const tempId = newId();
    setPendingFolders((prev) => [
      ...prev,
      { tempId, collectionId: target.collectionId, parentId: target.parentId, name: trimmed },
    ]);
    setTarget({ collectionId: target.collectionId, parentId: tempId });
  }
  setAdding(false);
  setNewName("");
}
```

(g) Render the contextual control below the picker (inside `!originBound`, after `<CollectionPicker .../>`):

```tsx
<div className="flex items-center gap-2">
  {adding ? (
    <>
      <Input
        aria-label="New node name"
        autoFocus
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitNew();
          if (e.key === "Escape") setAdding(false);
        }}
        placeholder="Name"
        className="h-7 text-xs"
      />
      <Button size="sm" onClick={commitNew}>Add</Button>
      <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
    </>
  ) : (
    <button
      type="button"
      className="text-[11px] text-muted-foreground hover:text-foreground"
      onClick={() => setAdding(true)}
    >
      {newLabel}
    </button>
  )}
</div>
```

(h) Generalize `submit()` to materialize pending COLLECTIONS before folders. At the start of the non-originBound branch (before the pending-folders loop), add:

```tsx
for (const pc of pendingCollections) {
  const realId = await onCreateCollection(pc.name);
  idMap.set(pc.tempId, realId);
}
```

(The pending-folders loop already maps `pf.collectionId` through `idMap`, so a folder inside a pending collection resolves correctly.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/SaveRequestDialog.tsx src/features/catalog/SaveRequestDialog.test.tsx
git commit -m "feat(catalog): Save dialog contextual New (collection/folder) + pending collections (plan-11)"
```

---

## Task 7: Verify full materialization ordering (regression guard)

Tasks 5-6 already implemented materialization; this task adds an explicit regression test for the hardest path — a new collection containing a new folder — to lock the temp→real ordering.

**Files:**
- Modify: `src/features/catalog/SaveRequestDialog.test.tsx`

- [ ] **Step 1: Write the test**

Add to `SaveRequestDialog.test.tsx`:

```tsx
describe("SaveRequestDialog — pending materialization order", () => {
  it("creates a pending collection, then a folder inside it, then saves with real ids", async () => {
    const onCreateCollection = vi.fn().mockResolvedValue("real-col");
    const onCreateFolder = vi.fn().mockResolvedValue("real-folder");
    const p = props({ collections: [], onCreateCollection, onCreateFolder });
    render(<SaveRequestDialog {...p} />);

    // New collection
    fireEvent.click(screen.getByRole("button", { name: /New collection/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // New folder inside it (selection is now the pending collection root)
    fireEvent.click(screen.getByRole("button", { name: /New folder in .*Acme/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "NotesApi" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCreateCollection).toHaveBeenCalledWith("Acme"));
    await waitFor(() => expect(onCreateFolder).toHaveBeenCalledWith("real-col", null, "NotesApi"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({
        collectionId: "real-col",
        parentId: "real-folder",
        name: "Create",
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: PASS (materialization from Tasks 5-6 already handles this). If it FAILS, fix the ordering in `submit()` — pending collections must be resolved before pending folders, and `idMap` lookups must cover both `collectionId` and `parentId`.

- [ ] **Step 3: Commit**

```bash
git add src/features/catalog/SaveRequestDialog.test.tsx
git commit -m "test(catalog): lock Save dialog pending collection→folder materialization order (plan-11)"
```

---

## Task 8: Wire `WorkflowApp` to the new dialog

**Files:**
- Modify: `src/app/WorkflowApp.tsx:23` (import), `:177-200` (dialog usage)

- [ ] **Step 1: Update the `grouping` import**

Change line 23 from:

```tsx
import { suggestSavePath, findSavedLocations } from "@/features/catalog/grouping";
```

to:

```tsx
import { findSavedLocations } from "@/features/catalog/grouping";
```

- [ ] **Step 2: Add a `createFolder` helper**

Add near `handleSave` (after the `handleSave` function, before the `return`):

```tsx
const createFolder = (collectionId: string, parentId: string | null, name: string) => {
  const id = newId();
  return cat.addItem(collectionId, parentId, { type: "folder", id, name, items: [] }).then(() => id);
};
```

Add the import at the top of `WorkflowApp.tsx` if not present:

```tsx
import { newId } from "@/lib/ids";
```

- [ ] **Step 3: Replace the `<SaveRequestDialog .../>` props**

Replace the existing `<SaveRequestDialog ...>` JSX block with:

```tsx
<SaveRequestDialog
  open={saveOpen}
  onOpenChange={(o) => {
    setSaveOpen(o);
    if (!o) pendingOpenRef.current = null;
  }}
  collections={cat.tree}
  defaultName={draft?.method ?? ""}
  draftService={draft?.service ?? ""}
  draftMethod={draft?.method ?? ""}
  onSave={handleSave}
  onCreateCollection={cat.createCollection}
  onCreateFolder={createFolder}
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
```

- [ ] **Step 4: Typecheck + full test run**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS, no type errors. (If `tsc` is not a standalone script, use `pnpm build`'s typecheck step or `pnpm exec vue-tsc`/`pnpm exec tsc -p tsconfig.json --noEmit` per the repo config.)

- [ ] **Step 5: Commit**

```bash
git add src/app/WorkflowApp.tsx
git commit -m "feat(app): wire WorkflowApp to redesigned Save dialog (collections + onCreateFolder) (plan-11)"
```

---

## Task 9: Manual smoke + plan close-out

- [ ] **Step 1: Build the front-end and run the app**

Run: `pnpm build` (ensures `dist/` compiles; `generate_context!` needs it) then launch the desktop app per project convention (`pnpm tauri dev`).

- [ ] **Step 2: Manually verify**

1. Start a new draft, reflect a service (e.g. anything named `*Service`), pick a method, Send.
2. Ctrl+S → Save dialog opens at 80vh; name prefilled with the method.
3. Chip reads `<first collection> / <Service-minus-Service> / <method>`; click "Добавить" → folder appears selected in the tree.
4. Save → request lands in `Collection › Folder` in the sidebar; folder was created.
5. Re-open Save on another draft, use "＋ New collection" / "＋ New folder", search to filter, save into a nested folder.

- [ ] **Step 3: Update the plan index**

Add a row to `docs/superpowers/plans/2026-06-05-plan-00-index.md` for plan-11 (status: done) following the existing table format.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-05-plan-00-index.md
git commit -m "docs(plan-11): mark Save-dialog redesign complete; update index (plan-11)"
```

---

## Self-Review Notes

- **Spec coverage:** chip variant A (T5), folder derivation strip-"Service" (T1), name=method (T1/T4), host excluded (T1 has no host), default collection = first (T4 `open` effect), no "(new)" marker (chip/picker render plain names — T3/T5), unified contextual New (T6), no "Save to" bottom line (T4 layout omits it), 80vh + scrollable tree (T4 `h-[80vh] flex-col` + picker `flex-1 overflow-auto`), `suggestSaveTarget` pure fn (T1), `CollectionPicker` not reusing heavy `CollectionTree` (T3), originBound minimal (T4), "Already saved in" retained (T4), edge cases: no collections (T6 tests), no method (T5 hides chip), existing folder reuse (T5), bare "Service" (T1). All covered.
- **Removed code:** `suggestSavePath` + `hostOf` deleted (T1); only refs were the dialog/test being rewritten (T4) and WorkflowApp (T8).
- **Type consistency:** `PickTarget` (CollectionPicker) and `SaveTarget` (grouping) are distinct on purpose — `PickTarget` = destination `{collectionId, parentId}`, `SaveTarget` = `{folderName, requestName}`. `PendingFolder`/`PendingCollection` share `tempId`. `onCreateFolder(collectionId, parentId, name) => Promise<string>` matches between dialog prop (T4), tests (T4-7), and WorkflowApp `createFolder` (T8).
