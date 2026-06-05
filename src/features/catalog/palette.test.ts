import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { flattenRequests, rankRequests } from "./palette";

function req(id: string, name: string, over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request",
    id,
    name,
    address_template: "h:443",
    service: "p.v1.S",
    method: "GetX",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
    ...over,
  };
}
function folder(id: string, name: string, items: ItemIpc[]): ItemIpc {
  return { type: "folder", id, name, items };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

describe("flattenRequests", () => {
  it("flattens nested folders into hits carrying collection + folder path", () => {
    const tree = [
      col("c1", "Orders", [folder("f1", "v1", [req("r1", "GetOrder")])]),
      col("c2", "Inv", [req("r2", "ListItems")]),
    ];
    const hits = flattenRequests(tree);
    expect(hits).toHaveLength(2);
    const h1 = hits.find((h) => h.request.id === "r1")!;
    expect(h1.collectionId).toBe("c1");
    expect(h1.collectionName).toBe("Orders");
    expect(h1.folderPath).toEqual(["v1"]);
    const h2 = hits.find((h) => h.request.id === "r2")!;
    expect(h2.folderPath).toEqual([]);
  });
});

describe("rankRequests", () => {
  const hits = flattenRequests([
    col("c1", "Orders", [
      req("r1", "GetOrder", { service: "ord.v1.OrderService", method: "GetOrder", address_template: "orders:443" }),
      req("r2", "ListItems", { service: "inv.v1.Inventory", method: "ListItems", address_template: "inv:443" }),
    ]),
  ]);

  it("returns all hits sorted by name when the query is empty", () => {
    const out = rankRequests("  ", hits);
    expect(out.map((h) => h.request.name)).toEqual(["GetOrder", "ListItems"]);
  });

  it("matches on the request name", () => {
    const out = rankRequests("listit", hits);
    expect(out.map((h) => h.request.id)).toEqual(["r2"]);
  });

  it("matches on service/method", () => {
    const out = rankRequests("OrderService", hits);
    expect(out[0].request.id).toBe("r1");
  });

  it("matches on the address", () => {
    const out = rankRequests("inv:443", hits);
    expect(out.map((h) => h.request.id)).toEqual(["r2"]);
  });
});
