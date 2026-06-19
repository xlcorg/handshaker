import { describe, it, expect } from "vitest";
import {
  shouldShowMinimap,
  MINIMAP_OVERFLOW_TOLERANCE,
  minimapToggleOptions,
} from "./minimapGate";

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

describe("minimapToggleOptions", () => {
  it("when the minimap shows, hides the vertical scrollbar and pins the minimap slider", () => {
    const opts = minimapToggleOptions(true);
    expect(opts.minimap.enabled).toBe(true);
    expect(opts.minimap.showSlider).toBe("always");
    // No second bar: the minimap (with an always-visible slider) IS the vertical
    // navigation, so the redundant vertical scrollbar is removed.
    expect(opts.scrollbar.vertical).toBe("hidden");
  });

  it("when the minimap hides, restores the vertical scrollbar (auto)", () => {
    const opts = minimapToggleOptions(false);
    expect(opts.minimap.enabled).toBe(false);
    // Small response / 8px gate band: the scrollbar is the only affordance again.
    expect(opts.scrollbar.vertical).toBe("auto");
  });

  it("re-specifies the full scrollbar so updateOptions can't reset sibling fields to defaults", () => {
    // editor.updateOptions replaces the scrollbar option object; any unspecified
    // field would fall back to a Monaco default. Keep size + scrollByPage present
    // in BOTH toggle states (must stay in sync with EDITOR_OPTIONS.scrollbar).
    for (const opts of [minimapToggleOptions(true), minimapToggleOptions(false)]) {
      expect(opts.scrollbar.verticalScrollbarSize).toBe(14);
      expect(opts.scrollbar.horizontalScrollbarSize).toBe(8);
      expect(opts.scrollbar.scrollByPage).toBe(true);
    }
  });
});
