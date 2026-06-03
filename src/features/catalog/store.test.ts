import { describe, it, expect, beforeEach } from "vitest";
import { catalogStore } from "./store";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

beforeEach(() => catalogStore.reset());

const contract: ServiceCatalogIpc = { services: [] };

describe("catalogStore", () => {
  it("starts empty", () => {
    expect(catalogStore.getState().collection.services).toEqual([]);
  });

  it("addService appends and notifies subscribers", () => {
    let calls = 0;
    const unsub = catalogStore.subscribe(() => calls++);
    const svc = catalogStore.addService({ address: "h:443", label: "Pay" });
    expect(calls).toBe(1);
    expect(catalogStore.services()).toHaveLength(1);
    expect(catalogStore.getService(svc.id)?.label).toBe("Pay");
    unsub();
  });

  it("removeService removes by id", () => {
    const svc = catalogStore.addService({ address: "h" });
    catalogStore.removeService(svc.id);
    expect(catalogStore.services()).toEqual([]);
  });

  it("toggleFavorite flips the flag", () => {
    const svc = catalogStore.addService({ address: "h" });
    catalogStore.toggleFavorite(svc.id);
    expect(catalogStore.getService(svc.id)?.favorite).toBe(true);
    catalogStore.toggleFavorite(svc.id);
    expect(catalogStore.getService(svc.id)?.favorite).toBe(false);
  });

  it("curateMethod adds once (idempotent); uncurateMethod removes", () => {
    const svc = catalogStore.addService({ address: "h" });
    catalogStore.curateMethod(svc.id, "p.S", "Get");
    catalogStore.curateMethod(svc.id, "p.S", "Get"); // dup ignored
    expect(catalogStore.getService(svc.id)?.curated).toEqual([{ service: "p.S", method: "Get" }]);
    catalogStore.uncurateMethod(svc.id, "p.S", "Get");
    expect(catalogStore.getService(svc.id)?.curated).toEqual([]);
  });

  it("setContract stores the contract and fetch time", () => {
    const svc = catalogStore.addService({ address: "h" });
    catalogStore.setContract(svc.id, contract, 1234);
    expect(catalogStore.getService(svc.id)?.contract).toBe(contract);
    expect(catalogStore.getService(svc.id)?.contractFetchedAt).toBe(1234);
  });
});
