import { describe, it, expect } from "vitest";
import { newCatalogService, type CatalogService } from "./model";
import { buildServiceTree, filterTree } from "./tree";
import type { ServiceCatalogIpc, MethodEntryIpc } from "@/ipc/bindings";

function method(name: string): MethodEntryIpc {
  return {
    name,
    path: `/p.v1.S/${name}`,
    input_message: `${name}Request`,
    output_message: `${name}Response`,
    client_streaming: false,
    server_streaming: false,
  };
}

const contract: ServiceCatalogIpc = {
  services: [
    { full_name: "p.v1.S", methods: [method("Get"), method("List")] },
    { full_name: "grpc.health.v1.Health", methods: [method("Check")] },
  ],
};

function svcWith(): CatalogService {
  const s = newCatalogService({ address: "h:443" });
  s.contract = contract;
  s.curated = [{ service: "p.v1.S", method: "Get" }];
  return s;
}

describe("buildServiceTree", () => {
  it("merges contract (○) with curated (●), sorted", () => {
    const tree = buildServiceTree(svcWith());
    expect(tree.map((p) => p.fullName)).toEqual(["grpc.health.v1.Health", "p.v1.S"]);
    const sNode = tree.find((p) => p.fullName === "p.v1.S")!;
    const get = sNode.methods.find((m) => m.method === "Get")!;
    const list = sNode.methods.find((m) => m.method === "List")!;
    expect(get.inCollection).toBe(true);
    expect(get.inContract).toBe(true);
    expect(get.entry).not.toBeNull();
    expect(list.inCollection).toBe(false);
    expect(list.inContract).toBe(true);
  });

  it("includes curated methods absent from the contract (stale), entry null", () => {
    const s = newCatalogService({ address: "h" });
    s.contract = contract;
    s.curated = [{ service: "p.v1.S", method: "Removed" }];
    const node = buildServiceTree(s).find((p) => p.fullName === "p.v1.S")!;
    const removed = node.methods.find((m) => m.method === "Removed")!;
    expect(removed.inCollection).toBe(true);
    expect(removed.inContract).toBe(false);
    expect(removed.entry).toBeNull();
  });

  it("works with no contract — curated-only tree", () => {
    const s = newCatalogService({ address: "h" });
    s.curated = [{ service: "p.v1.S", method: "Get" }];
    const tree = buildServiceTree(s);
    expect(tree).toHaveLength(1);
    expect(tree[0].methods[0]).toMatchObject({ method: "Get", inCollection: true, inContract: false });
  });
});

describe("filterTree", () => {
  it("showAll=false keeps only ● methods", () => {
    const out = filterTree(buildServiceTree(svcWith()), { showAll: false, query: "" });
    expect(out).toHaveLength(1); // only p.v1.S (has the curated Get); Health dropped
    expect(out[0].methods.map((m) => m.method)).toEqual(["Get"]);
  });

  it("showAll=true keeps ● and ○", () => {
    const out = filterTree(buildServiceTree(svcWith()), { showAll: true, query: "" });
    expect(out.map((p) => p.fullName)).toEqual(["grpc.health.v1.Health", "p.v1.S"]);
  });

  it("filters by method-name substring (case-insensitive) and drops empty services", () => {
    const out = filterTree(buildServiceTree(svcWith()), { showAll: true, query: "lis" });
    expect(out).toHaveLength(1);
    expect(out[0].fullName).toBe("p.v1.S");
    expect(out[0].methods.map((m) => m.method)).toEqual(["List"]);
  });
});
