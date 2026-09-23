# Plan 07 — CollectionOverview (Overview/Authorization/Variables, single-auth) + ⌘K rewrite (saved requests)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking. **Detail is TDD-complete** — execute
> task-by-task.

**Status:** ✅ **done** (`0af64bb..53755a2`, 10 commits — 8 feature/chore + 2 corrections).
Full front-end suite green: **409** tests / 79 files (was 374 at plan-06; +35 across
`catalog/{palette, CommandPalette-rewrite}`, `ipc/client.collectionAuth`, and
`catalog/overview/{subComponents, authConfigMap, SavedAuthEditor, CollectionOverview}`).
`pnpm lint` (`tsc -b`) reports only the **15 pre-existing** legacy errors
(`features/collections/**` ×14 + `ipc/client.ts` ×1) — **zero new** under
`features/{catalog,workflow}` or `app/WorkflowApp.tsx` (gate = `pnpm test` + targeted
typecheck; `pnpm build` stays `tsc`-blocked by the legacy 15 until plan-09).
Two corrections during execution: (1) a subagent had made the shared `Tooltip` self-provide a
nested provider (overrides global delay/skip in `main.tsx`) — reverted; the overview port +
`CollectionOverview` tests wrap renders in a local `TooltipProvider` instead. (2) a union
member-access in the `authConfigMap` test was narrowed on `kind` for `tsc`.
**Follow-ups (plan-09):** mount `CollectionOverview` in the main area when a collection is
opened from `SidebarShell`; feed `CommandPalette` the live tree + `openSavedRequest` with
`needsDiscardConfirm` interception (the `WorkflowApp` call site is a `collections={[]}`/
`onOpen={() => {}}` placeholder until then).
**Branch:** `redesign/workflow-ui-spec-plans`
**Phase:** 6 of spec §16 (`docs/superpowers/specs/2026-06-05-service-collection-sidebar-refactor-design.md`),
spec §8 (CollectionOverview) + §9 (⌘K) + §15-table rows.
**Predecessors:** plan-01 (`cadaccd..625241b`), plan-02 (`41d29bf..0a33cae`),
plan-03 (`7b1b885..2903c8a`), plan-04 (`0381a9d..7d767d4`), plan-05 (`65d8c96..f813bf9`),
plan-06 (`50583ed..4ae7d8e`) — all ✅ done. This plan builds the **CollectionOverview**
main-area panel and the **rewritten ⌘K palette** on top of the persistent library
(`useCatalogTree`, `CollectionIpc`/`SavedRequestIpc`), the pure helpers (`fuzzy.ts`,
`grouping.ts`), and the single-auth backend (`collection_set_node_auth`, plan-01).

**Goal:** Replace the `catalogStore`-driven, service/method two-stage Command Palette with a
single-stage palette over **saved requests** across all collections (open in Focus), and build
a **CollectionOverview** panel (Overview / Authorization / Variables tabs) adapted from the
legacy `collections/overview/*` to the **single-auth** model (`SavedAuthConfigIpc` on the
collection), persisting via `collectionUpsert` / `collectionSetVariables` /
`collectionSetNodeAuth`.

**Architecture:** The palette is split into a pure `palette.ts` (`flattenRequests` +
`rankRequests`, reusing `fuzzy.fuzzyMatch`) and a presentational `CommandPalette` that takes
`collections` + `onOpen` as props (no store). The overview lives under
`src/features/catalog/overview/`: model-agnostic presentational sub-components are **ported
verbatim** from the legacy folder (`COTabs`/`COBlock`/`CollectionTitle`/`DescriptionBlock`/
`VariablesBlock`/`TlsBlock`/`EnvVarField`); the per-env `AuthBlock`/`authMap` are **replaced**
by a single-auth `SavedAuthEditor` over a pure `authConfigMap.ts` (`configToForm`/
`formToConfig`). The `CollectionOverview` container calls `ipc` directly (description now
persists to the real `CollectionIpc.description` field, **not** localStorage).

**Wiring scope (mirrors plan-05/06):** This plan delivers fully unit-tested building blocks.
**Live shell glue is plan-09:** mounting `CollectionOverview` in the main area when a
collection is opened from `SidebarShell`, and feeding `CommandPalette` the real tree +
dirty-confirm interception. To keep the build honest, the **one existing** `CommandPalette`
call site in the transitional `WorkflowApp` (still on the legacy `Sidebar`/`ServicePanel`) is
updated to the new prop shape with **explicit placeholders** (`collections={[]}`,
`onOpen={() => {}}`) — real wiring lands in plan-09. Gate here = `pnpm test` + targeted
`pnpm lint` (repo-wide `tsc -b`/`pnpm build` stay blocked by the pre-existing legacy errors
removed in plan-09 — confirm **zero new** errors under `features/{catalog,workflow}` and
`src/app/WorkflowApp.tsx`).

**Tech Stack:** TypeScript, React 18, Vitest + Testing Library (`render`/`screen`/`fireEvent`/
`act`/`waitFor`, `userEvent`, fake timers where noted), lucide-react, radix-ui, `@/` path
alias (= `src/`).

## Build / test commands (repo root, PowerShell)

- Single test file: `pnpm test src/features/<path>.test.ts`
- All front-end tests: `pnpm test`
- Typecheck: `pnpm lint` (`tsc -b`) · Prod build: `pnpm build`

## Design notes (decisions locked from spec §8, §9, §15-table)

1. **⌘K = saved requests only, all collections, open in Focus** (spec §9; §15 «⌘K»):
   rewrite the palette to a single-stage list over every collection's saved requests, searched
   by **name + `service.method` + address** (same fields as the sidebar filter, §15 «Фильтр»).
   Select → `onOpen(collectionId, request)`; the caller (`openSavedRequest`, plan-06) binds
   origin and switches to Focus. The dirty-confirm before replacing a dirty unbound draft is
   the caller's job (plan-09, `needsDiscardConfirm` already exists).
2. **Palette ranking reuses `fuzzy.fuzzyMatch`** (generic subsequence scorer) — **not**
   `rankServices` (which is `CatalogService`-specific and deleted in plan-09). Empty query ⇒
   all requests sorted by name.
3. **CollectionOverview = 3 tabs** (spec §8): **Overview** (name + description + default
   TLS/skip-verify) · **Authorization** (single collection auth) · **Variables**. There is
   **no** Settings tab and **no** delete button here — delete lives in the sidebar context
   menu (plan-05). Rendered in the **main area** (plan-09 routes it in place of Focus).
4. **Description persists to the backend field** (`CollectionIpc.description: string | null`,
   plan-01) via `collectionUpsert` — drop the legacy localStorage `getCollectionDesc`/
   `setCollectionDesc`.
