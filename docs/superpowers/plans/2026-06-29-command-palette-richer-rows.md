# Command Palette — richer request rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give command-palette request results a second line showing the fully-qualified gRPC `service/method`, with match-highlighting on both lines and the collection name shown on the right only in flat (non-scoped) mode.

**Architecture:** Pure-frontend change. A new `methodLabel(request)` helper in `palette.ts` is the single source of the displayed method string; `paletteModel.ts` carries `methodIndices` (fuzzy indices of the query against that label) on each request row; `CommandPalette.tsx`'s `RowView` renders the two-line layout and hides the per-row collection name when scoped. A final pass centralizes the palette's inline copy into a new `palette` namespace in `messages.ts` (project `ui-strings` rule). Backend / IPC / bindings are untouched.

**Tech Stack:** React 18 + TypeScript, cmdk / shadcn `Command`, Vitest + Testing Library, Tailwind. Spec: `docs/superpowers/specs/2026-06-29-command-palette-richer-rows-design.md`.

---

## File structure

- `src/features/catalog/palette.ts` — add pure `methodLabel(request)` helper (display + index source of truth). **Modify.**
- `src/features/catalog/palette.test.ts` — cover `methodLabel`. **Modify.**
- `src/features/catalog/paletteModel.ts` — add `methodIndices` to the `request` row; rename the local `nameIndices` → `matchIndices` (now used for both name and method); later, source group-heading text from `messages`. **Modify.**
- `src/features/catalog/paletteModel.test.ts` — cover `methodIndices`. **Modify.**
- `src/features/catalog/CommandPalette.tsx` — two-line request row in `RowView`; thread `showCollection`; later, swap inline strings for `messages.palette.*`. **Modify.**
- `src/features/catalog/CommandPalette.test.tsx` — cover subtitle render + scoped collection-hiding. **Modify.**
- `src/lib/messages.ts` — new `palette` namespace. **Modify.**

