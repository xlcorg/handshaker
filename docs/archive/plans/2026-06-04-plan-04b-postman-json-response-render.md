# Postman-style JSON Response Rendering (Plan #4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-render the Plan #4 response viewer as **real, foldable, syntax-highlighted JSON** (braces, quoted keys, commas, closing lines, line numbers) — "like Postman" — while keeping every Plan #4 feature (double-click-copy §6, Ctrl+F search, virtualization, large-payload degrade/download, Postman-style `ErrorView`).

**Architecture:** Reuse the parsed node tree (`parseJsonTree`) and the `ResponseBody` orchestrator unchanged. Replace only the tree→rows projection and the row renderer: a pure `flattenLines(tree, collapsed)` turns the node tree into JSON **lines** (`open`/`close`/`folded`/`leaf` with comma flags), and a new `JsonLineView` renders one real-JSON line. `JsonTreeView` virtualizes the lines and adds a line-number gutter. The old outline pieces (`flattenVisible`, `JsonRowView`, `valuePreview`) are retired.

**Tech Stack:** React 18 + TypeScript (strict, `noUnusedLocals`) + `@tanstack/react-virtual` + Vitest + React Testing Library. Existing CSS tokens `.tok-key/.tok-str/.tok-num/.tok-bool/.tok-punct` (in `src/styles/globals.css`). Path alias `@` → `src`. Branch: `redesign/workflow-ui-spec-plans`.

**Spec ref:** `docs/superpowers/specs/2026-06-04-postman-style-json-response-render-design.md`.

> **✅ EXECUTION STATUS — PLAN #4b COMPLETE (2026-06-04, subagent-driven):** All 5 tasks
> implemented, committed, reviewed on `redesign/workflow-ui-spec-plans` (commits `d921d46`…`fdf9f3e`).
> Final whole-implementation review returned **READY TO MERGE** — comma-correctness traced through a
> nested stress case and confirmed valid in every sibling/last-child/root position (single
> comma-source-per-node invariant).
> - T1 `flattenLines` `d921d46` · T2 `valueLiteral` `7d554df` · T3 `JsonLineView` `6412d51`
> - T4 `JsonTreeView` real-JSON rewrite `d621342` · T5 retire outline + gate `fdf9f3e`
> - **Gate: 151/151 tests green** (38 files); `pnpm lint` (tsc -b) exit 0; `pnpm build` success.
> - The response now renders as real foldable JSON (braces, quoted keys, commas, closing lines,
>   line numbers, highlight); double-click-copy §6 + Ctrl+F + degrade/download + ErrorView preserved.
> - Retired: `JsonRowView`, `flattenVisible`, `valuePreview`.
> **Deferred (non-blocking minors from final review):** (1) `title` recomputes `JSON.stringify` per
> container row — could be hover-lazy; (2) leaf comma is a separate span while close/folded inline it
> (cosmetic). **Human smoke (Step 9) still pending:** rebuild (`pnpm tauri:dev`) and eyeball.

---

## File Structure

**Created (pure logic):**
- `src/features/response/json/jsonLines.ts` — `JsonLine`, `JsonLineKind`, `flattenLines(tree, collapsed)`.
- `src/features/response/json/jsonLines.test.ts`

**Created (component):**
- `src/features/response/json/JsonLineView.tsx` — renders one real-JSON line (line number, fold caret, quoted key, literal/bracket, comma, double-click copy, match highlight). Replaces `JsonRowView`.
- `src/features/response/json/JsonLineView.test.tsx`

**Modified:**
- `src/features/response/json/copyValue.ts` — add `valueLiteral(node)` (JSON literal for scalar leaves + empty containers). `copyTextForNode` unchanged.
- `src/features/response/json/copyValue.test.ts` — add `valueLiteral` tests (and, in the cleanup task, drop `valuePreview` tests).
- `src/features/response/json/JsonTreeView.tsx` — virtualize `flattenLines` + render `JsonLineView` + line numbers (component export name stays `JsonTree`; `ResponseBody` import unchanged).
- `src/features/response/json/JsonTreeView.test.tsx` — rewrite for JSON-line rendering.
- `src/features/response/json/jsonTree.ts` — remove now-unused `flattenVisible` (cleanup task).
- `src/features/response/json/jsonTree.test.ts` — remove `flattenVisible` test block (cleanup task).
- `src/features/response/ResponsePanel.test.tsx` — key now renders quoted (`"id"` not `id`).

