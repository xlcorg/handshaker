# Unified Body View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the gRPC request body and response body through one shared Monaco-based viewer with identical features — text selection, Postman-style fold gutter, native Ctrl+F, Ctrl+double-click rich copy, and per-value elision of huge strings.

**Architecture:** A new pure-logic module `src/features/bodyview/` holds a position-tracking JSON parser, a pretty-renderer with elision, span/offset lookup, and copy semantics — all unit-tested without Monaco. A thin `BodyView` Monaco wrapper wires those into the editor via an imperative `controller` that operates on a minimal `EditorLike` interface (so the controller is testable with a fake editor). `BodyEditor` (request, editable, raw text) and `ResponseBody` (response, read-only, elided render) become thin adapters. The old custom response tree, its search, and degrade path are deleted.

**Tech Stack:** React 18, TypeScript, Monaco (`@monaco-editor/react` 4.7 / `monaco-editor` 0.55.1), Vitest 2 + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-06-unified-body-view-design.md`

**Branch:** `redesign/workflow-ui-spec-plans`

---

## File Structure

New module `src/features/bodyview/`:

| File | Responsibility |
|------|----------------|
| `jsonTree.ts` | Shared value types: `JsonKind`, `JsonNode`, `JsonTree`. No logic. |
| `spans.ts` | `ValueSpan` (char-offset range → nodeId) + `spanAtOffset` (innermost-containing lookup). |
| `parse.ts` | `parseWithSpans(text)` — position-tracking JSON parser → `{ tree, spans }` or `null`. Single parser for both panes. |
| `elide.ts` | `elideString(value)` — threshold, preview, size/MIME label. |
| `render.ts` | `renderJsonTree(tree, expanded?)` — pretty text + render-spans + elision badges for the response pane. |
| `copyAtOffset.ts` | `copyAtOffset(tree, spans, offset)` — pure copy-text resolution. |
| `copyValue.ts` | `copyTextForNode`, `toastSnippet` (moved from `response/json/copyValue.ts`). |
| `editorLike.ts` | Minimal structural interfaces (`EditorLike`, `ModelLike`, `EditorMouseEventLike`) — the Monaco subset the controller uses. |
| `controller.ts` | `attachBodyController(editor, deps)` — wires Ctrl+dblclick copy + badge-click expand; returns `{ dispose }`. |
| `BodyView.tsx` | React Monaco wrapper: builds render/parse, sets value + badge decorations, attaches controller. |

Adapters (existing files, internals rewritten):
- `src/features/invoke/BodyEditor.tsx` — request: `<BodyView mode="request" .../>`.
- `src/features/response/ResponseBody.tsx` — response: `<BodyView mode="response" .../>`.

Deleted after migration: `src/features/response/json/{JsonTreeView,JsonLineView,JsonSearchBar}.tsx`, `{jsonLines,jsonSearch,degrade,jsonTree,copyValue}.ts` and their `.test` files; `@tanstack/react-virtual` dependency.

---

## Conventions

- Run a single test file: `pnpm vitest run src/features/bodyview/<name>.test.ts`
- Run the whole suite: `pnpm test`
- Typecheck: `pnpm lint` (alias for `tsc -b`)
- Commit after every task (frequent commits). Branch is already `redesign/workflow-ui-spec-plans`.
- `ValueSpan` offsets are **character offsets** `[start, end)` into whichever text the model holds. Monaco converts click position ↔ offset via `model.getOffsetAt(position)` / `model.getPositionAt(offset)`, so the pure layer never deals with line/column.

---

# Phase 1 — Pure core (no Monaco)

### Task 1: Move value types + copy semantics into `bodyview/`

**Files:**
- Create: `src/features/bodyview/jsonTree.ts`
- Create: `src/features/bodyview/copyValue.ts`
- Create: `src/features/bodyview/copyValue.test.ts`

- [ ] **Step 1: Create the shared types**

`src/features/bodyview/jsonTree.ts`:

```ts
export type JsonKind = "string" | "number" | "boolean" | "null" | "object" | "array";

export interface JsonNode {
  id: string;            // stable DFS id, e.g. "n0", "n1"
  parentId: string | null;
  key: string | null;    // object-member key; null for root and array elements
  index: number | null;  // array index; null for root and object members
  kind: JsonKind;
  value: unknown;        // raw parsed value (kept for copy)
  depth: number;         // 0 = root
  childIds: string[];    // direct children, in source order
  childCount: number;    // 0 for scalars
}

export interface JsonTree {
  rootId: string | null;
  nodes: Record<string, JsonNode>;
  order: string[];       // full DFS pre-order of every node id
}
```

- [ ] **Step 2: Create copy semantics**

`src/features/bodyview/copyValue.ts`:

```ts
import type { JsonNode } from "./jsonTree";

/** Clipboard text: string unquoted, scalar as-is, container compact JSON. */
export function copyTextForNode(node: JsonNode): string {
  switch (node.kind) {
    case "string": return node.value as string;
    case "number":
    case "boolean": return String(node.value);
    case "null": return "null";
    case "object":
    case "array": return JSON.stringify(node.value);
  }
}

export const TOAST_SNIPPET_LIMIT = 60;

/** Single-line, length-capped preview of copied text for a confirmation toast. */
export function toastSnippet(text: string, max = TOAST_SNIPPET_LIMIT): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
```

- [ ] **Step 3: Write the test**

`src/features/bodyview/copyValue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { copyTextForNode, toastSnippet } from "./copyValue";
import type { JsonNode } from "./jsonTree";

const node = (over: Partial<JsonNode>): JsonNode => ({
  id: "n0", parentId: null, key: null, index: null, kind: "string",
  value: "", depth: 0, childIds: [], childCount: 0, ...over,
});

describe("copyTextForNode", () => {
  it("copies strings unquoted", () => {
    expect(copyTextForNode(node({ kind: "string", value: "hi" }))).toBe("hi");
  });
  it("copies number/boolean/null as literals", () => {
    expect(copyTextForNode(node({ kind: "number", value: 42 }))).toBe("42");
    expect(copyTextForNode(node({ kind: "boolean", value: true }))).toBe("true");
    expect(copyTextForNode(node({ kind: "null", value: null }))).toBe("null");
  });
  it("copies containers as compact JSON", () => {
    expect(copyTextForNode(node({ kind: "object", value: { a: 1 } }))).toBe(`{"a":1}`);
    expect(copyTextForNode(node({ kind: "array", value: [1, 2] }))).toBe(`[1,2]`);
  });
});