Conventions to match (read before starting): test row/col fixtures use `service: "edo.attorney.v1.Letters"` and `method: name` (so `methodLabel` for request `Search` is `edo.attorney.v1.Letters/Search`). `fuzzyMatch(query, target)` returns `{ matched, score, indices }`. The `Highlighted` component renders one `<span>` per char when `indices` is non-empty (so Testing Library `getByText` only matches a row's full text when that text is **not** highlighted).

---

### Task 1: `methodLabel` helper in `palette.ts`

**Files:**
- Modify: `src/features/catalog/palette.ts`
- Test: `src/features/catalog/palette.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to the end of `src/features/catalog/palette.test.ts`, and add `methodLabel` to the existing import on line 3 (`import { flattenRequests, rankRequests, rankCollections, methodLabel } from "./palette";`):

```ts
describe("methodLabel", () => {
  it("joins service and method with a slash (gRPC path style)", () => {
    const hits = flattenRequests([
      col("c1", "Orders", [req("r1", "GetOrder", { service: "ord.v1.OrderService", method: "GetOrder" })]),
    ]);
    expect(methodLabel(hits[0].request)).toBe("ord.v1.OrderService/GetOrder");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/palette.test.ts -t "methodLabel"`
Expected: FAIL — `methodLabel is not a function` / TS error "has no exported member 'methodLabel'".

- [ ] **Step 3: Write minimal implementation**

In `src/features/catalog/palette.ts`, add after the `import` line (top of file):

```ts
/** Displayed gRPC identity of a saved request: `package.Service/Method`. Single source
 *  for both the palette subtitle text and its highlight indices, so they line up. */
export function methodLabel(request: SavedRequestIpc): string {
  return `${request.service}/${request.method}`;
}
```

(`SavedRequestIpc` is already imported on line 1 of `palette.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/palette.test.ts -t "methodLabel"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/palette.ts src/features/catalog/palette.test.ts
git commit -m "feat(palette): add methodLabel helper (service/method)"
```

---

### Task 2: `methodIndices` on the request row in `paletteModel.ts`

**Files:**
- Modify: `src/features/catalog/paletteModel.ts`
- Test: `src/features/catalog/paletteModel.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/catalog/paletteModel.test.ts`:

```ts
describe("derivePaletteResults — method indices", () => {
  it("highlights the service/method label when the query matches it (flat)", () => {
    // service is "edo.attorney.v1.Letters" → label "edo.attorney.v1.Letters/Search".
    // "letters" matches the service segment, so the subtitle must carry indices.
    const r = derivePaletteResults({ tree: TREE, scope: null, query: "letters", limits: LIMITS });
    const reqRow = r.rows.find((row) => row.kind === "request");
    expect(reqRow?.kind).toBe("request");
    if (reqRow?.kind === "request") expect(reqRow.methodIndices.length).toBeGreaterThan(0);
  });

  it("leaves method indices empty for an empty query (scoped)", () => {
    const r = derivePaletteResults({
      tree: TREE, scope: { id: "c1", name: "edo-attorney-letters" }, query: "", limits: LIMITS,
    });
    const reqRow = r.rows.find((row) => row.kind === "request");
    if (reqRow?.kind === "request") expect(reqRow.methodIndices).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/paletteModel.test.ts -t "method indices"`
Expected: FAIL — TS error "Property 'methodIndices' does not exist on type" (the `request` row variant has no such field yet).

- [ ] **Step 3: Write minimal implementation**

In `src/features/catalog/paletteModel.ts`:

1. Add `methodLabel` to the import on line 3:

```ts
import { flattenRequests, rankRequests, rankCollections, methodLabel } from "./palette";
```

2. Add `methodIndices` to the `request` variant of `PaletteRow` (the `kind: "request"` object), so it reads:

```ts
  | {
      kind: "request";
      value: string;
      collectionId: string;
      collectionName: string;
      request: SavedRequestIpc;
      indices: number[];
      methodIndices: number[];
    }
```

3. Rename the helper `nameIndices` → `matchIndices` (it now matches both names and method labels). Replace its definition and JSDoc:

```ts
/** Fuzzy-match indices of `query` against a display `target` (empty when no match/empty query). */
function matchIndices(query: string, target: string): number[] {
  const q = query.trim();
  if (!q) return [];
  const m = fuzzyMatch(q, target);
  return m.matched ? m.indices : [];
}
```

4. In the **scoped** branch `requestRows` map, change the `indices` line and add `methodIndices`:

```ts
    const requestRows: PaletteRow[] = hits.map((h) => ({
      kind: "request",
      value: "",
      collectionId: h.collectionId,
      collectionName: h.collectionName,
      request: h.request,
      indices: matchIndices(query, h.request.name),
      methodIndices: matchIndices(query, methodLabel(h.request)),
    }));
```

5. In the **flat** branch `reqRows` map, do the same:

```ts
    const reqRows: PaletteRow[] = rankRequests(query, flattenRequests(tree))
      .slice(0, limits.requests)
      .map((h) => ({
        kind: "request",
        value: "",
        collectionId: h.collectionId,
        collectionName: h.collectionName,
        request: h.request,
        indices: matchIndices(query, h.request.name),
        methodIndices: matchIndices(query, methodLabel(h.request)),
      }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/catalog/paletteModel.test.ts`
Expected: PASS (all existing tests in the file plus the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/paletteModel.ts src/features/catalog/paletteModel.test.ts
git commit -m "feat(palette): compute method-match indices on request rows"
```

---

### Task 3: Two-line request row + scoped collection-hide in `CommandPalette.tsx`

**Files:**
- Modify: `src/features/catalog/CommandPalette.tsx`
- Test: `src/features/catalog/CommandPalette.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/features/catalog/CommandPalette.test.tsx` (inside the `describe("CommandPalette", …)` block):

```ts
  it("renders the service/method subtitle on request rows", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Tab}"); // drill into c1; method query resets to "" → subtitles unhighlighted
    expect(screen.getByText("edo.attorney.v1.Letters/Search")).toBeInTheDocument();
    expect(screen.getByText("edo.attorney.v1.Letters/GetStatus")).toBeInTheDocument();
  });

  it("shows the per-row collection name in flat mode", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "search"); // request rows r1 + r2, both in edo-attorney-letters; no collection row, no chip
    expect(screen.getAllByText("edo-attorney-letters").length).toBe(2);
  });

  it("hides the per-row collection name in scoped mode", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Tab}"); // scope chip now shows the collection name…
    await user.keyboard("search"); // …and method rows must NOT repeat it
    expect(screen.getAllByText("edo-attorney-letters").length).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/catalog/CommandPalette.test.tsx -t "subtitle"`
Expected: FAIL — `Unable to find an element with the text: edo.attorney.v1.Letters/Search` (no subtitle rendered yet).

- [ ] **Step 3: Write minimal implementation**

In `src/features/catalog/CommandPalette.tsx`:

1. Add the `methodLabel` import below the existing `paletteModel` import (around line 20):

```ts
import { methodLabel } from "./palette";
```

2. Replace the entire `RowView` function with this version (adds `showCollection`, two-line request branch; `collection`/`overview` branches unchanged):

```tsx
function RowView({ row, showCollection }: { row: PaletteRow; showCollection: boolean }) {
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
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">
          <Highlighted text={row.request.name} indices={row.indices} />
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          <Highlighted text={methodLabel(row.request)} indices={row.methodIndices} />
        </span>
      </span>
      {showCollection && (
        <span className="flex-none truncate font-mono text-[11px] text-muted-foreground">
          {row.collectionName}
        </span>
      )}
    </span>
  );
}
```

3. Update the single `RowView` call site (inside the `result.groups.map(...)` → `g.rows.map(...)`), passing `showCollection`:

```tsx
              const items = g.rows.map((row) => (
                <CommandItem key={row.value} value={row.value} onSelect={() => activate(row)}>
                  <RowView row={row} showCollection={scope === null} />
                </CommandItem>
              ));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/catalog/CommandPalette.test.tsx`
Expected: PASS — all existing palette component tests plus the three new ones (subtitle rendered; collection name present twice in flat mode, once in scoped mode).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/CommandPalette.tsx src/features/catalog/CommandPalette.test.tsx
git commit -m "feat(palette): two-line request rows with service/method subtitle"
```

---

### Task 4: Centralize palette strings into `messages.ts` (`ui-strings` rule)

This is a refactor — no behavior change. The existing palette tests (which assert literal text like `"Collections"`, `/start typing/i`, `/methods in edo-attorney-letters/i`) are the guard: text must stay byte-identical, so they must stay green before and after.

**Files:**
- Modify: `src/lib/messages.ts`
- Modify: `src/features/catalog/paletteModel.ts` (group heading text)
- Modify: `src/features/catalog/CommandPalette.tsx` (placeholders, title, description, empty hints, footer prose, "drill in")

- [ ] **Step 1: Establish the green baseline**

Run: `pnpm test src/features/catalog/`
Expected: PASS (records the text the refactor must preserve).

- [ ] **Step 2: Add the `palette` namespace to `messages.ts`**

In `src/lib/messages.ts`, add this entry to the `messages` object (e.g. after the `catalog` namespace, before `contract`). Text must match the current inline strings exactly:

```ts
  palette: {
    title: "Command palette",
    description: "Search collections and saved requests by name, then open one.",
    searchFlat: "Search collections and requests…",
    searchScoped: (name: string) => `Search methods in ${name}…`,
    groupCollections: "Collections",
    groupRequests: "Requests",
    groupMethods: (name: string) => `${name} · methods`,
    emptyScoped: (name: string) => `No methods in ${name}`,
    emptyFlat: "Start typing to find a collection or method",
    emptyNoMatch: "No matches",
    drillIn: "drill in",
    footerDrill: "drill / complete",
    footerOpen: "open",
    footerClose: "close",
  },
```

- [ ] **Step 3: Source the group headings in `paletteModel.ts` from `messages`**

In `src/features/catalog/paletteModel.ts`, add the import at the top:

```ts
import { messages } from "@/lib/messages";
```

Replace the three heading literals:
- scoped methods heading: `groups.push({ heading: \`${scope.name} · methods\`, rows: requestRows });` → `groups.push({ heading: messages.palette.groupMethods(scope.name), rows: requestRows });`
- collections heading: `if (colRows.length > 0) groups.push({ heading: "Collections", rows: colRows });` → `… groups.push({ heading: messages.palette.groupCollections, rows: colRows });`
- requests heading: `if (reqRows.length > 0) groups.push({ heading: "Requests", rows: reqRows });` → `… groups.push({ heading: messages.palette.groupRequests, rows: reqRows });`

- [ ] **Step 4: Swap the component's inline strings in `CommandPalette.tsx`**

In `src/features/catalog/CommandPalette.tsx`, add the import near the top:

```ts
import { messages } from "@/lib/messages";
```

Then:

- `emptyHint`:

```tsx
  const emptyHint = scope
    ? messages.palette.emptyScoped(scope.name)
    : query.trim() === ""
      ? messages.palette.emptyFlat
      : messages.palette.emptyNoMatch;
```

- `DialogTitle` / `DialogDescription` text:

```tsx
        <DialogTitle className="sr-only">{messages.palette.title}</DialogTitle>
        <DialogDescription className="sr-only">{messages.palette.description}</DialogDescription>
```

- `CommandInput` placeholder:

```tsx
            placeholder={scope ? messages.palette.searchScoped(scope.name) : messages.palette.searchFlat}
```

- The collection-row "drill in" hint in `RowView` (keep the `⇥` glyph literal, centralize only the prose):

```tsx
        <span className="ml-auto flex-none text-[11px] text-muted-foreground">⇥ {messages.palette.drillIn}</span>
```

- The footer prose (keep the `<Kbd>` glyphs, centralize the words):

```tsx
          <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>⇥</Kbd> {messages.palette.footerDrill}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> {messages.palette.footerOpen}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> {messages.palette.footerClose}
            </span>
          </div>
```

- [ ] **Step 5: Verify tests + types stay green**

Run: `pnpm test src/features/catalog/ && pnpm lint`
Expected: PASS — the palette suite is unchanged (text preserved) and `tsc -b` is clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/messages.ts src/features/catalog/paletteModel.ts src/features/catalog/CommandPalette.tsx
git commit -m "refactor(palette): centralize command-palette strings in messages.ts"
```

---

### Task 5: Full gate

**Files:** none (verification only).

- [ ] **Step 1: Run the whole frontend gate**

Run: `pnpm test`
Expected: PASS — entire Vitest suite green (the pre-existing prefs/settings/shell `localStorage`-under-jsdom failures, if any, are unrelated to this change; confirm no palette/catalog regressions).

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: PASS — `tsc -b` clean.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: PASS — `tsc -b && vite build` completes.

- [ ] **Step 4: Final commit (if anything was adjusted)**

```bash
git status
# if the gate required a fix, commit it:
git commit -am "chore(palette): gate fixups"
```

---

## Notes for the implementer

- **No backend.** Do not run `cargo`, do not regenerate bindings — `SavedRequestIpc` already carries `service` / `method`. This is frontend-only.
- **Highlighting vs `getByText`.** `Highlighted` fragments its text into per-char spans when `indices` is non-empty. The Task 3 subtitle test deliberately drills into scope with an empty method query so subtitles render as single text nodes (`indices` empty) and `getByText` can match the whole `service/method` string.
- **Collection-count assertions.** Flat query `"search"` yields exactly two request rows (`Search`, `SearchByInn`) both in `edo-attorney-letters`, with no matching collection row and no scope chip → the name appears exactly twice. In scoped mode only the chip shows it → exactly once. That contrast is the test.
- **Layout intent.** The name column is `flex-1 min-w-0` so the name and method lines truncate first; the right-side collection name is `flex-none` (short, stays readable). Word-wrap is off in the palette — long labels truncate, they don't wrap.
- **Out of scope (do not add):** per-row icons, an address line, folder-path breadcrumb, streaming indicators, empty-state recents, action-commands. See the spec's "Вне scope" section.
```