**Deleted (cleanup task):**
- `src/features/response/json/JsonRowView.tsx`, `JsonRowView.test.tsx`.
- `valuePreview` from `copyValue.ts` (+ its tests).

**Untouched:** `parseJsonTree`/`JsonNode`, `copyValue.copyTextForNode`, `jsonSearch`, `degrade`/`download`, `ResponseBody.tsx`, `ErrorView.tsx`, `JsonSearchBar.tsx`, toast/clipboard, `ResponsePanel.tsx` (the swap is internal to `JsonTreeView`).

---

## Task 1: JSON-line model (`jsonLines.ts`)

Pure projection of the node tree into ordered JSON lines with correct comma placement. No React.

**Files:**
- Create: `src/features/response/json/jsonLines.ts`
- Test: `src/features/response/json/jsonLines.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/response/json/jsonLines.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { flattenLines, type JsonLine } from "./jsonLines";
import { parseJsonTree } from "./jsonTree";

const kinds = (ls: JsonLine[]) => ls.map((l) => l.kind);

describe("flattenLines", () => {
  it("emits open … children … close for an expanded object", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const lines = flattenLines(t, new Set());
    // {  "a": {  "b": 1  },  "c": 2  }
    expect(kinds(lines)).toEqual(["open", "open", "leaf", "close", "leaf", "close"]);
  });

  it("adds a trailing comma only when the node is not its parent's last child", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const lines = flattenLines(t, new Set());
    const node = (i: number) => t.nodes[lines[i].nodeId];
    expect(node(2).key).toBe("b");
    expect(lines[2]).toMatchObject({ kind: "leaf", trailingComma: false });  // b is last in a
    expect(node(3).key).toBe("a");
    expect(lines[3]).toMatchObject({ kind: "close", trailingComma: true });  // a not last in root
    expect(node(4).key).toBe("c");
    expect(lines[4]).toMatchObject({ kind: "leaf", trailingComma: false });  // c last in root
    expect(lines[5]).toMatchObject({ kind: "close", trailingComma: false }); // root close
  });

  it("collapses a non-empty container to a single folded line", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const aId = t.order.find((id) => t.nodes[id].key === "a")!;
    const lines = flattenLines(t, new Set([aId]));
    expect(kinds(lines)).toEqual(["open", "folded", "leaf", "close"]);
    expect(lines[1]).toMatchObject({ kind: "folded", trailingComma: true });
    expect(t.nodes[lines[1].nodeId].key).toBe("a");
  });

  it("renders an empty container as a single leaf line (no close line)", () => {
    const t = parseJsonTree(`{"e":{},"a":[]}`);
    const lines = flattenLines(t, new Set());
    expect(kinds(lines)).toEqual(["open", "leaf", "leaf", "close"]);
    expect(lines[1]).toMatchObject({ kind: "leaf", trailingComma: true });   // e, not last
    expect(lines[2]).toMatchObject({ kind: "leaf", trailingComma: false });  // a, last
  });

  it("handles a root scalar with no key and no comma", () => {
    const t = parseJsonTree(`"hi"`);
    const lines = flattenLines(t, new Set());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "leaf", depth: 0, trailingComma: false });
    expect(t.nodes[lines[0].nodeId].key).toBeNull();
  });

  it("handles a root array", () => {
    const t = parseJsonTree(`[1,2]`);
    const lines = flattenLines(t, new Set());
    expect(kinds(lines)).toEqual(["open", "leaf", "leaf", "close"]);
    expect(lines[1]).toMatchObject({ trailingComma: true });
    expect(lines[2]).toMatchObject({ trailingComma: false });
  });

  it("returns [] for an error tree", () => {
    expect(flattenLines(parseJsonTree("oops"), new Set())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/jsonLines.test.ts`
