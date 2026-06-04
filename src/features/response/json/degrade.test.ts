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
