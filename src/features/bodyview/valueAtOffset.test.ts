import { describe, it, expect } from "vitest";
import { parseWithSpans } from "./parse";
import { stringValueAtOffset } from "./valueAtOffset";

describe("stringValueAtOffset", () => {
  it("returns the full string value at an offset inside a string node", () => {
    const text = `{"k":"aGVsbG8="}`;
    const p = parseWithSpans(text)!;
    const off = text.indexOf("aGV");
    expect(stringValueAtOffset(p.tree, p.spans, off)).toBe("aGVsbG8=");
  });
  it("returns null for a non-string node", () => {
    const text = `{"n":42}`;
    const p = parseWithSpans(text)!;
    expect(stringValueAtOffset(p.tree, p.spans, text.indexOf("42"))).toBeNull();
  });
});
