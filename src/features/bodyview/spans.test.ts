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