5. **Single-auth** (spec §7/§8; §15 «Auth-модель»): the Authorization tab edits **one**
   `SavedAuthConfigIpc` on the collection via `collectionSetNodeAuth(collectionId, null,
   config)` (itemId `null` = the collection node). The per-environment legacy `AuthBlock`/
   `authMap`/`authSetForEnv` are **not** ported. `SavedAuthEditor` surfaces **None / Bearer /
   API key** (all map to `kind:"none"` or `kind:"env_var"`); an existing
   `oauth_2_client_credentials` config is shown as a read-only "configured but not editable"
   notice (master backend doesn't implement OAuth2 — same stance as `RequestTabs`/`AuthInline`).
6. **Port the model-agnostic presentational sub-components verbatim** into
   `catalog/overview/` (they only depend on `@/components/ui/*`, `@/lib/*`, lucide). Legacy
   copies are deleted in plan-09; porting now removes the cross-feature dependency early.
7. **`collectionSetNodeAuth` IPC wrapper** is added to `src/ipc/client.ts` (the command exists
   in `bindings.ts` since plan-01 but was never wrapped — plan-06 left it out of scope). No
   backend change.
8. **No new backend / no new IPC commands.** Everything uses already-generated commands
   (`collectionUpsert`/`collectionSetVariables`/`collectionSetNodeAuth`). `collectionBumpUsage`
   wrapping + Send wiring stay out of scope (later phases).

## File structure (boundaries)

- Create `src/features/catalog/palette.ts` (+ `palette.test.ts`) — `RequestHit`,
  `flattenRequests`, `rankRequests`.
- Rewrite `src/features/catalog/CommandPalette.tsx` (+ replace `CommandPalette.test.tsx`) —
  props `{ open, onClose, collections, onOpen }`; single-stage saved-request search.
- Modify `src/app/WorkflowApp.tsx` — update the one `CommandPalette` call site to the new
  prop shape (placeholders; real wiring = plan-09).
- Modify `src/ipc/client.ts` (+ create `src/ipc/client.collectionAuth.test.ts`) —
  `collectionSetNodeAuth` wrapper + `ipc` export.
- Create `src/features/catalog/overview/` ports (+ `subComponents.test.tsx`):
  `COTabs.tsx`, `COBlock.tsx`, `CollectionTitle.tsx`, `DescriptionBlock.tsx`,
  `VariablesBlock.tsx`, `TlsBlock.tsx`, `EnvVarField.tsx`.
- Create `src/features/catalog/overview/authConfigMap.ts` (+ `authConfigMap.test.ts`) —
  `AuthForm`, `configToForm`, `formToConfig`.
- Create `src/features/catalog/overview/SavedAuthEditor.tsx` (+ `SavedAuthEditor.test.tsx`).
- Create `src/features/catalog/overview/CollectionOverview.tsx` (+ `CollectionOverview.test.tsx`).

---

### Task 1: `palette.ts` — flatten + rank saved requests

**Files:**
- Create: `src/features/catalog/palette.ts`
- Test: `src/features/catalog/palette.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/palette.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { flattenRequests, rankRequests } from "./palette";

function req(id: string, name: string, over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request",
    id,
    name,
    address_template: "h:443",
    service: "p.v1.S",
    method: "GetX",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
    ...over,
  };
}
function folder(id: string, name: string, items: ItemIpc[]): ItemIpc {
  return { type: "folder", id, name, items };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

describe("flattenRequests", () => {
  it("flattens nested folders into hits carrying collection + folder path", () => {
    const tree = [
      col("c1", "Orders", [folder("f1", "v1", [req("r1", "GetOrder")])]),
      col("c2", "Inv", [req("r2", "ListItems")]),
    ];
    const hits = flattenRequests(tree);
    expect(hits).toHaveLength(2);
    const h1 = hits.find((h) => h.request.id === "r1")!;
    expect(h1.collectionId).toBe("c1");
    expect(h1.collectionName).toBe("Orders");
    expect(h1.folderPath).toEqual(["v1"]);
    const h2 = hits.find((h) => h.request.id === "r2")!;
    expect(h2.folderPath).toEqual([]);
  });
});

describe("rankRequests", () => {
  const hits = flattenRequests([
    col("c1", "Orders", [
      req("r1", "GetOrder", { service: "ord.v1.OrderService", method: "GetOrder", address_template: "orders:443" }),
      req("r2", "ListItems", { service: "inv.v1.Inventory", method: "ListItems", address_template: "inv:443" }),
    ]),
  ]);

  it("returns all hits sorted by name when the query is empty", () => {
    const out = rankRequests("  ", hits);
    expect(out.map((h) => h.request.name)).toEqual(["GetOrder", "ListItems"]);
  });

  it("matches on the request name", () => {
    const out = rankRequests("listit", hits);
    expect(out.map((h) => h.request.id)).toEqual(["r2"]);
  });

  it("matches on service/method", () => {
    const out = rankRequests("OrderService", hits);
    expect(out[0].request.id).toBe("r1");
  });

  it("matches on the address", () => {
    const out = rankRequests("inv:443", hits);
    expect(out.map((h) => h.request.id)).toEqual(["r2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/palette.test.ts`
Expected: FAIL — module `./palette` not found.

- [ ] **Step 3: Implement**

Create `src/features/catalog/palette.ts`:

```ts
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { fuzzyMatch } from "./fuzzy";

export interface RequestHit {
  collectionId: string;
  collectionName: string;
  /** Folder names from collection root to the request's parent (excludes the request). */
  folderPath: string[];
  request: SavedRequestIpc;
}

function walk(items: ItemIpc[], path: string[], c: CollectionIpc, out: RequestHit[]): void {
  for (const it of items) {
    if (it.type === "folder") {
      walk(it.items, [...path, it.name], c, out);
    } else {
      out.push({ collectionId: c.id, collectionName: c.name, folderPath: path, request: it });
    }
  }
}

/** Flatten every saved request across all collections into a searchable list. */
export function flattenRequests(collections: CollectionIpc[]): RequestHit[] {
  const out: RequestHit[] = [];
  for (const c of collections) walk(c.items, [], c, out);
  return out;
}

/** Searchable haystack for a hit: name + `service.method` + address. */
function haystack(h: RequestHit): string {
  const r = h.request;
  return `${r.name} ${r.service}.${r.method} ${r.address_template}`;
}

interface Ranked {
  hit: RequestHit;
  score: number;
}

/**
 * Rank hits by fuzzy match across name/service/method/address. An empty query returns all
 * hits sorted by request name; otherwise non-matching hits are dropped and matches are sorted
 * by descending score (name as the tie-break).
 */
export function rankRequests(query: string, hits: RequestHit[]): RequestHit[] {
  const q = query.trim();
  if (!q) return [...hits].sort((a, b) => a.request.name.localeCompare(b.request.name));
  const ranked: Ranked[] = [];
  for (const hit of hits) {
    const m = fuzzyMatch(q, haystack(hit));
    if (m.matched) ranked.push({ hit, score: m.score });
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.hit.request.name.localeCompare(b.hit.request.name))
    .map((r) => r.hit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/palette.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/palette.ts src/features/catalog/palette.test.ts
git commit -m "feat(catalog): palette.ts — flatten + fuzzy-rank saved requests (plan-07)"
```

---

### Task 2: rewrite `CommandPalette` over saved requests

**Files:**
- Modify (rewrite): `src/features/catalog/CommandPalette.tsx`
- Test (replace): `src/features/catalog/CommandPalette.test.tsx`

- [ ] **Step 1: Replace the test file**

Replace the entire contents of `src/features/catalog/CommandPalette.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { CommandPalette } from "./CommandPalette";

function req(id: string, name: string, over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "GetX",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0, ...over,
  };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

const collections = [
  col("c1", "Orders", [req("r1", "Alpha")]),
  col("c2", "Inventory", [req("r2", "Beta")]),
];

beforeEach(() => vi.clearAllMocks());

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CommandPalette open={false} onClose={() => {}} collections={collections} onOpen={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists saved requests from every collection with their location", () => {
    render(<CommandPalette open onClose={() => {}} collections={collections} onOpen={() => {}} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument(); // collection name as location
  });

  it("filters by query", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} collections={collections} onOpen={() => {}} />);
    await user.type(screen.getByLabelText("command-input"), "beta");
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("Enter opens the active request and closes", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} collections={collections} onOpen={onOpen} />);
    const input = screen.getByLabelText("command-input");
    input.focus();
    await user.keyboard("{Enter}"); // empty query → first by name = "Alpha" (c1)
    expect(onOpen).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1", name: "Alpha" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking a row opens that request", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<CommandPalette open onClose={() => {}} collections={collections} onOpen={onOpen} />);
    await user.click(screen.getByText("Beta"));
    expect(onOpen).toHaveBeenCalledWith("c2", expect.objectContaining({ id: "r2" }));
  });

  it("Escape closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} collections={collections} onOpen={() => {}} />);
    const input = screen.getByLabelText("command-input");
    input.focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} collections={collections} onOpen={() => {}} />);
    await user.type(screen.getByLabelText("command-input"), "zzzznomatch");
    expect(screen.getByText(/No saved requests/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/CommandPalette.test.tsx`
Expected: FAIL — `CommandPalette` still takes the old `{ open, onClose }` props and imports
`catalogStore` (type/render errors).

- [ ] **Step 3: Implement (full rewrite)**

Replace the entire contents of `src/features/catalog/CommandPalette.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { Kbd } from "@/components/ui/kbd";
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import { flattenRequests, rankRequests, type RequestHit } from "./palette";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Every collection (already loaded); the palette flattens their saved requests. */
  collections: CollectionIpc[];
  /** Open a saved request in Focus. The caller binds origin + handles dirty-confirm. */
  onOpen: (collectionId: string, req: SavedRequestIpc) => void;
}

/** ⌘K palette over saved requests across every collection (spec §9). Single-stage search. */
export function CommandPalette({ open, onClose, collections, onOpen }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const all = useMemo(() => flattenRequests(collections), [collections]);
  const hits = useMemo(() => rankRequests(query, all), [query, all]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, hits.length - 1)));
  }, [hits.length]);

  if (!open) return null;

  const choose = (hit: RequestHit) => {
    onOpen(hit.collectionId, hit.request);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[active];
      if (h) choose(h);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[560px] overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search saved requests…"
            aria-label="command-input"
            className="h-11 flex-1 bg-transparent text-sm focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[360px] overflow-auto py-1">
          {hits.length === 0 ? (
            <Empty q={query} />
          ) : (
            hits.map((h, i) => {
              const r = h.request;
              const where = [h.collectionName, ...h.folderPath].join(" › ");
              return (
                <button
                  key={`${h.collectionId}/${r.id}`}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(h)}
                  className={cn(
                    "flex w-full items-center gap-2 px-4 py-2 text-left text-sm",
                    i === active && "bg-accent",
                  )}
                >
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {r.service ? `${r.service}.${r.method}` : r.method}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground/70">{where}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          <span><Kbd>↵</Kbd> open</span>
          <span><Kbd>esc</Kbd> close</span>
          <span><Kbd>↑↓</Kbd> navigate</span>
        </div>
      </div>
    </div>
  );
}

function Empty({ q }: { q: string }) {
  return (
    <div className="px-4 py-8 text-center text-xs text-muted-foreground">
      No saved requests{q ? ` matching “${q}”` : ""}.
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/CommandPalette.test.tsx`
Expected: PASS. (The old `catalogStore`/`fuzzy.rankServices`/`tree`/`actions` imports are gone;
those modules are deleted in plan-09.)

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/CommandPalette.tsx src/features/catalog/CommandPalette.test.tsx
git commit -m "feat(catalog): rewrite ⌘K over saved requests (plan-07)"
```

---

### Task 3: update the `WorkflowApp` call site to the new prop shape

**Files:**
- Modify: `src/app/WorkflowApp.tsx`

The transitional `WorkflowApp` still mounts the old 2-prop palette. Update only that call site
so the project's `app/` directory stays type-clean. Real wiring (live tree + dirty-confirm)
is plan-09.

- [ ] **Step 1: Implement**

In `src/app/WorkflowApp.tsx`, replace the palette element (line ~80):

```tsx
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
```

with:

```tsx
      {/* TODO(plan-09): wire `collections` from useCatalogTree + onOpen=openSavedRequest
          with dirty-confirm. Placeholders keep the rewritten palette type-correct. */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        collections={[]}
        onOpen={() => {}}
      />
```

- [ ] **Step 2: Run the shell test to verify it stays green**

Run: `pnpm test src/app/WorkflowApp.test.tsx`
Expected: PASS — the test mocks `@/features/catalog/CommandPalette` as `() => null`, so the
new props are ignored; nothing else changed.

- [ ] **Step 3: Targeted typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | Select-String "WorkflowApp.tsx"`
Expected: **no** lines — `WorkflowApp.tsx` has no type errors from the palette call.

- [ ] **Step 4: Commit**

```bash
git add src/app/WorkflowApp.tsx
git commit -m "chore(app): update CommandPalette call site to new props (plan-07; wiring in plan-09)"
```

---

### Task 4: `collectionSetNodeAuth` IPC wrapper

**Files:**
- Modify: `src/ipc/client.ts`
- Test: `src/ipc/client.collectionAuth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ipc/client.collectionAuth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./bindings", () => ({
  commands: { collectionSetNodeAuth: vi.fn() },
}));

import { commands } from "./bindings";
import { collectionSetNodeAuth } from "./client";

beforeEach(() => vi.clearAllMocks());

describe("collectionSetNodeAuth wrapper", () => {
  it("calls the command and resolves on ok", async () => {
    vi.mocked(commands.collectionSetNodeAuth).mockResolvedValue({ status: "ok", data: null } as never);
    await collectionSetNodeAuth("c1", null, { kind: "none" });
    expect(commands.collectionSetNodeAuth).toHaveBeenCalledWith("c1", null, { kind: "none" });
  });

  it("throws the error payload on an error result", async () => {
    vi.mocked(commands.collectionSetNodeAuth).mockResolvedValue({
      status: "error",
      error: { message: "nope" },
    } as never);
    await expect(collectionSetNodeAuth("c1", null, { kind: "none" })).rejects.toEqual({ message: "nope" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ipc/client.collectionAuth.test.ts`
Expected: FAIL — `collectionSetNodeAuth` is not exported from `./client`.

- [ ] **Step 3: Implement**

In `src/ipc/client.ts`, add the wrapper right after `authResolve` (line ~173):

```ts
export async function collectionSetNodeAuth(
  collectionId: string,
  itemId: string | null,
  config: SavedAuthConfigIpc,
): Promise<void> {
  const r = await commands.collectionSetNodeAuth(collectionId, itemId, config);
  if (r.status === "error") throw r.error;
}
```

Then add `collectionSetNodeAuth` to the `ipc` export object (after `authResolve`):

```ts
export const ipc = {
  // …existing entries…
  authSetForEnv,
  authResolve,
  collectionSetNodeAuth,
};
```

(`SavedAuthConfigIpc` is already imported at the top of `client.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/ipc/client.collectionAuth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/client.ts src/ipc/client.collectionAuth.test.ts
git commit -m "feat(ipc): wrap collectionSetNodeAuth (plan-07)"
```

---

### Task 5: port presentational overview sub-components

**Files:**
- Create: `src/features/catalog/overview/COTabs.tsx`
- Create: `src/features/catalog/overview/COBlock.tsx`
- Create: `src/features/catalog/overview/CollectionTitle.tsx`
- Create: `src/features/catalog/overview/DescriptionBlock.tsx`
- Create: `src/features/catalog/overview/VariablesBlock.tsx`
- Create: `src/features/catalog/overview/TlsBlock.tsx`
- Create: `src/features/catalog/overview/EnvVarField.tsx`
- Test: `src/features/catalog/overview/subComponents.test.tsx`

These are **model-agnostic** and ported **verbatim** from `src/features/collections/overview/`
(deleted in plan-09). The test exercises the interactive ones to prove the ports mount and
wire their callbacks.

- [ ] **Step 1: Write the failing test**

Create `src/features/catalog/overview/subComponents.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { COTabs } from "./COTabs";
import { TlsBlock } from "./TlsBlock";
import { VariablesBlock } from "./VariablesBlock";
import { EnvVarField } from "./EnvVarField";

describe("overview sub-components (ports)", () => {
  it("COTabs switches the active tab", () => {
    const onChange = vi.fn();
    render(
      <COTabs
        value="overview"
        onChange={onChange}
        items={[
          { value: "overview", label: "Overview" },
          { value: "variables", label: "Variables" },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("Variables"));
    expect(onChange).toHaveBeenCalledWith("variables");
  });

  it("TlsBlock toggles TLS via its first switch", () => {
    const onChange = vi.fn();
    render(<TlsBlock enabled={false} skipVerify={false} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(onChange).toHaveBeenCalledWith({ enabled: true, skipVerify: false });
  });

  it("VariablesBlock edits a row value", () => {
    const onChange = vi.fn();
    render(<VariablesBlock rows={[{ id: "v0", k: "base", v: "x" }]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("x"), { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledWith([{ id: "v0", k: "base", v: "y" }]);
  });

  it("EnvVarField reports edits", () => {
    const onChange = vi.fn();
    render(<EnvVarField label="Token" value="" onChange={onChange} placeholder="TOK" />);
    fireEvent.change(screen.getByPlaceholderText("TOK"), { target: { value: "PROD_TOKEN" } });
    expect(onChange).toHaveBeenCalledWith("PROD_TOKEN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/overview/subComponents.test.tsx`
Expected: FAIL — the `./COTabs` etc. modules don't exist yet.

- [ ] **Step 3: Create the ported files**

Create `src/features/catalog/overview/COTabs.tsx`:

```tsx
import { cn } from "@/lib/cn";

export interface COTabItem {
  value: string;
  label: string;
  hint?: number | null;
}

interface COTabsProps {
  value: string;
  onChange: (value: string) => void;
  items: COTabItem[];
}

export function COTabs({ value, onChange, items }: COTabsProps) {
  return (
    <div className="flex-none flex items-stretch gap-0.5 h-9 px-3 border-b border-border bg-card/40">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-2.5 text-[12.5px] transition-colors focus:outline-none",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{it.label}</span>
            {it.hint != null && (
              <span
                className={cn(
                  "font-mono text-[10px] tabular-nums rounded px-1 py-px",
                  active ? "bg-accent text-muted-foreground" : "text-muted-foreground/55",
                )}
              >
                {it.hint}
              </span>
            )}
            {active && (
              <span
                aria-hidden
                className="absolute left-2 right-2 -bottom-px h-[1.5px] rounded-full bg-foreground"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
```

Create `src/features/catalog/overview/COBlock.tsx`:

```tsx
import { cn } from "@/lib/cn";

interface COBlockProps {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  danger?: boolean;
}

export function COBlock({ icon, title, desc, action, children, danger }: COBlockProps) {
  return (
    <section>
      <div className="flex items-start gap-3 mb-3.5">
        <span
          className={cn(
            "mt-0.5 flex-none",
            danger ? "text-destructive/80" : "text-muted-foreground/70",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "text-[13px] font-semibold tracking-tight",
              danger ? "text-destructive" : "text-foreground",
            )}
          >
            {title}
          </h3>
          {desc && (
            <p className="text-[12px] text-muted-foreground/70 leading-relaxed mt-0.5 text-pretty">
              {desc}
            </p>
          )}
        </div>
        {action}
      </div>
      <div className="pl-[27px]">{children}</div>
    </section>
  );
}
```

Create `src/features/catalog/overview/CollectionTitle.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";

interface CollectionTitleProps {
  name: string;
  onRename: (newName: string) => void;
}

export function CollectionTitle({ name, onRename }: CollectionTitleProps) {
  const [isEdit, setEdit] = useState(false);
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEdit && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit) setDraft(name);
  }, [name, isEdit]);

  const commit = () => {
    onRename(draft.trim() || name);
    setEdit(false);
  };

  const cancel = () => {
    setDraft(name);
    setEdit(false);
  };

  if (isEdit) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          className="h-7 text-[14px] font-semibold w-[260px] px-2"
        />
        <Tooltip content="Save (↵)">
          <Button size="icon-sm" className="h-7 w-7" onClick={commit}>
            <Check size={14} />
          </Button>
        </Tooltip>
        <Tooltip content="Cancel (Esc)">
          <Button variant="ghost" size="icon-sm" className="h-7 w-7" onClick={cancel}>
            <X size={14} />
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEdit(true)}
      className="group/title inline-flex items-center gap-1.5 min-w-0 rounded px-1 -ml-1 h-7 hover:bg-accent/50 transition-colors"
    >
      <span className="text-[14px] font-semibold tracking-tight truncate">{name}</span>
      <Pencil
        size={12}
        className="flex-none text-muted-foreground/0 group-hover/title:text-muted-foreground/60 transition-colors"
      />
    </button>
  );
}
```

Create `src/features/catalog/overview/DescriptionBlock.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

interface DescriptionBlockProps {
  text: string;
  onChange: (newText: string) => void;
}

export function DescriptionBlock({ text, onChange }: DescriptionBlockProps) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (edit && ref.current) ref.current.focus();
  }, [edit]);

  useEffect(() => {
    if (!edit) setDraft(text);
  }, [text, edit]);

  if (edit) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(text);
              setEdit(false);
            }
          }}
          placeholder="Describe what this collection is for. Markdown supported."
          className="w-full min-h-[104px] rounded-md border border-input bg-background px-3 py-2 text-[12.5px] leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/55"
        />
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            onClick={() => {
              onChange(draft);
              setEdit(false);
            }}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setDraft(text);
              setEdit(false);
            }}
          >
            Cancel
          </Button>
          <span className="ml-auto text-[10.5px] text-muted-foreground/45">Esc to cancel</span>
        </div>
      </div>
    );
  }

  if (!text) {
    return (
      <button
        onClick={() => {
          setDraft("");
          setEdit(true);
        }}
        className="w-full rounded-md border border-dashed border-border/80 px-4 py-5 text-left hover:border-border hover:bg-accent/30 transition-colors group/desc"
      >
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground/70 group-hover/desc:text-foreground/80">
          <Plus size={12} /> Add a description
        </span>
        <p className="text-[11px] text-muted-foreground/45 mt-0.5">
          Explain what the collection covers, conventions, required variables…
        </p>
      </button>
    );
  }

  return (
    <div className="group/desc relative">
      <p className="text-[12.5px] text-foreground/80 leading-relaxed whitespace-pre-wrap text-pretty pr-8">
        {text}
      </p>
      <Tooltip content="Edit description">
        <button
          onClick={() => {
            setDraft(text);
            setEdit(true);
          }}
          aria-label="Edit description"
          className="absolute top-0 right-0 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/45 hover:text-foreground hover:bg-accent opacity-0 group-hover/desc:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background-color]"
        >
          <Pencil size={12} />
        </button>
      </Tooltip>
    </div>
  );
}
```

Create `src/features/catalog/overview/VariablesBlock.tsx`:

```tsx
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { newId } from "@/lib/ids";

export interface VarRow {
  id: string;
  k: string;
  v: string;
}

interface VariablesBlockProps {
  rows: VarRow[];
  onChange: (nextRows: VarRow[]) => void;
}

export function VariablesBlock({ rows, onChange }: VariablesBlockProps) {
  const add = () => onChange([...rows, { id: newId(), k: "", v: "" }]);

  const upd = (id: string, key: "k" | "v", val: string) =>
    onChange(rows.map((x) => (x.id === id ? { ...x, [key]: val } : x)));

  const del = (id: string) => onChange(rows.filter((x) => x.id !== id));

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="w-full rounded-md border border-dashed border-border/80 px-4 py-6 text-center">
          <p className="text-[12px] text-muted-foreground/65">No collection variables yet.</p>
          <p className="text-[11px] text-muted-foreground/45 mt-0.5">
            Reusable values like base URLs or IDs — referenced as{" "}
            <span className="font-mono">{"{{name}}"}</span> in requests.
          </p>
        </div>
        <Button variant="outline" size="xs" className="gap-1.5" onClick={add}>
          <Plus size={12} /> Add variable
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_1.4fr_28px] gap-2 px-1 pb-0.5">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/50">
          Name
        </span>
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/50">
          Value
        </span>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.id} className="group/var grid grid-cols-[1fr_1.4fr_28px] gap-2 items-center">
          <Input
            value={row.k}
            onChange={(e) => upd(row.id, "k", e.target.value)}
            placeholder="name"
            className="h-8 font-mono text-[12px]"
          />
          <Input
            value={row.v}
            onChange={(e) => upd(row.id, "v", e.target.value)}
            placeholder="value"
            className="h-8 font-mono text-[12px]"
          />
          <Tooltip content="Remove">
            <button
              onClick={() => del(row.id)}
              aria-label="Remove variable"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground/45 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/var:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background-color]"
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      ))}
      <div className="pt-1">
        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground hover:text-foreground -ml-1.5"
          onClick={add}
        >
          <Plus size={12} /> Add variable
        </Button>
      </div>
    </div>
  );
}
```

Create `src/features/catalog/overview/TlsBlock.tsx`:

```tsx
import { AlertCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

export interface TlsState {
  enabled: boolean;
  skipVerify: boolean;
}

interface TlsBlockProps {
  enabled: boolean;
  skipVerify: boolean;
  onChange: (next: TlsState) => void;
}

export function TlsBlock({ enabled, skipVerify, onChange }: TlsBlockProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onChange({ enabled: checked, skipVerify })}
        />
        <div className="min-w-0">
          <div className="text-[12.5px] text-foreground/90">Use TLS by default</div>
          <div className="text-[11.5px] text-muted-foreground/60">
            New requests in this collection start with TLS enabled.
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex items-center gap-3 pl-1 transition-opacity",
          !enabled && "opacity-40 pointer-events-none select-none",
        )}
      >
        <Switch
          checked={enabled && skipVerify}
          onCheckedChange={(checked) => onChange({ enabled, skipVerify: checked })}
          disabled={!enabled}
        />
        <div className="min-w-0">
          <div className="text-[12.5px] text-foreground/90 flex items-center gap-1.5">
            Skip certificate verification
          </div>
          <div className="text-[11.5px] text-muted-foreground/60">
            {enabled
              ? "Accept self-signed or mismatched certs."
              : "Enable TLS to configure verification."}
          </div>
        </div>
      </div>

      {enabled && skipVerify && (
        <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2 ml-1">
          <span className="text-warn mt-0.5 flex-none">
            <AlertCircle size={13} />
          </span>
          <p className="text-[11.5px] text-warn/90 leading-relaxed">
            Connections won't validate server certificates. Use only for local or trusted endpoints.
          </p>
        </div>
      )}
    </div>
  );
}
```

Create `src/features/catalog/overview/EnvVarField.tsx`:

```tsx
import { Input } from "@/components/ui/input";

interface EnvVarFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function EnvVarField({
  label,
  value,
  onChange,
  placeholder = "ENV_VAR_NAME",
}: EnvVarFieldProps) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[11.5px] text-muted-foreground/80">{label}</span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground/45 pointer-events-none select-none">{"{}"}</span>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 pl-7 font-mono text-[12px] tracking-tight"
        />
      </div>
    </label>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/overview/subComponents.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/overview/COTabs.tsx src/features/catalog/overview/COBlock.tsx src/features/catalog/overview/CollectionTitle.tsx src/features/catalog/overview/DescriptionBlock.tsx src/features/catalog/overview/VariablesBlock.tsx src/features/catalog/overview/TlsBlock.tsx src/features/catalog/overview/EnvVarField.tsx src/features/catalog/overview/subComponents.test.tsx
git commit -m "feat(catalog): port overview presentational sub-components (plan-07)"
```

---

### Task 6: `authConfigMap.ts` — single-auth ⇄ form mapping

**Files:**
- Create: `src/features/catalog/overview/authConfigMap.ts`
- Test: `src/features/catalog/overview/authConfigMap.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/overview/authConfigMap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { configToForm, formToConfig, AUTH_FORM_DEFAULTS } from "./authConfigMap";

describe("configToForm", () => {
  it("maps none → none", () => {
    expect(configToForm({ kind: "none" })).toEqual(AUTH_FORM_DEFAULTS);
  });

  it("maps env_var with authorization/'Bearer ' → bearer", () => {
    const form = configToForm({ kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " });
    expect(form.kind).toBe("bearer");
    expect(form.envVar).toBe("TOK");
  });

  it("maps any other env_var → apikey, preserving header/prefix", () => {
    const form = configToForm({ kind: "env_var", env_var: "KEY", header_name: "x-api-key", prefix: "" });
    expect(form.kind).toBe("apikey");
    expect(form.envVar).toBe("KEY");
    expect(form.headerName).toBe("x-api-key");
  });

  it("maps oauth2 → oauth2", () => {
    const form = configToForm({
      kind: "oauth_2_client_credentials",
      token_url: "https://t",
      client_id: "id",
      client_secret_env_var: "SECRET",
      scopes: [],
    });
    expect(form.kind).toBe("oauth2");
  });
});

describe("formToConfig", () => {
  it("none → none", () => {
    expect(formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "none" })).toEqual({ kind: "none" });
  });

  it("bearer → env_var with authorization/'Bearer ' and trimmed env var", () => {
    expect(formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "bearer", envVar: " TOK " })).toEqual({
      kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("apikey → env_var with the custom header (defaulting blank to x-api-key)", () => {
    expect(formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "apikey", envVar: "KEY", headerName: "x-key", prefix: "" })).toEqual({
      kind: "env_var", env_var: "KEY", header_name: "x-key", prefix: "",
    });
    const blankHeader = formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "apikey", envVar: "KEY", headerName: "  " });
    expect(blankHeader.kind === "env_var" ? blankHeader.header_name : null).toBe("x-api-key");
  });

  it("oauth2 → none (not editable here)", () => {
    expect(formToConfig({ ...AUTH_FORM_DEFAULTS, kind: "oauth2" })).toEqual({ kind: "none" });
  });

  it("round-trips bearer through both maps", () => {
    const config = { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " } as const;
    expect(formToConfig(configToForm(config))).toEqual(config);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/overview/authConfigMap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/features/catalog/overview/authConfigMap.ts`:

```ts
import type { SavedAuthConfigIpc } from "@/ipc/bindings";

export type AuthFormKind = "none" | "bearer" | "apikey" | "oauth2";

export interface AuthForm {
  kind: AuthFormKind;
  envVar: string; // env-var NAME (for env_var configs)
  headerName: string; // header for apikey
  prefix: string; // value prefix (apikey)
}

export const AUTH_FORM_DEFAULTS: AuthForm = {
  kind: "none",
  envVar: "",
  headerName: "x-api-key",
  prefix: "",
};

const BEARER_HEADER = "authorization";
const BEARER_PREFIX = "Bearer ";

/** Map a stored single-auth config to the editor form. */
export function configToForm(config: SavedAuthConfigIpc): AuthForm {
  switch (config.kind) {
    case "none":
      return { ...AUTH_FORM_DEFAULTS };
    case "env_var": {
      const isBearer = config.header_name === BEARER_HEADER && config.prefix === BEARER_PREFIX;
      return {
        kind: isBearer ? "bearer" : "apikey",
        envVar: config.env_var,
        headerName: config.header_name,
        prefix: config.prefix,
      };
    }
    case "oauth_2_client_credentials":
      return { ...AUTH_FORM_DEFAULTS, kind: "oauth2" };
  }
}

/** Map the editor form back to a stored single-auth config. */
export function formToConfig(form: AuthForm): SavedAuthConfigIpc {
  switch (form.kind) {
    case "none":
    case "oauth2": // OAuth2 client-credentials is not editable here; persist as "none".
      return { kind: "none" };
    case "bearer":
      return {
        kind: "env_var",
        env_var: form.envVar.trim(),
        header_name: BEARER_HEADER,
        prefix: BEARER_PREFIX,
      };
    case "apikey":
      return {
        kind: "env_var",
        env_var: form.envVar.trim(),
        header_name: form.headerName.trim() || "x-api-key",
        prefix: form.prefix,
      };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/overview/authConfigMap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/overview/authConfigMap.ts src/features/catalog/overview/authConfigMap.test.ts
git commit -m "feat(catalog): authConfigMap — single-auth config ⇄ form (plan-07)"
```

---

### Task 7: `SavedAuthEditor` — single-auth editor

**Files:**
- Create: `src/features/catalog/overview/SavedAuthEditor.tsx`
- Test: `src/features/catalog/overview/SavedAuthEditor.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/overview/SavedAuthEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SavedAuthEditor } from "./SavedAuthEditor";

describe("SavedAuthEditor", () => {
  it("shows the 'no auth' copy for a none config", () => {
    render(<SavedAuthEditor value={{ kind: "none" }} onChange={() => {}} />);
    expect(screen.getByText(/No authentication/i)).toBeInTheDocument();
  });

  it("selecting Bearer emits an env_var config with authorization/'Bearer '", () => {
    const onChange = vi.fn();
    render(<SavedAuthEditor value={{ kind: "none" }} onChange={onChange} />);
    fireEvent.click(screen.getByText("Bearer"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("editing the Bearer token emits the env var name", () => {
    const onChange = vi.fn();
    render(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer " }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("BEARER_TOKEN_VAR"), { target: { value: "PROD_TOKEN" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "env_var", env_var: "PROD_TOKEN", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("renders header + value for an api-key config", () => {
    render(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "KEY", header_name: "x-api-key", prefix: "" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("x-api-key")).toBeInTheDocument();
    expect(screen.getByDisplayValue("KEY")).toBeInTheDocument();
  });

  it("shows the unsupported notice for an oauth2 config", () => {
    render(
      <SavedAuthEditor
        value={{
          kind: "oauth_2_client_credentials",
          token_url: "https://t",
          client_id: "id",
          client_secret_env_var: "SECRET",
          scopes: [],
        }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/OAuth2/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/overview/SavedAuthEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/features/catalog/overview/SavedAuthEditor.tsx`:

```tsx
import { Key } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import { EnvVarField } from "./EnvVarField";
import { configToForm, formToConfig, type AuthForm } from "./authConfigMap";

export interface SavedAuthEditorProps {
  value: SavedAuthConfigIpc;
  onChange: (next: SavedAuthConfigIpc) => void;
}

const KIND_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer" },
  { value: "apikey", label: "API key" },
];

/** Edit a single `SavedAuthConfigIpc` (collection node auth). None / Bearer / API key map to
 *  `none`/`env_var`; an existing OAuth2 config is shown as a read-only notice. */
export function SavedAuthEditor({ value, onChange }: SavedAuthEditorProps) {
  const form = configToForm(value);
  const patch = (next: Partial<AuthForm>) => onChange(formToConfig({ ...form, ...next }));

  if (form.kind === "oauth2") {
    return (
      <div className="grid gap-3 text-xs">
        <ToggleGroup
          value="oauth2"
          onValueChange={(v) => patch({ kind: v as AuthForm["kind"] })}
          options={KIND_OPTIONS}
        />
        <div className="rounded-md border border-border bg-card p-3 text-muted-foreground">
          OAuth2 client-credentials is configured but not editable here yet. Switch to another
          type to replace it.
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <ToggleGroup
        value={form.kind}
        onValueChange={(v) => patch({ kind: v as AuthForm["kind"] })}
        options={KIND_OPTIONS}
      />
      {form.kind === "none" && (
        <div className="py-1 text-xs text-muted-foreground">
          No authentication is attached to this collection's requests.
        </div>
      )}
      {form.kind === "bearer" && (
        <EnvVarField
          label="Token"
          value={form.envVar}
          onChange={(v) => patch({ envVar: v })}
          placeholder="BEARER_TOKEN_VAR"
        />
      )}
      {form.kind === "apikey" && (
        <>
          <div className="grid gap-1.5">
            <Label className="text-xs">Header name</Label>
            <Input
              value={form.headerName}
              onChange={(e) => patch({ headerName: e.target.value })}
              className="h-9 font-mono text-[12.5px]"
            />
          </div>
          <EnvVarField
            label="Value"
            value={form.envVar}
            onChange={(v) => patch({ envVar: v })}
            placeholder="API_KEY_VAR"
          />
        </>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Key className="size-3 shrink-0" />
        <span>
          Secrets are referenced by environment-variable name — the value lives in the
          environment, never in the request.
        </span>
      </div>
    </div>
  );
}
```

> Note: the `ToggleGroup` options render their labels as the accessible button text, so the
> tests select them via `screen.getByText("Bearer")`. Each kind switch fires `onChange`
> immediately with the mapped config (empty env var until the user fills it in).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/overview/SavedAuthEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/overview/SavedAuthEditor.tsx src/features/catalog/overview/SavedAuthEditor.test.tsx
git commit -m "feat(catalog): SavedAuthEditor — single-auth editor (plan-07)"
```

---

### Task 8: `CollectionOverview` container

**Files:**
- Create: `src/features/catalog/overview/CollectionOverview.tsx`
- Test: `src/features/catalog/overview/CollectionOverview.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/features/catalog/overview/CollectionOverview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/ipc/client", () => ({
  ipc: {
    collectionUpsert: vi.fn().mockResolvedValue(undefined),
    collectionSetVariables: vi.fn().mockResolvedValue(undefined),
    collectionSetNodeAuth: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ipc } from "@/ipc/client";
import { CollectionOverview } from "./CollectionOverview";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

// CollectionTitle + the close button use the `Tooltip` wrapper, which needs a
// TooltipProvider ancestor (supplied globally in `main.tsx`). Wrap renders here.
function r(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function req(id: string, name: string): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "GetX",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}

function collection(over: Partial<CollectionIpc> = {}): CollectionIpc {
  return {
    id: "c1", name: "My Col", items: [req("r1", "GetX")], variables: { base: "x" },
    auth: { kind: "none" }, default_tls: false, skip_tls_verify: false, pinned: false,
    description: null, created_at: 0, ...over,
  };
}

function props(over = {}) {
  return {
    collection: collection(),
    onChanged: vi.fn(),
    onSelectRequest: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("CollectionOverview", () => {
  it("renders the Overview tab with the collection name and counts by default", () => {
    r(<CollectionOverview {...props()} />);
    expect(screen.getByText("My Col")).toBeInTheDocument();
    expect(screen.getByText(/1 request/)).toBeInTheDocument();
  });

  it("clicking a request row calls onSelectRequest", () => {
    const p = props();
    r(<CollectionOverview {...p} />);
    fireEvent.click(screen.getByText("GetX"));
    expect(p.onSelectRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1" }));
  });

  it("toggling TLS persists via collectionUpsert", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", default_tls: true }),
    );
  });

  it("editing the description persists via collectionUpsert", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getByText(/Add a description/i)); // empty desc → add button
    fireEvent.change(screen.getByPlaceholderText(/Describe what this collection/i), {
      target: { value: "Order APIs" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", description: "Order APIs" }),
    );
  });

  it("the Authorization tab persists a chosen auth via collectionSetNodeAuth", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getByText("Authorization"));
    fireEvent.click(screen.getByText("Bearer"));
    expect(ipc.collectionSetNodeAuth).toHaveBeenCalledWith("c1", null, {
      kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("the Variables tab persists edits via collectionSetVariables", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getByText("Variables"));
    fireEvent.change(screen.getByDisplayValue("x"), { target: { value: "y" } });
    expect(ipc.collectionSetVariables).toHaveBeenCalledWith("c1", { base: "y" });
  });

  it("the close button calls onClose", () => {
    const p = props();
    r(<CollectionOverview {...p} />);
    fireEvent.click(screen.getByLabelText("close-overview"));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/catalog/overview/CollectionOverview.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/features/catalog/overview/CollectionOverview.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Layers, X, AlignLeft, Lock, KeyRound, Braces, Bookmark, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { newId } from "@/lib/ids";
import { ipc } from "@/ipc/client";
import type { CollectionIpc, ItemIpc, SavedAuthConfigIpc, SavedRequestIpc } from "@/ipc/bindings";
import { flattenRequests } from "../palette";
import { COTabs, type COTabItem } from "./COTabs";
import { COBlock } from "./COBlock";
import { CollectionTitle } from "./CollectionTitle";
import { DescriptionBlock } from "./DescriptionBlock";
import { VariablesBlock, type VarRow } from "./VariablesBlock";
import { TlsBlock } from "./TlsBlock";
import { SavedAuthEditor } from "./SavedAuthEditor";

function countFolders(items: ItemIpc[]): number {
  return items.reduce((n, it) => (it.type === "folder" ? n + 1 + countFolders(it.items) : n), 0);
}

function entriesToRows(vars: Partial<{ [k: string]: string }>): VarRow[] {
  return Object.entries(vars)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => ({ id: newId(), k, v }));
}

export interface CollectionOverviewProps {
  collection: CollectionIpc;
  /** Reload the tree after a persisted change. */
  onChanged: () => void;
  /** Open a saved request in Focus (caller binds origin + handles dirty-confirm). */
  onSelectRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onClose: () => void;
}

/** Main-area collection panel: Overview / Authorization / Variables (spec §8, single-auth). */
export function CollectionOverview({ collection, onChanged, onSelectRequest, onClose }: CollectionOverviewProps) {
  const [tab, setTab] = useState("overview");
  const [varRows, setVarRows] = useState<VarRow[]>(() => entriesToRows(collection.variables));
  // Re-seed the variable buffer only when the collection identity changes, so a persist→reload
  // of the SAME collection doesn't clobber an in-progress edit.
  useEffect(() => {
    setVarRows(entriesToRows(collection.variables));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.id]);

  const hits = useMemo(() => flattenRequests([collection]), [collection]);
  const total = hits.length;
  const folders = countFolders(collection.items);
  const varCount = varRows.filter((r) => r.k.trim()).length;

  const tabs: COTabItem[] = [
    { value: "overview", label: "Overview" },
    { value: "auth", label: "Authorization" },
    { value: "variables", label: "Variables", hint: varCount || null },
  ];

  const persistName = (name: string) => {
    const next = name.trim();
    if (!next || next === collection.name) return;
    void ipc.collectionUpsert({ ...collection, name: next }).then(onChanged).catch(() => {});
  };
  const persistDesc = (text: string) => {
    void ipc.collectionUpsert({ ...collection, description: text.trim() || null }).then(onChanged).catch(() => {});
  };
  const persistTls = (next: { enabled: boolean; skipVerify: boolean }) => {
    void ipc
      .collectionUpsert({ ...collection, default_tls: next.enabled, skip_tls_verify: next.skipVerify })
      .then(onChanged)
      .catch(() => {});
  };
  const persistAuth = (config: SavedAuthConfigIpc) => {
    void ipc.collectionSetNodeAuth(collection.id, null, config).then(onChanged).catch(() => {});
  };
  const persistVars = (rows: VarRow[]) => {
    const record: Record<string, string> = {};
    for (const r of rows) {
      const k = r.k.trim();
      if (k) record[k] = r.v;
    }
    void ipc.collectionSetVariables(collection.id, record).then(onChanged).catch(() => {});
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* header */}
      <div className="flex h-12 flex-none items-center gap-3 border-b border-border px-4">
        <Layers size={15} className="flex-none text-muted-foreground" />
        <CollectionTitle name={collection.name} onRename={persistName} />
        <span className="truncate text-[11.5px] text-muted-foreground/55">
          {folders} {folders === 1 ? "folder" : "folders"} · {total}{" "}
          {total === 1 ? "request" : "requests"}
        </span>
        <div className="ml-auto">
          <Tooltip content="Close">
            <Button variant="ghost" size="icon-sm" aria-label="close-overview" onClick={onClose}>
              <X size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <COTabs value={tab} onChange={setTab} items={tabs} />

      {/* body */}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[680px] px-5 py-6">
          {tab === "overview" && (
            <div className="flex flex-col gap-7">
              <COBlock
                icon={<AlignLeft size={15} />}
                title="Description"
                desc="What this collection is for — shown to anyone you share it with."
              >
                <DescriptionBlock text={collection.description ?? ""} onChange={persistDesc} />
              </COBlock>

              <COBlock
                icon={<Lock size={15} />}
                title="TLS defaults"
                desc="The transport security new requests in this collection start with."
              >
                <TlsBlock
                  enabled={collection.default_tls}
                  skipVerify={collection.skip_tls_verify}
                  onChange={persistTls}
                />
              </COBlock>

              {total > 0 && (
                <COBlock
                  icon={<Bookmark size={15} />}
                  title="Requests"
                  desc="Saved requests in this collection. Click any row to open it."
                >
                  <div className="overflow-hidden rounded-md border border-border">
                    {hits.map((h) => (
                      <button
                        key={h.request.id}
                        type="button"
                        onClick={() => onSelectRequest(collection.id, h.request)}
                        className="group flex h-9 w-full items-center gap-2.5 border-b border-border/40 px-3 text-left transition-colors hover:bg-accent/50"
                      >
                        <span
                          className="truncate text-[12.5px] text-foreground/90"
                          style={{ maxWidth: "45%" }}
                        >
                          {h.request.name}
                        </span>
                        <span className="hidden truncate font-mono text-[10.5px] text-muted-foreground/45 md:inline">
                          {h.request.service}.{h.request.method}
                        </span>
                        <Send
                          size={11}
                          className="ml-auto flex-none text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60"
                        />
                      </button>
                    ))}
                  </div>
                </COBlock>
              )}
            </div>
          )}

          {tab === "auth" && (
            <COBlock
              icon={<KeyRound size={15} />}
              title="Authorization"
              desc="A single auth config applied to this collection's requests (a request can override it)."
            >
              <SavedAuthEditor value={collection.auth} onChange={persistAuth} />
            </COBlock>
          )}

          {tab === "variables" && (
            <COBlock
              icon={<Braces size={15} />}
              title="Variables"
              desc="Collection-wide key/value pairs, reusable as {{name}} inside requests."
            >
              <VariablesBlock
                rows={varRows}
                onChange={(next) => {
                  setVarRows(next);
                  persistVars(next);
                }}
              />
            </COBlock>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/overview/CollectionOverview.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/overview/CollectionOverview.tsx src/features/catalog/overview/CollectionOverview.test.tsx
git commit -m "feat(catalog): CollectionOverview — 3-tab single-auth panel (plan-07)"
```

---

### Task 9: Whole-plan verification + status update

**Files:**
- Modify: `docs/superpowers/plans/2026-06-05-plan-07-overview-and-palette.md` (this file — banner)
- Modify: `docs/superpowers/plans/2026-06-05-plan-00-index.md` (plan-07 row)

- [ ] **Step 1: Full front-end suite**

Run: `pnpm test`
Expected: PASS — all prior suites green **plus** the new files. Net new test files:
`palette`, `CommandPalette` (rewritten), `client.collectionAuth`, `overview/subComponents`,
`overview/authConfigMap`, `overview/SavedAuthEditor`, `overview/CollectionOverview`. The
rewritten `CommandPalette.test.tsx` replaces the old service/method tests (no net file count
change there).

- [ ] **Step 2: Targeted typecheck — zero new errors under the gated dirs**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | Select-String -Pattern "features\\(catalog|workflow)|app\\WorkflowApp|ipc\\client"`
Expected: the only `ipc\client.ts` line (if any) is the **1 pre-existing** legacy error noted
in plan-06; **no** new errors under `features/catalog`, `features/workflow`, or
`app/WorkflowApp.tsx`. (Repo-wide `tsc -b`/`pnpm build` stay blocked by the legacy errors
removed in plan-09 — that is expected.)

- [ ] **Step 3: Update this plan's banner**

Change the **Status** line at the top of this file to:

```markdown
**Status:** ✅ **done** (`<firstSha>..<lastSha>`, 8 commits). Front-end suite green;
targeted typecheck clean under `features/{catalog,workflow}` + `app/WorkflowApp.tsx`.
**Follow-ups (plan-09):** mount `CollectionOverview` in the main area when a collection is
opened from `SidebarShell`; feed `CommandPalette` the live tree + `openSavedRequest` with
`needsDiscardConfirm` interception (the `WorkflowApp` call site is a placeholder until then).
```

Fill `<firstSha>..<lastSha>` from `git log --oneline` (Task 1 → Task 9 commits).

- [ ] **Step 4: Update the index row**

In `docs/superpowers/plans/2026-06-05-plan-00-index.md`, change the `plan-07` row's **Status**
column from `outline` to `**✅ done** (\`<firstSha>..<lastSha>\`)`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-06-05-plan-07-overview-and-palette.md docs/superpowers/plans/2026-06-05-plan-00-index.md
git commit -m "docs(plan-07): mark complete; update index row"
```

---

## Self-review (run before executing)

**Spec coverage (§8, §9, §14, §15):**
- §9 ⌘K = saved requests, all collections, open in Focus → Tasks 1–2 (`palette.ts`,
  `CommandPalette` rewrite); dirty-confirm is the caller's (plan-09). ✅
- §8 CollectionOverview tabs Overview/Authorization/Variables → Tasks 5–8. ✅
- §8 single-auth (replaces `auth_by_env`) → Tasks 4 (wrapper), 6 (`authConfigMap`), 7
  (`SavedAuthEditor`), 8 (wires `collectionSetNodeAuth`). ✅
- §8 description on the real backend field (not localStorage) → Task 8 `persistDesc`. ✅
- §14 front-end tests: ⌘K (suggest saved, open in Focus) → Task 2; CollectionOverview
  (Overview/Authorization/Variables, single-auth) → Task 8. ✅
- §15 «Variables = таб в CollectionOverview», «Настройки коллекции: Overview/Authorization/
  Variables» → Task 8 (no Settings/delete tab — delete is the sidebar's, plan-05). ✅

**Type consistency:** `RequestHit` (`palette.ts`) is consumed unchanged by `CommandPalette`
and `CollectionOverview`. `AuthForm`/`configToForm`/`formToConfig` (`authConfigMap.ts`) are the
only producers of `SavedAuthConfigIpc` in the editor; `SavedAuthEditor` and the
`CollectionOverview` auth test assert the same `{ kind:"env_var", env_var:"", header_name:
"authorization", prefix:"Bearer " }` shape. `collectionSetNodeAuth(collectionId, itemId, config)`
matches the binding signature (Task 4) and the call site passes `null` itemId (Task 8).

**Placeholder scan:** none — every code/test step contains complete source; the only literal
"placeholder" is the deliberate `WorkflowApp` call-site stub (Task 3), explicitly deferred to
plan-09.

**Boundary check:** no backend/Rust changes; no new IPC commands (only a wrapper for an
existing command); legacy `collections/overview/*` is read-from (ported) but not modified —
its deletion is plan-09.
