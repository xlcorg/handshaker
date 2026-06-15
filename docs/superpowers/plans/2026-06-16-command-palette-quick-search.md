# Command Palette — быстрый поиск по коллекциям и методам — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Статус:** 📝 NOT STARTED. **Ветка:** `claude/nervous-swartz-f4def4` (worktree).
> **Спека:** `docs/superpowers/specs/2026-06-16-command-palette-quick-search-design.md`.
> **Режим исполнения:** subagent-driven (дефолт). spec+quality ревью на каждой задаче + финальное ревью ветки.

**Goal:** Вызываемая (`Ctrl/Cmd+K` и `Ctrl/Cmd+P`) палитра быстрого поиска: плоский fuzzy по коллекциям и сохранённым запросам + drill `коллекция → TAB → «.» → метод → TAB → Enter`.

**Architecture:** Модалка на `cmdk` (shadcn `Command`) внутри существующего Radix `Dialog`. Список ранжируем сами (`shouldFilter={false}`) через уже готовые `fuzzy.ts`/`palette.ts` + новый `rankCollections`. Чистый `paletteModel.ts` (state→rows) — сердце логики, 100% юнит-покрытие. Тонкий `CommandPalette.tsx` (рендер + клавиши). Хоткей — отдельный capture-фаза листенер (преемптит Monaco-чорд Ctrl+K). Бэкенд/IPC/bindings не трогаем.

**Tech Stack:** React 18 · cmdk (новая зависимость) · radix-ui Dialog · lucide-react · vitest + @testing-library/react + user-event · TS strict.

---

## Структура файлов

| Файл | Ответственность | Действие |
|------|------------------|----------|
| `package.json` | зависимость `cmdk` | modify |
| `src/components/ui/command.tsx` | shadcn-обёртка над cmdk (`Command`/`CommandInput`(+`prefix`)/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem`) | create |
| `src/components/ui/command.test.tsx` | smoke + проверка `shouldFilter={false}` | create |
| `src/features/catalog/palette.ts` | + `CollectionHit` + `rankCollections` | modify |
| `src/features/catalog/palette.test.ts` | + тесты `rankCollections` | modify |
| `src/features/catalog/paletteModel.ts` | чистый state→rows: `derivePaletteResults`, `bestCollectionMatch`, `completionFor` | create |
| `src/features/catalog/paletteModel.test.ts` | юнит-тесты модели | create |
| `src/features/catalog/CommandPalette.tsx` | компонент: рендер + клавиши TAB/«.»/Enter/Backspace | create |
| `src/features/catalog/CommandPalette.test.tsx` | RTL key-flow тесты | create |
| `src/features/catalog/paletteHotkey.ts` | чистый предикат `isPaletteHotkey` | create |
| `src/features/catalog/paletteHotkey.test.ts` | юнит-тесты предиката | create |
| `src/app/WorkflowApp.tsx` | состояние `paletteOpen` + capture-хоткей + reload-on-open + монтаж | modify |

---

## Task 1: зависимость cmdk + shadcn-обёртка `ui/command.tsx`

**Files:**
- Modify: `package.json` (через `pnpm add`)
- Create: `src/components/ui/command.tsx`
- Test: `src/components/ui/command.test.tsx`

- [ ] **Step 1: Установить cmdk**

Run: `pnpm add cmdk`
Expected: `package.json` получает `"cmdk": "^1..."` в `dependencies`, `pnpm-lock.yaml` обновлён.

- [ ] **Step 2: Написать падающий smoke-тест**

Create `src/components/ui/command.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Command, CommandInput, CommandList, CommandItem } from "./command";

