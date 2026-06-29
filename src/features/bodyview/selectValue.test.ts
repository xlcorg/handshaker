import { describe, it, expect } from "vitest";
import { parseWithSpans } from "./parse";
import { valueSelectionAt } from "./selectValue";

describe("valueSelectionAt", () => {
  it("selects inner text (no quotes) of a string value", () => {
    const text = `{"k":"hello world"}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("hello"))!;
    expect(text.slice(r.start, r.end)).toBe("hello world");
  });

  it("selects the whole token of a number", () => {
    const text = `{"n":42}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("42"))!;
    expect(text.slice(r.start, r.end)).toBe("42");
  });

  it("selects a negative / exponential number whole", () => {
    const text = `{"n":-1.5e3}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("-1.5e3") + 1)!;
    expect(text.slice(r.start, r.end)).toBe("-1.5e3");
  });

  it("selects the whole token of a boolean", () => {
    const text = `{"b":true}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("true"))!;
    expect(text.slice(r.start, r.end)).toBe("true");
  });

  it("selects the whole token of null", () => {
    const text = `{"x":null}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("null"))!;
    expect(text.slice(r.start, r.end)).toBe("null");
  });

  it("returns an empty range between the quotes for an empty string", () => {
    const text = `{"k":""}`;
    const p = parseWithSpans(text)!;
    const off = text.indexOf(`""`) + 1; // between the two quotes
    const r = valueSelectionAt(p.tree, p.spans, off)!;
    expect(r.start).toBe(r.end);
    expect(text.slice(r.start, r.end)).toBe("");
  });

  it("returns null when the click lands on a key", () => {
    const text = `{"name":"Ada"}`;
    const p = parseWithSpans(text)!;
    expect(valueSelectionAt(p.tree, p.spans, text.indexOf("name"))).toBeNull();
  });

  it("returns null for an object value", () => {
    const text = `{"o":{"a":1}}`;
    const p = parseWithSpans(text)!;
    expect(valueSelectionAt(p.tree, p.spans, text.indexOf(`{"a"`))).toBeNull();
  });

  it("returns null for an array value", () => {
    const text = `{"a":[1,2,3]}`;
    const p = parseWithSpans(text)!;
    expect(valueSelectionAt(p.tree, p.spans, text.indexOf("[1,2,3]"))).toBeNull();
  });

  it("selects a scalar inside an array", () => {
    const text = `["a","bb","ccc"]`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("bb"))!;
    expect(text.slice(r.start, r.end)).toBe("bb");
  });

  it("selects a nested value", () => {
    const text = `{"o":{"a":"deep"}}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("deep"))!;
    expect(text.slice(r.start, r.end)).toBe("deep");
  });
});
