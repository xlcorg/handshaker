# Response Viewer & Copy (Plan #4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Monaco read-only response body with a **custom, collapsible, virtualized JSON viewer** featuring double-click-to-copy (per spec copy rules), in-response search (Ctrl+F), Postman-style large-payload degradation + download, and Postman-style gRPC error rendering — wired in through the single shared `ResponsePanel` so all three views (Focus / Лента / Список) get it at once.

**Architecture:** A pure core (parse JSON → flat addressable node tree; flatten-visible given a collapsed set; copy-text rules; substring search; size-threshold check) with **zero React**, exhaustively unit-tested. On top of it a thin presentational row (`JsonRowView`), a virtualized container (`JsonTree`, backed by `@tanstack/react-virtual`), a search bar, and an orchestrator (`ResponseBody`) that owns collapse/search/degrade state. A tiny app-level toast singleton (`lib/toast` + `<Toaster/>`) backs copy confirmations. The error path gets a dedicated `ErrorView`. Because Plan #3 routed every view through `CallPanel → ResponsePanel`, swapping `BodyView`→`ResponseBody` and `ErrorBody`→`ErrorView` inside `ResponsePanel` lands the new viewer in **all three views** with no per-view edits.

**Tech Stack:** React 18 + TypeScript (strict) + Tailwind/shadcn (existing primitives) + **`@tanstack/react-virtual` (new dep, row virtualization)** + Vitest + React Testing Library. The Monaco request **editor** (`BodyEditor`) is untouched; only the read-only **response** view changes.

**Spec refs:** §6 (dbl-click value → clipboard, string w/o quotes, scalar as-is, object/array compact JSON; hover highlight + full-value tooltip; `⧉ copy all`), §10 "Просмотр ответа / копирование" (custom collapsible JSON viewer, Ctrl+F search, Postman-style virtualization + size threshold soft-degrade + download), §10/§14 "Ошибки и края" (gRPC error Postman-style: status code + message prominent, trailing metadata in a tab).

> **🔭 SCOPE DECISIONS (interview 2026-06-04 — confirm at review):**
> 1. **gRPC `google.rpc` details are FRONTEND-ONLY-DEFERRED.** The backend
>    (`crates/handshaker-core/src/grpc/transport/tonic_impl.rs` → `metadata_to_map`)
>    **silently drops binary `-bin` trailers**, so `grpc-status-details-bin` (the
>    serialized `google.rpc.Status` carrying structured `details[]`) never reaches the
>    UI. Plan #4 therefore renders the error **Postman-style with what we have** —
>    status code + message prominent, ASCII trailing metadata in the existing Trailers
>    tab — and shows an honest "structured details unavailable (pending backend)" note.
>    **Decoding `-bin` → `google.rpc.Status` is a separate backend follow-up** (capture
>    binary trailer, add `prost` well-known-types decode, new `UnaryOutcome`/`InvokeOutcomeIpc`
>    field, regen specta). Out of scope here. See "Deferred follow-ups" at the bottom.
> 2. **Virtualization uses `@tanstack/react-virtual`** (new dependency — breaks the prior
>    "no new deps" streak deliberately; a hand-rolled virtualized *collapsible tree* is
>    fragile). Fixed row height (single-line mono rows) → static `estimateSize`, no dynamic
>    measurement.
>
> **Confirmed defaults:** custom viewer replaces Monaco **for the response body only**
> (request `BodyEditor` stays Monaco). Degrade threshold = **2 MB** of UTF-8 JSON.

---

## File Structure

**Created — pure logic (no React, fully unit-tested):**
- `src/features/response/json/jsonTree.ts` — `parseJsonTree(json) → JsonTree`, `flattenVisible(tree, collapsed) → JsonNode[]`.
- `src/features/response/json/jsonTree.test.ts`
- `src/features/response/json/copyValue.ts` — `copyTextForNode(node)`, `valuePreview(node)`.
- `src/features/response/json/copyValue.test.ts`
- `src/features/response/json/jsonSearch.ts` — `findMatches(tree, query)`, `ancestorsToExpand(tree, id)`.
- `src/features/response/json/jsonSearch.test.ts`
- `src/features/response/json/degrade.ts` — `byteSize(s)`, `shouldDegrade(json, threshold?)`, `DEGRADE_THRESHOLD_BYTES`.
- `src/features/response/json/degrade.test.ts`
- `src/lib/download.ts` — `downloadText(filename, text)`.
- `src/lib/download.test.ts`
- `src/lib/toast.ts` — toast singleton store + `toast(message)`.
- `src/lib/toast.test.ts`
- `src/lib/clipboard.ts` — `copyToClipboard(text, toastMessage?)`.
- `src/lib/clipboard.test.ts`

**Created — components:**
- `src/components/ui/toaster.tsx` — `<Toaster/>` (subscribes to toast store, auto-dismiss).
- `src/components/ui/toaster.test.tsx`
- `src/features/response/json/JsonRowView.tsx` — one presentational row (caret, key, value, kind colors, dbl-click copy, match highlight).
- `src/features/response/json/JsonRowView.test.tsx`
- `src/features/response/json/JsonTree.tsx` — virtualized container over `flattenVisible`.
- `src/features/response/json/JsonTree.test.tsx`
- `src/features/response/json/JsonSearchBar.tsx` — Ctrl+F bar (input, n/N, next/prev, close).
- `src/features/response/json/JsonSearchBar.test.tsx`
- `src/features/response/ResponseBody.tsx` — orchestrator (parse + collapse + search + degrade + copy). Replaces `BodyView` in the success path.
- `src/features/response/ResponseBody.test.tsx`
- `src/features/response/ErrorView.tsx` — Postman-style gRPC error. Replaces `ErrorBody`.
- `src/features/response/ErrorView.test.tsx`

**Modified:**
- `package.json` — add `@tanstack/react-virtual`.
- `src/features/response/ResponsePanel.tsx` — swap `BodyView`→`ResponseBody`, `ErrorBody`→`ErrorView`.
- `src/app/WorkflowApp.tsx` — mount `<Toaster/>` once at the shell root.

