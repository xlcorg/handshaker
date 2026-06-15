import { describe, it, expect } from "vitest";
import { statusName, statusDescription, formatByteCount } from "./grpc-status";

describe("statusName", () => {
  it("maps canonical codes", () => {
    expect(statusName(0)).toBe("OK");
    expect(statusName(5)).toBe("NOT_FOUND");
    expect(statusName(14)).toBe("UNAVAILABLE");
  });
  it("falls back for unknown codes", () => {
    expect(statusName(99)).toBe("CODE_99");
  });
});

describe("statusDescription", () => {
  it("describes canonical codes", () => {
    expect(statusDescription(5)).toMatch(/not found/i);
    expect(statusDescription(14)).toMatch(/unavailable/i);
    expect(statusDescription(16)).toMatch(/authentication/i);
  });
  it("falls back for non-standard codes", () => {
    expect(statusDescription(99)).toMatch(/non-standard/i);
  });
});

describe("formatByteCount", () => {
  it("formats raw byte counts", () => {
    expect(formatByteCount(512)).toBe("512B");
    expect(formatByteCount(2048)).toBe("2.0KB");
    expect(formatByteCount(3 * 1024 * 1024)).toBe("3.0MB");
    expect(formatByteCount(-1)).toBe("0B");
  });
});