Expected: FAIL — `flattenLines is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/features/response/json/jsonLines.ts`:
```ts
import type { JsonNode, JsonTree } from "./jsonTree";

export type JsonLineKind = "leaf" | "open" | "close" | "folded";

export interface JsonLine {
  nodeId: string;
  kind: JsonLineKind;
  depth: number;
  trailingComma: boolean;
}

/** Is `node` the last child of its parent? Root (no parent) counts as last. */
function isLastChild(tree: JsonTree, node: JsonNode): boolean {
  if (node.parentId === null) return true;
  const parent = tree.nodes[node.parentId];
  return parent.childIds[parent.childIds.length - 1] === node.id;
}

/**
 * Project the node tree into ordered JSON lines.
 * - expanded non-empty container → `open` + children + `close` (close carries the comma)
 * - collapsed non-empty container → single `folded` line
 * - empty container / scalar → single `leaf` line
 * The trailing comma is on a node's last rendered line iff it is not its parent's last child.
 */
export function flattenLines(tree: JsonTree, collapsed: ReadonlySet<string>): JsonLine[] {
  if (tree.rootId === null) return [];
  const out: JsonLine[] = [];

  const walk = (id: string) => {
    const node = tree.nodes[id];
    const isContainer = node.kind === "object" || node.kind === "array";
    const comma = !isLastChild(tree, node);

    if (!isContainer || node.childCount === 0) {
      out.push({ nodeId: id, kind: "leaf", depth: node.depth, trailingComma: comma });
      return;
    }
    if (collapsed.has(id)) {
      out.push({ nodeId: id, kind: "folded", depth: node.depth, trailingComma: comma });
      return;
    }
    out.push({ nodeId: id, kind: "open", depth: node.depth, trailingComma: false });
    for (const c of node.childIds) walk(c);
    out.push({ nodeId: id, kind: "close", depth: node.depth, trailingComma: comma });
  };

  walk(tree.rootId);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/response/json/jsonLines.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/jsonLines.ts src/features/response/json/jsonLines.test.ts
git commit -m "feat(response): JSON-line model (flattenLines) for real-JSON rendering"
```
Append to the commit body:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 2: Scalar/empty literal helper (`valueLiteral`)

Add a JSON-literal helper for leaf lines (scalars + empty containers). `copyTextForNode` (copy rules) is untouched.

**Files:**
- Modify: `src/features/response/json/copyValue.ts`
- Test: `src/features/response/json/copyValue.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/features/response/json/copyValue.test.ts`. First update the import line at the top from:
```ts
import { copyTextForNode, valuePreview, PREVIEW_LIMIT } from "./copyValue";
```
to:
```ts
import { copyTextForNode, valuePreview, valueLiteral, PREVIEW_LIMIT } from "./copyValue";
```
Then append this block at the end of the file (after the existing `describe("valuePreview", …)` block, before the file ends):
```ts
describe("valueLiteral", () => {
  it("quotes strings and truncates with … past the limit", () => {
    expect(valueLiteral(nodeFor(`{"s":"hi"}`, "s"))).toBe(`"hi"`);
    const long = "x".repeat(PREVIEW_LIMIT + 50);
    const v = valueLiteral(nodeFor(`{"s":${JSON.stringify(long)}}`, "s"));
    expect(v.startsWith(`"`)).toBe(true);
    expect(v.endsWith(`…"`)).toBe(true);
  });
  it("renders number/bool/null as JSON literals", () => {
    expect(valueLiteral(nodeFor(`{"n":42}`, "n"))).toBe("42");
    expect(valueLiteral(nodeFor(`{"b":true}`, "b"))).toBe("true");
    expect(valueLiteral(nodeFor(`{"z":null}`, "z"))).toBe("null");
  });
  it("renders empty containers as {} and []", () => {
    expect(valueLiteral(nodeFor(`{"o":{}}`, "o"))).toBe("{}");
    expect(valueLiteral(nodeFor(`{"a":[]}`, "a"))).toBe("[]");
  });
});
```
(`nodeFor` is already defined at the top of this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/copyValue.test.ts`
Expected: FAIL — `valueLiteral is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/features/response/json/copyValue.ts`, append this function at the end of the file (keep everything else, including `valuePreview`, for now):
```ts
/**
 * JSON literal for a node rendered on a single `leaf` line: scalars and EMPTY containers.
 * (Non-empty containers are rendered with real brackets by `JsonLineView`, not via this.)
 */
export function valueLiteral(node: JsonNode): string {
  switch (node.kind) {
    case "string": {
      const s = node.value as string;
      const body = s.length > PREVIEW_LIMIT ? `${s.slice(0, PREVIEW_LIMIT)}…` : s;
      return `"${body}"`;
    }
    case "number":
    case "boolean":
      return String(node.value);
    case "null":
      return "null";
    case "array":
      return "[]";
    case "object":
      return "{}";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/response/json/copyValue.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/copyValue.ts src/features/response/json/copyValue.test.ts
git commit -m "feat(response): valueLiteral helper for JSON-line leaf rendering"
```
Append to the commit body:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 3: JSON-line renderer (`JsonLineView.tsx`)

