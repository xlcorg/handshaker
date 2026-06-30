import { describe, it, expect } from "vitest";
import { responseFileName } from "./responseFileName";

describe("responseFileName", () => {
  it("is 'response' + a local timestamp", () => {
    // Local-time constructor: 2026-06-30 15:30:12 (month is 0-based → 5 = June).
    expect(responseFileName(new Date(2026, 5, 30, 15, 30, 12))).toBe(
      "response-2026-06-30T15-30-12.json",
    );
  });

  it("zero-pads single-digit date/time components", () => {
    expect(responseFileName(new Date(2026, 0, 5, 9, 8, 7))).toBe(
      "response-2026-01-05T09-08-07.json",
    );
  });
});
