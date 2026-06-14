import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// vitest runs with the repo root as cwd.
const html = readFileSync("index.html", "utf8");

describe("index.html startup splash", () => {
  it("ships an inline #splash overlay on a dark background", () => {
    expect(html).toContain('id="splash"');
    expect(html).toContain("#0A0A0A");
  });

  it("has a safety timeout that removes the overlay if the bundle never boots", () => {
    expect(html).toContain("__splashKill");
  });

  it("renders the wordmark in a system font (no Inter FOUT before the bundle)", () => {
    expect(html).toContain("Handshaker");
    expect(html).toContain("system-ui");
  });
});
