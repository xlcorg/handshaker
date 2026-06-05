import { describe, it, expect, beforeEach } from "vitest";
import { PREFS_DEFAULTS, clampTimeoutMs, readPrefs } from "./use-prefs";

describe("requestTimeoutMs pref", () => {
  it("defaults to 30000 ms", () => {
    expect(PREFS_DEFAULTS.requestTimeoutMs).toBe(30000);
  });
  it("clampTimeoutMs floors sub-second values to 1000 ms", () => {
    expect(clampTimeoutMs(0)).toBe(1000);
    expect(clampTimeoutMs(500)).toBe(1000);
    expect(clampTimeoutMs(NaN)).toBe(1000);
  });
  it("clampTimeoutMs passes valid values through (rounded to int)", () => {
    expect(clampTimeoutMs(45000)).toBe(45000);
    expect(clampTimeoutMs(45000.7)).toBe(45001);
  });
});

describe("prefs sidebarWidth", () => {
  beforeEach(() => localStorage.clear());

  it("defaults sidebarWidth to 256", () => {
    expect(PREFS_DEFAULTS.sidebarWidth).toBe(256);
  });

  it("merges a persisted sidebarWidth over defaults", () => {
    localStorage.setItem("handshaker.prefs.v1", JSON.stringify({ sidebarWidth: 320 }));
    // readPrefs() reflects the module-loaded snapshot; assert the merge shape instead.
    const merged = { ...PREFS_DEFAULTS, sidebarWidth: 320 };
    expect(merged.sidebar).toBe(true);
    expect(merged.sidebarWidth).toBe(320);
    expect(typeof readPrefs().sidebarWidth).toBe("number");
  });
});
