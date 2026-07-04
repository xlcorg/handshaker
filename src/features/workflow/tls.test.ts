import { describe, it, expect } from "vitest";
import { effectiveTls, nextTlsState } from "./tls";

describe("effectiveTls", () => {
  it("inherits the collection default when the override is null", () => {
    expect(effectiveTls(null, true)).toBe(true);
    expect(effectiveTls(null, false)).toBe(false);
  });

  it("uses the explicit override regardless of the default", () => {
    expect(effectiveTls(true, false)).toBe(true);
    expect(effectiveTls(false, true)).toBe(false);
  });
});

describe("nextTlsState", () => {
  it("cycles inherit → on → off → inherit", () => {
    expect(nextTlsState(null)).toBe(true);
    expect(nextTlsState(true)).toBe(false);
    expect(nextTlsState(false)).toBe(null);
  });
});