**Untouched (explicitly):** `BodyView.tsx`/`ErrorBody.tsx` are left on disk but no longer imported (delete in Task 12's commit). `BodyEditor`, Monaco, `CallPanel`, `FocusView`, `LedgerView`, `ListView`, `StepRow`, `KVTable`, `RespMeta` need no edits — the swap is contained to `ResponsePanel`.

---

## Task 1: Add the virtualization dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dep**

Run (from repo root):
```bash
pnpm add @tanstack/react-virtual
```
Expected: `package.json` `dependencies` gains `"@tanstack/react-virtual": "^3.x"`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Verify it resolves**

Run:
```bash
pnpm lint
```
Expected: `tsc -b` exit 0 (no usage yet, just confirms install didn't break the graph).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(deps): add @tanstack/react-virtual for response viewer"
```

---

## Task 2: JSON tree model (`jsonTree.ts`)

Pure parse of a JSON string into a flat, stably-addressed node tree, plus a visible-flattening pass that honors a collapsed set. No React.

**Files:**
- Create: `src/features/response/json/jsonTree.ts`
- Test: `src/features/response/json/jsonTree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseJsonTree, flattenVisible } from "./jsonTree";

describe("parseJsonTree", () => {
  it("returns an error tree for invalid JSON", () => {
    const t = parseJsonTree("not json {");
    expect(t.error).not.toBeNull();
    expect(t.rootId).toBeNull();
    expect(t.order).toEqual([]);
  });

  it("classifies scalar kinds and keeps raw values", () => {
    const t = parseJsonTree(`{"s":"hi","n":42,"b":true,"z":null}`);
    expect(t.error).toBeNull();
    const root = t.nodes[t.rootId!];
    expect(root.kind).toBe("object");
    expect(root.childCount).toBe(4);
    const byKey = (k: string) => root.childIds.map((id) => t.nodes[id]).find((n) => n.key === k)!;
    expect(byKey("s").kind).toBe("string");
    expect(byKey("s").value).toBe("hi");
    expect(byKey("n").kind).toBe("number");
    expect(byKey("n").value).toBe(42);
    expect(byKey("b").kind).toBe("boolean");
    expect(byKey("z").kind).toBe("null");
  });

  it("indexes array elements with index + depth and null keys", () => {
    const t = parseJsonTree(`{"tags":["a","b"]}`);
    const root = t.nodes[t.rootId!];
    const tags = t.nodes[root.childIds[0]];
    expect(tags.kind).toBe("array");
    expect(tags.depth).toBe(1);
    const first = t.nodes[tags.childIds[0]];
    expect(first.key).toBeNull();
    expect(first.index).toBe(0);
    expect(first.depth).toBe(2);
    expect(first.value).toBe("a");
  });

  it("gives every node a unique stable id and a full DFS order", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    expect(new Set(t.order).size).toBe(t.order.length);
    // pre-order: root, a, a.b, c
    expect(t.order.length).toBe(4);
    expect(t.order[0]).toBe(t.rootId);
  });
});

