import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches an empty query against anything with score 0", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ matched: true, score: 0, indices: [] });
  });

  it("matches a subsequence and records indices", () => {
    const r = fuzzyMatch("pay", "payment-api");
    expect(r.matched).toBe(true);
    expect(r.indices).toEqual([0, 1, 2]);
  });

  it("returns not-matched when chars are missing or out of order", () => {
    expect(fuzzyMatch("xyz", "payment").matched).toBe(false);
  });

  it("scores a prefix match higher than a scattered one", () => {
    const prefix = fuzzyMatch("pay", "payment-service");
    const scattered = fuzzyMatch("pay", "proxy-relay-yak");
    expect(prefix.score).toBeGreaterThan(scattered.score);
  });
});
