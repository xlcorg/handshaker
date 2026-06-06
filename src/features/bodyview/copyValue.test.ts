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
