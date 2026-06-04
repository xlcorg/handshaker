import { describe, it, expect } from "vitest";
import { PREFS_DEFAULTS, clampTimeoutMs } from "./use-prefs";

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