describe("ui/command", () => {
  it("keeps non-matching items visible when shouldFilter is false", () => {
    render(
      <Command shouldFilter={false}>
        <CommandInput value="zzz" onValueChange={() => {}} />
        <CommandList>
          <CommandItem value="r0">Alpha</CommandItem>
          <CommandItem value="r1">Beta</CommandItem>
        </CommandList>
      </Command>,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders an input prefix slot before the text input", () => {
    render(
      <Command shouldFilter={false}>
        <CommandInput value="" onValueChange={() => {}} prefix={<span>chip</span>} />
        <CommandList />
      </Command>,
    );
    expect(screen.getByText("chip")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `pnpm test src/components/ui/command.test.tsx`
Expected: FAIL — `Cannot find module './command'`.

- [ ] **Step 4: Реализовать `ui/command.tsx`**

Create `src/components/ui/command.tsx`:

```tsx
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/cn";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandInput({
  className,
  prefix,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive.Input>, "prefix"> & {
  prefix?: React.ReactNode;
}) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-12 items-center gap-2 border-b px-3">
      <SearchIcon className="size-4 shrink-0 opacity-50" aria-hidden />
      {prefix}
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-10 min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-[360px] scroll-py-1 overflow-x-hidden overflow-y-auto scroll-thin", className)}
      {...props}
    />
  );
}

function CommandEmpty({ ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-8 text-center text-xs text-muted-foreground"
      {...props}
    />
  );
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `pnpm test src/components/ui/command.test.tsx`
Expected: PASS (2 теста).

- [ ] **Step 6: Коммит**

```bash
git add package.json pnpm-lock.yaml src/components/ui/command.tsx src/components/ui/command.test.tsx
git commit -m "feat(ui): add cmdk Command primitives (shadcn wrapper)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `rankCollections` в `palette.ts`

**Files:**
- Modify: `src/features/catalog/palette.ts`
- Test: `src/features/catalog/palette.test.ts`

- [ ] **Step 1: Дописать падающие тесты**

Добавить в конец `src/features/catalog/palette.test.ts` (импорт `rankCollections` добавить в существующую строку импорта `from "./palette"`):

```ts
import { flattenRequests, rankRequests, rankCollections } from "./palette";

describe("rankCollections", () => {
  const tree = [
    col("c1", "edo-attorney-letters", []),
    col("c2", "edo-billing", []),
    col("c3", "orders", []),
  ];

  it("returns all collections when the query is empty", () => {
    const out = rankCollections("  ", tree);
    expect(out.map((h) => h.collection.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("keeps only fuzzy-matching collections", () => {
    const out = rankCollections("edo", tree);
    expect(out.map((h) => h.collection.id).sort()).toEqual(["c1", "c2"]);
  });

  it("ranks a tighter prefix match first and exposes match indices", () => {
    const out = rankCollections("orders", tree);
    expect(out[0].collection.id).toBe("c3");
    expect(out[0].indices.length).toBe(6);
  });
});
```

> Примечание: верхняя строка `import { flattenRequests, rankRequests } from "./palette";` уже есть — замените её на строку с тремя именами выше (не добавляйте второй импорт).

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test src/features/catalog/palette.test.ts`
Expected: FAIL — `rankCollections is not a function` / нет экспорта.

- [ ] **Step 3: Реализовать**

Добавить в конец `src/features/catalog/palette.ts`:

```ts
export interface CollectionHit {
  collection: CollectionIpc;
  indices: number[];
}

/**
 * Rank collections by fuzzy match against their name. Empty query returns every
 * collection in tree order; otherwise non-matching collections are dropped and
 * matches sort by descending score (name as the tie-break).
 */
export function rankCollections(query: string, collections: CollectionIpc[]): CollectionHit[] {
  const q = query.trim();
  if (!q) return collections.map((c) => ({ collection: c, indices: [] }));
  const ranked: { hit: CollectionHit; score: number }[] = [];
  for (const c of collections) {
    const m = fuzzyMatch(q, c.name);
    if (m.matched) ranked.push({ hit: { collection: c, indices: m.indices }, score: m.score });
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.hit.collection.name.localeCompare(b.hit.collection.name))
    .map((r) => r.hit);
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm test src/features/catalog/palette.test.ts`
Expected: PASS (старые + 3 новых).

- [ ] **Step 5: Коммит**

```bash
git add src/features/catalog/palette.ts src/features/catalog/palette.test.ts
git commit -m "feat(catalog): rankCollections fuzzy ranker for the palette" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: чистая модель `paletteModel.ts`

**Files:**
- Create: `src/features/catalog/paletteModel.ts`
- Test: `src/features/catalog/paletteModel.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Create `src/features/catalog/paletteModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { derivePaletteResults, bestCollectionMatch, completionFor } from "./paletteModel";

function req(id: string, name: string, over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "edo.attorney.v1.Letters",
    method: name, body_template: "{}", metadata: [], auth: { kind: "none" },
    tls_override: null, last_used_at: null, use_count: 0, ...over,
  };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: false,
  };
}
const TREE: CollectionIpc[] = [
  col("c1", "edo-attorney-letters", [req("r1", "Search"), req("r2", "SearchByInn"), req("r3", "GetStatus")]),
  col("c2", "edo-billing", [req("r4", "Charge")]),
];
const LIMITS = { collections: 6, requests: 8 };

describe("derivePaletteResults — flat", () => {
  it("yields no groups for an empty query (hint shown by the component)", () => {
    const r = derivePaletteResults({ tree: TREE, scope: null, query: "  ", limits: LIMITS });
    expect(r.groups).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  it("groups Collections then Requests for a matching query", () => {
    const r = derivePaletteResults({ tree: TREE, scope: null, query: "edo", limits: LIMITS });
    expect(r.groups.map((g) => g.heading)).toEqual(["Collections", "Requests"]);
    const cols = r.groups[0].rows;
    expect(cols.every((row) => row.kind === "collection")).toBe(true);
    expect(cols.map((row) => (row.kind === "collection" ? row.collection.id : "")).sort()).toEqual(["c1", "c2"]);
  });

  it("assigns unique sequential values across all rows", () => {
    const r = derivePaletteResults({ tree: TREE, scope: null, query: "edo", limits: LIMITS });
    const values = r.rows.map((row) => row.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values[0]).toBe("r0");
  });

  it("caps collections and requests at the given limits", () => {
    const big = Array.from({ length: 10 }, (_, i) => col(`x${i}`, `edo-x${i}`, [req(`q${i}`, `Edo${i}`)]));
    const r = derivePaletteResults({ tree: big, scope: null, query: "edo", limits: { collections: 6, requests: 8 } });
    expect(r.groups[0].rows.length).toBe(6);
    expect(r.groups[1].rows.length).toBe(8);
  });
});

describe("derivePaletteResults — scoped", () => {
  const scope = { id: "c1", name: "edo-attorney-letters" };

  it("shows an overview row first then methods when the query is empty", () => {
    const r = derivePaletteResults({ tree: TREE, scope, query: "", limits: LIMITS });
    expect(r.rows[0].kind).toBe("overview");
    expect(r.groups[1].heading).toBe("edo-attorney-letters · methods");
    expect(r.groups[1].rows.map((row) => (row.kind === "request" ? row.request.id : ""))).toContain("r1");
  });

  it("drops the overview row once the user types a method query", () => {
    const r = derivePaletteResults({ tree: TREE, scope, query: "sea", limits: LIMITS });
    expect(r.rows.some((row) => row.kind === "overview")).toBe(false);
    const ids = r.rows.map((row) => (row.kind === "request" ? row.request.id : ""));
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
    expect(ids).not.toContain("r3");
  });
});

describe("bestCollectionMatch", () => {
  it("returns null for an empty query", () => {
    expect(bestCollectionMatch(TREE, "  ", null)).toBeNull();
  });
  it("prefers the highlighted collection when one is given", () => {
    expect(bestCollectionMatch(TREE, "edo", "c2")).toEqual({ id: "c2", name: "edo-billing" });
  });
  it("falls back to the top-ranked collection", () => {
    expect(bestCollectionMatch(TREE, "edo-attorney", null)).toEqual({ id: "c1", name: "edo-attorney-letters" });
  });
});

describe("completionFor", () => {
  it("completes a request to its name and ignores non-requests", () => {
    const r = derivePaletteResults({ tree: TREE, scope: { id: "c1", name: "edo-attorney-letters" }, query: "sea", limits: LIMITS });
    const reqRow = r.rows.find((row) => row.kind === "request")!;
    expect(completionFor(reqRow)).toBe("Search");
    const overviewRow = derivePaletteResults({ tree: TREE, scope: { id: "c1", name: "edo-attorney-letters" }, query: "", limits: LIMITS }).rows[0];
    expect(completionFor(overviewRow)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test src/features/catalog/paletteModel.test.ts`
Expected: FAIL — `Cannot find module './paletteModel'`.

- [ ] **Step 3: Реализовать `paletteModel.ts`**

Create `src/features/catalog/paletteModel.ts`:

```ts
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import { fuzzyMatch } from "./fuzzy";
import { flattenRequests, rankRequests, rankCollections } from "./palette";

export type PaletteRow =
  | { kind: "collection"; value: string; collection: CollectionIpc; indices: number[] }
  | {
      kind: "request";
      value: string;
      collectionId: string;
      collectionName: string;
      request: SavedRequestIpc;
      indices: number[];
    }
  | { kind: "overview"; value: string; collectionId: string; collectionName: string };

export interface PaletteGroup {
  heading: string | null;
  rows: PaletteRow[];
}

export interface PaletteResult {
  /** Flat, in render order — used by the component for highlight lookup. */
  rows: PaletteRow[];
  groups: PaletteGroup[];
}

export interface PaletteLimits {
  collections: number;
  requests: number;
}

export interface DeriveInput {
  tree: CollectionIpc[];
  scope: { id: string; name: string } | null;
  query: string;
  limits: PaletteLimits;
}

/** Fuzzy-match indices of `query` against a display `name` (empty when no match/empty query). */
function nameIndices(query: string, name: string): number[] {
  const q = query.trim();
  if (!q) return [];
  const m = fuzzyMatch(q, name);
  return m.matched ? m.indices : [];
}

/**
 * Pure state → rows for the palette. Flat mode (scope=null) groups matching collections
 * then requests; scoped mode lists the collection's requests (plus an overview row when the
 * method query is empty). Row `value`s are assigned sequentially (`r0`, `r1`, …) in render
 * order so they are unique and lowercase — dodging cmdk's value normalisation.
 */
export function derivePaletteResults(input: DeriveInput): PaletteResult {
  const { tree, scope, query, limits } = input;
  const groups: PaletteGroup[] = [];

  if (scope) {
    const col = tree.find((c) => c.id === scope.id);
    const hits = col ? rankRequests(query, flattenRequests([col])) : [];
    const requestRows: PaletteRow[] = hits.map((h) => ({
      kind: "request",
      value: "",
      collectionId: h.collectionId,
      collectionName: h.collectionName,
      request: h.request,
      indices: nameIndices(query, h.request.name),
    }));
    if (query.trim() === "") {
      groups.push({
        heading: null,
        rows: [{ kind: "overview", value: "", collectionId: scope.id, collectionName: scope.name }],
      });
    }
    if (requestRows.length > 0) groups.push({ heading: `${scope.name} · methods`, rows: requestRows });
  } else if (query.trim() !== "") {
    const colRows: PaletteRow[] = rankCollections(query, tree)
      .slice(0, limits.collections)
      .map((h) => ({ kind: "collection", value: "", collection: h.collection, indices: h.indices }));
    const reqRows: PaletteRow[] = rankRequests(query, flattenRequests(tree))
      .slice(0, limits.requests)
      .map((h) => ({
        kind: "request",
        value: "",
        collectionId: h.collectionId,
        collectionName: h.collectionName,
        request: h.request,
        indices: nameIndices(query, h.request.name),
      }));
    if (colRows.length > 0) groups.push({ heading: "Collections", rows: colRows });
    if (reqRows.length > 0) groups.push({ heading: "Requests", rows: reqRows });
  }

  let i = 0;
  const rows: PaletteRow[] = [];
  for (const g of groups) {
    for (const r of g.rows) {
      r.value = `r${i++}`;
      rows.push(r);
    }
  }
  return { rows, groups };
}

/**
 * Collection to commit when the user presses "." in flat mode: the highlighted collection
 * if one is highlighted, else the top-ranked fuzzy match. Null for an empty query or no match
 * (so "." on an empty input never commits a random collection).
 */
export function bestCollectionMatch(
  tree: CollectionIpc[],
  query: string,
  highlightedCollectionId: string | null,
): { id: string; name: string } | null {
  if (query.trim() === "") return null;
  if (highlightedCollectionId) {
    const c = tree.find((x) => x.id === highlightedCollectionId);
    if (c) return { id: c.id, name: c.name };
  }
  const top = rankCollections(query, tree)[0];
  return top ? { id: top.collection.id, name: top.collection.name } : null;
}

/** TAB-completion string for a row: a request completes to its name; others don't complete. */
export function completionFor(row: PaletteRow): string | null {
  return row.kind === "request" ? row.request.name : null;
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm test src/features/catalog/paletteModel.test.ts`
Expected: PASS (все блоки).

- [ ] **Step 5: Коммит**

```bash
git add src/features/catalog/paletteModel.ts src/features/catalog/paletteModel.test.ts
git commit -m "feat(catalog): pure paletteModel (flat/scoped rows, best-match, completion)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: компонент `CommandPalette.tsx`

**Files:**
- Create: `src/features/catalog/CommandPalette.tsx`
- Test: `src/features/catalog/CommandPalette.test.tsx`

- [ ] **Step 1: Написать падающие RTL-тесты**

Create `src/features/catalog/CommandPalette.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

function req(id: string, name: string, over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "edo.attorney.v1.Letters",
    method: name, body_template: "{}", metadata: [], auth: { kind: "none" },
    tls_override: null, last_used_at: null, use_count: 0, ...over,
  };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: false,
  };
}
const TREE: CollectionIpc[] = [
  col("c1", "edo-attorney-letters", [req("r1", "Search"), req("r2", "SearchByInn"), req("r3", "GetStatus")]),
  col("c2", "edo-billing", [req("r4", "Charge")]),
];

function setup(over: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    collections: TREE,
    onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(),
    ...over,
  };
  render(<CommandPalette {...props} />);
  return props;
}

async function type(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = screen.getByPlaceholderText(/methods in|collections and requests/i);
  await user.click(input);
  await user.keyboard(text);
}

describe("CommandPalette", () => {
  it("shows the empty hint before typing", () => {
    setup();
    expect(screen.getByText(/start typing/i)).toBeInTheDocument();
  });

  it("lists matching collections and requests in flat mode", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo");
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Requests")).toBeInTheDocument();
    // A collection name shows both as a collection row and as the muted label on its
    // request rows; highlighted rows also split the name into per-char spans (RTL only
    // matches leaf nodes). So assert presence (>=1), not uniqueness.
    expect(screen.getAllByText("edo-attorney-letters").length).toBeGreaterThan(0);
    expect(screen.getAllByText("edo-billing").length).toBeGreaterThan(0);
  });

  it("opens a request on Enter", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const props = setup();
    await type(user, "searchbyinn");
    await user.keyboard("{Enter}");
    expect(props.onOpenRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r2" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("opens a collection overview on Enter", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const props = setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Enter}");
    expect(props.onOpenCollection).toHaveBeenCalledWith("c1");
  });

  it("Tab on a collection drills into scope, then Enter opens a method", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const props = setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Tab}");
    expect(screen.getByPlaceholderText(/methods in edo-attorney-letters/i)).toBeInTheDocument();
    await user.keyboard("search");
    await user.keyboard("{Enter}");
    expect(props.onOpenRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1" }));
  });

  it("commits the best collection as scope on '.'", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo-attorney");
    await user.keyboard(".");
    expect(screen.getByPlaceholderText(/methods in edo-attorney-letters/i)).toBeInTheDocument();
  });

  it("Tab on a request completes its name into the input", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Tab}");
    await user.keyboard("sea");
    await user.keyboard("{Tab}");
    expect(screen.getByPlaceholderText(/methods in edo-attorney-letters/i)).toHaveValue("Search");
  });

  it("Backspace on an empty input pops the scope", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Tab}");
    expect(screen.getByPlaceholderText(/methods in/i)).toBeInTheDocument();
    await user.keyboard("{Backspace}");
    expect(screen.getByPlaceholderText(/collections and requests/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test src/features/catalog/CommandPalette.test.tsx`
Expected: FAIL — `Cannot find module './CommandPalette'`.

- [ ] **Step 3: Реализовать `CommandPalette.tsx`**

Create `src/features/catalog/CommandPalette.tsx`:

```tsx
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import {
  derivePaletteResults,
  bestCollectionMatch,
  completionFor,
  type PaletteRow,
} from "./paletteModel";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  collections: CollectionIpc[];
  onOpenRequest: (collectionId: string, request: SavedRequestIpc) => void;
  onOpenCollection: (collectionId: string) => void;
}

const LIMITS = { collections: 6, requests: 8 };

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-primary font-medium">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

function RowView({ row }: { row: PaletteRow }) {
  if (row.kind === "overview") {
    return (
      <span className="text-muted-foreground">
        Open <span className="text-foreground">{row.collectionName}</span> overview
      </span>
    );
  }
  if (row.kind === "collection") {
    return (
      <span className="flex w-full items-center gap-2">
        <span className="truncate">
          <Highlighted text={row.collection.name} indices={row.indices} />
        </span>
        <span className="ml-auto flex-none text-[11px] text-muted-foreground">⇥ drill in</span>
      </span>
    );
  }
  return (
    <span className="flex w-full items-center gap-2">
      <span className="truncate font-medium">
        <Highlighted text={row.request.name} indices={row.indices} />
      </span>
      <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{row.collectionName}</span>
    </span>
  );
}

export function CommandPalette({
  open,
  onClose,
  collections,
  onOpenRequest,
  onOpenCollection,
}: CommandPaletteProps) {
  const [scope, setScope] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState("");

  // Reset transient state whenever the palette closes.
  useEffect(() => {
    if (!open) {
      setScope(null);
      setQuery("");
      setHighlighted("");
    }
  }, [open]);

  const result = useMemo(
    () => derivePaletteResults({ tree: collections, scope, query, limits: LIMITS }),
    [collections, scope, query],
  );
  const rowsByValue = useMemo(() => {
    const m = new Map<string, PaletteRow>();
    for (const r of result.rows) m.set(r.value, r);
    return m;
  }, [result]);

  function activate(row: PaletteRow) {
    if (row.kind === "request") onOpenRequest(row.collectionId, row.request);
    else if (row.kind === "overview") onOpenCollection(row.collectionId);
    else onOpenCollection(row.collection.id);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Tab") {
      e.preventDefault();
      // Fall back to the top-ranked row: cmdk auto-selects the first item, but its
      // onValueChange may not have flushed into `highlighted` on the first keypress.
      const row = rowsByValue.get(highlighted) ?? result.rows[0];
      if (!row) return;
      if (row.kind === "collection") {
        setScope({ id: row.collection.id, name: row.collection.name });
        setQuery("");
      } else if (row.kind === "request") {
        const c = completionFor(row);
        if (c) setQuery(c);
      }
      return;
    }
    if (e.key === "." && !scope) {
      const hi = rowsByValue.get(highlighted) ?? result.rows[0];
      const highlightedColId = hi?.kind === "collection" ? hi.collection.id : null;
      const col = bestCollectionMatch(collections, query, highlightedColId);
      if (col) {
        e.preventDefault();
        setScope(col);
        setQuery("");
      }
      return;
    }
    if (e.key === "Backspace" && scope && query === "") {
      e.preventDefault();
      setScope(null);
    }
  }

  const emptyHint = scope
    ? `No methods in ${scope.name}`
    : query.trim() === ""
      ? "Start typing to find a collection or method"
      : "No matches";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="overflow-hidden gap-0 p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command shouldFilter={false} onValueChange={setHighlighted} onKeyDown={onKeyDown}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={scope ? `Search methods in ${scope.name}…` : "Search collections and requests…"}
            prefix={
              scope ? (
                <span className="flex flex-none items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-foreground">
                  {scope.name}
                  <ChevronRight className="size-3 opacity-60" aria-hidden />
                </span>
              ) : undefined
            }
          />
          <CommandList>
            <CommandEmpty>{emptyHint}</CommandEmpty>
            {result.groups.map((g, gi) => {
              const items = g.rows.map((row) => (
                <CommandItem key={row.value} value={row.value} onSelect={() => activate(row)}>
                  <RowView row={row} />
                </CommandItem>
              ));
              return (
                <CommandGroup key={gi} heading={g.heading ?? undefined}>
                  {items}
                </CommandGroup>
              );
            })}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>⇥</Kbd> drill / complete
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
```

> Примечание: cmdk управляет подсветкой САМ (uncontrolled) — мы лишь СЛУШАЕМ её через `onValueChange={setHighlighted}` (без `value=`), чтобы Enter штатно работал через `onSelect`. TAB/«.» берут подсвеченную строку, а при несинхронизированном на первом нажатии состоянии — фолбэк на `result.rows[0]` (топ-ранжированную, её cmdk и выделяет по умолчанию). `row.value` (`r0…`) уникален из модели и служит идентичностью cmdk.

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm test src/features/catalog/CommandPalette.test.tsx`
Expected: PASS (8 тестов).

> Если конкретный key-flow тест окажется флейки в jsdom (cmdk highlight/Tab-перехват), НЕ ослабляйте проверку молча: сначала добавьте `await screen.findByText(...)` перед клавишей (дать cmdk кадр на подсветку первого элемента), затем при необходимости вынесите спорную логику в чистый `paletteModel` тест, оставив в RTL только наблюдаемое (placeholder/чип/колбэк). Не используйте `shouldFilter` по умолчанию — он обязан быть `false`.

- [ ] **Step 5: Коммит**

```bash
git add src/features/catalog/CommandPalette.tsx src/features/catalog/CommandPalette.test.tsx
git commit -m "feat(catalog): CommandPalette (flat search + collection-scoped method drill)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: чистый предикат хоткея `paletteHotkey.ts`

**Files:**
- Create: `src/features/catalog/paletteHotkey.ts`
- Test: `src/features/catalog/paletteHotkey.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Create `src/features/catalog/paletteHotkey.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPaletteHotkey } from "./paletteHotkey";

function ev(over: Partial<KeyboardEvent>): KeyboardEvent {
  return { ctrlKey: false, metaKey: false, altKey: false, repeat: false, code: "KeyK", ...over } as KeyboardEvent;
}

describe("isPaletteHotkey", () => {
  it("matches Ctrl+K and Cmd+K", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, code: "KeyK" }))).toBe(true);
    expect(isPaletteHotkey(ev({ metaKey: true, code: "KeyK" }))).toBe(true);
  });
  it("matches Ctrl+P and Cmd+P", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, code: "KeyP" }))).toBe(true);
    expect(isPaletteHotkey(ev({ metaKey: true, code: "KeyP" }))).toBe(true);
  });
  it("matches by physical code regardless of layout (KeyK even if e.key differs)", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, code: "KeyK", key: "л" } as Partial<KeyboardEvent>))).toBe(true);
  });
  it("rejects without a modifier", () => {
    expect(isPaletteHotkey(ev({ code: "KeyK" }))).toBe(false);
  });
  it("rejects AltGr (ctrl+alt) and key repeat", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, altKey: true, code: "KeyK" }))).toBe(false);
    expect(isPaletteHotkey(ev({ ctrlKey: true, repeat: true, code: "KeyK" }))).toBe(false);
  });
  it("rejects other keys", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, code: "KeyB" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm test src/features/catalog/paletteHotkey.test.ts`
Expected: FAIL — `Cannot find module './paletteHotkey'`.

- [ ] **Step 3: Реализовать**

Create `src/features/catalog/paletteHotkey.ts`:

```ts
/**
 * True for the command-palette hotkey: Ctrl/Cmd + K or Ctrl/Cmd + P.
 * Matched by PHYSICAL key (`e.code`) so non-Latin layouts still trigger it, with
 * AltGr (ctrl+alt) and key-repeat guards — mirrors the Ctrl+E env-cycle hotkey.
 */
export function isPaletteHotkey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  if (e.altKey) return false;
  if (e.repeat) return false;
  return e.code === "KeyK" || e.code === "KeyP";
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm test src/features/catalog/paletteHotkey.test.ts`
Expected: PASS (6 тестов).

- [ ] **Step 5: Коммит**

```bash
git add src/features/catalog/paletteHotkey.ts src/features/catalog/paletteHotkey.test.ts
git commit -m "feat(catalog): isPaletteHotkey predicate (Ctrl/Cmd+K|P, physical key)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: интеграция в `WorkflowApp.tsx`

**Files:**
- Modify: `src/app/WorkflowApp.tsx`

- [ ] **Step 1: Добавить импорты**

В блок импортов `src/app/WorkflowApp.tsx` добавить:

```tsx
import { CommandPalette } from "@/features/catalog/CommandPalette";
import { isPaletteHotkey } from "@/features/catalog/paletteHotkey";
```

- [ ] **Step 2: Состояние палитры**

Рядом с другими `useState` (после `const [discardOpen, setDiscardOpen] = useState(false);`) добавить:

```tsx
const [paletteOpen, setPaletteOpen] = useState(false);
```

- [ ] **Step 3: Capture-фаза хоткей + reload-on-open**

Добавить ДВА `useEffect` (рядом с существующим `keydown`-эффектом). Capture-фаза + `stopPropagation` нужны, чтобы преемптить чорд Monaco `Ctrl+K`:

```tsx
// Командная палитра: Ctrl/Cmd+K|P. CAPTURE-фаза + stopPropagation — иначе Monaco
// перехватывает Ctrl+K как префикс чорда и палитра не откроется из редактора тела.
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (!isPaletteHotkey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setPaletteOpen(true);
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}, []);

// На открытии палитры освежаем дерево каталога (дёшево; гарантирует актуальные коллекции).
useEffect(() => {
  if (paletteOpen) void cat.reload();
}, [paletteOpen, cat.reload]);
```

- [ ] **Step 4: Монтаж компонента**

Рядом с другими модалками (после `<SettingsDialog … />`) добавить:

```tsx
<CommandPalette
  open={paletteOpen}
  onClose={() => setPaletteOpen(false)}
  collections={cat.tree}
  onOpenRequest={(cid, req) => {
    setPaletteOpen(false);
    openRequest(cid, req);
  }}
  onOpenCollection={(cid) => {
    setPaletteOpen(false);
    setPanelCollectionId(cid);
  }}
/>
```

- [ ] **Step 5: Полный прогон тестов + типы**

Run: `pnpm test`
Expected: PASS — все наборы, включая `WorkflowApp.test` (палитра монтируется закрытой → `Dialog` ничего не рендерит, существующие тесты не затронуты). Если `WorkflowApp.test` падает из-за нового импорта — НЕ мокать палитру без нужды; сперва убедиться, что причина не в реальной регрессии.

Run: `pnpm lint`
Expected: PASS (tsc -b без ошибок; при жалобе на неиспользуемый `renderIndex` в `CommandPalette.tsx` — удалить две строки с ним, см. примечание в Task 4).

- [ ] **Step 6: Коммит**

```bash
git add src/app/WorkflowApp.tsx
git commit -m "feat(app): mount CommandPalette + Ctrl/Cmd+K|P (capture, preempts Monaco)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: финальный гейт + живая проверка

**Files:** —

- [ ] **Step 1: Полный гейт**

Run: `pnpm test`
Expected: PASS (полный набор; новые наборы: ui/command, palette(+rankCollections), paletteModel, CommandPalette, paletteHotkey).

Run: `pnpm lint`
Expected: PASS.

Run: `pnpm build`
Expected: успешный `tsc -b` + `vite build` (свежий `dist/`).

- [ ] **Step 2: Живая проверка в WebView2 (ручная, через `pnpm tauri:dev`)**

Сценарий (отметить пройденным после визуальной проверки):
1. `Ctrl+K` И `Ctrl+P` открывают палитру (в т.ч. когда фокус в редакторе тела запроса — Monaco не перехватывает).
2. Пустой ввод → подсказка «Start typing…».
3. Ввод `edo` → группы «Collections» + «Requests», подсветка совпавших символов.
4. `TAB` на коллекции → чип `[edo-attorney-letters ›]`, список сузился до методов.
5. Альтернатива: `edo` затем `.` → тот же scope (символ «.» не введён).
6. `s` + `TAB` → ввод дополнился до `Search`; `Enter` → запрос открылся в Focus.
7. `Backspace` на пустом вводе в scope → чип снят (назад к плоскому).
8. `Enter` на коллекции (без drill) → открылся Collection Overview.
9. `Esc` закрывает палитру; повторное открытие — состояние сброшено.
10. Русская раскладка: `Ctrl+К`(физически KeyK) тоже открывает.

- [ ] **Step 3: Финальное ревью ветки**

Использовать `superpowers:requesting-code-review` по всей ветке против спеки; устранить замечания.

---

## Покрытие спеки (self-review map)

| Требование спеки | Задача |
|---|---|
| Зависимость cmdk + shadcn-обёртка | Task 1 |
| `rankCollections` (реюз `fuzzy.ts`) | Task 2 |
| `paletteModel` (flat/scope, overview-row, best-match, completion) | Task 3 |
| Суперсет-поиск: плоский (Collections+Requests) + scope-drill | Task 3 + Task 4 |
| Scope-чип + автодополнение по TAB + «.» коммит + Backspace pop | Task 4 |
| Enter: запрос → open; коллекция/overview → overview | Task 4 |
| Пустой ввод → подсказка (без «недавних») | Task 4 (`emptyHint`) |
| Подсветка совпавших символов (`fuzzy.indices`) | Task 4 (`Highlighted`) |
| Хоткей `Ctrl/Cmd+K` и `Ctrl/Cmd+P`, физическая клавиша, AltGr/repeat-гарды | Task 5 |
| Capture-фаза (преемпт Monaco) + reload-on-open + монтаж + реюз `openRequest`/`setPanelCollectionId` | Task 6 |
| Гейт vitest+tsc+build, бэкенд не тронут | Task 7 |

## Архивирование (после мерджа, не сейчас)

Когда фича влита в `main` и баннер плана помечен завершённым — `git mv` план и спеку в `docs/superpowers/plans/archive/` и `docs/superpowers/specs/archive/` одним коммитом `docs(archive): command palette quick search plan+spec`, затем обновить строку «Active work» в `CLAUDE.md` и индекс памяти.
