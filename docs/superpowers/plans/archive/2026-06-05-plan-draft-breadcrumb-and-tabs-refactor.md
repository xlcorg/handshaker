# Draft Breadcrumb Full-Path + Unified Tab Strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the full `Коллекция › Папки › Реквест` path in the draft header (live from the catalog) and unify the request/response tab strips into one underline style on the same vertical level.

**Architecture:** Add a pure `pathNamesToItem` helper in `treeNav` that returns the named path *including* the target item. `draftBreadcrumb` becomes a pure function returning **segments** (`string[]`) computed from the live catalog, with a fallback to stored `DraftOrigin` names. `FocusView` feeds it `useCatalog().tree` and renders segments so the request-name segment never truncates. `RequestTabs` swaps its bespoke pill buttons for the shared `UnderlineTabs` in a container matching `ResponsePanel`.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-05-draft-breadcrumb-and-tabs-refactor-design.md`

**Status banner:** ✅ **done** (реализовано: `4cab4d9` pathNamesToItem, `6dc3ece`
draftBreadcrumb segments, `f2bfe6e` FocusView full-path breadcrumb, `0d59885`
unified underline tab strip) · branch `redesign/workflow-ui-spec-plans` ·
mode subagent-driven. Прежний баннер «not started» устарел; работа влита, файл архивирован.

**Commands:**
- Single test file: `pnpm exec vitest run <path>`
- All tests: `pnpm test`
- Typecheck: `pnpm lint`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/features/catalog/treeNav.ts` | Pure tree utilities over `CollectionIpc[]` | + `pathNamesToItem` |
| `src/features/catalog/treeNav.test.ts` | Tests for tree utilities | + `pathNamesToItem` suite |
| `src/features/workflow/draftHeader.ts` | Compute draft breadcrumb segments | rewrite `draftBreadcrumb` → `string[]`, live path + fallback |
| `src/features/workflow/draftHeader.test.ts` | Tests for breadcrumb | rewrite for segments + add catalog-path cases |
| `src/features/workflow/FocusView.tsx` | Draft header + CallPanel host | use catalog; render segments with non-truncating last segment |
| `src/features/workflow/FocusView.test.tsx` | Tests for FocusView | mock catalog; update labels; add full-path test |
| `src/features/workflow/RequestTabs.tsx` | Request/Metadata/Auth tab strip | swap to `UnderlineTabs`, match response container |
| `src/features/workflow/RequestTabs.test.tsx` | Tests for RequestTabs | add tablist/underline regression assertions |

---

## Task 1: `pathNamesToItem` helper in treeNav

**Files:**
- Modify: `src/features/catalog/treeNav.ts`
- Test: `src/features/catalog/treeNav.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/catalog/treeNav.test.ts` (the file already defines `tree`, `col`, `folder`, `req` and imports from `./treeNav`):

```ts
import { pathNamesToItem } from "./treeNav"; // add to the existing import from "./treeNav"

describe("pathNamesToItem", () => {
  it("returns [collectionName] for a collection root", () => {
    expect(pathNamesToItem(tree, "c1")).toEqual(["c1"]);
  });

  it("returns [collection, request] for a top-level request", () => {
    expect(pathNamesToItem(tree, "r1")).toEqual(["c1", "r1"]);
  });

  it("returns the full nested path including the request itself", () => {
    expect(pathNamesToItem(tree, "r3")).toEqual(["c1", "f1", "f2", "r3"]);
  });

  it("returns the path to a folder including the folder itself", () => {
    expect(pathNamesToItem(tree, "f2")).toEqual(["c1", "f1", "f2"]);
  });

  it("returns null for an unknown id", () => {
    expect(pathNamesToItem(tree, "nope")).toBeNull();
  });

  it("returns null for a null id", () => {
    expect(pathNamesToItem(tree, null)).toBeNull();
  });
});
```

