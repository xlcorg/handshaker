import { describe, it, expect } from "vitest";
import { copyTextForNode, valueLiteral, toastSnippet, TOAST_SNIPPET_LIMIT, PREVIEW_LIMIT } from "./copyValue";
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

describe("toastSnippet", () => {
  it("returns short text unchanged", () => {
    expect(toastSnippet("hello")).toBe("hello");
  });
  it("collapses whitespace and newlines to single spaces", () => {
    expect(toastSnippet("a\n  b\tc")).toBe("a b c");
  });
  it("truncates long text with … at the limit", () => {
    const long = "x".repeat(TOAST_SNIPPET_LIMIT + 20);
    const s = toastSnippet(long);
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBe(TOAST_SNIPPET_LIMIT + 1); // limit chars + the … glyph
  });
});
