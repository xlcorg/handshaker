import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("prose UI string ratchet", () => {
  it("stays within the baseline", () => {
    const out = execFileSync("python3", ["scripts/check-prose-ratchet.py"], {
      encoding: "utf8",
    });
    expect(out).toMatch(/prose UI strings: \d+ \(baseline \d+\)/);
  });
});
