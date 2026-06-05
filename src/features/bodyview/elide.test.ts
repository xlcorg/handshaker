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
