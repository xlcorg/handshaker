import { describe, it, expect } from "vitest";
import { badgeDecorationOptions } from "./badgeDecoration";
import { BADGE_CLASS } from "./controller";

describe("badgeDecorationOptions", () => {
  it("sets showIfCollapsed so the pill renders on its zero-width range", () => {
    // The badge anchors on a collapsed range (previewEnd == previewEnd). Monaco's
    // getAllInjectedText drops injected `after` text on collapsed ranges unless
    // showIfCollapsed is true — without it the pill never renders (the bug).
    expect(badgeDecorationOptions("4.9KB").showIfCollapsed).toBe(true);
  });

  it("injects the label as padded after-content with the badge class", () => {
    const o = badgeDecorationOptions("image/png · 4.9KB");
    expect(o.after.content).toBe(" image/png · 4.9KB ");
    expect(o.after.inlineClassName).toBe(BADGE_CLASS);
  });
});
