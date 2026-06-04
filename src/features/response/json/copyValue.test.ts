import { describe, it, expect } from "vitest";
import { copyTextForNode, valuePreview, valueLiteral, PREVIEW_LIMIT } from "./copyValue";
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