> Note: in this test fixture `name === id` for every node (see `col`/`folder`/`req`), so expected names equal the ids.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/treeNav.test.ts`
Expected: FAIL — `pathNamesToItem is not a function` (or import error).

- [ ] **Step 3: Write minimal implementation**

Add to `src/features/catalog/treeNav.ts` (after `pathToItem`):

```ts
function findNamePath(items: ItemIpc[], itemId: string, acc: string[]): string[] | null {
  for (const it of items) {
    if (it.id === itemId) return [...acc, it.name];
    if (it.type === "folder") {
      const r = findNamePath(it.items, itemId, [...acc, it.name]);
      if (r) return r;
    }
  }
  return null;
}

/** Ordered display names `[collectionName, ...folderNames, itemName]` to reach `itemId`
 *  (the path INCLUDES the target item's own name), or null when not found. */
export function pathNamesToItem(
  collections: CollectionIpc[],
  itemId: string | null,
): string[] | null {
  if (!itemId) return null;
  for (const c of collections) {
    if (c.id === itemId) return [c.name];
    const sub = findNamePath(c.items, itemId, [c.name]);
    if (sub) return sub;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/treeNav.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/treeNav.ts src/features/catalog/treeNav.test.ts
git commit -m "feat(catalog): pathNamesToItem — named path including the target item"
```

---

## Task 2: `draftBreadcrumb` → live full-path segments

**Files:**
- Modify: `src/features/workflow/draftHeader.ts`
- Test: `src/features/workflow/draftHeader.test.ts`

- [ ] **Step 1: Rewrite the test for segment output + catalog path**

Replace the entire body of `src/features/workflow/draftHeader.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { draftBreadcrumb } from "./draftHeader";
import { newStep } from "./model";

const draft = newStep({
  address: "h:443", tls: false, service: "pkg.v1.NotesService", method: "Create",
});

function req(id: string, name: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "M",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function folder(id: string, name: string, items: ItemIpc[]): Extract<ItemIpc, { type: "folder" }> {
  return { type: "folder", id, name, items };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

const tree: CollectionIpc[] = [
  col("c1", "Notes", [folder("f1", "Staging", [req("r1", "Create")])]),
];

describe("draftBreadcrumb", () => {
  it("returns the unbound label for a draft with no origin", () => {
    expect(draftBreadcrumb(draft, null)).toEqual(["Новый реквест"]);
  });

  it("returns the full live path (collection › folders › request) from the catalog", () => {
    const origin = { collectionId: "c1", requestId: "r1", collectionName: "Notes", requestName: "Create" };
    expect(draftBreadcrumb(draft, origin, tree)).toEqual(["Notes", "Staging", "Create"]);
  });

  it("falls back to stored origin names when the request is not yet in the catalog", () => {
    const origin = { collectionId: "cX", requestId: "rX", collectionName: "Notes", requestName: "Create" };
    expect(draftBreadcrumb(draft, origin, tree)).toEqual(["Notes", "Create"]);
  });

  it("falls back to the request name alone when collection name is missing", () => {
    expect(
      draftBreadcrumb(draft, { collectionId: "c1", requestId: "rX", requestName: "Create note" }, []),
    ).toEqual(["Create note"]);
  });

  it("falls back to service / method when origin has no names and catalog lacks the id", () => {
    expect(draftBreadcrumb(draft, { collectionId: "c1", requestId: "rX" }, [])).toEqual([
      "NotesService / Create",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/workflow/draftHeader.test.ts`
Expected: FAIL — current `draftBreadcrumb` returns a `string`, not `string[]`, and ignores the catalog.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `src/features/workflow/draftHeader.ts` with:

```ts
import { shortService } from "@/features/shell/SelectedMethod";
import { pathNamesToItem } from "@/features/catalog/treeNav";
import type { CollectionIpc } from "@/ipc/bindings";
import type { Step } from "./model";
import type { DraftOrigin } from "./store";

/** Breadcrumb segments for the draft header.
 *  - Unbound → ["Новый реквест"].
 *  - Bound → full live path from the catalog `[collection, …folders, request]`.
 *  - Fallback (just-saved before reload, or deleted) → stored origin names, else the call label.
 *  Returned as segments so the caller can keep the last (request-name) segment from truncating. */
export function draftBreadcrumb(
  draft: Step,
  origin: DraftOrigin | null,
  collections: CollectionIpc[] = [],
): string[] {
  if (!origin) return ["Новый реквест"];

  const path = pathNamesToItem(collections, origin.requestId);
  if (path) return path;

  if (origin.requestName) {
    return origin.collectionName
      ? [origin.collectionName, origin.requestName]
      : [origin.requestName];
  }

  const svc = shortService(draft.service);
  return [draft.method ? `${svc} / ${draft.method}` : svc || "Saved request"];
}
```

> No import cycle: `treeNav.ts` imports only from `@/ipc/bindings`, never from `workflow/*`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/workflow/draftHeader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/draftHeader.ts src/features/workflow/draftHeader.test.ts
git commit -m "feat(workflow): draftBreadcrumb returns live full-path segments"
```

---

## Task 3: FocusView renders segments from the live catalog

**Files:**
- Modify: `src/features/workflow/FocusView.tsx`
- Test: `src/features/workflow/FocusView.test.tsx`

- [ ] **Step 1: Update the test — mock the catalog, fix labels, add a full-path case**

Edit `src/features/workflow/FocusView.test.tsx`.

(a) After the existing `vi.mock("./CallPanel", …)` block, add a hoisted catalog mock and the `CollectionIpc` import:

```tsx
import type { CollectionIpc } from "@/ipc/bindings";

const cat = vi.hoisted(() => ({ tree: [] as CollectionIpc[] }));
vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({ tree: cat.tree }),
}));
```

(b) In the existing `beforeEach`, reset the mock tree alongside the store reset:

```tsx
beforeEach(() => {
  workflowStore.reset();
  cat.tree = [];
});
```

(c) Replace the unbound-breadcrumb test (currently asserts `"New request"`):

```tsx
  it("shows the unbound breadcrumb label for a draft with no origin", () => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("Новый реквест");
  });
```

(d) Append a new test that exercises the live catalog full path:

```tsx
  it("shows the full live path from the catalog for a bound draft", () => {
    cat.tree = [
      {
        id: "c1", name: "Notes", default_tls: false, skip_tls_verify: false,
        pinned: false, description: null, created_at: 0, variables: {}, auth: { kind: "none" },
        items: [
          {
            type: "folder", id: "f1", name: "Staging",
            items: [
              {
                type: "request", id: "r1", name: "Create", address_template: "h:443",
                service: "p.v1.S", method: "M", body_template: "{}", metadata: [],
                auth: { kind: "none" }, tls_override: null, last_used_at: null, use_count: 0,
              },
            ],
          },
        ],
      },
    ];
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1", collectionName: "Notes", requestName: "Create" },
    );
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("Notes › Staging › Create");
  });
```

> The existing "Notes › Create" bound test stays as-is: `cat.tree` is `[]`, so the breadcrumb falls back to the stored origin names.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/workflow/FocusView.test.tsx`
Expected: FAIL — `FocusView` still calls `draftBreadcrumb(draft, origin)` (string, 2 args) and does not read the catalog.

- [ ] **Step 3: Update FocusView to consume the catalog and render segments**

In `src/features/workflow/FocusView.tsx`:

Add the import near the top:

```tsx
import { useCatalog } from "@/features/catalog/CatalogProvider";
```

Inside the component, add the catalog read next to the existing hooks:

```tsx
  const draft = useDraft();
  const origin = useDraftOrigin();
  const dirty = useDraftDirty();
  const { tree } = useCatalog();
```

Replace the breadcrumb `<span>` (the element with `data-testid="draft-breadcrumb"`) with a segmented render. Compute segments just before the returned JSX:

```tsx
  const segments = draft ? draftBreadcrumb(draft, origin, tree) : [];
  const prefix = segments.slice(0, -1);
  const last = segments[segments.length - 1] ?? "";
```

And render:

```tsx
          <span
            className="flex min-w-0 items-center text-muted-foreground"
            data-testid="draft-breadcrumb"
          >
            {prefix.length > 0 && (
              <span className="truncate">{prefix.join(" › ")} › </span>
            )}
            <span className="flex-none">{last}</span>
          </span>
```

> The prefix span is `min-w-0 truncate` (clips collection/folders when narrow); the request-name span is `flex-none` so it never disappears. The `" › "` text (with spaces) keeps `toHaveTextContent("A › B")` matching.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/workflow/FocusView.test.tsx`
Expected: PASS (all cases, including the existing fallback "Notes › Create").

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/FocusView.tsx src/features/workflow/FocusView.test.tsx
git commit -m "feat(workflow): FocusView renders full-path breadcrumb, request name never truncates"
```

---

## Task 4: Unify the request tab strip with the response strip

**Files:**
- Modify: `src/features/workflow/RequestTabs.tsx`
- Test: `src/features/workflow/RequestTabs.test.tsx`

- [ ] **Step 1: Add the regression assertions for the unified strip**

Append to `src/features/workflow/RequestTabs.test.tsx` (inside the existing `describe("RequestTabs", …)`):

```tsx
  it("renders a tablist with underline-style tabs (no pill bg-accent on the active tab)", async () => {
    const user = userEvent.setup();
    const p = setup();
    render(<RequestTabs {...p} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();

    const requestTab = screen.getByRole("tab", { name: /request/i });
    expect(requestTab).toHaveAttribute("aria-selected", "true");
    expect(requestTab.className).not.toContain("bg-accent");

    await user.click(screen.getByRole("tab", { name: /metadata/i }));
    expect(screen.getByRole("tab", { name: /metadata/i })).toHaveAttribute("aria-selected", "true");
    expect(requestTab).toHaveAttribute("aria-selected", "false");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/workflow/RequestTabs.test.tsx`
Expected: FAIL — the current active tab uses `bg-accent` (pill), so `not.toContain("bg-accent")` fails.

- [ ] **Step 3: Swap to UnderlineTabs in a response-matching container**

Replace the contents of `src/features/workflow/RequestTabs.tsx` with:

```tsx
import { useState } from "react";
import { BodyEditor } from "@/features/invoke/BodyEditor";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
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
  return (
    <div className="flex h-full flex-col">
      <div className="h-10 flex-none flex items-center border-b border-border px-3.5">
        <UnderlineTabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "request", label: "Request" },
            { value: "metadata", label: "Metadata" },
            { value: "auth", label: "Auth" },
          ]}
        />
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
            <div>variable: {auth.env_var}</div>
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

> `UnderlineTabs<Tab>` infers the union from `items`, so `onChange={setTab}` type-checks without a cast. The container mirrors `ResponsePanel`'s strip: `h-10 flex-none flex items-center border-b border-border px-3.5`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/features/workflow/RequestTabs.test.tsx`
Expected: PASS (new assertions + the three existing tests: default body, switch to metadata, read-only auth).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/RequestTabs.tsx src/features/workflow/RequestTabs.test.tsx
git commit -m "feat(workflow): unify request tab strip with response (underline, h-10)"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole project**

Run: `pnpm lint`
Expected: exits 0, no TS errors. (Watch for any other caller of `draftBreadcrumb` — there should be none besides `FocusView`.)

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: all suites pass.

- [ ] **Step 3: Final commit (only if anything was adjusted in Step 1–2)**

```bash
git add -A
git commit -m "chore(workflow): finalize draft breadcrumb + tab strip refactor"
```

---

## Self-Review notes (author)

- **Spec coverage:** A (full live path + fallback + Russian unbound label) → Tasks 1–3; truncation (request name never clipped) → Task 3 Step 3; B (unified underline strip) → Task 4. Out-of-scope items (no backend, no DraftOrigin field removal, no DraftAddressBar/response changes) respected.
- **Type consistency:** `draftBreadcrumb` returns `string[]` everywhere (Tasks 2 & 3); `pathNamesToItem(collections, itemId)` signature identical in Tasks 1 & 2; `UnderlineTabs<Tab>` value/onChange match the `Tab` union.
- **No placeholders:** every code step shows full content; commands have expected output.