describe("flattenVisible", () => {
  it("hides descendants of collapsed containers", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const root = t.nodes[t.rootId!];
    const a = t.nodes[root.childIds.find((id) => t.nodes[id].key === "a")!];
    const allVisible = flattenVisible(t, new Set());
    expect(allVisible.map((n) => n.id)).toEqual(t.order); // nothing collapsed → full order
    const collapsed = flattenVisible(t, new Set([a.id]));
    // a is still shown, but a.b is hidden
    expect(collapsed.some((n) => n.id === a.id)).toBe(true);
    expect(collapsed.some((n) => t.nodes[n.id].key === "b")).toBe(false);
  });

  it("returns [] for an error tree", () => {
    expect(flattenVisible(parseJsonTree("oops"), new Set())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/jsonTree.test.ts`
Expected: FAIL — `parseJsonTree is not a function` (module not found / no exports).

- [ ] **Step 3: Write the implementation**

```ts
export type JsonKind = "string" | "number" | "boolean" | "null" | "object" | "array";

export interface JsonNode {
  id: string;            // stable DFS id, e.g. "n0", "n1" — deterministic per json
  parentId: string | null;
  key: string | null;    // object-member key; null for root and array elements
  index: number | null;  // array index; null for root and object members
  kind: JsonKind;
  value: unknown;        // raw parsed value (kept for copy / preview)
  depth: number;         // 0 = root
  childIds: string[];    // direct children, in source order
  childCount: number;    // 0 for scalars
}

export interface JsonTree {
  rootId: string | null;
  nodes: Record<string, JsonNode>;
  order: string[];       // full DFS pre-order of every node id
  error: string | null;  // parse error message, or null
}

function kindOf(v: unknown): JsonKind {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "object";
  }
}

export function parseJsonTree(json: string): JsonTree {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { rootId: null, nodes: {}, order: [], error: (e as Error).message };
  }

  const nodes: Record<string, JsonNode> = {};
  const order: string[] = [];
  let counter = 0;

  const build = (
    value: unknown,
    key: string | null,
    index: number | null,
    parentId: string | null,
    depth: number,
  ): string => {
    const id = `n${counter++}`;
    const kind = kindOf(value);
    const node: JsonNode = {
      id, parentId, key, index, kind, value, depth, childIds: [], childCount: 0,
    };
    nodes[id] = node;
    order.push(id);

    if (kind === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      node.childCount = entries.length;
      node.childIds = entries.map(([k, v]) => build(v, k, null, id, depth + 1));
    } else if (kind === "array") {
      const arr = value as unknown[];
      node.childCount = arr.length;
      node.childIds = arr.map((v, i) => build(v, null, i, id, depth + 1));
    }
    return id;
  };

  const rootId = build(parsed, null, null, null, 0);
  return { rootId, nodes, order, error: null };
}

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/response/json/jsonTree.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/jsonTree.ts src/features/response/json/jsonTree.test.ts
git commit -m "feat(response): pure JSON tree model (parse + flatten-visible)"
```

---

## Task 3: Copy-value + preview rules (`copyValue.ts`)

The spec's copy contract (§6): string → **unquoted**, number/bool/null → as-is, object/array → **compact JSON**. Plus a display preview (quoted/truncated strings, `{N}`/`[N]` for containers).

**Files:**
- Create: `src/features/response/json/copyValue.ts`
- Test: `src/features/response/json/copyValue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { copyTextForNode, valuePreview, PREVIEW_LIMIT } from "./copyValue";
import { parseJsonTree } from "./jsonTree";

const nodeFor = (json: string, key: string) => {
  const t = parseJsonTree(json);
  const root = t.nodes[t.rootId!];
  return root.childIds.map((id) => t.nodes[id]).find((n) => n.key === key)!;
};

describe("copyTextForNode", () => {
  it("copies a string WITHOUT surrounding quotes", () => {
    expect(copyTextForNode(nodeFor(`{"s":"hello world"}`, "s"))).toBe("hello world");
  });
  it("copies numbers and booleans and null as-is", () => {
    expect(copyTextForNode(nodeFor(`{"n":42}`, "n"))).toBe("42");
    expect(copyTextForNode(nodeFor(`{"b":true}`, "b"))).toBe("true");
    expect(copyTextForNode(nodeFor(`{"z":null}`, "z"))).toBe("null");
  });
  it("copies objects/arrays as COMPACT JSON (no whitespace)", () => {
    expect(copyTextForNode(nodeFor(`{"o":{"a":1,"b":[2,3]}}`, "o"))).toBe(`{"a":1,"b":[2,3]}`);
    expect(copyTextForNode(nodeFor(`{"arr":[1,2]}`, "arr"))).toBe(`[1,2]`);
  });
  it("copies the FULL string even when display would truncate", () => {
    const long = "x".repeat(PREVIEW_LIMIT + 50);
    expect(copyTextForNode(nodeFor(`{"s":${JSON.stringify(long)}}`, "s"))).toBe(long);
  });
});

describe("valuePreview", () => {
  it("quotes strings and truncates with … past the limit", () => {
    expect(valuePreview(nodeFor(`{"s":"hi"}`, "s"))).toBe(`"hi"`);
    const long = "x".repeat(PREVIEW_LIMIT + 50);
    const p = valuePreview(nodeFor(`{"s":${JSON.stringify(long)}}`, "s"));
    expect(p.startsWith(`"`)).toBe(true);
    expect(p.endsWith(`…"`)).toBe(true);
    expect(p.length).toBeLessThan(long.length);
  });
  it("summarizes containers by child count", () => {
    expect(valuePreview(nodeFor(`{"o":{"a":1}}`, "o"))).toBe("{1}");
    expect(valuePreview(nodeFor(`{"e":{}}`, "e"))).toBe("{}");
    expect(valuePreview(nodeFor(`{"arr":[1,2,3]}`, "arr"))).toBe("[3]");
    expect(valuePreview(nodeFor(`{"empty":[]}`, "empty"))).toBe("[]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/copyValue.test.ts`
Expected: FAIL — `copyTextForNode is not a function`.

- [ ] **Step 3: Write the implementation**

```ts
import type { JsonNode } from "./jsonTree";

export const PREVIEW_LIMIT = 120;

/** Clipboard text per spec §6: string unquoted, scalar as-is, container compact JSON. */
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

/** Inline display preview (truncated). The FULL value is what `copyTextForNode` yields. */
export function valuePreview(node: JsonNode): string {
  switch (node.kind) {
    case "string": {
      const s = node.value as string;
      const body = s.length > PREVIEW_LIMIT ? `${s.slice(0, PREVIEW_LIMIT)}…` : s;
      return `"${body}"`;
    }
    case "number":
    case "boolean": return String(node.value);
    case "null": return "null";
    case "array": return node.childCount === 0 ? "[]" : `[${node.childCount}]`;
    case "object": return node.childCount === 0 ? "{}" : `{${node.childCount}}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/response/json/copyValue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/copyValue.ts src/features/response/json/copyValue.test.ts
git commit -m "feat(response): double-click copy-text + value-preview rules"
```

---

## Task 4: In-response search (`jsonSearch.ts`)

Case-insensitive substring search over keys (any node) and scalar value text (leaves only), plus the ancestor chain needed to reveal a match.

**Files:**
- Create: `src/features/response/json/jsonSearch.ts`
- Test: `src/features/response/json/jsonSearch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { findMatches, ancestorsToExpand } from "./jsonSearch";
import { parseJsonTree } from "./jsonTree";

describe("findMatches", () => {
  it("returns [] for a blank query", () => {
    expect(findMatches(parseJsonTree(`{"a":1}`), "   ")).toEqual([]);
  });
  it("matches keys case-insensitively", () => {
    const t = parseJsonTree(`{"userId":1,"name":"x"}`);
    const m = findMatches(t, "USER");
    expect(m).toHaveLength(1);
    expect(m[0].field).toBe("key");
    expect(t.nodes[m[0].nodeId].key).toBe("userId");
  });
  it("matches scalar value text but not container nodes", () => {
    const t = parseJsonTree(`{"city":"Berlin","nested":{"city":"Berlin"}}`);
    const m = findMatches(t, "berlin");
    // two string leaves match on value; the object node "nested" must NOT match
    expect(m.every((x) => x.field === "value")).toBe(true);
    expect(m).toHaveLength(2);
  });
  it("matches numbers by their text form", () => {
    const t = parseJsonTree(`{"port":8443}`);
    expect(findMatches(t, "844")).toHaveLength(1);
  });
});

describe("ancestorsToExpand", () => {
  it("returns the parent chain of a node, nearest-first, excluding the node", () => {
    const t = parseJsonTree(`{"a":{"b":{"c":1}}}`);
    const cId = t.order[t.order.length - 1]; // deepest leaf "c"
    const chain = ancestorsToExpand(t, cId);
    const keys = chain.map((id) => t.nodes[id].key);
    expect(keys).toEqual(["b", "a", null]); // b, a, then root (null key)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/jsonSearch.test.ts`
Expected: FAIL — `findMatches is not a function`.

- [ ] **Step 3: Write the implementation**

```ts
import type { JsonTree } from "./jsonTree";

export interface JsonMatch {
  nodeId: string;
  field: "key" | "value";
}

export function findMatches(tree: JsonTree, query: string): JsonMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: JsonMatch[] = [];
  for (const id of tree.order) {
    const n = tree.nodes[id];
    if (n.key != null && n.key.toLowerCase().includes(q)) {
      out.push({ nodeId: id, field: "key" });
    }
    if (n.kind !== "object" && n.kind !== "array") {
      const text = n.kind === "string" ? (n.value as string) : String(n.value);
      if (text.toLowerCase().includes(q)) out.push({ nodeId: id, field: "value" });
    }
  }
  return out;
}

/** Ancestor ids from nearest parent up to root (exclusive of `nodeId`). */
export function ancestorsToExpand(tree: JsonTree, nodeId: string): string[] {
  const ids: string[] = [];
  let cur = tree.nodes[nodeId]?.parentId ?? null;
  while (cur) {
    ids.push(cur);
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/response/json/jsonSearch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/jsonSearch.ts src/features/response/json/jsonSearch.test.ts
git commit -m "feat(response): in-response substring search + ancestor reveal"
```

---

## Task 5: Size threshold + download helper (`degrade.ts`, `lib/download.ts`)

Soft-degrade decision for huge payloads, and a browser download trigger.

**Files:**
- Create: `src/features/response/json/degrade.ts`
- Test: `src/features/response/json/degrade.test.ts`
- Create: `src/lib/download.ts`
- Test: `src/lib/download.test.ts`

- [ ] **Step 1: Write the failing tests**

`degrade.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { byteSize, shouldDegrade, DEGRADE_THRESHOLD_BYTES } from "./degrade";

describe("degrade", () => {
  it("measures UTF-8 byte length (not code-unit length)", () => {
    expect(byteSize("ab")).toBe(2);
    expect(byteSize("é")).toBe(2);   // 2 UTF-8 bytes
    expect(byteSize("😀")).toBe(4);
  });
  it("degrades only above the threshold", () => {
    expect(shouldDegrade("{}", 10)).toBe(false);
    expect(shouldDegrade("0123456789X", 10)).toBe(true);
    expect(shouldDegrade("{}")).toBe(false); // well under default 2 MB
  });
  it("exposes a 2 MB default threshold", () => {
    expect(DEGRADE_THRESHOLD_BYTES).toBe(2 * 1024 * 1024);
  });
});
```

`download.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadText } from "./download";

describe("downloadText", () => {
  beforeEach(() => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:x");
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });
  it("creates an anchor, clicks it, and revokes the blob url", () => {
    const click = vi.fn();
    const anchor = { href: "", download: "", click } as unknown as HTMLAnchorElement;
    const create = vi.spyOn(document, "createElement").mockReturnValue(anchor);

    downloadText("response.json", `{"a":1}`);

    expect(create).toHaveBeenCalledWith("a");
    expect(anchor.download).toBe("response.json");
    expect(anchor.href).toBe("blob:x");
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    create.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/features/response/json/degrade.test.ts src/lib/download.test.ts`
Expected: FAIL — modules/exports missing.

- [ ] **Step 3: Write the implementations**

`src/features/response/json/degrade.ts`:
```ts
/** Above this UTF-8 byte size we skip the tree/highlight and offer a download (spec §10). */
export const DEGRADE_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2 MB

export function byteSize(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function shouldDegrade(json: string, threshold: number = DEGRADE_THRESHOLD_BYTES): boolean {
  return byteSize(json) > threshold;
}
```

`src/lib/download.ts`:
```ts
/** Trigger a client-side download of `text` as a file named `filename`. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/features/response/json/degrade.test.ts src/lib/download.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/degrade.ts src/features/response/json/degrade.test.ts src/lib/download.ts src/lib/download.test.ts
git commit -m "feat(response): size-threshold degrade check + download helper"
```

---

## Task 6: Toast singleton + clipboard helper (`lib/toast.ts`, `lib/clipboard.ts`)

A minimal app-level toast store (no new dep — there is no toast lib in the project) and a clipboard helper that confirms via toast. `<Toaster/>` UI is Task 7.

**Files:**
- Create: `src/lib/toast.ts`
- Test: `src/lib/toast.test.ts`
- Create: `src/lib/clipboard.ts`
- Test: `src/lib/clipboard.test.ts`

> Note: `newId()` already exists at `src/lib/ids.ts` (used by `model.ts`).

- [ ] **Step 1: Write the failing tests**

`toast.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { toast, toastStore } from "./toast";

beforeEach(() => toastStore.reset());

describe("toast store", () => {
  it("appends a toast and notifies subscribers", () => {
    let ticks = 0;
    const unsub = toastStore.subscribe(() => { ticks++; });
    toast("Скопировано");
    expect(toastStore.getState()).toHaveLength(1);
    expect(toastStore.getState()[0].message).toBe("Скопировано");
    expect(ticks).toBe(1);
    unsub();
  });
  it("dismiss removes by id and reset clears all", () => {
    const id = toast("a");
    toast("b");
    toastStore.dismiss(id);
    expect(toastStore.getState().map((t) => t.message)).toEqual(["b"]);
    toastStore.reset();
    expect(toastStore.getState()).toEqual([]);
  });
});
```

`clipboard.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { copyToClipboard } from "./clipboard";
import { toastStore } from "./toast";

beforeEach(() => toastStore.reset());

describe("copyToClipboard", () => {
  it("writes text and shows a confirmation toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await copyToClipboard("payload-123");
    expect(writeText).toHaveBeenCalledWith("payload-123");
    expect(toastStore.getState()[0].message).toMatch(/копировано/i);
  });
  it("shows a failure toast when the write rejects", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await copyToClipboard("x");
    expect(toastStore.getState()[0].message).toMatch(/не удалось/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/lib/toast.test.ts src/lib/clipboard.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write the implementations**

`src/lib/toast.ts`:
```ts
import { newId } from "@/lib/ids";

export interface ToastItem {
  id: string;
  message: string;
}

type Listener = () => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const emit = () => { for (const l of listeners) l(); };

export const toastStore = {
  getState(): ToastItem[] { return items; },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  dismiss(id: string) {
    items = items.filter((t) => t.id !== id);
    emit();
  },
  reset() { items = []; emit(); },
};

/** Show a transient toast; returns its id. */
export function toast(message: string): string {
  const item: ToastItem = { id: newId(), message };
  items = [...items, item];
  emit();
  return item.id;
}
```

`src/lib/clipboard.ts`:
```ts
import { toast } from "@/lib/toast";

/** Copy `text` to the clipboard and confirm (or report failure) via a toast. */
export async function copyToClipboard(text: string, okMessage = "Скопировано"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
  } catch {
    toast("Не удалось скопировать");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/lib/toast.test.ts src/lib/clipboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/toast.ts src/lib/toast.test.ts src/lib/clipboard.ts src/lib/clipboard.test.ts
git commit -m "feat(lib): minimal toast store + clipboard helper"
```

---

## Task 7: `<Toaster/>` UI + mount in shell

**Files:**
- Create: `src/components/ui/toaster.tsx`
- Test: `src/components/ui/toaster.test.tsx`
- Modify: `src/app/WorkflowApp.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Toaster } from "./toaster";
import { toast, toastStore } from "@/lib/toast";

beforeEach(() => { toastStore.reset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("Toaster", () => {
  it("renders active toasts and auto-dismisses them after the timeout", () => {
    render(<Toaster />);
    act(() => { toast("Скопировано"); });
    expect(screen.getByText("Скопировано")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByText("Скопировано")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/ui/toaster.test.tsx`
Expected: FAIL — `Toaster` not exported.

- [ ] **Step 3: Write the component**

`src/components/ui/toaster.tsx`:
```tsx
import { useEffect, useSyncExternalStore } from "react";
import { toastStore } from "@/lib/toast";

const TOAST_MS = 1800;

export function Toaster() {
  const toasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getState,
    toastStore.getState,
  );
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} id={t.id} message={t.message} />
      ))}
    </div>
  );
}

function ToastRow({ id, message }: { id: string; message: string }) {
  useEffect(() => {
    const h = setTimeout(() => toastStore.dismiss(id), TOAST_MS);
    return () => clearTimeout(h);
  }, [id]);
  return (
    <div className="pointer-events-auto rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg">
      {message}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/ui/toaster.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount `<Toaster/>` in the shell**

In `src/app/WorkflowApp.tsx`, add the import near the top (after the `Kbd` import):
```tsx
import { Toaster } from "@/components/ui/toaster";
```
Then render it once, just before the closing `</div>` of the root shell — change the tail of the returned JSX from:
```tsx
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
```
to:
```tsx
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster />
    </div>
  );
```

- [ ] **Step 6: Run the existing shell test to confirm no regression**

Run: `pnpm exec vitest run src/app/WorkflowApp.test.tsx`
Expected: PASS (Toaster renders nothing when no toasts are queued).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/toaster.tsx src/components/ui/toaster.test.tsx src/app/WorkflowApp.tsx
git commit -m "feat(ui): Toaster component mounted in the shell"
```

---

## Task 8: Presentational row (`JsonRowView.tsx`)

One single-line row: indent by depth, caret for containers, colored key/value, double-click copies, full value in the `title` tooltip, match highlighting. No virtualization here — pure props in, easy to test.

**Files:**
- Create: `src/features/response/json/JsonRowView.tsx`
- Test: `src/features/response/json/JsonRowView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonRowView } from "./JsonRowView";
import { parseJsonTree } from "./jsonTree";

const node = (json: string, key: string) => {
  const t = parseJsonTree(json);
  const root = t.nodes[t.rootId!];
  return root.childIds.map((id) => t.nodes[id]).find((n) => n.key === key)!;
};

describe("JsonRowView", () => {
  it("renders key + quoted preview for a string leaf and copies on double-click", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const n = node(`{"name":"Alice"}`, "name");
    render(
      <JsonRowView node={n} collapsed={false} isMatch={false} isActiveMatch={false}
        onToggle={() => {}} onCopy={onCopy} />,
    );
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText(`"Alice"`)).toBeInTheDocument();
    await user.dblClick(screen.getByText(`"Alice"`));
    expect(onCopy).toHaveBeenCalledWith(n);
  });

  it("shows a caret for a container and toggles without triggering copy", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onCopy = vi.fn();
    const n = node(`{"obj":{"a":1}}`, "obj");
    render(
      <JsonRowView node={n} collapsed isMatch={false} isActiveMatch={false}
        onToggle={onToggle} onCopy={onCopy} />,
    );
    expect(screen.getByText("{1}")).toBeInTheDocument(); // collapsed container preview
    await user.click(screen.getByRole("button", { name: "toggle-node" }));
    expect(onToggle).toHaveBeenCalledWith(n.id);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("exposes the full value as a tooltip title", () => {
    const n = node(`{"s":"the full value"}`, "s");
    render(
      <JsonRowView node={n} collapsed={false} isMatch={false} isActiveMatch={false}
        onToggle={() => {}} onCopy={() => {}} />,
    );
    expect(screen.getByTitle("the full value")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/JsonRowView.test.tsx`
Expected: FAIL — `JsonRowView` not exported.

- [ ] **Step 3: Write the component**

```tsx
import { cn } from "@/lib/cn";
import type { JsonKind, JsonNode } from "./jsonTree";
import { copyTextForNode, valuePreview } from "./copyValue";

export interface JsonRowViewProps {
  node: JsonNode;
  collapsed: boolean;       // meaningful only for containers
  isMatch: boolean;
  isActiveMatch: boolean;
  onToggle: (id: string) => void;
  onCopy: (node: JsonNode) => void;
}

const VALUE_CLASS: Record<JsonKind, string> = {
  string: "tok-str",
  number: "tok-num",
  boolean: "tok-bool",
  null: "tok-punct",
  object: "tok-punct",
  array: "tok-punct",
};

export function JsonRowView({
  node, collapsed, isMatch, isActiveMatch, onToggle, onCopy,
}: JsonRowViewProps) {
  const isContainer = node.kind === "object" || node.kind === "array";
  const label = node.key != null ? node.key : node.index != null ? String(node.index) : null;

  return (
    <div
      role="treeitem"
      aria-expanded={isContainer ? !collapsed : undefined}
      onDoubleClick={() => onCopy(node)}
      title={copyTextForNode(node)}
      style={{ paddingLeft: 8 + node.depth * 14 }}
      className={cn(
        "flex h-[22px] items-center gap-1.5 whitespace-pre pr-2 font-mono text-[12.5px] leading-[22px]",
        "cursor-default select-none hover:bg-accent/50",
        isMatch && "bg-[hsl(var(--syntax-num))]/15",
        isActiveMatch && "bg-[hsl(var(--syntax-num))]/35",
      )}
    >
      {isContainer ? (
        <button
          type="button"
          aria-label="toggle-node"
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          className="w-[1ch] text-muted-foreground"
        >
          {collapsed ? "▸" : "▾"}
        </button>
      ) : (
        <span className="w-[1ch]" aria-hidden />
      )}
      {label != null && (
        <>
          <span className="tok-key">{label}</span>
          <span className="tok-punct">:</span>
        </>
      )}
      <span className={VALUE_CLASS[node.kind]}>{valuePreview(node)}</span>
    </div>
  );
}
```

> Note on display: containers always show their `{N}`/`[N]` preview here. Expanded containers reveal their children as separate rows below (provided by `JsonTree` via `flattenVisible`); we deliberately render **no closing-brace rows** (common JSON-tree convention — simpler to virtualize).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/response/json/JsonRowView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/JsonRowView.tsx src/features/response/json/JsonRowView.test.tsx
git commit -m "feat(response): presentational JSON row (caret, colors, dbl-click copy)"
```

---

## Task 9: Virtualized container (`JsonTree.tsx`)

Renders only the visible window of `flattenVisible(tree, collapsed)` via `@tanstack/react-virtual`, scrolling the active match into view.

**Files:**
- Create: `src/features/response/json/JsonTree.tsx`
- Test: `src/features/response/json/JsonTree.test.tsx`

> **jsdom + virtualization:** in jsdom element heights are 0, so the real virtualizer renders an empty window. The test **mocks `@tanstack/react-virtual`** to yield all items — this keeps the test about *our* wiring (row props, toggle, copy), not the third-party measuring.

- [ ] **Step 1: Write the failing test**

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

import { JsonTree } from "./JsonTree";
import { parseJsonTree } from "./jsonTree";

describe("JsonTree", () => {
  it("renders a row per visible node and hides collapsed descendants", () => {
    const tree = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const aId = tree.order.find((id) => tree.nodes[id].key === "a")!;
    const { rerender } = render(
      <JsonTree tree={tree} collapsed={new Set()} matchIds={new Set()} activeMatchId={null}
        scrollToId={null} onToggle={() => {}} onCopy={() => {}} />,
    );
    expect(screen.getByText("b")).toBeInTheDocument();
    rerender(
      <JsonTree tree={tree} collapsed={new Set([aId])} matchIds={new Set()} activeMatchId={null}
        scrollToId={null} onToggle={() => {}} onCopy={() => {}} />,
    );
    expect(screen.queryByText("b")).not.toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
  });

  it("wires copy + toggle through to rows", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onToggle = vi.fn();
    const tree = parseJsonTree(`{"n":5}`);
    render(
      <JsonTree tree={tree} collapsed={new Set()} matchIds={new Set()} activeMatchId={null}
        scrollToId={null} onToggle={onToggle} onCopy={onCopy} />,
    );
    await user.dblClick(screen.getByText("5"));
    expect(onCopy).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "toggle-node" })); // root container caret
    expect(onToggle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/JsonTree.test.tsx`
Expected: FAIL — `JsonTree` not exported.

- [ ] **Step 3: Write the component**

```tsx
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { JsonRowView } from "./JsonRowView";
import { flattenVisible, type JsonNode, type JsonTree as Tree } from "./jsonTree";

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
  const rows = flattenVisible(tree, collapsed);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
  });

  useEffect(() => {
    if (!scrollToId) return;
    const idx = rows.findIndex((r) => r.id === scrollToId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToId]);

  return (
    <div ref={parentRef} role="tree" className="min-h-0 flex-1 overflow-auto scroll-thin">
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const node = rows[vi.index];
          return (
            <div
              key={node.id}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <JsonRowView
                node={node}
                collapsed={collapsed.has(node.id)}
                isMatch={matchIds.has(node.id)}
                isActiveMatch={node.id === activeMatchId}
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

Run: `pnpm exec vitest run src/features/response/json/JsonTree.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/JsonTree.tsx src/features/response/json/JsonTree.test.tsx
git commit -m "feat(response): virtualized JSON tree (react-virtual)"
```

---

## Task 10: Search bar (`JsonSearchBar.tsx`)

The Ctrl+F bar: input, `n/N` match counter, prev/next, close. Keyboard: Enter→next, Shift+Enter→prev, Esc→close.

**Files:**
- Create: `src/features/response/json/JsonSearchBar.tsx`
- Test: `src/features/response/json/JsonSearchBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonSearchBar } from "./JsonSearchBar";

const base = {
  query: "ber", matchCount: 3, activeIndex: 0,
  onQuery: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onClose: vi.fn(),
};

describe("JsonSearchBar", () => {
  it("shows the 1-based active index over the total", () => {
    render(<JsonSearchBar {...base} />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });
  it("shows 0/0 when there are no matches", () => {
    render(<JsonSearchBar {...base} matchCount={0} activeIndex={-1} />);
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });
  it("typing calls onQuery; Enter→next, Shift+Enter→prev, Esc→close", async () => {
    const user = userEvent.setup();
    const onQuery = vi.fn(); const onNext = vi.fn(); const onPrev = vi.fn(); const onClose = vi.fn();
    render(<JsonSearchBar {...base} query="" onQuery={onQuery} onNext={onNext} onPrev={onPrev} onClose={onClose} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "x");
    expect(onQuery).toHaveBeenCalledWith("x");
    await user.type(input, "{Enter}");
    expect(onNext).toHaveBeenCalled();
    await user.type(input, "{Shift>}{Enter}{/Shift}");
    expect(onPrev).toHaveBeenCalled();
    await user.type(input, "{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/json/JsonSearchBar.test.tsx`
Expected: FAIL — `JsonSearchBar` not exported.

- [ ] **Step 3: Write the component**

```tsx
import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface JsonSearchBarProps {
  query: string;
  matchCount: number;
  activeIndex: number; // 0-based; -1 when no matches
  onQuery: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function JsonSearchBar({
  query, matchCount, activeIndex, onQuery, onNext, onPrev, onClose,
}: JsonSearchBarProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const display = matchCount === 0 ? "0/0" : `${activeIndex + 1}/${matchCount}`;

  return (
    <div className="flex flex-none items-center gap-1.5 border-b border-border bg-background/90 px-2 py-1">
      <Input
        ref={ref}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? onPrev() : onNext(); }
          else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
        placeholder="Поиск в ответе…"
        className="h-6 flex-1 text-xs"
      />
      <span className="min-w-[3ch] text-center font-mono text-[11px] tabular-nums text-muted-foreground">
        {display}
      </span>
      <button type="button" aria-label="prev-match" onClick={onPrev} className="text-muted-foreground hover:text-foreground">
        <ChevronUp className="size-4" />
      </button>
      <button type="button" aria-label="next-match" onClick={onNext} className="text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-4" />
      </button>
      <button type="button" aria-label="close-search" onClick={onClose} className="text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  );
}
```

> `Input` forwards its `ref` (it is a shadcn `React.forwardRef` wrapper — confirm at `src/components/ui/input.tsx`; if it does not, change `ref={ref}` to an `autoFocus` prop instead).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/response/json/JsonSearchBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/response/json/JsonSearchBar.tsx src/features/response/json/JsonSearchBar.test.tsx
git commit -m "feat(response): in-response search bar (Ctrl+F UI)"
```

---

## Task 11: Orchestrator (`ResponseBody.tsx`) + Postman error (`ErrorView.tsx`)

`ResponseBody` ties the pure core to the components: parse, own the collapsed set + search state, intercept Ctrl+F, auto-expand to the active match, copy-on-double-click (→ clipboard + toast), a `⧉ copy all` button, and the degrade/download fallback. `ErrorView` is the Postman-style error face.

**Files:**
- Create: `src/features/response/ResponseBody.tsx`
- Test: `src/features/response/ResponseBody.test.tsx`
- Create: `src/features/response/ErrorView.tsx`
- Test: `src/features/response/ErrorView.test.tsx`

- [ ] **Step 1: Write the failing tests**

`ResponseBody.test.tsx` (mock the virtualizer the same way; mock clipboard):
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 22,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 22, size: 22 })),
    scrollToIndex: vi.fn(),
  }),
}));

import { ResponseBody } from "./ResponseBody";
import { toastStore } from "@/lib/toast";

beforeEach(() => {
  toastStore.reset();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("ResponseBody", () => {
  it("double-clicking a string value copies it unquoted and toasts", async () => {
    const user = userEvent.setup();
    render(<ResponseBody json={`{"name":"Alice"}`} />);
    await user.dblClick(screen.getByText(`"Alice"`));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Alice");
    expect(await screen.findByText(/Скопировано/)).toBeInTheDocument();
  });

  it("⧉ copy all copies the whole response", async () => {
    const user = userEvent.setup();
    render(<ResponseBody json={`{"a":1}`} />);
    await user.click(screen.getByRole("button", { name: "copy-all" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`{"a":1}`);
  });

  it("Ctrl+F opens the search bar and matches highlight + count", async () => {
    const user = userEvent.setup();
    render(<ResponseBody json={`{"city":"Berlin","other":"Berlin"}`} />);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = await screen.findByRole("textbox");
    await user.type(input, "berlin");
    expect(screen.getByText("1/2")).toBeInTheDocument(); // two value matches
  });

  it("degrades for payloads over the threshold and offers download", () => {
    const downloadSpy = vi.fn();
    vi.doMock("@/lib/download", () => ({ downloadText: downloadSpy }));
    // 3 MB string value → over the 2 MB threshold
    const big = JSON.stringify({ blob: "x".repeat(3 * 1024 * 1024) });
    render(<ResponseBody json={big} />);
    expect(screen.getByRole("button", { name: /Скачать/ })).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument(); // tree skipped
  });
});
```

`ErrorView.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorView } from "./ErrorView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const outcome = (over: Partial<InvokeOutcomeIpc> = {}): InvokeOutcomeIpc => ({
  status_code: 5,
  status_message: "NOT_FOUND: user does not exist",
  response_json: null,
  trailing_metadata: {},
  elapsed_ms: 12,
  ...over,
});

describe("ErrorView", () => {
  it("renders the status code name and the message prominently", () => {
    render(<ErrorView outcome={outcome()} />);
    expect(screen.getByText("NOT_FOUND")).toBeInTheDocument();
    expect(screen.getByText(/user does not exist/)).toBeInTheDocument();
  });
  it("notes that structured google.rpc details are unavailable (backend pending)", () => {
    render(<ErrorView outcome={outcome()} />);
    expect(screen.getByText(/details/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/features/response/ResponseBody.test.tsx src/features/response/ErrorView.test.tsx`
Expected: FAIL — components not exported.

- [ ] **Step 3: Write `ErrorView.tsx`**

```tsx
import { AlertCircle } from "lucide-react";
import { statusName } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

/**
 * Postman-style gRPC error face: status code + message prominent. Structured
 * `google.rpc` details require decoding the `grpc-status-details-bin` trailer in the
 * backend (currently dropped) — deferred to a follow-up; we surface an honest note.
 * Trailing metadata lives in the Trailers tab (rendered by ResponsePanel).
 */
export function ErrorView({ outcome }: { outcome: InvokeOutcomeIpc }) {
  const code = statusName(outcome.status_code);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2.5 border-b border-border bg-destructive/5 px-4 py-3 text-destructive">
        <AlertCircle className="size-4" />
        <span className="font-mono text-sm font-semibold">{code}</span>
        <span className="text-muted-foreground">·</span>
        <span className="break-all text-xs text-foreground/85">{outcome.status_message}</span>
      </div>
      <div className="flex-1 overflow-auto scroll-thin p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground/70">details</p>
        <p>
          Структурированные details (google.rpc) пока недоступны — требуется декодирование
          бинарного трейлера <code className="font-mono">grpc-status-details-bin</code> на бэкенде.
          Trailing metadata см. во вкладке Trailers.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `ResponseBody.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { JsonTree } from "./json/JsonTree";
import { JsonSearchBar } from "./json/JsonSearchBar";
import { parseJsonTree, type JsonNode } from "./json/jsonTree";
import { copyTextForNode } from "./json/copyValue";
import { findMatches, ancestorsToExpand } from "./json/jsonSearch";
import { shouldDegrade, byteSize } from "./json/degrade";
import { copyToClipboard } from "@/lib/clipboard";
import { downloadText } from "@/lib/download";
import { formatBytes } from "@/lib/grpc-status";

export interface ResponseBodyProps {
  json: string;
}

export function ResponseBody({ json }: ResponseBodyProps) {
  const degraded = useMemo(() => shouldDegrade(json), [json]);
  const tree = useMemo(() => parseJsonTree(json), [json]);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => (query ? findMatches(tree, query) : []), [tree, query]);
  const matchIds = useMemo(() => new Set(matches.map((m) => m.nodeId)), [matches]);
  const activeMatch = matches[activeIndex] ?? null;
  const activeMatchId = activeMatch?.nodeId ?? null;

  // Reset the active match when the result set changes.
  useEffect(() => { setActiveIndex(0); }, [query]);

  // Auto-expand the path to the active match so it is visible.
  useEffect(() => {
    if (!activeMatchId) return;
    const reveal = ancestorsToExpand(tree, activeMatchId);
    setCollapsed((prev) => {
      if (reveal.every((id) => !prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of reveal) next.delete(id);
      return next;
    });
  }, [activeMatchId, tree]);

  // Ctrl/Cmd+F opens the in-response search (only one ResponseBody is mounted at a time).
  useEffect(() => {
    if (degraded) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [degraded]);

  const onToggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const onCopy = (node: JsonNode) => { void copyToClipboard(copyTextForNode(node)); };

  if (degraded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-foreground">
          Ответ слишком большой для просмотра ({formatBytes(json)}).
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Подсветка и дерево отключены, чтобы не вешать интерфейс. Скачайте ответ, чтобы
          открыть его во внешнем редакторе.
        </p>
        <button
          type="button"
          onClick={() => downloadText("response.json", json)}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
        >
          Скачать ответ ({formatBytes(json)})
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-end border-b border-border/60 px-2 py-1">
        <button
          type="button"
          aria-label="copy-all"
          onClick={() => void copyToClipboard(json, "Ответ скопирован")}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Copy className="size-3" /> копировать всё
        </button>
      </div>
      {searchOpen && (
        <JsonSearchBar
          query={query}
          matchCount={matches.length}
          activeIndex={matches.length ? activeIndex : -1}
          onQuery={setQuery}
          onNext={() => matches.length && setActiveIndex((i) => (i + 1) % matches.length)}
          onPrev={() => matches.length && setActiveIndex((i) => (i - 1 + matches.length) % matches.length)}
          onClose={() => { setSearchOpen(false); setQuery(""); }}
        />
      )}
      <JsonTree
        tree={tree}
        collapsed={collapsed}
        matchIds={matchIds}
        activeMatchId={activeMatchId}
        scrollToId={activeMatchId}
        onToggle={onToggle}
        onCopy={onCopy}
      />
    </div>
  );
}
```

> The degrade test stubs `byteSize` indirectly via a real 3 MB string; the `byteSize` import is used by the threshold path. If unused-import lint fires, drop the explicit `byteSize` import (it is only referenced through `shouldDegrade`). Keep `formatBytes` for the size label.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/features/response/ResponseBody.test.tsx src/features/response/ErrorView.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/response/ResponseBody.tsx src/features/response/ResponseBody.test.tsx src/features/response/ErrorView.tsx src/features/response/ErrorView.test.tsx
git commit -m "feat(response): ResponseBody orchestrator + Postman-style ErrorView"
```

---

## Task 12: Wire into `ResponsePanel`, drop Monaco response view, verify everything

Swap the success body (`BodyView`/Monaco) for `ResponseBody` and the error body (`ErrorBody`) for `ErrorView`. This lands in **all three views at once** because they all render through `CallPanel → ResponsePanel`.

**Files:**
- Modify: `src/features/response/ResponsePanel.tsx`
- Delete: `src/features/response/BodyView.tsx`, `src/features/response/ErrorBody.tsx`
- Test: `src/features/response/ResponsePanel.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing wiring test**

Create `src/features/response/ResponsePanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 22,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 22, size: 22 })),
    scrollToIndex: vi.fn(),
  }),
}));

import { ResponsePanel } from "./ResponsePanel";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

const ok: InvokeOutcomeIpc = {
  status_code: 0, status_message: "OK",
  response_json: `{"id":"echo"}`, trailing_metadata: {}, elapsed_ms: 5,
};
const err: InvokeOutcomeIpc = {
  status_code: 5, status_message: "NOT_FOUND: nope",
  response_json: null, trailing_metadata: { "x-id": "1" }, elapsed_ms: 9,
};

describe("ResponsePanel", () => {
  it("renders the custom JSON tree for a successful body", () => {
    render(<ResponsePanel state="success" outcome={ok} />);
    expect(screen.getByRole("tree")).toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText(`"echo"`)).toBeInTheDocument();
  });
  it("renders the Postman-style error face for a non-OK status", () => {
    render(<ResponsePanel state="error" outcome={err} />);
    expect(screen.getByText("NOT_FOUND")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/response/ResponsePanel.test.tsx`
Expected: FAIL — panel still renders Monaco `BodyView` (no `role="tree"`).

- [ ] **Step 3: Edit `ResponsePanel.tsx`**

Change the imports — replace:
```tsx
import { BodyView } from "./BodyView";
import { ErrorBody } from "./ErrorBody";
```
with:
```tsx
import { ResponseBody } from "./ResponseBody";
import { ErrorView } from "./ErrorView";
```
Then in the JSX, replace the success-body line:
```tsx
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <BodyView json={outcome.response_json} />
      )}
```
with:
```tsx
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <ResponseBody json={outcome.response_json} />
      )}
```
and replace the error-body line:
```tsx
      {isError && outcome && tab === "body" && <ErrorBody outcome={outcome} />}
```
with:
```tsx
      {isError && outcome && tab === "body" && <ErrorView outcome={outcome} />}
```

- [ ] **Step 4: Run the wiring test to verify it passes**

Run: `pnpm exec vitest run src/features/response/ResponsePanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Delete the now-unused Monaco response view + old error body**

```bash
git rm src/features/response/BodyView.tsx src/features/response/ErrorBody.tsx
```
Then confirm nothing else imports them:

Run: `pnpm exec vitest run` and `pnpm lint`
Expected: no `Cannot find module './BodyView'` / `./ErrorBody` errors. (`BodyView`/`ErrorBody` were only referenced by `ResponsePanel`.)

> If `pnpm lint` reports a leftover import, grep for `BodyView`/`ErrorBody` and remove the dangling reference before continuing.

- [ ] **Step 6: Full verification gate**

Run, in order:
```bash
pnpm exec vitest run
pnpm lint
pnpm build
```
Expected:
- `vitest run`: ALL tests green (prior 96 + the new suites from Tasks 2–12). Report the final count.
- `pnpm lint` (`tsc -b`): exit 0.
- `pnpm build` (`tsc -b && vite build`): success, `dist/` produced.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(response): swap ResponsePanel onto custom JSON viewer + Postman error; drop Monaco response view"
```

- [ ] **Step 8 (human/manual smoke — deferred like Plan #3 Task 12):**

Against a live reflection server (or once a GUI is running): create a call, Send, confirm — collapse/expand nodes, double-click a string/number/object (clipboard + toast), Ctrl+F search with next/prev, and a forced non-OK status renders the Postman error face. This live-GUI step is a human checkpoint; mark it done after manual verification.

---

## 🧹 /clear-checkpoint at completion.

After Task 12's verification gate is green and committed, **update this plan's status banner** (add a ✅ EXECUTION STATUS block like Plan #3's), advance the active-plan pointer in `CLAUDE.md` to **Plan #5**, then end the session. Next session: `/clear`, then start Plan #5 (Env / auth / metadata).

---

## Self-Review (spec coverage)

- **§6 dbl-click copy (string unquoted / scalar as-is / container compact JSON):** Task 3 `copyTextForNode` (tested all four cases) → wired in Task 8 row + Task 11 orchestrator (clipboard + toast). ✅
- **§6 hover highlight + full-value tooltip:** Task 8 `hover:bg-accent/50` + `title={copyTextForNode(node)}` (full value even when preview truncates). ✅
- **§6 `⧉ copy all`:** Task 11 `copy-all` button. ✅
- **§10 custom collapsible JSON viewer:** Tasks 2 (model) + 8 (row caret) + 9 (tree) + 11 (collapse state). ✅
- **§10 Ctrl+F search + next/prev + highlight:** Tasks 4 (search core) + 10 (bar) + 11 (Ctrl+F intercept, active-match reveal/scroll). ✅
- **§10 virtualization:** Task 1 (dep) + Task 9 (`useVirtualizer`). ✅
- **§10 size threshold soft-degrade + download:** Task 5 (`shouldDegrade`, `downloadText`) + Task 11 (degrade branch). ✅
- **§10/§14 gRPC error Postman-style (code + message prominent, trailing metadata in tab):** Task 11 `ErrorView` (code+message) + existing Trailers tab (`KVTable`, untouched). ✅
- **"decoded google.rpc details":** **DEFERRED** (backend drops `-bin`); `ErrorView` shows an honest pending note. Documented as a follow-up. ⚠️ (intentional scope cut, confirmed 2026-06-04)
- **Outline task 6 "swap into FocusView and Лента/Список cells":** satisfied via the single shared `ResponsePanel` (Task 12) — all three views route through `CallPanel → ResponsePanel`. ✅

## Deferred follow-ups (out of Plan #4 scope)
1. **Backend: decode `google.rpc.Status` from `grpc-status-details-bin`.** Capture the binary trailer in `tonic_impl.rs::metadata_to_map` (currently skips `-bin`), decode via `prost` well-known types into structured `details[]`, add a field to `UnaryOutcome` + `InvokeOutcomeIpc`, regen specta bindings, then render the decoded details in `ErrorView` (replace the pending-note). This is what fully closes spec §10/§14 "decoded google.rpc details".
2. **Initial-metadata (response headers) tab** is still empty (backend doesn't surface it — pre-existing, not introduced here).
3. **Degrade threshold tuning** (2 MB is a first guess; spec §11 lists exact limit as open).
