import { describe, it, expect } from "vitest";
import { isMacOSUA } from "./platform";

describe("isMacOSUA", () => {
  it("is true for a macOS WKWebView user-agent", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(isMacOSUA(ua)).toBe(true);
  });

  it("is false for a Windows user-agent", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    expect(isMacOSUA(ua)).toBe(false);
  });

  it("is false for a Linux user-agent", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
    expect(isMacOSUA(ua)).toBe(false);
  });
});
