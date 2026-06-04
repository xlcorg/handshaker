import { describe, it, expect } from "vitest";
import {
  newCatalogService,
  newCollection,
  methodKey,
  isCurated,
} from "./model";

describe("newCatalogService", () => {
  it("creates a service with defaults and a unique id", () => {
    const a = newCatalogService({ address: "pay-api:443" });
    const b = newCatalogService({ address: "pay-api:443" });
    expect(a.id).not.toEqual(b.id);
    expect(a.address).toBe("pay-api:443");
    expect(a.label).toBe("pay-api:443"); // defaults to address
    expect(a.tls).toBe(false);
    expect(a.skipVerify).toBe(false);
    expect(a.thirdParty).toBe(false);
    expect(a.team).toBeNull();
    expect(a.favorite).toBe(false);
    expect(a.curated).toEqual([]);
    expect(a.contract).toBeNull();
    expect(a.contractFetchedAt).toBeNull();
  });

  it("uses an explicit label and flags when given", () => {
    const s = newCatalogService({
      address: "h:443",
      label: "Payments",
      tls: true,
      thirdParty: true,
      team: "billing",
    });
    expect(s.label).toBe("Payments");
    expect(s.tls).toBe(true);
    expect(s.thirdParty).toBe(true);
    expect(s.team).toBe("billing");
  });

  it("falls back to address when label is blank", () => {
    expect(newCatalogService({ address: "h:443", label: "   " }).label).toBe("h:443");
  });
});

describe("newCollection", () => {
  it("creates an empty collection", () => {
    expect(newCollection().services).toEqual([]);
  });
});

describe("methodKey / isCurated", () => {
  it("builds a stable key", () => {
    expect(methodKey("p.v1.S", "Get")).toBe("p.v1.S/Get");
  });
  it("detects curated membership", () => {
    const s = newCatalogService({ address: "h" });
    s.curated.push({ service: "p.v1.S", method: "Get" });
    expect(isCurated(s, "p.v1.S", "Get")).toBe(true);
    expect(isCurated(s, "p.v1.S", "List")).toBe(false);
  });
});

it("newCatalogService defaults auth to none and defaultMetadata to empty", () => {
  const svc = newCatalogService({ address: "h:443" });
  expect(svc.auth).toEqual({ kind: "none" });
  expect(svc.defaultMetadata).toEqual([]);
});