Render one real-JSON line: line number, fold caret (containers only), quoted key, literal or bracket, trailing comma. Double-click copies the node's value (§6). No virtualization here — pure props.

**Files:**
- Create: `src/features/response/json/JsonLineView.tsx`
- Test: `src/features/response/json/JsonLineView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/response/json/JsonLineView.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonLineView } from "./JsonLineView";
import { parseJsonTree } from "./jsonTree";
import { flattenLines } from "./jsonLines";

/** Build (line, node, lineNumber) rows for a json so tests pick a specific line. */
function rows(json: string, collapsedKeys: string[] = []) {
  const tree = parseJsonTree(json);
  const collapsed = new Set(collapsedKeys.map((k) => tree.order.find((id) => tree.nodes[id].key === k)!));
  return flattenLines(tree, collapsed).map((line, i) => ({ line, node: tree.nodes[line.nodeId], n: i + 1 }));
}

const noop = () => {};

describe("JsonLineView", () => {
  it("renders a quoted key, quoted string value and a trailing comma", () => {
    const r = rows(`{"name":"Alice","x":1}`).find((x) => x.node.key === "name")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={noop} />);
    expect(screen.getByText(`"name"`)).toBeInTheDocument();
    expect(screen.getByText(`"Alice"`)).toBeInTheDocument();
    expect(screen.getByText(",")).toBeInTheDocument();
  });

  it("renders the line number", () => {
    const r = rows(`{"a":1}`).find((x) => x.node.key === "a")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={42}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={noop} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders an expanded container open line with a caret and toggles (no copy)", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onCopy = vi.fn();
    const r = rows(`{"obj":{"a":1}}`).find((x) => x.line.kind === "open" && x.node.key === "obj")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={onToggle} onCopy={onCopy} />);
    expect(screen.getByText(`"obj"`)).toBeInTheDocument();
    expect(screen.getByText("{")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "toggle-node" }));
    expect(onToggle).toHaveBeenCalledWith(r.node.id);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("renders a folded container as { … } with a caret", () => {
    const r = rows(`{"obj":{"a":1}}`, ["obj"]).find((x) => x.line.kind === "folded")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={noop} />);
    expect(screen.getByText(/\{ … \}/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "toggle-node" })).toBeInTheDocument();
  });

  it("renders a close line and copies the node on double-click", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const r = rows(`{"obj":{"a":1}}`).find((x) => x.line.kind === "close" && x.node.key === "obj")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={onCopy} />);
    expect(screen.getByText("}")).toBeInTheDocument();
    await user.dblClick(screen.getByText("}"));
    expect(onCopy).toHaveBeenCalledWith(r.node);
  });

  it("renders an empty object as {}", () => {
    const r = rows(`{"e":{}}`).find((x) => x.node.key === "e")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={noop} />);
    expect(screen.getByText("{}")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/JsonLineView.test.tsx`
Expected: FAIL — `JsonLineView` not exported.

- [ ] **Step 3: Write the component**

