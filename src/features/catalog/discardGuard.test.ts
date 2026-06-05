import { describe, it, expect } from "vitest";
import { needsDiscardConfirm } from "./discardGuard";

describe("needsDiscardConfirm", () => {
  it("confirms only for a dirty UNBOUND draft", () => {
    expect(needsDiscardConfirm(null, true)).toBe(true);
  });
  it("no confirm when clean", () => {
    expect(needsDiscardConfirm(null, false)).toBe(false);
  });
  it("no confirm when bound (origin-bound autosaves)", () => {
    expect(needsDiscardConfirm({ collectionId: "c1", requestId: "r1" }, true)).toBe(false);
  });
});
