import { describe, it, expect } from "vitest";
import type { CollectionIpc, GrpcTemplateIpc, HttpTemplateIpc, ItemIpc } from "@/ipc/bindings";
import { flattenRequests, rankRequests, rankCollections, requestLabelOf } from "./palette";

const httpTemplate: HttpTemplateIpc = {
  method: "DELETE",
  url_template: "{{base}}/users/{{id}}",
  query: [],
  headers: [],
  body: { kind: "none" },
  auth: { kind: "none" },
};

function req(id: string, name: string, template: Partial<GrpcTemplateIpc> = {}): ItemIpc {
  return {
    type: "request",
    id,
    name,
    template: { protocol: "grpc", address_template: "h:443", service: "p.v1.S", method: "GetX", body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null, ...template },
    last_used_at: null,
    use_count: 0,
  };
}
function folder(id: string, name: string, items: ItemIpc[]): ItemIpc {
  return { type: "folder", id, name, items, expanded: false };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
    expanded: false,
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

describe("rankCollections", () => {
  const tree = [
    col("c1", "edo-attorney-letters", []),
    col("c2", "edo-billing", []),
    col("c3", "orders", []),
  ];

  it("returns all collections when the query is empty", () => {
    const out = rankCollections("  ", tree);
    expect(out.map((h) => h.collection.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("keeps only fuzzy-matching collections", () => {
    const out = rankCollections("edo", tree);
    expect(out.map((h) => h.collection.id).sort()).toEqual(["c1", "c2"]);
  });

  it("ranks a tighter prefix match first and exposes match indices", () => {
    const out = rankCollections("orders", tree);
    expect(out[0].collection.id).toBe("c3");
    expect(out[0].indices.length).toBe(6);
  });
});

describe("requestLabelOf", () => {
  it("joins the short service name and method with a slash (method-picker trimming)", () => {
    const hits = flattenRequests([
      col("c1", "Orders", [req("r1", "GetOrder", { service: "ord.v1.OrderService", method: "GetOrder" })]),
    ]);
    expect(requestLabelOf(hits[0].request.template)).toBe("OrderService/GetOrder");
  });

  it("labels an HTTP request with its method and URL template", () => {
    expect(requestLabelOf({ protocol: "http", ...httpTemplate })).toBe("DELETE {{base}}/users/{{id}}");
  });
});

describe("HTTP requests in the palette", () => {
  const hits = flattenRequests([
    col("c1", "Users", [
      { type: "request", id: "h1", name: "Remove", template: { protocol: "http", ...httpTemplate }, last_used_at: null, use_count: 0 },
      req("r1", "GetOrder", { service: "ord.v1.OrderService", method: "GetOrder" }),
    ]),
  ]);

  it("matches an HTTP request on its URL", () => {
    expect(rankRequests("users/{{id}}", hits).map((h) => h.request.id)).toEqual(["h1"]);
  });

  it("matches an HTTP request on its method", () => {
    expect(rankRequests("DELETE", hits).map((h) => h.request.id)).toEqual(["h1"]);
  });
});