Create `src/features/response/json/JsonLineView.tsx`:
```tsx
import { cn } from "@/lib/cn";
import type { JsonKind, JsonNode } from "./jsonTree";
import type { JsonLine } from "./jsonLines";
import { copyTextForNode, valueLiteral } from "./copyValue";

const LITERAL_CLASS: Record<JsonKind, string> = {
  string: "tok-str",
  number: "tok-num",
  boolean: "tok-bool",
  null: "tok-punct",
  object: "tok-punct",
  array: "tok-punct",
};

export interface JsonLineViewProps {
  line: JsonLine;
  node: JsonNode;
  lineNumber: number;
  isMatch: boolean;
  isActiveMatch: boolean;
  onToggle: (id: string) => void;
  onCopy: (node: JsonNode) => void;
}

export function JsonLineView({
  line, node, lineNumber, isMatch, isActiveMatch, onToggle, onCopy,
}: JsonLineViewProps) {
  const isContainer = node.kind === "object" || node.kind === "array";
  const canFold = isContainer && node.childCount > 0 && (line.kind === "open" || line.kind === "folded");
  const openBracket = node.kind === "array" ? "[" : "{";
  const closeBracket = node.kind === "array" ? "]" : "}";
  const showKey = node.key != null && line.kind !== "close";

  const content = () => {
    switch (line.kind) {
      case "open":
        return <span className="tok-punct">{openBracket}</span>;
      case "close":
        return <span className="tok-punct">{line.trailingComma ? `${closeBracket},` : closeBracket}</span>;
      case "folded":
        return (
          <span className="tok-punct">
            {openBracket} … {closeBracket}{line.trailingComma ? "," : ""}
          </span>
        );
      case "leaf":
        return (
          <>
            <span className={LITERAL_CLASS[node.kind]}>{valueLiteral(node)}</span>
            {line.trailingComma && <span className="tok-punct">,</span>}
          </>
        );
    }
  };

  return (
    <div
      role="treeitem"
      aria-expanded={canFold ? line.kind === "open" : undefined}
      onDoubleClick={() => onCopy(node)}
      title={copyTextForNode(node)}
      style={{ paddingLeft: 8 + line.depth * 14 }}
      className={cn(
        "flex h-[22px] items-center gap-1.5 whitespace-pre pr-2 font-mono text-[12.5px] leading-[22px]",
        "cursor-default select-none hover:bg-accent/50",
        isMatch && "bg-[hsl(var(--syntax-num))]/15",
        isActiveMatch && "bg-[hsl(var(--syntax-num))]/35",
      )}
    >
      <span className="w-[3ch] flex-none select-none text-right tabular-nums text-[11px] text-muted-foreground/60">
        {lineNumber}
      </span>
      {canFold ? (
        <button
          type="button"
          aria-label="toggle-node"
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          className="w-[1ch] text-muted-foreground"
        >
          {line.kind === "folded" ? "▸" : "▾"}
        </button>
      ) : (
        <span className="w-[1ch]" aria-hidden />
      )}
      {showKey && (
        <>
          <span className="tok-key">"{node.key}"</span>
          <span className="tok-punct">: </span>
        </>
      )}
      {content()}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/response/json/JsonLineView.test.tsx`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/JsonLineView.tsx src/features/response/json/JsonLineView.test.tsx
git commit -m "feat(response): JsonLineView — real-JSON line renderer"
```
Append to the commit body:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 4: Rework `JsonTreeView` to render JSON lines

Virtualize `flattenLines` and render `JsonLineView` with line numbers. Keep the `JsonTree` export name and props so `ResponseBody` needs no change.

**Files:**
- Modify (rewrite): `src/features/response/json/JsonTreeView.tsx`
- Test (rewrite): `src/features/response/json/JsonTreeView.test.tsx`

- [ ] **Step 1: Write the failing test (replace the whole file)**

Replace the entire contents of `src/features/response/json/JsonTreeView.test.tsx` with:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 22,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 22, size: 22 })),
    scrollToIndex: vi.fn(),
  }),
}));

import { JsonTree } from "./JsonTreeView";
import { parseJsonTree } from "./jsonTree";

const base = {
  matchIds: new Set<string>(),
  activeMatchId: null,
  scrollToId: null,
  onToggle: () => {},
  onCopy: () => {},
};

describe("JsonTree (JSON lines)", () => {
  it("renders real JSON lines including closing braces", () => {
    const tree = parseJsonTree(`{"a":{"b":1},"c":2}`);
    render(<JsonTree tree={tree} collapsed={new Set()} {...base} />);
    expect(screen.getByText(`"a"`)).toBeInTheDocument();
    expect(screen.getByText(`"b"`)).toBeInTheDocument();
    expect(screen.getByText(`"c"`)).toBeInTheDocument();
    expect(screen.getByText("},")).toBeInTheDocument(); // close of "a" (trailing comma)
    expect(screen.getByText("}")).toBeInTheDocument();  // close of root
  });

  it("collapsing a container hides its children and its closing brace", () => {
    const tree = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const aId = tree.order.find((id) => tree.nodes[id].key === "a")!;
    const { rerender } = render(<JsonTree tree={tree} collapsed={new Set()} {...base} />);
    expect(screen.getByText(`"b"`)).toBeInTheDocument();
    rerender(<JsonTree tree={tree} collapsed={new Set([aId])} {...base} />);
    expect(screen.queryByText(`"b"`)).not.toBeInTheDocument();
    expect(screen.getByText(/\{ … \}/)).toBeInTheDocument();
  });

  it("shows line numbers", () => {
    const tree = parseJsonTree(`{"a":1}`); // 3 lines: {  "a": 1  }
    render(<JsonTree tree={tree} collapsed={new Set()} {...base} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("wires toggle through to a container line", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const tree = parseJsonTree(`{"obj":{"a":1}}`);
    render(<JsonTree tree={tree} collapsed={new Set()} {...base} onToggle={onToggle} />);
    await user.click(screen.getAllByRole("button", { name: "toggle-node" })[0]);
    expect(onToggle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/JsonTreeView.test.tsx`
