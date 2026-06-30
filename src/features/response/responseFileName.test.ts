import { describe, it, expect } from "vitest";
import { responseFileName } from "./responseFileName";

// Local-time constructor: 2026-06-30 15:30:12 (month is 0-based → 5 = June).
const FIXED = new Date(2026, 5, 30, 15, 30, 12);

describe("responseFileName", () => {
  it("uses the method name + local timestamp", () => {
    expect(responseFileName("GetUser", FIXED)).toBe("GetUser-2026-06-30T15-30-12.json");
  });

  it("falls back to 'response' when the method is empty", () => {
    expect(responseFileName("", FIXED)).toBe("response-2026-06-30T15-30-12.json");
  });

  it("falls back to 'response' when the method is whitespace-only", () => {
    expect(responseFileName("   ", FIXED)).toBe("response-2026-06-30T15-30-12.json");
  });

  it("strips filename-unsafe characters from the method", () => {
    expect(responseFileName("My/Method!", FIXED)).toBe("MyMethod-2026-06-30T15-30-12.json");
  });

  it("zero-pads single-digit date/time components", () => {
    const d = new Date(2026, 0, 5, 9, 8, 7); // 2026-01-05 09:08:07
    expect(responseFileName("M", d)).toBe("M-2026-01-05T09-08-07.json");
  });
});
