import { describe, it, expect } from "vitest";
import { shouldShowMinimap, MINIMAP_OVERFLOW_TOLERANCE } from "./minimapGate";

describe("shouldShowMinimap", () => {
  it("is false when content fits the viewport", () => {
    expect(shouldShowMinimap(300, 600)).toBe(false);
  });

  it("is false when content equals the viewport", () => {
    expect(shouldShowMinimap(600, 600)).toBe(false);
  });

  it("is false for an overflow within the tolerance (no flicker at the boundary)", () => {
    expect(shouldShowMinimap(600 + MINIMAP_OVERFLOW_TOLERANCE, 600)).toBe(false);
  });

  it("is true once content overflows beyond the tolerance", () => {
    expect(shouldShowMinimap(600 + MINIMAP_OVERFLOW_TOLERANCE + 1, 600)).toBe(true);
  });

  it("is true for a clearly larger document", () => {
    expect(shouldShowMinimap(5000, 600)).toBe(true);
  });
});