Expected: FAIL — current `JsonTree` renders the outline (no `},` close line; `"b"` shows as `b`).

- [ ] **Step 3: Rewrite the component (replace the whole file)**

Replace the entire contents of `src/features/response/json/JsonTreeView.tsx` with:
```tsx
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { JsonLineView } from "./JsonLineView";
import { flattenLines } from "./jsonLines";
import type { JsonNode, JsonTree as Tree } from "./jsonTree";

const ROW_H = 22;

export interface JsonTreeProps {
  tree: Tree;
  collapsed: ReadonlySet<string>;
  matchIds: ReadonlySet<string>;
  activeMatchId: string | null;
  scrollToId: string | null;
  onToggle: (id: string) => void;
  onCopy: (node: JsonNode) => void;
}

export function JsonTree({
  tree, collapsed, matchIds, activeMatchId, scrollToId, onToggle, onCopy,
}: JsonTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const lines = flattenLines(tree, collapsed);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
  });

  useEffect(() => {
    if (!scrollToId) return;
    const idx = lines.findIndex((l) => l.nodeId === scrollToId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToId, lines.length]);

  return (
    <div ref={parentRef} role="tree" className="min-h-0 flex-1 overflow-auto scroll-thin">
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const line = lines[vi.index];
          const node = tree.nodes[line.nodeId];
          return (
            <div
              key={vi.key}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <JsonLineView
                line={line}
                node={node}
                lineNumber={vi.index + 1}
                isMatch={matchIds.has(line.nodeId)}
                isActiveMatch={line.nodeId === activeMatchId}
                onToggle={onToggle}
                onCopy={onCopy}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/response/json/JsonTreeView.test.tsx`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/JsonTreeView.tsx src/features/response/json/JsonTreeView.test.tsx
git commit -m "feat(response): render response as real JSON lines (line numbers, braces, fold)"
```
Append to the commit body:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 5: Wire-through, cleanup, and full verification

`ResponseBody` already consumes `JsonTree` from `JsonTreeView` with the same props, so it works as-is. This task updates the one stale assertion, deletes the retired outline code, and runs the full gate.

**Files:**
- Modify: `src/features/response/ResponsePanel.test.tsx`
- Modify: `src/features/response/json/jsonTree.ts`, `jsonTree.test.ts`
- Modify: `src/features/response/json/copyValue.ts`, `copyValue.test.ts`
- Delete: `src/features/response/json/JsonRowView.tsx`, `JsonRowView.test.tsx`

- [ ] **Step 1: Fix the stale key assertion in `ResponsePanel.test.tsx`**

Keys now render quoted. In `src/features/response/ResponsePanel.test.tsx`, change:
```tsx
    expect(screen.getByText("id")).toBeInTheDocument();
```
to:
```tsx
    expect(screen.getByText(`"id"`)).toBeInTheDocument();
