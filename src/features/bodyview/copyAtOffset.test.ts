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
