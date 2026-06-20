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

  it("collapses the reserved scrollbar slot to 0 when the minimap shows (minimap sits flush to the edge)", () => {
    // Monaco reserves `verticalScrollbarSize` px at the right edge for the vertical
    // scrollbar REGARDLESS of `vertical:"hidden"` — its layout positions a right-side
    // minimap at `outerWidth - minimapWidth - verticalScrollbarSize`. So hiding the
    // scrollbar without also zeroing its size leaves a blank band between the minimap
    // and the edge. Zero the size in the shown state to reclaim that slot.
    expect(minimapToggleOptions(true).scrollbar.verticalScrollbarSize).toBe(0);
  });

  it("restores the grabbable 14px scrollbar when the minimap hides", () => {
    expect(minimapToggleOptions(false).scrollbar.verticalScrollbarSize).toBe(14);
  });

  it("re-specifies the sibling scrollbar fields so updateOptions can't reset them to defaults", () => {
    // editor.updateOptions replaces the scrollbar option object; any unspecified
    // field would fall back to a Monaco default. Keep horizontal size + scrollByPage
    // present in BOTH toggle states (in sync with EDITOR_OPTIONS.scrollbar).
    for (const opts of [minimapToggleOptions(true), minimapToggleOptions(false)]) {
      expect(opts.scrollbar.horizontalScrollbarSize).toBe(8);
      expect(opts.scrollbar.scrollByPage).toBe(true);
    }
  });
});
