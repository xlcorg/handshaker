import { describe, it, expect } from "vitest";
import { fuzzyMatch, rankServices } from "./fuzzy";
import { newCatalogService, type CatalogService } from "./model";

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

describe("rankServices", () => {
  function svc(label: string, extra: Partial<CatalogService> = {}): CatalogService {
    return { ...newCatalogService({ address: `${label}:443`, label }), ...extra };
  }

  it("drops non-matching services and orders by score (best first)", () => {
    const services = [svc("order-api"), svc("payment-api"), svc("inventory")];
    const out = rankServices("pay", services);
    expect(out.map((r) => r.service.label)).toContain("payment-api");
    expect(out.find((r) => r.service.label === "inventory")).toBeUndefined();
    expect(out[0].service.label).toBe("payment-api");
  });

  it("matches on address when the label does not", () => {
    const s = svc("Billing", { address: "pay-internal:443" });
    const out = rankServices("pay", [s]);
    expect(out).toHaveLength(1);
  });

  it("breaks ties toward favorites", () => {
    const plain = svc("payment-a");
    const fav = svc("payment-b", { favorite: true });
    const out = rankServices("payment", [plain, fav]);
    expect(out[0].service.label).toBe("payment-b");
  });

  it("returns all services (score 0) for an empty query", () => {
    const out = rankServices("", [svc("a"), svc("b")]);
    expect(out).toHaveLength(2);
  });
});