describe("toastSnippet", () => {
  it("collapses whitespace and caps length", () => {
    expect(toastSnippet("a\n  b")).toBe("a b");
    expect(toastSnippet("x".repeat(80)).endsWith("…")).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run src/features/bodyview/copyValue.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/jsonTree.ts src/features/bodyview/copyValue.ts src/features/bodyview/copyValue.test.ts
git commit -m "feat(bodyview): shared json types + copy semantics"
```

---

### Task 2: Span type + innermost-containing lookup

**Files:**
- Create: `src/features/bodyview/spans.ts`
- Create: `src/features/bodyview/spans.test.ts`

- [ ] **Step 1: Write the failing test**

`src/features/bodyview/spans.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spanAtOffset, type ValueSpan } from "./spans";

// Nested: root object [0,20) contains value [8,18) which is itself a span.
const spans: ValueSpan[] = [
  { nodeId: "root", start: 0, end: 20 },
  { nodeId: "child", start: 8, end: 18 },
];

describe("spanAtOffset", () => {
  it("returns the innermost span containing the offset", () => {
    expect(spanAtOffset(spans, 10)?.nodeId).toBe("child");
  });
  it("returns the outer span when offset is outside the child", () => {
    expect(spanAtOffset(spans, 2)?.nodeId).toBe("root");
  });
  it("returns null when no span contains the offset", () => {
    expect(spanAtOffset(spans, 50)).toBeNull();
  });
  it("treats end as exclusive", () => {
    expect(spanAtOffset([{ nodeId: "a", start: 0, end: 4 }], 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/features/bodyview/spans.test.ts`
Expected: FAIL — "Cannot find module './spans'".

- [ ] **Step 3: Implement**

`src/features/bodyview/spans.ts`:

```ts
export interface ValueSpan {
  nodeId: string;
  start: number; // inclusive char offset
  end: number;   // exclusive char offset
}

/**
 * Innermost span containing `offset`. Spans nest (a container span encloses its
 * children); the innermost is the containing span with the greatest `start`.
 */
export function spanAtOffset(spans: readonly ValueSpan[], offset: number): ValueSpan | null {
  let best: ValueSpan | null = null;
  for (const s of spans) {
    if (offset >= s.start && offset < s.end) {
      if (!best || s.start > best.start) best = s;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/features/bodyview/spans.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/spans.ts src/features/bodyview/spans.test.ts
git commit -m "feat(bodyview): value span type + innermost-containing lookup"
```

---

### Task 3: Position-tracking JSON parser

**Files:**
- Create: `src/features/bodyview/parse.ts`
- Create: `src/features/bodyview/parse.test.ts`

This parser produces the same `JsonTree` shape as the old `parseJsonTree`, **plus** a `ValueSpan` per node mapping into the source text. It returns `null` on syntax error (used by the request pane to fall back). `{{var}}` inside a quoted string is just a normal string — no special handling needed.

- [ ] **Step 1: Write the failing test**

`src/features/bodyview/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseWithSpans } from "./parse";

describe("parseWithSpans", () => {
  it("returns null on invalid JSON", () => {
    expect(parseWithSpans("not json {")).toBeNull();
    expect(parseWithSpans(`{ "limit": {{count}} }`)).toBeNull(); // unquoted var
  });

  it("parses scalars and keeps raw values + kinds", () => {
    const r = parseWithSpans(`{"s":"hi","n":42,"b":true,"z":null}`)!;
    expect(r).not.toBeNull();
    const root = r.tree.nodes[r.tree.rootId!];
    expect(root.kind).toBe("object");
    expect(root.childCount).toBe(4);
    const byKey = (k: string) => root.childIds.map((id) => r.tree.nodes[id]).find((n) => n.key === k)!;
    expect(byKey("s").value).toBe("hi");
    expect(byKey("n").value).toBe(42);
    expect(byKey("b").value).toBe(true);
    expect(byKey("z").kind).toBe("null");
  });

  it("treats {{var}} inside a string as a normal string value", () => {
    const r = parseWithSpans(`{"id":"{{userId}}"}`)!;
    const child = r.tree.nodes[r.tree.nodes[r.tree.rootId!].childIds[0]];
    expect(child.value).toBe("{{userId}}");
  });

  it("records a span (incl. quotes/brackets) per value matching source offsets", () => {
    const text = `{"s":"hi"}`;
    const r = parseWithSpans(text)!;
    const span = (id: string) => r.spans.find((s) => s.nodeId === id)!;
    const root = r.tree.nodes[r.tree.rootId!];
    expect(text.slice(span(root.id).start, span(root.id).end)).toBe(`{"s":"hi"}`);
    const child = r.tree.nodes[root.childIds[0]];
    expect(text.slice(span(child.id).start, span(child.id).end)).toBe(`"hi"`);
  });

  it("indexes array elements", () => {
    const r = parseWithSpans(`{"tags":["a","b"]}`)!;
    const tags = r.tree.nodes[r.tree.nodes[r.tree.rootId!].childIds[0]];
    expect(tags.kind).toBe("array");
    expect(tags.childCount).toBe(2);
    expect(r.tree.nodes[tags.childIds[1]].index).toBe(1);
    expect(r.tree.nodes[tags.childIds[1]].value).toBe("b");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/features/bodyview/parse.test.ts`
Expected: FAIL — "Cannot find module './parse'".

- [ ] **Step 3: Implement**

`src/features/bodyview/parse.ts`:

```ts
import type { JsonKind, JsonNode, JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";

class Cursor {
  constructor(public readonly s: string, public i = 0) {}
  ws() { while (this.i < this.s.length && " \t\r\n".includes(this.s[this.i])) this.i++; }
  eof() { return this.i >= this.s.length; }
  peek() { return this.s[this.i]; }
}

class ParseError extends Error {}

const kindOf = (v: unknown): JsonKind => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "object";
  }
};

/**
 * Recursive-descent JSON parser that records, per node, the source offset range
 * of its value token. Returns null on any syntax error (incl. trailing junk).
 */
export function parseWithSpans(text: string): { tree: JsonTree; spans: ValueSpan[] } | null {
  const nodes: Record<string, JsonNode> = {};
  const order: string[] = [];
  const spans: ValueSpan[] = [];
  let counter = 0;
  const c = new Cursor(text);

  const fail = (): never => { throw new ParseError(); };

  const parseString = (): string => {
    if (c.s[c.i] !== '"') fail();
    c.i++;
    let out = "";
    while (true) {
      if (c.eof()) fail();
      const ch = c.s[c.i++];
      if (ch === '"') return out;
      if (ch === "\\") {
        const esc = c.s[c.i++];
        switch (esc) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            const hex = c.s.slice(c.i, c.i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
            out += String.fromCharCode(parseInt(hex, 16));
            c.i += 4;
            break;
          }
          default: fail();
        }
      } else {
        out += ch;
      }
    }
  };

  const parseLiteralValue = (): unknown => {
    // number / true / false / null — delegate to JSON.parse on the matched slice
    const start = c.i;
    const rest = c.s.slice(c.i);
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(rest);
    if (!m) return fail();
    c.i += m[1].length;
    try { return JSON.parse(c.s.slice(start, c.i)); } catch { return fail(); }
  };

  const build = (key: string | null, index: number | null, parentId: string | null, depth: number): string => {
    c.ws();
    const id = `n${counter++}`;
    const start = c.i;
    const ch = c.peek();
    let value: unknown;
    let kind: JsonKind;
    const childIds: string[] = [];

    if (ch === "{") {
      kind = "object";
      c.i++; c.ws();
      const obj: Record<string, unknown> = {};
      if (c.peek() === "}") { c.i++; }
      else {
        while (true) {
          c.ws();
          const k = parseString();
          c.ws();
          if (c.s[c.i++] !== ":") fail();
          const childId = build(k, null, id, depth + 1);
          childIds.push(childId);
          obj[k] = nodes[childId].value;
          c.ws();
          const sep = c.s[c.i++];
          if (sep === "}") break;
          if (sep !== ",") fail();
        }
      }
      value = obj;
    } else if (ch === "[") {
      kind = "array";
      c.i++; c.ws();
      const arr: unknown[] = [];
      if (c.peek() === "]") { c.i++; }
      else {
        let idx = 0;
        while (true) {
          const childId = build(null, idx, id, depth + 1);
          childIds.push(childId);
          arr.push(nodes[childId].value);
          idx++;
          c.ws();
          const sep = c.s[c.i++];
          if (sep === "]") break;
          if (sep !== ",") fail();
        }
      }
      value = arr;
    } else if (ch === '"') {
      kind = "string";
      value = parseString();
    } else {
      value = parseLiteralValue();
      kind = kindOf(value);
    }

    const node: JsonNode = {
      id, parentId, key, index, kind, value, depth,
      childIds, childCount: childIds.length,
    };
    nodes[id] = node;
    order.push(id);
    spans.push({ nodeId: id, start, end: c.i });
    return id;
  };

  try {
    const rootId = build(null, null, null, 0);
    c.ws();
    if (!c.eof()) return null; // trailing junk
    return { tree: { rootId, nodes, order }, spans };
  } catch {
    return null;
  }
}
```

Note: `order` and `spans` are emitted in DFS post-order for containers (child spans pushed before the parent's). `spanAtOffset` does not depend on ordering, and `order` is only used as a node-id set, so post-order is fine.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/features/bodyview/parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/parse.ts src/features/bodyview/parse.test.ts
git commit -m "feat(bodyview): position-tracking json parser with value spans"
```

---

### Task 4: Elision of large string values

**Files:**
- Create: `src/features/bodyview/elide.ts`
- Create: `src/features/bodyview/elide.test.ts`

- [ ] **Step 1: Write the failing test**

`src/features/bodyview/elide.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { elideString, ELIDE_LIMIT, PREVIEW_CHARS } from "./elide";

describe("elideString", () => {
  it("returns null at or below the limit", () => {
    expect(elideString("x".repeat(ELIDE_LIMIT))).toBeNull();
  });

  it("elides above the limit with a preview and a byte-size label", () => {
    const e = elideString("x".repeat(ELIDE_LIMIT + 1))!;
    expect(e).not.toBeNull();
    expect(e.preview.length).toBe(PREVIEW_CHARS);
    expect(e.label).toMatch(/KB$/); // 4097 bytes -> "4.0KB"
  });

  it("shows the declared MIME for a data: URI", () => {
    const big = "data:image/png;base64," + "A".repeat(ELIDE_LIMIT);
    const e = elideString(big)!;
    expect(e.label.startsWith("image/png · ")).toBe(true);
  });

  it("does not guess a type for a non-data: long string", () => {
    const e = elideString("A".repeat(ELIDE_LIMIT + 1))!;
    expect(e.label).not.toContain("·");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/features/bodyview/elide.test.ts`
Expected: FAIL — "Cannot find module './elide'".

- [ ] **Step 3: Implement** (reuses `formatBytes` from `@/lib/grpc-status`)

`src/features/bodyview/elide.ts`:

```ts
import { formatBytes } from "@/lib/grpc-status";

export const ELIDE_LIMIT = 4096; // characters; mirrors Postman's CodeMirror line cap
export const PREVIEW_CHARS = 64;

export interface Elision {
  preview: string; // first PREVIEW_CHARS chars of the full value
  label: string;   // "248.0KB" or "image/png · 248.0KB"
}

// `data:<type>/<subtype>[;param=value]*;base64,` — MIME is declared, not guessed.
const DATA_URI_RE = /^data:([\w.+-]+\/[\w.+-]+)(?:;[\w.+-]+=[\w.+-]+)*;base64,/i;

export function elideString(value: string, limit = ELIDE_LIMIT): Elision | null {
  if (value.length <= limit) return null;
  const size = formatBytes(value);
  const m = DATA_URI_RE.exec(value);
  const label = m ? `${m[1]} · ${size}` : size;
  return { preview: value.slice(0, PREVIEW_CHARS), label };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/features/bodyview/elide.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/elide.ts src/features/bodyview/elide.test.ts
git commit -m "feat(bodyview): elide large string values with size/MIME label"
```

---

### Task 5: Pretty renderer with elision badges (response pane)

**Files:**
- Create: `src/features/bodyview/render.ts`
- Create: `src/features/bodyview/render.test.ts`

`renderJsonTree` walks the tree and emits pretty text (2-space indent) while recording a `ValueSpan` per node into the **rendered** text, plus a `Badge` per elided string. A string node is emitted full when its id is in `expanded` (badge clicked) or it's under the limit; otherwise preview + badge.

- [ ] **Step 1: Write the failing test**

`src/features/bodyview/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderJsonTree } from "./render";
import { parseWithSpans } from "./parse";
import { spanAtOffset } from "./spans";
import { ELIDE_LIMIT } from "./elide";

const treeOf = (json: string) => parseWithSpans(json)!.tree;

describe("renderJsonTree", () => {
  it("pretty-prints with 2-space indentation", () => {
    const r = renderJsonTree(treeOf(`{"a":1,"b":[2,3]}`));
    expect(r.text).toBe(`{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}`);
  });

  it("records spans into the rendered text that resolve back to nodes", () => {
    const tree = treeOf(`{"a":1}`);
    const r = renderJsonTree(tree);
    const offset = r.text.indexOf("1");
    const span = spanAtOffset(r.spans, offset)!;
    expect(tree.nodes[span.nodeId].value).toBe(1);
  });

  it("emits a preview + badge for a string over the limit", () => {
    const big = "z".repeat(ELIDE_LIMIT + 1);
    const r = renderJsonTree(treeOf(JSON.stringify({ blob: big })));
    expect(r.badges).toHaveLength(1);
    expect(r.text).not.toContain(big);          // full value not in model text
    expect(r.text).toContain("z".repeat(64));   // preview is
    expect(r.badges[0].label).toMatch(/KB$/);
  });

  it("emits the full value (no badge) when the node id is expanded", () => {
    const big = "z".repeat(ELIDE_LIMIT + 1);
    const tree = treeOf(JSON.stringify({ blob: big }));
    const blobId = tree.nodes[tree.rootId!].childIds[0];
    const r = renderJsonTree(tree, new Set([blobId]));
    expect(r.badges).toHaveLength(0);
    expect(r.text).toContain(big);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/features/bodyview/render.test.ts`
Expected: FAIL — "Cannot find module './render'".

- [ ] **Step 3: Implement**

`src/features/bodyview/render.ts`:

```ts
import type { JsonNode, JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";
import { elideString } from "./elide";

const INDENT = "  ";

export interface Badge {
  nodeId: string;
  previewStart: number; // offset of the preview value token's first char (the quote)
  previewEnd: number;   // offset just past the preview value token's closing quote
  label: string;
}

export interface RenderResult {
  text: string;
  spans: ValueSpan[];
  badges: Badge[];
}

export function renderJsonTree(tree: JsonTree, expanded: ReadonlySet<string> = new Set()): RenderResult {
  const spans: ValueSpan[] = [];
  const badges: Badge[] = [];
  let out = "";

  const walk = (node: JsonNode, indent: string) => {
    const start = out.length;
    switch (node.kind) {
      case "object": {
        if (node.childCount === 0) { out += "{}"; break; }
        out += "{\n";
        node.childIds.forEach((cid, i) => {
          const child = tree.nodes[cid];
          out += indent + INDENT + JSON.stringify(child.key) + ": ";
          walk(child, indent + INDENT);
          out += i < node.childCount - 1 ? ",\n" : "\n";
        });
        out += indent + "}";
        break;
      }
      case "array": {
        if (node.childCount === 0) { out += "[]"; break; }
        out += "[\n";
        node.childIds.forEach((cid, i) => {
          out += indent + INDENT;
          walk(tree.nodes[cid], indent + INDENT);
          out += i < node.childCount - 1 ? ",\n" : "\n";
        });
        out += indent + "]";
        break;
      }
      case "string": {
        const full = node.value as string;
        const elision = expanded.has(node.id) ? null : elideString(full);
        if (elision) {
          const previewStart = out.length;
          out += JSON.stringify(elision.preview);
          badges.push({ nodeId: node.id, previewStart, previewEnd: out.length, label: elision.label });
        } else {
          out += JSON.stringify(full);
        }
        break;
      }
      case "number":
      case "boolean": out += String(node.value); break;
      case "null": out += "null"; break;
    }
    spans.push({ nodeId: node.id, start, end: out.length });
  };

  if (tree.rootId) walk(tree.nodes[tree.rootId], "");
  return { text: out, spans, badges };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/features/bodyview/render.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/render.ts src/features/bodyview/render.test.ts
git commit -m "feat(bodyview): pretty renderer with elision badges + render spans"
```

---

### Task 6: Resolve copy text at an offset

**Files:**
- Create: `src/features/bodyview/copyAtOffset.ts`
- Create: `src/features/bodyview/copyAtOffset.test.ts`

- [ ] **Step 1: Write the failing test**

`src/features/bodyview/copyAtOffset.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { copyAtOffset } from "./copyAtOffset";
import { parseWithSpans } from "./parse";

describe("copyAtOffset", () => {
  it("returns the unquoted string when the offset is inside a string value", () => {
    const text = `{"name":"Ada"}`;
    const { tree, spans } = parseWithSpans(text)!;
    const offset = text.indexOf("Ada");
    expect(copyAtOffset(tree, spans, offset)).toBe("Ada");
  });

  it("returns compact JSON when the offset is on a container bracket", () => {
    const text = `{"a":1}`;
    const { tree, spans } = parseWithSpans(text)!;
    expect(copyAtOffset(tree, spans, 0)).toBe(`{"a":1}`);
  });

  it("returns null when no span contains the offset", () => {
    const text = `{"a":1}`;
    const { tree, spans } = parseWithSpans(text)!;
    expect(copyAtOffset(tree, spans, 999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/features/bodyview/copyAtOffset.test.ts`
Expected: FAIL — "Cannot find module './copyAtOffset'".

- [ ] **Step 3: Implement**

`src/features/bodyview/copyAtOffset.ts`:

```ts
import type { JsonTree } from "./jsonTree";
import { spanAtOffset, type ValueSpan } from "./spans";
import { copyTextForNode } from "./copyValue";

/** Copy text for the innermost value at `offset`, or null if the offset hits no value. */
export function copyAtOffset(tree: JsonTree, spans: readonly ValueSpan[], offset: number): string | null {
  const span = spanAtOffset(spans, offset);
  if (!span) return null;
  const node = tree.nodes[span.nodeId];
  return node ? copyTextForNode(node) : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/features/bodyview/copyAtOffset.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/copyAtOffset.ts src/features/bodyview/copyAtOffset.test.ts
git commit -m "feat(bodyview): resolve copy text at a char offset"
```

🧹 **/clear checkpoint** — Phase 1 (pure core) complete. Start a fresh session for Phase 2.

---

# Phase 2 — Monaco controller + wrapper

### Task 7: Editor-event controller (Ctrl+dblclick copy + badge expand)

**Files:**
- Create: `src/features/bodyview/editorLike.ts`
- Create: `src/features/bodyview/controller.ts`
- Create: `src/features/bodyview/controller.test.ts`

The controller listens to `editor.onMouseDown` and handles two gestures on a single handler:
- **Ctrl/⌘ + double-click** (`detail === 2`) → copy the value at the click offset.
- **Single click on a badge element** (class `bodyview-badge`) → ask the host to expand that node.

It depends only on `EditorLike` (a structural subset of Monaco's editor) so it can be tested with a plain fake.

- [ ] **Step 1: Write the failing test**

`src/features/bodyview/controller.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { attachBodyController } from "./controller";
import { parseWithSpans } from "./parse";
import type { EditorLike, EditorMouseEventLike, ModelLike } from "./editorLike";

// --- minimal fake editor over a fixed text -------------------------------
function fakeEditor(text: string) {
  let handler: ((e: EditorMouseEventLike) => void) | null = null;
  const model: ModelLike = {
    getOffsetAt: (pos) => pos.column - 1,           // single-line: column(1-based) -> offset
    getPositionAt: (off) => ({ lineNumber: 1, column: off + 1 }),
    setValue: vi.fn(),
    getValueInRange: () => "",
  };
  const editor: EditorLike = {
    getModel: () => model,
    onMouseDown: (cb) => { handler = cb; return { dispose: vi.fn() }; },
  };
  const fire = (offset: number, over: Partial<EditorMouseEventLike["event"]> & { element?: HTMLElement | null }) => {
    const { element = null, ...ev } = over;
    handler?.({
      event: { ctrlKey: false, metaKey: false, detail: 1, browserEvent: { preventDefault: vi.fn() }, ...ev },
      target: { element, position: { lineNumber: 1, column: offset + 1 } },
    });
  };
  return { editor, fire };
}

beforeEach(() => {
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
});

describe("attachBodyController", () => {
  it("copies the value on Ctrl+double-click", () => {
    const text = `{"name":"Ada"}`;
    const parsed = parseWithSpans(text)!;
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, {
      getTree: () => parsed.tree,
      getSpans: () => parsed.spans,
      onBadgeExpand: vi.fn(),
    });
    fire(text.indexOf("Ada"), { ctrlKey: true, detail: 2 });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Ada");
  });

  it("ignores a plain double-click (no modifier)", () => {
    const text = `{"name":"Ada"}`;
    const parsed = parseWithSpans(text)!;
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans, onBadgeExpand: vi.fn() });
    fire(text.indexOf("Ada"), { detail: 2 });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("calls onBadgeExpand when a badge element is clicked", () => {
    const text = `{"name":"Ada"}`;
    const parsed = parseWithSpans(text)!;
    const onBadgeExpand = vi.fn();
    const { editor, fire } = fakeEditor(text);
    const badgeEl = document.createElement("span");
    badgeEl.className = "bodyview-badge";
    attachBodyController(editor, {
      getTree: () => parsed.tree,
      getSpans: () => parsed.spans,
      getBadgeNodeIdAt: () => "n1",
      onBadgeExpand,
    });
    fire(5, { detail: 1, element: badgeEl });
    expect(onBadgeExpand).toHaveBeenCalledWith("n1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/features/bodyview/controller.test.ts`
Expected: FAIL — "Cannot find module './editorLike'".

- [ ] **Step 3: Implement the interfaces**

`src/features/bodyview/editorLike.ts`:

```ts
export interface PositionLike { lineNumber: number; column: number; }

export interface ModelLike {
  getOffsetAt(position: PositionLike): number;
  getPositionAt(offset: number): PositionLike;
  setValue(text: string): void;
  getValueInRange(range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): string;
}

export interface EditorMouseEventLike {
  event: { ctrlKey: boolean; metaKey: boolean; detail: number; browserEvent: { preventDefault(): void } };
  target: { element: HTMLElement | null; position: PositionLike | null };
}

export interface DisposableLike { dispose(): void; }

export interface EditorLike {
  getModel(): ModelLike | null;
  onMouseDown(listener: (e: EditorMouseEventLike) => void): DisposableLike;
}
```

- [ ] **Step 4: Implement the controller**

`src/features/bodyview/controller.ts`:

```ts
import type { EditorLike, DisposableLike } from "./editorLike";
import type { JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";
import { copyAtOffset } from "./copyAtOffset";
import { copyToClipboard } from "@/lib/clipboard";
import { toastSnippet } from "./copyValue";

export interface BodyControllerDeps {
  getTree: () => JsonTree | null;
  getSpans: () => readonly ValueSpan[];
  /** Resolve which elided node a badge click landed on; response pane only. */
  getBadgeNodeIdAt?: (offset: number) => string | null;
  /** Host re-renders with this node expanded; response pane only. */
  onBadgeExpand?: (nodeId: string) => void;
}

const BADGE_CLASS = "bodyview-badge";

export function attachBodyController(editor: EditorLike, deps: BodyControllerDeps): DisposableLike {
  const sub = editor.onMouseDown((e) => {
    const model = editor.getModel();
    const pos = e.target.position;
    if (!model || !pos) return;
    const offset = model.getOffsetAt(pos);

    // Badge click (single click on the injected badge element).
    if (e.target.element?.classList.contains(BADGE_CLASS) && deps.getBadgeNodeIdAt && deps.onBadgeExpand) {
      const nodeId = deps.getBadgeNodeIdAt(offset);
      if (nodeId) { e.event.browserEvent.preventDefault(); deps.onBadgeExpand(nodeId); }
      return;
    }

    // Ctrl/Cmd + double-click → rich copy.
    if ((e.event.ctrlKey || e.event.metaKey) && e.event.detail === 2) {
      const tree = deps.getTree();
      if (!tree) return;
      const text = copyAtOffset(tree, deps.getSpans(), offset);
      if (text !== null) {
        e.event.browserEvent.preventDefault();
        void copyToClipboard(text, `Скопировано: ${toastSnippet(text)}`);
      }
    }
  });
  return sub;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/features/bodyview/controller.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/bodyview/editorLike.ts src/features/bodyview/controller.ts src/features/bodyview/controller.test.ts
git commit -m "feat(bodyview): editor controller for ctrl+dblclick copy and badge expand"
```

---

### Task 8: `BodyView` Monaco wrapper

**Files:**
- Create: `src/features/bodyview/BodyView.tsx`
- Create: `src/features/bodyview/BodyView.test.tsx`
- Modify: `src/lib/monaco.ts` (add a folding-enabled options set)

`BodyView` has two modes:
- `request` — editable, `render: raw`. Model text = `value`. On each change it re-parses (`parseWithSpans`) to refresh spans/tree for copy; unparseable → `getTree()` returns null and the controller's copy is a no-op (acceptable fallback for mid-edit; native selection still copies).
- `response` — read-only, `render: elide`. Parses `value`, renders via `renderJsonTree`, sets model text, paints badge decorations, and expands a node on badge click by re-rendering. Unparseable response → shows raw `value` (no spans/badges).

- [ ] **Step 1: Add a folding-enabled options set**

In `src/lib/monaco.ts`, after `READ_ONLY_OPTIONS` (around line 182), add:

```ts
/** Body-view options: folding gutter ON (Postman-style node collapse). */
export const BODY_EDIT_OPTIONS = {
  ...EDITOR_OPTIONS,
  folding: true,
} as const;

export const BODY_READONLY_OPTIONS = {
  ...EDITOR_OPTIONS,
  folding: true,
  readOnly: true,
} as const;
```

- [ ] **Step 2: Write a smoke test (mocked Monaco)**

`src/features/bodyview/BodyView.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the heavy Monaco module: render a textarea-ish stub, expose value/readOnly.
vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value, options }: { value: string; options?: { readOnly?: boolean } }) => (
    <pre data-testid="monaco" data-readonly={String(!!options?.readOnly)}>{value}</pre>
  ),
  monacoThemeFor: () => "handshaker-dark",
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{ theme: "dark" }] }));

import { BodyView } from "./BodyView";

// NOTE: the mocked MonacoEditor does NOT invoke onMount, so the imperative
// response render (parse → renderJsonTree → model.setValue) does not run here.
// Pretty-print / elision / badge-expand are covered by the pure-unit tests
// (parse/render) and controller.test; this smoke test only checks prop plumbing
// (which mode wires editable vs read-only, and that the value reaches Monaco).
describe("BodyView", () => {
  it("request mode is editable and passes the value through", () => {
    render(<BodyView mode="request" value={`{"a":1}`} onChange={vi.fn()} />);
    const el = screen.getByTestId("monaco");
    expect(el.textContent).toBe(`{"a":1}`);
    expect(el.getAttribute("data-readonly")).toBe("false");
  });

  it("response mode is read-only", () => {
    render(<BodyView mode="response" value={`{"a":1}`} />);
    expect(screen.getByTestId("monaco").getAttribute("data-readonly")).toBe("true");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run src/features/bodyview/BodyView.test.tsx`
Expected: FAIL — "Cannot find module './BodyView'".

- [ ] **Step 4: Implement `BodyView`**

`src/features/bodyview/BodyView.tsx`:

```tsx
import { Suspense, useCallback, useMemo, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { MonacoEditor, monacoThemeFor, BODY_EDIT_OPTIONS, BODY_READONLY_OPTIONS } from "@/lib/monaco";
import { usePrefs } from "@/lib/use-prefs";
import { parseWithSpans } from "./parse";
import { renderJsonTree, type Badge } from "./render";
import type { JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";
import { attachBodyController } from "./controller";

type Mode = "request" | "response";

export interface BodyViewProps {
  mode: Mode;
  value: string;
  onChange?: (next: string) => void;
}

interface Live {
  editor: Monaco.editor.IStandaloneCodeEditor;
  monaco: typeof Monaco;
  tree: JsonTree | null;
  spans: ValueSpan[];
  badges: Badge[];
  decorations: Monaco.editor.IEditorDecorationsCollection | null;
  expanded: Set<string>;
}

const BADGE_CLASS = "bodyview-badge";

export function BodyView({ mode, value, onChange }: BodyViewProps) {
  const [prefs] = usePrefs();
  const live = useRef<Live | null>(null);

  // --- response rendering ------------------------------------------------
  const renderResponse = (text: string) => {
    const l = live.current;
    if (!l) return;
    const parsed = parseWithSpans(text);
    if (!parsed) {
      // Invalid JSON: show raw, no spans/badges.
      l.tree = null; l.spans = []; l.badges = [];
      l.editor.getModel()?.setValue(text);
      l.decorations?.clear();
      return;
    }
    l.tree = parsed.tree;
    const r = renderJsonTree(parsed.tree, l.expanded);
    l.spans = r.spans;
    l.badges = r.badges;
    l.editor.getModel()?.setValue(r.text);
    paintBadges();
  };

  const paintBadges = () => {
    const l = live.current;
    const model = l?.editor.getModel();
    if (!l || !model) return;
    const decos: Monaco.editor.IModelDeltaDecoration[] = l.badges.map((b) => {
      const pos = model.getPositionAt(b.previewEnd);
      return {
        range: new l.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        options: { after: { content: ` ${b.label} `, inlineClassName: BADGE_CLASS } },
      };
    });
    if (l.decorations) l.decorations.set(decos);
    else l.decorations = l.editor.createDecorationsCollection(decos);
  };

  const badgeNodeIdAt = (offset: number): string | null => {
    const l = live.current;
    const model = l?.editor.getModel();
    if (!l || !model) return null;
    const clickLine = model.getPositionAt(offset).lineNumber;
    // Pick the badge anchored on the clicked line (≤1 badge per line in practice).
    const hit = l.badges.find((b) => model.getPositionAt(b.previewEnd).lineNumber === clickLine);
    return hit?.nodeId ?? null;
  };

  const expandNode = (nodeId: string) => {
    const l = live.current;
    if (!l || !l.tree) return;
    l.expanded.add(nodeId);
    const r = renderJsonTree(l.tree, l.expanded);
    l.spans = r.spans;
    l.badges = r.badges;
    const view = l.editor.saveViewState();
    l.editor.getModel()?.setValue(r.text);
    if (view) l.editor.restoreViewState(view);
    paintBadges();
  };

  // --- mount -------------------------------------------------------------
  const onMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      live.current = {
        editor, monaco, tree: null, spans: [], badges: [],
        decorations: null, expanded: new Set(),
      };
      if (mode === "response") {
        renderResponse(editor.getValue());
      } else {
        const parsed = parseWithSpans(editor.getValue());
        live.current.tree = parsed?.tree ?? null;
        live.current.spans = parsed?.spans ?? [];
      }
      attachBodyController(editor, {
        getTree: () => live.current?.tree ?? null,
        getSpans: () => live.current?.spans ?? [],
        getBadgeNodeIdAt: mode === "response" ? badgeNodeIdAt : undefined,
        onBadgeExpand: mode === "response" ? expandNode : undefined,
      });
    },
    [mode],
  );

  // Request: refresh tree/spans from the user's text on each edit.
  const handleChange = useCallback(
    (next: string | undefined) => {
      const v = next ?? "";
      if (mode === "request" && live.current) {
        const parsed = parseWithSpans(v);
        live.current.tree = parsed?.tree ?? null;
        live.current.spans = parsed?.spans ?? [];
      }
      onChange?.(v);
    },
    [mode, onChange],
  );

  const options = mode === "response" ? BODY_READONLY_OPTIONS : BODY_EDIT_OPTIONS;
  // Response model text is derived (pretty/elided) and set imperatively in onMount;
  // pass the raw value only as the initial Monaco value, then never via React again
  // for response (so prop-sync doesn't clobber the rendered text). Keyed remount on
  // value change keeps it simple and correct.
  const key = useMemo(() => (mode === "response" ? value : "request"), [mode, value]);

  return (
    <Suspense fallback={<div className="h-full w-full bg-background" aria-hidden />}>
      <MonacoEditor
        key={key}
        height="100%"
        defaultLanguage="json-with-vars"
        theme={monacoThemeFor(prefs.theme)}
        value={value}
        onChange={mode === "request" ? handleChange : undefined}
        onMount={onMount}
        options={options}
        loading={null}
      />
    </Suspense>
  );
}
```

> Implementation note for the worker: `useCallback` is imported from `react` (the snippet's `useCallback` import line lists it). Add a CSS rule for `.bodyview-badge` in `src/index.css`/`globals.css` (muted pill): `monaco` injected text picks up `inlineClassName`. Example:
> ```css
> .bodyview-badge { color: var(--muted-foreground); background: var(--muted); border-radius: 4px; padding: 0 6px; margin-left: 4px; font-size: 11px; cursor: pointer; }
> ```
> Verify the exact globals file with `git grep -l "\-\-muted-foreground" src` and add the rule there.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/features/bodyview/BodyView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm lint`
Expected: no errors. (Fix the `useCallback` import — it is `import { Suspense, useCallback, useMemo, useRef } from "react"`.)

- [ ] **Step 7: Commit**

```bash
git add src/features/bodyview/BodyView.tsx src/features/bodyview/BodyView.test.tsx src/lib/monaco.ts src/index.css
git commit -m "feat(bodyview): Monaco wrapper with folding, badges, expand, copy wiring"
```

🧹 **/clear checkpoint** — Phase 2 (controller + wrapper) complete. Start a fresh session for Phase 3.

---

# Phase 3 — Swap consumers + cleanup

### Task 9: Request pane → `BodyView`

**Files:**
- Modify: `src/features/invoke/BodyEditor.tsx`

Keep the public `BodyEditorProps` (`value`, `onChange`) so `src/features/workflow/RequestTabs.tsx` is untouched.

- [ ] **Step 1: Rewrite `BodyEditor` as a thin adapter**

`src/features/invoke/BodyEditor.tsx`:

```tsx
import { BodyView } from "@/features/bodyview/BodyView";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
}

/** Request-body editor: editable Monaco (raw text) via the shared BodyView. */
export function BodyEditor({ value, onChange }: BodyEditorProps) {
  return <BodyView mode="request" value={value} onChange={onChange} />;
}
```

- [ ] **Step 2: Typecheck + run the workflow tests that use BodyEditor**

Run: `pnpm vitest run src/features/workflow/RequestTabs.test.tsx src/features/workflow/CallPanel.editable.test.tsx`
Expected: PASS. If a test asserted Monaco internals, update it to assert on the mocked editor stub (mirror the mock in `BodyView.test.tsx`). Do not weaken behavioral assertions about `onChange`.

- [ ] **Step 3: Commit**

```bash
git add src/features/invoke/BodyEditor.tsx
git commit -m "refactor(invoke): request body uses shared BodyView"
```

---

### Task 10: Response pane → `BodyView`

**Files:**
- Modify: `src/features/response/ResponseBody.tsx`
- Modify: `src/features/response/ResponseBody.test.tsx`

- [ ] **Step 1: Rewrite `ResponseBody` as a thin adapter**

`src/features/response/ResponseBody.tsx`:

```tsx
import { BodyView } from "@/features/bodyview/BodyView";

export interface ResponseBodyProps {
  json: string;
}

/** Response-body viewer: read-only Monaco with elision via the shared BodyView. */
export function ResponseBody({ json }: ResponseBodyProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BodyView mode="response" value={json} />
    </div>
  );
}
```

- [ ] **Step 2: Replace the response test (old tree/search/degrade assertions are gone)**

`src/features/response/ResponseBody.test.tsx` — replace entire file:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value, options }: { value: string; options?: { readOnly?: boolean } }) => (
    <pre data-testid="monaco" data-readonly={String(!!options?.readOnly)}>{value}</pre>
  ),
  monacoThemeFor: () => "handshaker-dark",
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{ theme: "dark" }] }));

import { ResponseBody } from "./ResponseBody";

describe("ResponseBody", () => {
  it("renders the response read-only via BodyView", () => {
    render(<ResponseBody json={`{"name":"Alice"}`} />);
    const el = screen.getByTestId("monaco");
    expect(el.getAttribute("data-readonly")).toBe("true");
    expect(el.textContent).toContain("Alice");
  });
});
```

> Pretty-print, elision, Ctrl+dblclick copy, and badge-expand are covered by the pure render/parse/controller tests; the mocked MonacoEditor here does not run `onMount`, and jsdom cannot exercise real Monaco mouse targeting, so they are not re-tested at the component level (see Manual Verification).

- [ ] **Step 3: Run**

Run: `pnpm vitest run src/features/response/ResponseBody.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add src/features/response/ResponseBody.tsx src/features/response/ResponseBody.test.tsx
git commit -m "refactor(response): response body uses shared BodyView with elision"
```

---

### Task 11: Delete dead code + drop unused dependency + full verification

**Files:**
- Delete: `src/features/response/json/JsonTreeView.tsx` (+ `.test.tsx`)
- Delete: `src/features/response/json/JsonLineView.tsx` (+ `.test.tsx`)
- Delete: `src/features/response/json/JsonSearchBar.tsx` (+ `.test.tsx`)
- Delete: `src/features/response/json/jsonLines.ts` (+ `.test.ts`)
- Delete: `src/features/response/json/jsonSearch.ts` (+ `.test.ts`)
- Delete: `src/features/response/json/degrade.ts` (+ `.test.ts`)
- Delete: `src/features/response/json/jsonTree.ts` (+ `.test.ts`)
- Delete: `src/features/response/json/copyValue.ts` (+ `.test.ts`)
- Modify: `package.json` (remove `@tanstack/react-virtual`)
- Modify: `src/features/response/ResponsePanel.test.tsx` (drop the `react-virtual` mock if present)

- [ ] **Step 1: Confirm nothing else imports the doomed files**

Run: `git grep -nE "response/json/(JsonTreeView|JsonLineView|JsonSearchBar|jsonLines|jsonSearch|degrade|jsonTree|copyValue)" src`
Expected: no matches outside the files being deleted. If `ResponsePanel.test.tsx` (or any other) still references them or mocks `@tanstack/react-virtual`, fix those references first.

- [ ] **Step 2: Delete the dead files**

```bash
git rm src/features/response/json/JsonTreeView.tsx src/features/response/json/JsonTreeView.test.tsx \
       src/features/response/json/JsonLineView.tsx src/features/response/json/JsonLineView.test.tsx \
       src/features/response/json/JsonSearchBar.tsx src/features/response/json/JsonSearchBar.test.tsx \
       src/features/response/json/jsonLines.ts src/features/response/json/jsonLines.test.ts \
       src/features/response/json/jsonSearch.ts src/features/response/json/jsonSearch.test.ts \
       src/features/response/json/degrade.ts src/features/response/json/degrade.test.ts \
       src/features/response/json/jsonTree.ts src/features/response/json/jsonTree.test.ts \
       src/features/response/json/copyValue.ts src/features/response/json/copyValue.test.ts
```

(If the `src/features/response/json/` directory is now empty, remove it.)

- [ ] **Step 3: Confirm `@tanstack/react-virtual` is unused, then remove it**

Run: `git grep -n "react-virtual" src`
Expected: no matches (only `package.json`/lockfile). Then remove the dependency:

Run: `pnpm remove @tanstack/react-virtual`
Expected: updates `package.json` + `pnpm-lock.yaml`.

- [ ] **Step 4: Full typecheck + test suite**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm test`
Expected: all tests pass; no references to deleted modules.

- [ ] **Step 5: Production build sanity (generates `dist/`)**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(response): remove legacy json tree/search/degrade + react-virtual dep"
```

🧹 **/clear checkpoint** — Feature complete. Manual verification pass below.

---

## Manual Verification (after Task 11)

jsdom cannot run real Monaco, so verify these by hand in `pnpm tauri:dev` (or `pnpm dev`):

1. **Unified look** — request and response panes share gutter, line numbers, fold arrows, syntax colors, theme.
2. **Folding** — both panes collapse/expand object/array nodes via the gutter arrows; response loads fully expanded.
3. **Text selection** — selectable in both panes (response too).
4. **Native find** — Ctrl+F opens Monaco's find widget in both panes.
5. **Ctrl+double-click copy** — on a string copies it unquoted; on an object/array bracket copies compact JSON; toast confirms. Plain double-click still selects a word (request stays editable).
6. **Elision** — a response with a string > 4096 chars shows preview + size badge; `data:image/png;base64,…` shows `image/png · <size>`.
7. **Badge expand** — clicking a badge expands the full value inline; the badge disappears; Ctrl+double-click on it still copies the full value.

---

## Self-Review Notes (spec coverage)

- Direction = Monaco both panes → Tasks 8–10. ✅
- Ctrl+dblclick uniform + rich semantics → Tasks 1, 6, 7. ✅
- Native Ctrl+F → Monaco built-in (Tasks 8/manual). ✅
- Elision >4096, preview+badge, data: MIME → Tasks 4, 5. ✅
- Badge click → inline expand, one-way → Task 8 (`expandNode`), Task 7 (`onBadgeExpand`). ✅
- Fold default expanded → render produces expanded text; folding controls are user-driven (Task 5/8). ✅
- 50 MB whole-body ceiling → Task 12 (optional). ✅
- Scope: only the two bodies; Metadata/Trailers/Headers untouched. ✅
- Cleanup of tree/search/degrade/react-virtual → Task 11. ✅

---

### Task 12 (optional): 50 MB whole-body ceiling

**Files:**
- Modify: `src/features/bodyview/elide.ts`
- Modify: `src/features/bodyview/elide.test.ts`
- Modify: `src/features/bodyview/BodyView.tsx`

Per-value elision already keeps single giant values out of the model. This task adds the spec's last-resort guard: a response whose **total** body exceeds 50 MB is shown as raw text with folding off, skipping parse/render entirely. It is its own task because the team may prefer elision-only; skip it if so, but it is fully specified here.

- [ ] **Step 1: Add the ceiling helper + test**

Append to `src/features/bodyview/elide.ts`:

```ts
export const BODY_MAX_BYTES = 50 * 1024 * 1024; // 50 MB, mirrors Postman's default

export function exceedsByteCeiling(text: string, max = BODY_MAX_BYTES): boolean {
  return new TextEncoder().encode(text).length > max;
}
```

Append to `src/features/bodyview/elide.test.ts`:

```ts
import { exceedsByteCeiling } from "./elide";

describe("exceedsByteCeiling", () => {
  it("is false below the limit and true above it (custom limit keeps the test cheap)", () => {
    expect(exceedsByteCeiling("hello", 10)).toBe(false);
    expect(exceedsByteCeiling("hello world!", 10)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the elide test**

Run: `pnpm vitest run src/features/bodyview/elide.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Guard `renderResponse` in `BodyView.tsx`**

In `src/features/bodyview/BodyView.tsx`, update the import from `./elide` (add it if absent):

```tsx
import { exceedsByteCeiling } from "./elide";
```

At the very top of `renderResponse`, before `parseWithSpans`, add:

```tsx
    if (exceedsByteCeiling(text)) {
      l.tree = null; l.spans = []; l.badges = [];
      l.editor.updateOptions({ folding: false });
      l.editor.getModel()?.setValue(text);
      l.decorations?.clear();
      return;
    }
```

- [ ] **Step 4: Typecheck + suite**

Run: `pnpm lint && pnpm test`
Expected: no errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/elide.ts src/features/bodyview/elide.test.ts src/features/bodyview/BodyView.tsx
git commit -m "feat(bodyview): 50MB whole-body ceiling falls back to raw render"
```