```
(The `"echo"` value assertion is already quoted — leave it.)

- [ ] **Step 2: Run the response tests to confirm the new renderer is wired everywhere**

Run: `pnpm exec vitest run src/features/response/ResponsePanel.test.tsx src/features/response/ResponseBody.test.tsx`
Expected: PASS. (`ResponseBody` renders the same `"echo"`/`"Alice"` text and `role="tree"`; only the key quoting changed.)

- [ ] **Step 3: Delete the retired `JsonRowView`**

```bash
git rm src/features/response/json/JsonRowView.tsx src/features/response/json/JsonRowView.test.tsx
```

- [ ] **Step 4: Remove the unused `flattenVisible` from `jsonTree.ts`**

In `src/features/response/json/jsonTree.ts`, delete the entire `flattenVisible` function (the final exported function in the file):
```ts
export function flattenVisible(tree: JsonTree, collapsed: ReadonlySet<string>): JsonNode[] {
  if (tree.rootId === null) return [];
  const out: JsonNode[] = [];
  const walk = (id: string) => {
    const node = tree.nodes[id];
    out.push(node);
    if (!collapsed.has(id)) for (const c of node.childIds) walk(c);
  };
  walk(tree.rootId);
  return out;
}
```
Then in `src/features/response/json/jsonTree.test.ts`, delete the whole `describe("flattenVisible", …)` block and remove `flattenVisible` from the import at the top (change `import { parseJsonTree, flattenVisible } from "./jsonTree";` to `import { parseJsonTree } from "./jsonTree";`).

- [ ] **Step 5: Remove the unused `valuePreview` from `copyValue.ts`**

In `src/features/response/json/copyValue.ts`, delete the entire `valuePreview` function. In `src/features/response/json/copyValue.test.ts`, delete the whole `describe("valuePreview", …)` block and remove `valuePreview` from the top import (it becomes `import { copyTextForNode, valueLiteral, PREVIEW_LIMIT } from "./copyValue";`).

- [ ] **Step 6: Confirm nothing still imports the deleted symbols**

Run: `pnpm exec vitest run` and `pnpm lint`
Expected: no `Cannot find name 'flattenVisible' / 'valuePreview' / 'JsonRowView'` errors. If `pnpm lint` reports a dangling reference, grep for the symbol and remove it.

- [ ] **Step 7: Full verification gate**

Run, in order:
```bash
pnpm exec vitest run
pnpm lint
pnpm build
```
Expected:
- `vitest run`: ALL tests green — report the exact total and that 0 failed. (Net change vs the prior 140: `jsonLines` +7, `valueLiteral` +3, `JsonLineView` +6, `JsonTreeView` rewrite (was 2, now 4), minus removed `JsonRowView` (3), `flattenVisible` (2), `valuePreview` (2).)
- `pnpm lint` (tsc -b): exit 0.
- `pnpm build` (tsc -b && vite build): success, `dist/` produced.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(response): retire outline renderer (JsonRowView/flattenVisible/valuePreview)"
```
Append to the commit body:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

- [ ] **Step 9 (human smoke):** Rebuild and run the app (`pnpm tauri:dev`), invoke a call, confirm the response renders as real JSON (braces, quoted keys, commas, line numbers), folding works on objects/arrays, double-click on a value copies it (toast), Ctrl+F search highlights + next/prev, and a non-OK status still shows the Postman-style error face.

---

## Self-Review

**Spec coverage:**
- §3 `jsonLines.ts` / `flattenLines` (open/close/folded/leaf + commas) → Task 1. ✅
- §4 `JsonLineView` (line number, caret, quoted key, literal/bracket, comma, dbl-click copy, highlight) → Tasks 2 (`valueLiteral`) + 3. ✅
- §5 `JsonTreeView` (virtualize lines, line numbers, scroll-to-match `[scrollToId, lines.length]`, `role="tree"`) → Task 4. ✅
- §6 untouched modules; retire `flattenVisible`/`JsonRowView`/`valuePreview` → Task 5. ✅
- §7 tests (flattenLines comma cases, empty containers, root scalar/array; JsonLineView quotes/comma/fold/dbl-click; JsonTreeView line numbers/collapse; ResponsePanel regression) → Tasks 1,3,4,5. ✅
- §9 deep-recursion guard already in `parseJsonTree` — `flattenLines` recurses no deeper than the parsed tree. ✅

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `JsonLine`/`JsonLineKind`/`flattenLines` (Task 1) are consumed with identical shapes in `JsonLineView` (Task 3) and `JsonTreeView` (Task 4). `valueLiteral(node: JsonNode)` (Task 2) is used by `JsonLineView` (Task 3). `JsonTree` component prop interface is unchanged from Plan #4, so `ResponseBody` needs no edit. Key now renders quoted → the only consumer assertion that changes is `ResponsePanel.test.tsx` (Task 5 Step 1).
