import { describe, it, expect } from "vitest";
import { relativeTime, usageLabel } from "./usage";

const NOW = 1_700_000_000_000;
const m = (n: number) => n * 60_000;
const h = (n: number) => n * 3_600_000;
const d = (n: number) => n * 86_400_000;

describe("relativeTime", () => {
  it("reports sub-45s as 'just now' (and clamps future timestamps)", () => {
    expect(relativeTime(NOW, NOW)).toBe("just now");
    expect(relativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(relativeTime(NOW + 5_000, NOW)).toBe("just now"); // clamped, no negative
  });

  it("reports minutes, hours, and days", () => {
    expect(relativeTime(NOW - m(5), NOW)).toBe("5m ago");
    expect(relativeTime(NOW - h(2), NOW)).toBe("2h ago");
    expect(relativeTime(NOW - d(3), NOW)).toBe("3d ago");
  });

  it("falls back to a date string beyond ~a month", () => {
    const out = relativeTime(NOW - d(40), NOW);
    expect(out).not.toMatch(/ago|just now/);
    expect(out).toBe(new Date(NOW - d(40)).toLocaleDateString());
  });
});

describe("usageLabel", () => {
  it("is 'unused' at zero", () => {
    expect(usageLabel(0, null, NOW)).toBe("unused");
  });

  it("combines count and relative last-used", () => {
    expect(usageLabel(3, NOW - m(5), NOW)).toBe("3× · 5m ago");
  });

  it("shows just the count when used but missing a timestamp", () => {
    expect(usageLabel(1, null, NOW)).toBe("1×");
  });
});
